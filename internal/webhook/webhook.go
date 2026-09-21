package webhook

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

// Webhook defines a configured webhook endpoint for change events.
type Webhook struct {
	ID           string            `json:"id"`
	ConnectionID string            `json:"connection_id"`
	Name         string            `json:"name"`
	URL          string            `json:"url"`
	Secret       string            `json:"secret,omitempty"`
	Events       []string          `json:"events"` // "INSERT", "UPDATE", "DELETE", or "*"
	Tables       []string          `json:"tables"` // table names or "*"
	Enabled      bool              `json:"enabled"`
	Headers      map[string]string `json:"headers,omitempty"`
	CreatedAt    time.Time         `json:"created_at"`
}

// DeliveryLog captures the result and payload of a webhook HTTP dispatch.
type DeliveryLog struct {
	ID                 string    `json:"id"`
	WebhookID          string    `json:"webhook_id,omitempty"`
	WebhookName        string    `json:"webhook_name,omitempty"`
	ConnectionID       string    `json:"connection_id,omitempty"`
	Event              string    `json:"event"`
	URL                string    `json:"url"`
	RequestPayload     string    `json:"request_payload"`
	ResponseStatusCode int       `json:"response_status_code"`
	ResponseBody       string    `json:"response_body"`
	LatencyMs          int64     `json:"latency_ms"`
	Error              string    `json:"error,omitempty"`
	Timestamp          time.Time `json:"timestamp"`
}

// EventPayload defines standardized database change event JSON schema.
type EventPayload struct {
	ID        string         `json:"id"`
	Event     string         `json:"event"` // "INSERT" | "UPDATE" | "DELETE"
	Schema    string         `json:"schema"`
	Table     string         `json:"table"`
	OldRecord map[string]any `json:"old_record,omitempty"`
	NewRecord map[string]any `json:"new_record,omitempty"`
	Timestamp string         `json:"timestamp"` // RFC3339
}

// SimulateRequest configures a synthetic change event dispatch.
type SimulateRequest struct {
	WebhookID string         `json:"webhook_id,omitempty"`
	URL       string         `json:"url,omitempty"`
	Secret    string         `json:"secret,omitempty"`
	Event     string         `json:"event"` // "INSERT", "UPDATE", "DELETE"
	Schema    string         `json:"schema"`
	Table     string         `json:"table"`
	OldRecord map[string]any `json:"old_record,omitempty"`
	NewRecord map[string]any `json:"new_record,omitempty"`
}

// SimulateResponse contains delivery details of simulated synthetic event.
type SimulateResponse struct {
	Delivery DeliveryLog `json:"delivery"`
	Success  bool        `json:"success"`
	Error    string      `json:"error,omitempty"`
}

var (
	_, linkLocalV4, _ = net.ParseCIDR("169.254.0.0/16")
	_, linkLocalV6, _ = net.ParseCIDR("fe80::/10")
)

// ValidateWebhookURL verifies the webhook target URL and enforces SSRF protection.
// Blocks link-local addresses and cloud metadata services.
func ValidateWebhookURL(targetURL string) error {
	u, err := url.Parse(strings.TrimSpace(targetURL))
	if err != nil {
		return fmt.Errorf("invalid webhook url: %w", err)
	}

	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("invalid scheme %q: only http and https are permitted", u.Scheme)
	}

	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("missing host in webhook url")
	}

	hostLower := strings.ToLower(host)
	if hostLower == "169.254.169.254" ||
		hostLower == "metadata.google.internal" ||
		hostLower == "instance-data" ||
		strings.HasSuffix(hostLower, ".metadata.google.internal") ||
		strings.HasSuffix(hostLower, ".instance-data") {
		return fmt.Errorf("webhook target blocked: cloud metadata access prohibited")
	}

	ip := net.ParseIP(host)
	if ip != nil {
		if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
			(linkLocalV4 != nil && linkLocalV4.Contains(ip)) ||
			(linkLocalV6 != nil && linkLocalV6.Contains(ip)) {
			return fmt.Errorf("webhook target blocked: link-local addresses prohibited")
		}
	}

	return nil
}

// ComputeHMACSHA256 generates hex-encoded HMAC-SHA256 signature with "sha256=" prefix.
func ComputeHMACSHA256(secret string, payload []byte) string {
	if secret == "" {
		return ""
	}
	h := hmac.New(sha256.New, []byte(secret))
	h.Write(payload)
	return "sha256=" + hex.EncodeToString(h.Sum(nil))
}

// VerifyHMACSHA256 checks if signatureHeader matches computed HMAC-SHA256 signature.
func VerifyHMACSHA256(secret string, payload []byte, signatureHeader string) bool {
	if secret == "" {
		return signatureHeader == ""
	}
	expected := ComputeHMACSHA256(secret, payload)
	return hmac.Equal([]byte(expected), []byte(signatureHeader))
}

// GenerateID produces a random prefixed identifier.
func GenerateID(prefix string) string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%s%d", prefix, time.Now().UnixNano())
	}
	return prefix + hex.EncodeToString(b)
}

// MatchesEvent returns true if event is matched by configured events.
func MatchesEvent(configuredEvents []string, event string) bool {
	if len(configuredEvents) == 0 {
		return true
	}
	for _, e := range configuredEvents {
		eTrim := strings.TrimSpace(e)
		if eTrim == "*" || strings.EqualFold(eTrim, event) {
			return true
		}
	}
	return false
}

// MatchesTable returns true if table is matched by configured tables.
func MatchesTable(configuredTables []string, schema, table string) bool {
	if len(configuredTables) == 0 {
		return true
	}
	for _, t := range configuredTables {
		tTrim := strings.TrimSpace(t)
		if tTrim == "*" ||
			strings.EqualFold(tTrim, table) ||
			(schema != "" && strings.EqualFold(tTrim, schema+"."+table)) {
			return true
		}
	}
	return false
}

const MaxDeliveryHistory = 100

// Manager manages registered webhooks and their delivery history.
type Manager struct {
	mu          sync.RWMutex
	webhooks    map[string]map[string]Webhook // connID -> id -> Webhook
	deliveries  []DeliveryLog                 // newest first, capped at MaxDeliveryHistory
	httpClient  *http.Client
	httpTimeout time.Duration
}

// NewManager creates a new thread-safe Webhook Manager.
func NewManager() *Manager {
	return &Manager{
		webhooks:   make(map[string]map[string]Webhook),
		deliveries: make([]DeliveryLog, 0, MaxDeliveryHistory),
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		httpTimeout: 10 * time.Second,
	}
}

// WithHTTPClient overrides the HTTP client for testing.
func (m *Manager) WithHTTPClient(client *http.Client) *Manager {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.httpClient = client
	return m
}

// SetTimeout sets request timeout duration.
func (m *Manager) SetTimeout(d time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.httpTimeout = d
}

// Create registers a new webhook under connID.
func (m *Manager) Create(connID string, wh Webhook) (Webhook, error) {
	wh.Name = strings.TrimSpace(wh.Name)
	if wh.Name == "" {
		return Webhook{}, errors.New("webhook name is required")
	}

	wh.URL = strings.TrimSpace(wh.URL)
	if wh.URL == "" {
		return Webhook{}, errors.New("webhook url is required")
	}

	if err := ValidateWebhookURL(wh.URL); err != nil {
		return Webhook{}, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if wh.ID == "" {
		wh.ID = GenerateID("wh_")
	}
	wh.ConnectionID = connID
	wh.CreatedAt = time.Now().UTC()

	if len(wh.Events) == 0 {
		wh.Events = []string{"INSERT", "UPDATE", "DELETE"}
	}
	if len(wh.Tables) == 0 {
		wh.Tables = []string{"*"}
	}

	if m.webhooks[connID] == nil {
		m.webhooks[connID] = make(map[string]Webhook)
	}
	m.webhooks[connID][wh.ID] = wh
	return wh, nil
}

// Get retrieves a webhook by id and connection id.
func (m *Manager) Get(connID, id string) (Webhook, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	whMap, ok := m.webhooks[connID]
	if !ok {
		return Webhook{}, errors.New("webhook not found")
	}
	wh, ok := whMap[id]
	if !ok {
		return Webhook{}, errors.New("webhook not found")
	}
	return wh, nil
}

// List returns all webhooks registered for connID sorted newest first.
func (m *Manager) List(connID string) []Webhook {
	m.mu.RLock()
	defer m.mu.RUnlock()

	whMap := m.webhooks[connID]
	result := make([]Webhook, 0, len(whMap))
	for _, wh := range whMap {
		result = append(result, wh)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	return result
}

// Update updates an existing webhook.
func (m *Manager) Update(connID, id string, wh Webhook) (Webhook, error) {
	wh.Name = strings.TrimSpace(wh.Name)
	if wh.Name == "" {
		return Webhook{}, errors.New("webhook name is required")
	}

	wh.URL = strings.TrimSpace(wh.URL)
	if wh.URL == "" {
		return Webhook{}, errors.New("webhook url is required")
	}

	if err := ValidateWebhookURL(wh.URL); err != nil {
		return Webhook{}, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	whMap, ok := m.webhooks[connID]
	if !ok {
		return Webhook{}, errors.New("webhook not found")
	}
	existing, ok := whMap[id]
	if !ok {
		return Webhook{}, errors.New("webhook not found")
	}

	wh.ID = id
	wh.ConnectionID = connID
	wh.CreatedAt = existing.CreatedAt
	if len(wh.Events) == 0 {
		wh.Events = existing.Events
	}
	if len(wh.Tables) == 0 {
		wh.Tables = existing.Tables
	}

	whMap[id] = wh
	return wh, nil
}

// Delete removes a webhook.
func (m *Manager) Delete(connID, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	whMap, ok := m.webhooks[connID]
	if !ok {
		return errors.New("webhook not found")
	}
	if _, ok := whMap[id]; !ok {
		return errors.New("webhook not found")
	}
	delete(whMap, id)
	return nil
}

// RecordDelivery saves a delivery log, maintaining a capped buffer of MaxDeliveryHistory.
func (m *Manager) RecordDelivery(log DeliveryLog) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.deliveries = append([]DeliveryLog{log}, m.deliveries...)
	if len(m.deliveries) > MaxDeliveryHistory {
		m.deliveries = m.deliveries[:MaxDeliveryHistory]
	}
}

// GetDeliveries returns delivery logs for connID (or all if connID is empty), newest first.
func (m *Manager) GetDeliveries(connID string) []DeliveryLog {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if connID == "" {
		cp := make([]DeliveryLog, len(m.deliveries))
		copy(cp, m.deliveries)
		return cp
	}

	result := make([]DeliveryLog, 0, len(m.deliveries))
	for _, d := range m.deliveries {
		if d.ConnectionID == connID || d.ConnectionID == "" {
			result = append(result, d)
		}
	}
	return result
}

// GetDelivery retrieves a delivery log by ID.
func (m *Manager) GetDelivery(id string) (DeliveryLog, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, d := range m.deliveries {
		if d.ID == id {
			return d, nil
		}
	}
	return DeliveryLog{}, errors.New("delivery not found")
}

// Dispatch executes HTTP POST request to targetURL with HMAC signature and custom headers.
func (m *Manager) Dispatch(ctx context.Context, targetURL, secret string, headers map[string]string, payloadBytes []byte, event, webhookID, webhookName, connID string) DeliveryLog {
	deliveryID := GenerateID("del_")
	now := time.Now().UTC()

	log := DeliveryLog{
		ID:                 deliveryID,
		WebhookID:          webhookID,
		WebhookName:        webhookName,
		ConnectionID:       connID,
		Event:              event,
		URL:                targetURL,
		RequestPayload:     string(payloadBytes),
		ResponseStatusCode: 0,
		Timestamp:          now,
	}

	if err := ValidateWebhookURL(targetURL); err != nil {
		log.Error = err.Error()
		m.RecordDelivery(log)
		return log
	}

	m.mu.RLock()
	timeout := m.httpTimeout
	client := m.httpClient
	m.mu.RUnlock()

	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	if client == nil {
		client = http.DefaultClient
	}

	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodPost, targetURL, bytes.NewReader(payloadBytes))
	if err != nil {
		log.Error = err.Error()
		m.RecordDelivery(log)
		return log
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-DBLens-Delivery", deliveryID)
	httpReq.Header.Set("X-DBLens-Event", event)
	if secret != "" {
		sig := ComputeHMACSHA256(secret, payloadBytes)
		if sig != "" {
			httpReq.Header.Set("X-DBLens-Signature", sig)
		}
	}
	for k, v := range headers {
		httpReq.Header.Set(k, v)
	}

	start := time.Now()
	resp, err := client.Do(httpReq)
	log.LatencyMs = time.Since(start).Milliseconds()

	if err != nil {
		log.Error = err.Error()
		m.RecordDelivery(log)
		return log
	}
	defer resp.Body.Close()

	log.ResponseStatusCode = resp.StatusCode
	bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	log.ResponseBody = string(bodyBytes)

	m.RecordDelivery(log)
	return log
}

// RetryDelivery re-sends a prior delivery payload.
func (m *Manager) RetryDelivery(ctx context.Context, id string) (DeliveryLog, error) {
	orig, err := m.GetDelivery(id)
	if err != nil {
		return DeliveryLog{}, err
	}

	targetURL := orig.URL
	var secret string
	var headers map[string]string
	whName := orig.WebhookName

	if orig.WebhookID != "" && orig.ConnectionID != "" {
		if wh, err := m.Get(orig.ConnectionID, orig.WebhookID); err == nil {
			targetURL = wh.URL
			secret = wh.Secret
			headers = wh.Headers
			whName = wh.Name
		}
	}

	newLog := m.Dispatch(ctx, targetURL, secret, headers, []byte(orig.RequestPayload), orig.Event, orig.WebhookID, whName, orig.ConnectionID)
	return newLog, nil
}

// Simulate sends a synthetic change event to a target webhook or direct URL.
func (m *Manager) Simulate(ctx context.Context, connID string, req SimulateRequest) (SimulateResponse, error) {
	targetURL := strings.TrimSpace(req.URL)
	secret := req.Secret
	var headers map[string]string
	webhookName := "Synthetic Simulator"
	webhookID := req.WebhookID

	if req.WebhookID != "" {
		wh, err := m.Get(connID, req.WebhookID)
		if err != nil {
			return SimulateResponse{}, fmt.Errorf("webhook not found: %w", err)
		}
		targetURL = wh.URL
		secret = wh.Secret
		headers = wh.Headers
		webhookName = wh.Name
	}

	if targetURL == "" {
		return SimulateResponse{}, errors.New("target url is required")
	}

	if err := ValidateWebhookURL(targetURL); err != nil {
		return SimulateResponse{}, err
	}

	evtType := strings.ToUpper(strings.TrimSpace(req.Event))
	if evtType == "" {
		evtType = "INSERT"
	}

	tbl := strings.TrimSpace(req.Table)
	if tbl == "" {
		tbl = "synthetic_table"
	}

	payload := EventPayload{
		ID:        GenerateID("evt_"),
		Event:     evtType,
		Schema:    req.Schema,
		Table:     tbl,
		OldRecord: req.OldRecord,
		NewRecord: req.NewRecord,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return SimulateResponse{}, fmt.Errorf("failed to marshal event payload: %w", err)
	}

	delivery := m.Dispatch(ctx, targetURL, secret, headers, payloadBytes, evtType, webhookID, webhookName, connID)
	success := delivery.ResponseStatusCode >= 200 && delivery.ResponseStatusCode < 300 && delivery.Error == ""

	return SimulateResponse{
		Delivery: delivery,
		Success:  success,
		Error:    delivery.Error,
	}, nil
}

// DispatchEvent checks matching registered webhooks for connID and dispatches payloads.
func (m *Manager) DispatchEvent(ctx context.Context, connID string, payload EventPayload) []DeliveryLog {
	m.mu.RLock()
	whMap := m.webhooks[connID]
	targets := make([]Webhook, 0, len(whMap))
	for _, wh := range whMap {
		if !wh.Enabled {
			continue
		}
		if !MatchesEvent(wh.Events, payload.Event) {
			continue
		}
		if !MatchesTable(wh.Tables, payload.Schema, payload.Table) {
			continue
		}
		targets = append(targets, wh)
	}
	m.mu.RUnlock()

	if len(targets) == 0 {
		return nil
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil
	}

	deliveries := make([]DeliveryLog, 0, len(targets))
	for _, wh := range targets {
		log := m.Dispatch(ctx, wh.URL, wh.Secret, wh.Headers, payloadBytes, payload.Event, wh.ID, wh.Name, connID)
		deliveries = append(deliveries, log)
	}
	return deliveries
}

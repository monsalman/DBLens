package webhook

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestValidateWebhookURL_SSRF(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		blocked bool
	}{
		{"valid https", "https://api.example.com/webhook", false},
		{"valid http", "http://example.com:8080/events", false},
		{"invalid scheme ftp", "ftp://example.com/webhook", true},
		{"invalid scheme file", "file:///etc/passwd", true},
		{"aws metadata ip", "http://169.254.169.254/latest/meta-data", true},
		{"aws metadata with port", "http://169.254.169.254:8080/path", true},
		{"link-local ipv4", "http://169.254.1.1/hook", true},
		{"link-local ipv4 border", "http://169.254.255.254/hook", true},
		{"google metadata domain", "http://metadata.google.internal/computeMetadata/v1", true},
		{"subdomain google metadata", "http://foo.metadata.google.internal/path", true},
		{"instance-data domain", "http://instance-data/path", true},
		{"subdomain instance-data", "http://api.instance-data/path", true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateWebhookURL(tc.url)
			if tc.blocked && err == nil {
				t.Errorf("expected URL %q to be blocked, but was allowed", tc.url)
			}
			if !tc.blocked && err != nil {
				t.Errorf("expected URL %q to be allowed, but got error: %v", tc.url, err)
			}
		})
	}
}

func TestHMACSHA256(t *testing.T) {
	secret := "super-secret-key"
	payload := []byte(`{"event":"INSERT","table":"users"}`)

	sig := ComputeHMACSHA256(secret, payload)
	if !strings.HasPrefix(sig, "sha256=") {
		t.Fatalf("expected prefix sha256=, got: %s", sig)
	}

	if !VerifyHMACSHA256(secret, payload, sig) {
		t.Fatal("expected HMAC verification to succeed")
	}

	// Tampered payload
	tamperedPayload := []byte(`{"event":"INSERT","table":"users","tampered":true}`)
	if VerifyHMACSHA256(secret, tamperedPayload, sig) {
		t.Fatal("expected HMAC verification to fail for tampered payload")
	}

	// Wrong secret
	if VerifyHMACSHA256("wrong-secret", payload, sig) {
		t.Fatal("expected HMAC verification to fail with wrong secret")
	}

	// Empty secret
	if ComputeHMACSHA256("", payload) != "" {
		t.Fatal("empty secret should return empty signature")
	}
}

func TestWebhookManager_CRUD(t *testing.T) {
	mgr := NewManager()
	connID := "conn_test_1"

	// Create
	wh, err := mgr.Create(connID, Webhook{
		Name:    "Test Webhook",
		URL:     "https://webhook.site/test-uuid",
		Secret:  "test-secret",
		Events:  []string{"INSERT", "UPDATE"},
		Tables:  []string{"users", "orders"},
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("failed to create webhook: %v", err)
	}
	if wh.ID == "" {
		t.Fatal("expected webhook ID to be generated")
	}
	if wh.ConnectionID != connID {
		t.Fatalf("expected connection ID %s, got %s", connID, wh.ConnectionID)
	}

	// Get
	fetched, err := mgr.Get(connID, wh.ID)
	if err != nil {
		t.Fatalf("failed to get webhook: %v", err)
	}
	if fetched.Name != wh.Name {
		t.Fatalf("expected name %s, got %s", wh.Name, fetched.Name)
	}

	// List
	list := mgr.List(connID)
	if len(list) != 1 {
		t.Fatalf("expected 1 webhook, got %d", len(list))
	}

	// Update
	wh.Name = "Updated Webhook Name"
	wh.Enabled = false
	updated, err := mgr.Update(connID, wh.ID, wh)
	if err != nil {
		t.Fatalf("failed to update webhook: %v", err)
	}
	if updated.Name != "Updated Webhook Name" || updated.Enabled != false {
		t.Fatalf("update failed, got name=%s enabled=%v", updated.Name, updated.Enabled)
	}

	// Delete
	if err := mgr.Delete(connID, wh.ID); err != nil {
		t.Fatalf("failed to delete webhook: %v", err)
	}
	if _, err := mgr.Get(connID, wh.ID); err == nil {
		t.Fatal("expected error getting deleted webhook")
	}
	if len(mgr.List(connID)) != 0 {
		t.Fatal("expected list to be empty after deletion")
	}
}

func TestMatchesEventAndTable(t *testing.T) {
	// Event matches
	if !MatchesEvent([]string{"INSERT", "UPDATE"}, "insert") {
		t.Fatal("expected case-insensitive INSERT to match")
	}
	if !MatchesEvent([]string{"*"}, "DELETE") {
		t.Fatal("expected wildcard event to match")
	}
	if !MatchesEvent(nil, "DELETE") {
		t.Fatal("expected empty events to match all")
	}
	if MatchesEvent([]string{"INSERT"}, "DELETE") {
		t.Fatal("expected DELETE not to match [INSERT]")
	}

	// Table matches
	if !MatchesTable([]string{"*"}, "public", "users") {
		t.Fatal("expected wildcard table to match")
	}
	if !MatchesTable([]string{"users"}, "public", "users") {
		t.Fatal("expected table name to match")
	}
	if !MatchesTable([]string{"public.users"}, "public", "users") {
		t.Fatal("expected schema.table to match")
	}
	if MatchesTable([]string{"orders"}, "public", "users") {
		t.Fatal("expected users not to match [orders]")
	}
}

func TestManager_DispatchAndHMAC(t *testing.T) {
	var receivedSig string
	var receivedEvent string
	var receivedDeliveryID string
	var receivedBody []byte
	var callCount int32

	secret := "webhook-test-secret"

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&callCount, 1)
		receivedSig = r.Header.Get("X-DBLens-Signature")
		receivedEvent = r.Header.Get("X-DBLens-Event")
		receivedDeliveryID = r.Header.Get("X-DBLens-Delivery")

		b, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		receivedBody = b

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"received":true}`))
	}))
	defer ts.Close()

	mgr := NewManager()
	mgr.WithHTTPClient(ts.Client())

	payload := EventPayload{
		ID:        "evt_123",
		Event:     "INSERT",
		Schema:    "public",
		Table:     "products",
		NewRecord: map[string]any{"id": 1, "title": "Widget"},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	payloadBytes, _ := json.Marshal(payload)

	delivery := mgr.Dispatch(
		context.Background(),
		ts.URL,
		secret,
		map[string]string{"X-Custom-Header": "TestValue"},
		payloadBytes,
		"INSERT",
		"wh_123",
		"Test Webhook",
		"conn_1",
	)

	if delivery.ResponseStatusCode != 200 {
		t.Fatalf("expected status 200, got %d, err: %s", delivery.ResponseStatusCode, delivery.Error)
	}
	if delivery.ResponseBody != `{"received":true}` {
		t.Fatalf("unexpected response body: %s", delivery.ResponseBody)
	}
	if receivedEvent != "INSERT" {
		t.Fatalf("expected X-DBLens-Event INSERT, got %s", receivedEvent)
	}
	if receivedDeliveryID == "" {
		t.Fatal("expected delivery ID in header")
	}
	if !VerifyHMACSHA256(secret, receivedBody, receivedSig) {
		t.Fatalf("received signature %s did not verify against body", receivedSig)
	}

	// Verify Delivery Log was recorded
	deliveries := mgr.GetDeliveries("conn_1")
	if len(deliveries) != 1 {
		t.Fatalf("expected 1 delivery in log, got %d", len(deliveries))
	}
	if deliveries[0].ID != delivery.ID {
		t.Fatalf("expected log ID %s, got %s", delivery.ID, deliveries[0].ID)
	}
}

func TestManager_DeliveryLogRetentionCap(t *testing.T) {
	mgr := NewManager()

	for i := 0; i < 150; i++ {
		mgr.RecordDelivery(DeliveryLog{
			ID:                 fmt.Sprintf("del_%d", i),
			ConnectionID:       "conn_cap",
			Event:              "INSERT",
			URL:                "http://example.com/test",
			ResponseStatusCode: 200,
			Timestamp:          time.Now().UTC(),
		})
	}

	deliveries := mgr.GetDeliveries("conn_cap")
	if len(deliveries) != MaxDeliveryHistory {
		t.Fatalf("expected delivery log capped at %d, got %d", MaxDeliveryHistory, len(deliveries))
	}
	// Newest first
	if deliveries[0].ID != "del_149" {
		t.Fatalf("expected newest delivery del_149 first, got %s", deliveries[0].ID)
	}
}

func TestManager_RetryDelivery(t *testing.T) {
	var callCount int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&callCount, 1)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer ts.Close()

	mgr := NewManager()
	mgr.WithHTTPClient(ts.Client())

	origLog := mgr.Dispatch(
		context.Background(),
		ts.URL,
		"",
		nil,
		[]byte(`{"test":true}`),
		"UPDATE",
		"",
		"Simulator",
		"conn_retry",
	)

	if atomic.LoadInt32(&callCount) != 1 {
		t.Fatalf("expected 1 call, got %d", callCount)
	}

	// Retry
	retriedLog, err := mgr.RetryDelivery(context.Background(), origLog.ID)
	if err != nil {
		t.Fatalf("failed to retry delivery: %v", err)
	}
	if atomic.LoadInt32(&callCount) != 2 {
		t.Fatalf("expected 2 calls after retry, got %d", callCount)
	}
	if retriedLog.ResponseStatusCode != 200 {
		t.Fatalf("expected status 200 on retry, got %d", retriedLog.ResponseStatusCode)
	}
	if retriedLog.ID == origLog.ID {
		t.Fatal("retried delivery should have a distinct ID")
	}
}

func TestManager_Simulate(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload EventPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if payload.Event != "DELETE" || payload.Table != "users" {
			http.Error(w, "invalid payload", 400)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"acknowledged":true}`))
	}))
	defer ts.Close()

	mgr := NewManager()
	mgr.WithHTTPClient(ts.Client())

	resp, err := mgr.Simulate(context.Background(), "conn_sim", SimulateRequest{
		URL:       ts.URL,
		Event:     "DELETE",
		Schema:    "public",
		Table:     "users",
		OldRecord: map[string]any{"id": 42, "name": "Bob"},
	})
	if err != nil {
		t.Fatalf("simulate failed: %v", err)
	}
	if !resp.Success {
		t.Fatalf("expected simulate success, got delivery error: %s", resp.Delivery.Error)
	}
	if resp.Delivery.ResponseStatusCode != 200 {
		t.Fatalf("expected status 200, got %d", resp.Delivery.ResponseStatusCode)
	}
}

func TestManager_DispatchEventFiltering(t *testing.T) {
	var insertCount int32
	var deleteCount int32

	tsInsert := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&insertCount, 1)
		w.WriteHeader(200)
	}))
	defer tsInsert.Close()

	tsDelete := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&deleteCount, 1)
		w.WriteHeader(200)
	}))
	defer tsDelete.Close()

	mgr := NewManager()
	mgr.WithHTTPClient(tsInsert.Client())

	connID := "conn_filter"

	// Webhook 1: Only INSERT on users
	_, err := mgr.Create(connID, Webhook{
		Name:    "Insert Users",
		URL:     tsInsert.URL,
		Events:  []string{"INSERT"},
		Tables:  []string{"users"},
		Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Webhook 2: Only DELETE on users
	_, err = mgr.Create(connID, Webhook{
		Name:    "Delete Users",
		URL:     tsDelete.URL,
		Events:  []string{"DELETE"},
		Tables:  []string{"users"},
		Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Webhook 3: Disabled webhook
	_, err = mgr.Create(connID, Webhook{
		Name:    "Disabled Webhook",
		URL:     tsInsert.URL,
		Events:  []string{"*"},
		Tables:  []string{"*"},
		Enabled: false,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Dispatch INSERT event
	deliveries := mgr.DispatchEvent(context.Background(), connID, EventPayload{
		ID:        "evt_ins",
		Event:     "INSERT",
		Table:     "users",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
	if len(deliveries) != 1 {
		t.Fatalf("expected 1 delivery for INSERT, got %d", len(deliveries))
	}
	if atomic.LoadInt32(&insertCount) != 1 {
		t.Fatalf("expected insertCount 1, got %d", insertCount)
	}
	if atomic.LoadInt32(&deleteCount) != 0 {
		t.Fatalf("expected deleteCount 0, got %d", deleteCount)
	}

	// Dispatch UPDATE event (neither matches)
	deliveries = mgr.DispatchEvent(context.Background(), connID, EventPayload{
		ID:        "evt_upd",
		Event:     "UPDATE",
		Table:     "users",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
	if len(deliveries) != 0 {
		t.Fatalf("expected 0 deliveries for unmatched UPDATE, got %d", len(deliveries))
	}
}

func TestWebhook_SecretRetainOnUpdate(t *testing.T) {
	mgr := NewManager()
	connID := "conn_secret_test"

	wh, err := mgr.Create(connID, Webhook{
		Name:    "Secret Hook",
		URL:     "https://example.com/webhook",
		Secret:  "original-secret-123",
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("failed to create webhook: %v", err)
	}
	if !wh.HasSecret {
		t.Fatal("expected HasSecret to be true")
	}

	// Update with empty secret
	wh.Name = "Secret Hook Renamed"
	wh.Secret = ""
	updated, err := mgr.Update(connID, wh.ID, wh)
	if err != nil {
		t.Fatalf("failed to update webhook: %v", err)
	}
	if updated.Secret != "original-secret-123" {
		t.Fatalf("expected secret to be retained, got %q", updated.Secret)
	}
	if !updated.HasSecret {
		t.Fatal("expected HasSecret to remain true")
	}

	// Update with mask "••••••••"
	wh.Secret = "••••••••"
	updated2, err := mgr.Update(connID, wh.ID, wh)
	if err != nil {
		t.Fatalf("failed to update webhook: %v", err)
	}
	if updated2.Secret != "original-secret-123" {
		t.Fatalf("expected secret to be retained with mask, got %q", updated2.Secret)
	}

	// Update with new non-empty secret
	wh.Secret = "new-secret-456"
	updated3, err := mgr.Update(connID, wh.ID, wh)
	if err != nil {
		t.Fatalf("failed to update webhook: %v", err)
	}
	if updated3.Secret != "new-secret-456" {
		t.Fatalf("expected secret to update, got %q", updated3.Secret)
	}
}

func TestWebhook_SocketLevelSSRF(t *testing.T) {
	mgr := NewManager() // uses NewSafeHTTPTransport

	// 1. Dispatch to cloud metadata IP
	log := mgr.Dispatch(context.Background(), "http://169.254.169.254/meta-data", "", nil, []byte("{}"), "INSERT", "", "", "c1")
	if log.Error == "" {
		t.Fatal("expected dispatch to 169.254.169.254 to fail")
	}

	// 2. Dispatch to link-local IP
	log2 := mgr.Dispatch(context.Background(), "http://169.254.1.2/hook", "", nil, []byte("{}"), "INSERT", "", "", "c1")
	if log2.Error == "" {
		t.Fatal("expected dispatch to 169.254.1.2 to fail")
	}
}

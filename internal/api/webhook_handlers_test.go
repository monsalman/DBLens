package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/api"
	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/webhook"
)

func TestWebhookEndpoints(t *testing.T) {
	dbFile := "/tmp/dblens_api_webhook_test.db"
	_ = os.Remove(dbFile)
	defer os.Remove(dbFile)

	dsn := "sqlite://" + dbFile

	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to create connection: %v", err)
	}

	ctx := context.Background()
	_, err = entry.Driver.ExecuteQuery(ctx, `
		CREATE TABLE items (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL
		);
	`)
	if err != nil {
		t.Fatalf("failed to setup sqlite: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	// Mock target server for receiving webhooks
	var callCount int32
	mockTarget := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&callCount, 1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"received":true}`))
	}))
	defer mockTarget.Close()

	// Direct test server's client into handler's manager
	h.WebhookManager().WithHTTPClient(mockTarget.Client())

	connID := "conn_wh_test"

	// 1. Test POST /api/connections/{connId}/webhooks (SSRF rejection)
	t.Run("create webhook with SSRF blocked", func(t *testing.T) {
		body := map[string]any{
			"name": "Evil Hook",
			"url":  "http://169.254.169.254/metadata",
		}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest("POST", "/api/connections/"+connID+"/webhooks", bytes.NewReader(bodyBytes))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for SSRF blocked url, got %d: %s", w.Code, w.Body.String())
		}
	})

	var createdID string

	// 2. Test POST /api/connections/{connId}/webhooks (Valid)
	t.Run("create webhook success", func(t *testing.T) {
		body := map[string]any{
			"name":    "Sync Service",
			"url":     mockTarget.URL,
			"secret":  "whsec_test123",
			"events":  []string{"INSERT", "UPDATE"},
			"tables":  []string{"items"},
			"enabled": true,
			"headers": map[string]string{"X-Test-Env": "unit"},
		}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest("POST", "/api/connections/"+connID+"/webhooks", bytes.NewReader(bodyBytes))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
		}

		var resp struct {
			Data webhook.Webhook `json:"data"`
		}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if resp.Data.ID == "" {
			t.Fatal("expected non-empty webhook ID")
		}
		if resp.Data.Name != "Sync Service" {
			t.Fatalf("expected name 'Sync Service', got %s", resp.Data.Name)
		}
		createdID = resp.Data.ID
	})

	// 3. Test GET /api/connections/{connId}/webhooks
	t.Run("get webhooks list", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/connections/"+connID+"/webhooks", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
		}

		var resp struct {
			Data []webhook.Webhook `json:"data"`
		}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if len(resp.Data) != 1 {
			t.Fatalf("expected 1 webhook, got %d", len(resp.Data))
		}
		if resp.Data[0].ID != createdID {
			t.Fatalf("expected ID %s, got %s", createdID, resp.Data[0].ID)
		}
		if resp.Data[0].Secret != "••••••••" {
			t.Fatalf("expected masked secret ••••••••, got %q", resp.Data[0].Secret)
		}
		if !resp.Data[0].HasSecret {
			t.Fatal("expected HasSecret to be true")
		}
	})

	// 4. Test PUT /api/connections/{connId}/webhooks/{id}
	t.Run("update webhook", func(t *testing.T) {
		body := map[string]any{
			"name":    "Sync Service Renamed",
			"url":     mockTarget.URL,
			"events":  []string{"INSERT", "UPDATE", "DELETE"},
			"tables":  []string{"*"},
			"enabled": true,
		}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest("PUT", "/api/connections/"+connID+"/webhooks/"+createdID, bytes.NewReader(bodyBytes))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
		}

		var resp struct {
			Data webhook.Webhook `json:"data"`
		}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if resp.Data.Name != "Sync Service Renamed" {
			t.Fatalf("expected updated name, got %s", resp.Data.Name)
		}
	})

	// 5. Test POST /api/connections/{connId}/webhooks/simulate
	t.Run("simulate webhook synthetic event", func(t *testing.T) {
		simReq := map[string]any{
			"webhook_id": createdID,
			"event":      "UPDATE",
			"schema":     "public",
			"table":      "items",
			"old_record": map[string]any{"id": 1, "name": "Old"},
			"new_record": map[string]any{"id": 1, "name": "New"},
		}
		bodyBytes, _ := json.Marshal(simReq)
		req := httptest.NewRequest("POST", "/api/connections/"+connID+"/webhooks/simulate", bytes.NewReader(bodyBytes))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
		}

		var resp struct {
			Data webhook.SimulateResponse `json:"data"`
		}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if !resp.Data.Success {
			t.Fatalf("expected simulation success, got error: %s", resp.Data.Error)
		}
		if resp.Data.Delivery.ResponseStatusCode != 200 {
			t.Fatalf("expected status 200 in delivery log, got %d", resp.Data.Delivery.ResponseStatusCode)
		}
	})

	// 6. Test GET /api/connections/{connId}/webhooks/deliveries
	var deliveryID string
	t.Run("get webhook deliveries", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/connections/"+connID+"/webhooks/deliveries", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
		}

		var resp struct {
			Data []webhook.DeliveryLog `json:"data"`
		}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if len(resp.Data) == 0 {
			t.Fatal("expected at least 1 delivery log")
		}
		deliveryID = resp.Data[0].ID
	})

	// 7. Test POST /api/connections/{connId}/webhooks/deliveries/{id}/retry
	t.Run("retry webhook delivery", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/api/connections/"+connID+"/webhooks/deliveries/"+deliveryID+"/retry", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK on retry, got %d: %s", w.Code, w.Body.String())
		}

		var resp struct {
			Data webhook.DeliveryLog `json:"data"`
		}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if resp.Data.ResponseStatusCode != 200 {
			t.Fatalf("expected status 200 on retry delivery, got %d", resp.Data.ResponseStatusCode)
		}
	})

	// 8. Test Mutation Hook: ExecuteQuery triggers webhook
	t.Run("mutation hook via ExecuteQuery", func(t *testing.T) {
		initialCount := atomic.LoadInt32(&callCount)
		queryReq := map[string]any{
			"sql": "INSERT INTO items (id, name) VALUES (10, 'HookItem');",
		}
		bodyBytes, _ := json.Marshal(queryReq)
		req := httptest.NewRequest("POST", "/api/connections/"+connID+"/query", bytes.NewReader(bodyBytes))
		req.Header.Set("X-DBLENS-DSN", dsn)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected query 200, got %d: %s", w.Code, w.Body.String())
		}

		// Wait briefly for async dispatch
		time.Sleep(50 * time.Millisecond)
		if atomic.LoadInt32(&callCount) <= initialCount {
			t.Fatal("expected webhook to be dispatched upon ExecuteQuery INSERT")
		}
	})

	// 9. Test Mutation Hook: MutateRow triggers webhook
	t.Run("mutation hook via MutateRow", func(t *testing.T) {
		initialCount := atomic.LoadInt32(&callCount)
		mutReq := map[string]any{
			"type":  "INSERT",
			"table": "items",
			"data":  map[string]any{"id": 20, "name": "MutateItem"},
		}
		bodyBytes, _ := json.Marshal(mutReq)
		req := httptest.NewRequest("POST", "/api/connections/"+connID+"/mutate", bytes.NewReader(bodyBytes))
		req.Header.Set("X-DBLENS-DSN", dsn)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected mutate 200, got %d: %s", w.Code, w.Body.String())
		}

		time.Sleep(50 * time.Millisecond)
		if atomic.LoadInt32(&callCount) <= initialCount {
			t.Fatal("expected webhook to be dispatched upon MutateRow")
		}
	})

	// 10. Test DELETE /api/connections/{connId}/webhooks/{id}
	t.Run("delete webhook", func(t *testing.T) {
		req := httptest.NewRequest("DELETE", "/api/connections/"+connID+"/webhooks/"+createdID, nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK on delete, got %d: %s", w.Code, w.Body.String())
		}

		// Verify list is empty
		listReq := httptest.NewRequest("GET", "/api/connections/"+connID+"/webhooks", nil)
		listW := httptest.NewRecorder()
		router.ServeHTTP(listW, listReq)

		var resp struct {
			Data []webhook.Webhook `json:"data"`
		}
		_ = json.NewDecoder(listW.Body).Decode(&resp)
		if len(resp.Data) != 0 {
			t.Fatalf("expected 0 webhooks after delete, got %d", len(resp.Data))
		}
	})
}

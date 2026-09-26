package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dblens/dblens/internal/api"
	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/vault"
)

func setupVaultTestEnv(t *testing.T) (http.Handler, *api.Handler, func()) {
	t.Helper()
	mgr := connection.NewManager()
	h, err := api.NewHandler(mgr)
	if err != nil {
		t.Fatalf("failed to create api handler: %v", err)
	}

	h.SetVaultFastKDF(true)

	router := api.SetupRouter(h, api.RouterConfig{})
	cleanup := func() {
		h.Shutdown()
	}
	return router, h, cleanup
}

func TestVault_API_Lifecycle(t *testing.T) {
	router, _, cleanup := setupVaultTestEnv(t)
	defer cleanup()

	// 1. Check initial status
	req := httptest.NewRequest("GET", "/api/vault/status", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status GET failed: code %d, body: %s", w.Code, w.Body.String())
	}
	var statusResp struct {
		Data vault.VaultStatusResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &statusResp); err != nil {
		t.Fatalf("failed to unmarshal status resp: %v", err)
	}
	if statusResp.Data.IsUnlocked {
		t.Fatal("expected vault initially locked")
	}

	// 2. Export vault
	exportReq := vault.ExportRequest{
		Passphrase:  "TeamVaultPass2026!",
		Name:        "Engineering DBs",
		Description: "Production and Staging DBs",
		Connections: VaultConnectionForTest(t),
		Policies: vault.VaultPolicy{
			GlobalReadOnlyProd:  true,
			RequireAuditAllProd: true,
		},
		ScrubPasswords: true,
	}
	body, _ := json.Marshal(exportReq)
	req = httptest.NewRequest("POST", "/api/vault/export", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("export failed: code %d, body: %s", w.Code, w.Body.String())
	}
	var exportResp struct {
		Data vault.ExportResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &exportResp); err != nil {
		t.Fatalf("failed to parse export response: %v", err)
	}
	container := exportResp.Data.Container
	if container.Ciphertext == "" || container.HMAC == "" {
		t.Fatal("expected non-empty ciphertext and HMAC in export response")
	}

	// 3. Import with invalid passphrase
	importBadReq := vault.ImportRequest{
		Container:  &container,
		Passphrase: "WrongPassword!",
	}
	badBody, _ := json.Marshal(importBadReq)
	req = httptest.NewRequest("POST", "/api/vault/import", bytes.NewReader(badBody))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code == http.StatusOK {
		t.Fatal("expected error on import with wrong passphrase, got 200")
	}

	// 4. Import with correct passphrase & apply policies
	importGoodReq := vault.ImportRequest{
		Container:      &container,
		Passphrase:     "TeamVaultPass2026!",
		ApplyPolicies:  true,
		InterpolateEnv: true,
	}
	goodBody, _ := json.Marshal(importGoodReq)
	req = httptest.NewRequest("POST", "/api/vault/import", bytes.NewReader(goodBody))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("import failed: code %d, body: %s", w.Code, w.Body.String())
	}
	var importResp struct {
		Data vault.ImportResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &importResp); err != nil {
		t.Fatalf("failed to parse import response: %v", err)
	}
	if !importResp.Data.Valid {
		t.Fatal("expected import response valid = true")
	}
	if len(importResp.Data.Connections) != 2 {
		t.Fatalf("expected 2 connections, got %d", len(importResp.Data.Connections))
	}
	// Verify production guardrail applied:
	var prodConn *vault.VaultConnection
	for _, c := range importResp.Data.Connections {
		if c.Environment == "production" {
			prodConn = &c
			break
		}
	}
	if prodConn == nil || !prodConn.ReadOnly || !prodConn.Policy.RequireAuditLog {
		t.Fatalf("expected prod connection to be ReadOnly with RequireAuditLog, got %+v", prodConn)
	}

	// 5. Unlock vault
	unlockReq := vault.UnlockRequest{
		Container:  &container,
		Passphrase: "TeamVaultPass2026!",
	}
	unlockBody, _ := json.Marshal(unlockReq)
	req = httptest.NewRequest("POST", "/api/vault/unlock", bytes.NewReader(unlockBody))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("unlock failed: code %d, body: %s", w.Code, w.Body.String())
	}

	// 6. Check status after unlock
	req = httptest.NewRequest("GET", "/api/vault/status", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	var postUnlockStatus struct {
		Data vault.VaultStatusResponse `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &postUnlockStatus)
	if !postUnlockStatus.Data.IsUnlocked {
		t.Fatal("expected vault status to report is_unlocked = true")
	}
	if postUnlockStatus.Data.ConnectionsCount != 2 {
		t.Fatalf("expected 2 connections reported in status, got %d", postUnlockStatus.Data.ConnectionsCount)
	}

	// 7. Lock vault
	req = httptest.NewRequest("POST", "/api/vault/lock", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("lock failed: code %d, body: %s", w.Code, w.Body.String())
	}

	// 8. Verify status after locking
	req = httptest.NewRequest("GET", "/api/vault/status", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	var finalStatus struct {
		Data vault.VaultStatusResponse `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &finalStatus)
	if finalStatus.Data.IsUnlocked {
		t.Fatal("expected vault status to report is_unlocked = false after lock")
	}
}

func VaultConnectionForTest(t *testing.T) []vault.VaultConnection {
	return []vault.VaultConnection{
		{
			ID:          "conn_prod_1",
			Name:        "Main Production DB",
			Driver:      "postgres",
			DSN:         "postgres://admin:RealSecret123@prod-db.internal:5432/primary",
			Environment: "production",
			ReadOnly:    false,
		},
		{
			ID:          "conn_staging_1",
			Name:        "Staging DB",
			Driver:      "mysql",
			DSN:         "stg_user:StgSecret99@tcp(staging-db.internal:3306)/stage",
			Environment: "staging",
			ReadOnly:    false,
		},
	}
}

func TestVault_API_MaxBytesReader_RejectsOversizedPayload(t *testing.T) {
	router, _, cleanup := setupVaultTestEnv(t)
	defer cleanup()

	// 5 MB + 1024 bytes payload exceeds the 5MB MaxBytesReader limit
	oversizedBody := make([]byte, (5<<20)+1024)
	for i := range oversizedBody {
		oversizedBody[i] = ' '
	}

	endpoints := []string{
		"/api/vault/export",
		"/api/vault/import",
		"/api/vault/unlock",
	}

	for _, ep := range endpoints {
		t.Run(ep, func(t *testing.T) {
			req := httptest.NewRequest("POST", ep, bytes.NewReader(oversizedBody))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 Bad Request on oversized payload to %s, got %d", ep, w.Code)
			}
		})
	}
}

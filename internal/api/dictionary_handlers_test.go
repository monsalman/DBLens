package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/api"
	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/dictionary"
)

func setupDictionaryTestEnv(t *testing.T) (http.Handler, string, func()) {
	dbFile := fmt.Sprintf("/tmp/dblens_api_dict_%d.db", time.Now().UnixNano())
	cleanup := func() { _ = os.Remove(dbFile) }

	dsn := "sqlite://" + dbFile
	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		cleanup()
		t.Fatalf("failed to init sqlite db: %v", err)
	}

	ctx := context.Background()
	queries := []string{
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY,
			email TEXT NOT NULL,
			phone TEXT,
			credit_card TEXT,
			bio TEXT
		);`,
		`INSERT INTO users (id, email, phone, credit_card, bio) VALUES
			(1, 'alice@example.com', '+1-555-0100', '4532015112830366', 'Software engineer'),
			(2, 'bob@example.com', '+1-555-0101', '4532015112830367', 'Product manager');`,
		`CREATE TABLE audit_logs (
			id INTEGER PRIMARY KEY,
			user_id INTEGER,
			action TEXT,
			FOREIGN KEY (user_id) REFERENCES users(id)
		);`,
	}
	for _, q := range queries {
		if _, err := entry.Driver.ExecuteQuery(ctx, q); err != nil {
			cleanup()
			t.Fatalf("failed to seed db: %v", err)
		}
	}

	h, err := api.NewHandler(mgr)
	if err != nil {
		cleanup()
		t.Fatalf("failed to init handler: %v", err)
	}

	router := api.SetupRouter(h, api.RouterConfig{})
	return router, dsn, func() {
		h.Shutdown()
		cleanup()
	}
}

func TestGetDictionaryEndpoint(t *testing.T) {
	router, dsn, cleanup := setupDictionaryTestEnv(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/connections/test-conn/dictionary", nil)
	req.Header.Set("X-DBLENS-DSN", dsn)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Data  *dictionary.DataDictionary `json:"data"`
		Error *string                    `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse json: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
	if resp.Data == nil {
		t.Fatalf("expected data dictionary response")
	}

	dict := resp.Data
	if len(dict.Schemas) == 0 {
		t.Fatalf("expected at least 1 schema, got 0")
	}
	if dict.Summary.TotalTables < 2 {
		t.Errorf("expected at least 2 tables, got %d", dict.Summary.TotalTables)
	}
	if dict.Summary.TotalPIIColumns < 3 {
		t.Errorf("expected at least 3 PII columns, got %d", dict.Summary.TotalPIIColumns)
	}
}

func TestUpdateDictionaryCommentsEndpoint(t *testing.T) {
	router, dsn, cleanup := setupDictionaryTestEnv(t)
	defer cleanup()

	payload, _ := json.Marshal(dictionary.CommentUpdateRequest{
		Schema:   "main",
		Table:    "users",
		Column:   "bio",
		Comment:  "User biography and personal tagline",
		SyncToDB: false,
	})

	req := httptest.NewRequest(http.MethodPut, "/api/connections/test-conn/dictionary/comments", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-DBLENS-DSN", dsn)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	// Verify SyncToDB=true is blocked in ReadOnly mode
	syncPayload, _ := json.Marshal(dictionary.CommentUpdateRequest{
		Schema:   "main",
		Table:    "users",
		Column:   "bio",
		Comment:  "Updated bio with DB sync",
		SyncToDB: true,
	})
	roReq := httptest.NewRequest(http.MethodPut, "/api/connections/test-conn/dictionary/comments", bytes.NewReader(syncPayload))
	roReq.Header.Set("Content-Type", "application/json")
	roReq.Header.Set("X-DBLENS-DSN", dsn)
	roReq.Header.Set("X-DBLENS-READONLY", "1")
	roRec := httptest.NewRecorder()
	router.ServeHTTP(roRec, roReq)
	if roRec.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for SyncToDB in read-only mode, got %d", roRec.Code)
	}

	roQReq := httptest.NewRequest(http.MethodPut, "/api/connections/test-conn/dictionary/comments?readonly=true", bytes.NewReader(syncPayload))
	roQReq.Header.Set("Content-Type", "application/json")
	roQReq.Header.Set("X-DBLENS-DSN", dsn)
	roQRec := httptest.NewRecorder()
	router.ServeHTTP(roQRec, roQReq)
	if roQRec.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for SyncToDB with ?readonly=true, got %d", roQRec.Code)
	}

	// Verify SyncToDB=false is permitted in ReadOnly mode (saves to local annotations)
	localReq := httptest.NewRequest(http.MethodPut, "/api/connections/test-conn/dictionary/comments", bytes.NewReader(payload))
	localReq.Header.Set("Content-Type", "application/json")
	localReq.Header.Set("X-DBLENS-DSN", dsn)
	localReq.Header.Set("X-DBLENS-READONLY", "1")
	localRec := httptest.NewRecorder()
	router.ServeHTTP(localRec, localReq)
	if localRec.Code != http.StatusOK {
		t.Errorf("expected 200 OK for local note update in read-only mode, got %d", localRec.Code)
	}

	// Verify missing table yields 400
	badPayload, _ := json.Marshal(dictionary.CommentUpdateRequest{
		Table: "",
	})
	badReq := httptest.NewRequest(http.MethodPut, "/api/connections/test-conn/dictionary/comments", bytes.NewReader(badPayload))
	badReq.Header.Set("Content-Type", "application/json")
	badReq.Header.Set("X-DBLENS-DSN", dsn)

	badRec := httptest.NewRecorder()
	router.ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request, got %d", badRec.Code)
	}
}

func TestExportDictionaryHTMLEndpoint(t *testing.T) {
	router, dsn, cleanup := setupDictionaryTestEnv(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/connections/test-conn/dictionary/export/html", nil)
	req.Header.Set("X-DBLENS-DSN", dsn)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	contentType := rec.Header().Get("Content-Type")
	if !strings.Contains(contentType, "text/html") {
		t.Errorf("expected text/html content-type, got %s", contentType)
	}

	body := rec.Body.String()
	if !strings.Contains(body, "<!DOCTYPE html>") {
		t.Errorf("expected html doctype")
	}
	if !strings.Contains(body, "users") {
		t.Errorf("expected table name users in HTML export")
	}
	if !strings.Contains(body, "SOC 2 TYPE II AUDIT READY") {
		t.Errorf("expected SOC 2 compliance tag")
	}
}

func TestExportDictionaryMDEndpoint(t *testing.T) {
	router, dsn, cleanup := setupDictionaryTestEnv(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/connections/test-conn/dictionary/export/md", nil)
	req.Header.Set("X-DBLENS-DSN", dsn)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	contentType := rec.Header().Get("Content-Type")
	if !strings.Contains(contentType, "text/markdown") {
		t.Errorf("expected text/markdown content-type, got %s", contentType)
	}

	body := rec.Body.String()
	if !strings.Contains(body, "# Data Dictionary: test-conn") {
		t.Errorf("expected markdown title")
	}
	if !strings.Contains(body, "users") {
		t.Errorf("expected table users in markdown")
	}
}

func TestExportDictionaryOpenAPIEndpoint(t *testing.T) {
	router, dsn, cleanup := setupDictionaryTestEnv(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/connections/test-conn/dictionary/export/openapi", nil)
	req.Header.Set("X-DBLENS-DSN", dsn)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	contentType := rec.Header().Get("Content-Type")
	if !strings.Contains(contentType, "application/json") {
		t.Errorf("expected application/json content-type, got %s", contentType)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("expected valid JSON: %v", err)
	}

	if parsed["openapi"] != "3.0.3" {
		t.Errorf("expected openapi 3.0.3, got %v", parsed["openapi"])
	}
}

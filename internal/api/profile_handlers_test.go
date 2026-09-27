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
	"github.com/dblens/dblens/internal/profile"
)

func setupProfileTestEnv(t *testing.T) (http.Handler, string, func()) {
	dbFile := fmt.Sprintf("/tmp/dblens_api_profile_%d.db", time.Now().UnixNano())
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
			email TEXT,
			age INTEGER,
			status TEXT
		);`,
		`INSERT INTO users (id, email, age, status) VALUES
			(1, 'john@example.com', 25, 'active'),
			(2, 'jane@domain.org', 30, 'active'),
			(3, 'bob@corp.net', 35, 'inactive');`,
		`CREATE TABLE users_v2 (
			id INTEGER PRIMARY KEY,
			email TEXT,
			age INTEGER,
			status TEXT,
			is_verified BOOLEAN
		);`,
		`INSERT INTO users_v2 (id, email, age, status, is_verified) VALUES
			(1, 'john@example.com', 25, 'active', 1),
			(2, 'jane@domain.org', 30, 'active', 1),
			(3, 'bob@corp.net', 35, 'inactive', 0),
			(4, 'alice@test.io', 40, 'active', 1);`,
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

func TestProfileTableEndpoint(t *testing.T) {
	router, dsn, cleanup := setupProfileTestEnv(t)
	defer cleanup()

	// 1. Valid profile request
	body, _ := json.Marshal(profile.ProfileRequest{Table: "users"})
	req := httptest.NewRequest(http.MethodPost, "/api/connections/test-conn/profile", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-DBLENS-DSN", dsn)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Data  *profile.ProfileReport `json:"data"`
		Error *string                `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse json: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
	if resp.Data == nil || resp.Data.TotalRows != 3 {
		t.Fatalf("expected 3 total rows, got %+v", resp.Data)
	}
	if len(resp.Data.Columns) != 4 {
		t.Fatalf("expected 4 columns, got %d", len(resp.Data.Columns))
	}

	// 2. Missing table should return 400
	badBody, _ := json.Marshal(profile.ProfileRequest{Table: ""})
	badReq := httptest.NewRequest(http.MethodPost, "/api/connections/test-conn/profile", bytes.NewReader(badBody))
	badReq.Header.Set("Content-Type", "application/json")
	badReq.Header.Set("X-DBLENS-DSN", dsn)

	badRec := httptest.NewRecorder()
	router.ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request, got %d", badRec.Code)
	}
}

func TestProfileSuggestEndpoint(t *testing.T) {
	router, dsn, cleanup := setupProfileTestEnv(t)
	defer cleanup()

	// Via ProfileRequest
	body, _ := json.Marshal(profile.ProfileRequest{Table: "users"})
	req := httptest.NewRequest(http.MethodPost, "/api/connections/test-conn/profile/suggest", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-DBLENS-DSN", dsn)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Data  []profile.Suggestion `json:"data"`
		Error *string              `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode suggestions: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
	if len(resp.Data) == 0 {
		t.Fatalf("expected non-empty suggestions")
	}
}

func TestProfileExportMDEndpoint(t *testing.T) {
	router, dsn, cleanup := setupProfileTestEnv(t)
	defer cleanup()

	// GET export
	req := httptest.NewRequest(http.MethodGet, "/api/connections/test-conn/profile/export.md?table=users", nil)
	req.Header.Set("X-DBLENS-DSN", dsn)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Header().Get("Content-Type"), "text/markdown") {
		t.Fatalf("expected text/markdown content type, got %s", rec.Header().Get("Content-Type"))
	}
	if !strings.Contains(rec.Body.String(), "# Data Profile Report: users") {
		t.Fatalf("expected markdown heading, got: %s", rec.Body.String())
	}

	// POST export with precomputed report
	rep := profile.ProfileReport{
		Table:     "demo",
		Dialect:   "sqlite",
		TotalRows: 1,
		Columns: []profile.ColumnProfile{
			{ColumnName: "id", DataType: "int", DistinctCount: 1, TotalRows: 1},
		},
	}
	postBody, _ := json.Marshal(rep)
	postReq := httptest.NewRequest(http.MethodPost, "/api/connections/test-conn/profile/export.md", bytes.NewReader(postBody))
	postReq.Header.Set("Content-Type", "application/json")
	postRec := httptest.NewRecorder()
	router.ServeHTTP(postRec, postReq)

	if postRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for POST export, got %d", postRec.Code)
	}
	if !strings.Contains(postRec.Body.String(), "# Data Profile Report: demo") {
		t.Fatalf("expected demo report markdown, got: %s", postRec.Body.String())
	}
}

func TestProfileCompareEndpoint(t *testing.T) {
	router, dsn, cleanup := setupProfileTestEnv(t)
	defer cleanup()

	compareReq := api.ProfileCompareRequest{
		BaseTable:   "users",
		TargetTable: "users_v2",
	}
	body, _ := json.Marshal(compareReq)
	req := httptest.NewRequest(http.MethodPost, "/api/connections/test-conn/profile/compare", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-DBLENS-DSN", dsn)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Data  *profile.CompareResult `json:"data"`
		Error *string                `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode compare result: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
	if resp.Data == nil || resp.Data.RowDiff != 1 {
		t.Fatalf("expected row diff 1, got %+v", resp.Data)
	}

	// Verify column addition detected
	var foundAdded bool
	for _, cd := range resp.Data.ColumnDiffs {
		if cd.ColumnName == "is_verified" && cd.Status == "added" {
			foundAdded = true
			break
		}
	}
	if !foundAdded {
		t.Errorf("expected is_verified column marked as added")
	}
}

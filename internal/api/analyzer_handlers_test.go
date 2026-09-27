package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/analyzer"
	"github.com/dblens/dblens/internal/api"
	"github.com/dblens/dblens/internal/connection"
)

func TestAnalyzerHandlers(t *testing.T) {
	dbFile := fmt.Sprintf("/tmp/dblens_api_analyzer_%d.db", time.Now().UnixNano())
	defer os.Remove(dbFile)

	dsn := "sqlite://" + dbFile
	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to init sqlite test db: %v", err)
	}

	ctx := context.Background()
	_, err = entry.Driver.ExecuteRaw(ctx, "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT);")
	if err != nil {
		t.Fatalf("setup table failed: %v", err)
	}

	h, err := api.NewHandler(mgr)
	if err != nil {
		t.Fatalf("NewHandler: %v", err)
	}
	t.Cleanup(h.Shutdown)
	router := api.SetupRouter(h, api.RouterConfig{})

	// 1. GET /api/analyze/rules
	t.Run("Get Analyzer Rules", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/analyze/rules", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Data []analyzer.RuleMeta `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to parse rules response: %v", err)
		}
		if len(resp.Data) < 10 {
			t.Errorf("expected at least 10 rules, got %d", len(resp.Data))
		}
	})

	// 2. PUT /api/analyze/rules
	t.Run("Update Analyzer Rules", func(t *testing.T) {
		updates := map[string]analyzer.RuleSetting{
			"select-star": {
				Enabled:  false,
				Severity: analyzer.SeverityInfo,
			},
		}
		payload, _ := json.Marshal(updates)
		req := httptest.NewRequest(http.MethodPut, "/api/analyze/rules", bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 3. POST /api/connections/c1/analyze
	t.Run("Analyze SQL with Safety Error", func(t *testing.T) {
		body := api.AnalyzeRequestBody{
			SQL:     "DELETE FROM users;",
			Dialect: "sqlite",
		}
		payload, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/analyze", bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Data analyzer.AnalyzeResult `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to parse analyze response: %v", err)
		}

		if resp.Data.Summary.Errors == 0 {
			t.Errorf("expected error for DELETE without WHERE, got summary %+v", resp.Data.Summary)
		}
	})

	// 4. POST /api/connections/c1/analyze/gate
	t.Run("Analyze Gate Failure", func(t *testing.T) {
		gateReq := analyzer.GateRequest{
			SQL:            "UPDATE users SET name = 'anonymous'",
			Dialect:        "sqlite",
			FailOnSeverity: analyzer.SeverityError,
			MaxAllowed:     0,
		}
		payload, _ := json.Marshal(gateReq)
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/analyze/gate", bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Data analyzer.GateResult `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to parse gate response: %v", err)
		}

		if resp.Data.Passed {
			t.Errorf("expected gate to fail for unconstrained UPDATE")
		}
	})

	t.Run("Analyze Gate Success", func(t *testing.T) {
		gateReq := analyzer.GateRequest{
			SQL:            "SELECT id, email FROM users WHERE id = 1",
			Dialect:        "sqlite",
			FailOnSeverity: analyzer.SeverityError,
			MaxAllowed:     0,
		}
		payload, _ := json.Marshal(gateReq)
		req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/analyze/gate", bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Data analyzer.GateResult `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to parse gate response: %v", err)
		}

		if !resp.Data.Passed {
			t.Errorf("expected gate to pass: %s", resp.Data.Reason)
		}
	})
}

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
	"github.com/dblens/dblens/internal/datadiff"
)

func setupDataDiffTestEnv(t *testing.T) (http.Handler, string, string, func()) {
	srcFile := fmt.Sprintf("/tmp/dblens_datadiff_src_%d.db", time.Now().UnixNano())
	tgtFile := fmt.Sprintf("/tmp/dblens_datadiff_tgt_%d.db", time.Now().UnixNano())
	srcDSN := "sqlite://" + srcFile
	tgtDSN := "sqlite://" + tgtFile

	mgr := connection.NewManager()

	srcEntry, err := mgr.GetByDSN(srcDSN)
	if err != nil {
		t.Fatalf("failed to init src db: %v", err)
	}
	tgtEntry, err := mgr.GetByDSN(tgtDSN)
	if err != nil {
		t.Fatalf("failed to init tgt db: %v", err)
	}

	ctx := context.Background()

	// Seed source: items table with id 1, 2, 3
	_, err = srcEntry.Driver.ExecuteQuery(ctx, `CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, price REAL);`)
	if err != nil {
		t.Fatalf("failed create src table: %v", err)
	}
	_, _ = srcEntry.Driver.ExecuteQuery(ctx, "INSERT INTO items VALUES (1, 'Book', 15.0);")
	_, _ = srcEntry.Driver.ExecuteQuery(ctx, "INSERT INTO items VALUES (2, 'Pen', 3.5);")
	_, _ = srcEntry.Driver.ExecuteQuery(ctx, "INSERT INTO items VALUES (3, 'Notebook', 8.0);")

	// Seed target: items table with id 1 (identical), 2 (modified price 2.5), 4 (extra/deleted from source)
	_, err = tgtEntry.Driver.ExecuteQuery(ctx, `CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, price REAL);`)
	if err != nil {
		t.Fatalf("failed create tgt table: %v", err)
	}
	_, _ = tgtEntry.Driver.ExecuteQuery(ctx, "INSERT INTO items VALUES (1, 'Book', 15.0);")
	_, _ = tgtEntry.Driver.ExecuteQuery(ctx, "INSERT INTO items VALUES (2, 'Pen', 2.5);")
	_, _ = tgtEntry.Driver.ExecuteQuery(ctx, "INSERT INTO items VALUES (4, 'Eraser', 1.0);")

	h, err := api.NewHandler(mgr)
	if err != nil {
		t.Fatalf("failed to create api handler: %v", err)
	}

	router := api.SetupRouter(h, api.RouterConfig{})

	cleanup := func() {
		h.Shutdown()
		_ = os.Remove(srcFile)
		_ = os.Remove(tgtFile)
	}

	return router, srcDSN, tgtDSN, cleanup
}

func TestDataDiff_CompareEndpoint(t *testing.T) {
	router, srcDSN, tgtDSN, cleanup := setupDataDiffTestEnv(t)
	defer cleanup()

	reqBody := datadiff.DataDiffRequest{
		SourceDSN:   srcDSN,
		SourceTable: "items",
		TargetDSN:   tgtDSN,
		TargetTable: "items",
		PageSize:    100,
	}
	b, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/datadiff/compare", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Data datadiff.DataDiffResult `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	res := resp.Data

	if res.Summary.AddedCount != 1 || res.Summary.DeletedCount != 1 ||
		res.Summary.ModifiedCount != 1 || res.Summary.IdenticalCount != 1 {
		t.Errorf("unexpected counts: %+v", res.Summary)
	}

	// Test Identifier SQL Injection Prevention
	badReq := datadiff.DataDiffRequest{
		SourceDSN:   srcDSN,
		SourceTable: "items; DROP TABLE items; --",
		TargetDSN:   tgtDSN,
		TargetTable: "items",
	}
	badB, _ := json.Marshal(badReq)
	req2 := httptest.NewRequest(http.MethodPost, "/api/datadiff/compare", bytes.NewReader(badB))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()

	router.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request for malicious table identifier, got %d", rec2.Code)
	}
}

func TestDataDiff_GenerateSyncEndpoint(t *testing.T) {
	router, _, tgtDSN, cleanup := setupDataDiffTestEnv(t)
	defer cleanup()

	reqBody := datadiff.SyncScriptRequest{
		TargetDSN:     tgtDSN,
		TargetTable:   "items",
		TargetDialect: "sqlite",
		PrimaryKeys:   []string{"id"},
		Columns:       []string{"id", "name", "price"},
		Strategy:      datadiff.StrategySourceWins,
		DeleteExcess:  true,
		Rows: []datadiff.RowDiffItem{
			{
				Status:       datadiff.StatusAdded,
				SourceValues: map[string]any{"id": 3, "name": "Notebook", "price": 8.0},
				PKValues:     map[string]any{"id": 3},
			},
			{
				Status:       datadiff.StatusModified,
				SourceValues: map[string]any{"id": 2, "name": "Pen", "price": 3.5},
				TargetValues: map[string]any{"id": 2, "name": "Pen", "price": 2.5},
				PKValues:     map[string]any{"id": 2},
			},
			{
				Status:       datadiff.StatusDeleted,
				TargetValues: map[string]any{"id": 4, "name": "Eraser", "price": 1.0},
				PKValues:     map[string]any{"id": 4},
			},
		},
	}
	b, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/datadiff/generate-sync", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Data datadiff.SyncScriptResponse `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	res := resp.Data

	if res.InsertCount != 1 || res.UpdateCount != 1 || res.DeleteCount != 1 {
		t.Errorf("unexpected counts: %+v", res)
	}
	if !strings.Contains(res.SQL, "BEGIN TRANSACTION;") || !strings.Contains(res.SQL, "COMMIT;") {
		t.Errorf("expected transaction markers in SQL script: %s", res.SQL)
	}
}

func TestDataDiff_ApplySyncEndpoint(t *testing.T) {
	router, _, tgtDSN, cleanup := setupDataDiffTestEnv(t)
	defer cleanup()

	// Safe Mode 403 test via Header
	safeReq := datadiff.ApplySyncRequest{
		TargetDSN:  tgtDSN,
		Statements: []string{"UPDATE items SET price = 99.0 WHERE id = 1;"},
	}
	bSafe, _ := json.Marshal(safeReq)
	req1 := httptest.NewRequest(http.MethodPost, "/api/datadiff/apply-sync", bytes.NewReader(bSafe))
	req1.Header.Set("Content-Type", "application/json")
	req1.Header.Set("X-DBLENS-READONLY", "true")
	rec1 := httptest.NewRecorder()

	router.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden with X-DBLENS-READONLY, got %d: %s", rec1.Code, rec1.Body.String())
	}

	// Safe Mode 403 test via Payload ReadOnly flag
	safeReq2 := datadiff.ApplySyncRequest{
		TargetDSN:  tgtDSN,
		Statements: []string{"UPDATE items SET price = 99.0 WHERE id = 1;"},
		ReadOnly:   true,
	}
	bSafe2, _ := json.Marshal(safeReq2)
	req2 := httptest.NewRequest(http.MethodPost, "/api/datadiff/apply-sync", bytes.NewReader(bSafe2))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()

	router.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden with payload ReadOnly=true, got %d", rec2.Code)
	}

	// Successful Apply
	applyReq := datadiff.ApplySyncRequest{
		TargetDSN: tgtDSN,
		Statements: []string{
			"INSERT INTO items (id, name, price) VALUES (3, 'Notebook', 8.0);",
			"UPDATE items SET price = 3.5 WHERE id = 2;",
			"DELETE FROM items WHERE id = 4;",
		},
		ReadOnly: false,
	}
	bApply, _ := json.Marshal(applyReq)
	req3 := httptest.NewRequest(http.MethodPost, "/api/datadiff/apply-sync", bytes.NewReader(bApply))
	req3.Header.Set("Content-Type", "application/json")
	rec3 := httptest.NewRecorder()

	router.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec3.Code, rec3.Body.String())
	}

	var resp struct {
		Data datadiff.ApplySyncResponse `json:"data"`
	}
	if err := json.NewDecoder(rec3.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	res := resp.Data
	if !res.Success || res.StatementsExecuted != 3 {
		t.Errorf("unexpected apply response: %+v", res)
	}
}

func TestDataDiff_ExportSQLEndpoint(t *testing.T) {
	router, _, tgtDSN, cleanup := setupDataDiffTestEnv(t)
	defer cleanup()

	// POST /api/datadiff/export.sql
	reqBody := datadiff.SyncScriptRequest{
		TargetDSN:     tgtDSN,
		TargetTable:   "items",
		TargetDialect: "sqlite",
		PrimaryKeys:   []string{"id"},
		Columns:       []string{"id", "name", "price"},
		Strategy:      datadiff.StrategySourceWins,
		Rows: []datadiff.RowDiffItem{
			{
				Status:       datadiff.StatusAdded,
				SourceValues: map[string]any{"id": 10, "name": "Item 10", "price": 5.0},
				PKValues:     map[string]any{"id": 10},
			},
		},
	}
	b, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/datadiff/export.sql", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/sql") {
		t.Errorf("expected application/sql Content-Type, got %s", ct)
	}
	if !strings.Contains(rec.Body.String(), "Item 10") {
		t.Errorf("exported SQL missing expected contents: %s", rec.Body.String())
	}
}

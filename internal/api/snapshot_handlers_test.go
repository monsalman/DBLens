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

	"github.com/dblens/dblens/internal/api"
	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/snapshot"
)

func setupSnapshotTestEnv(t *testing.T) (http.Handler, string, func()) {
	t.Helper()
	dbFile := fmt.Sprintf("/tmp/dblens_api_snap_%d.db", time.Now().UnixNano())
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
			created_at TEXT
		);`,
		`CREATE INDEX idx_users_email ON users(email);`,
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

func TestSnapshotEndpointsLifecycle(t *testing.T) {
	router, dsn, cleanup := setupSnapshotTestEnv(t)
	defer cleanup()

	connID := fmt.Sprintf("snap-conn-%d", time.Now().UnixNano())

	// 1. Initially snapshot list should be empty
	req := httptest.NewRequest(http.MethodGet, "/api/connections/"+connID+"/snapshots", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for list, got %d: %s", rec.Code, rec.Body.String())
	}
	var listResp struct {
		Data  []*snapshot.SchemaSnapshot `json:"data"`
		Error *string                    `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("failed to parse json list: %v", err)
	}
	if len(listResp.Data) != 0 {
		t.Fatalf("expected 0 initial snapshots, got %d", len(listResp.Data))
	}

	// 2. Capture baseline snapshot
	capPayload, _ := json.Marshal(api.CaptureSnapshotRequest{
		Label:       "v1 Baseline",
		Tag:         "manual",
		Description: "Initial schema baseline",
	})
	capReq := httptest.NewRequest(http.MethodPost, "/api/connections/"+connID+"/snapshots/capture", bytes.NewReader(capPayload))
	capReq.Header.Set("Content-Type", "application/json")
	capReq.Header.Set("X-DBLENS-DSN", dsn)
	capRec := httptest.NewRecorder()
	router.ServeHTTP(capRec, capReq)

	if capRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for capture, got %d: %s", capRec.Code, capRec.Body.String())
	}
	var snap1Resp struct {
		Data  *snapshot.SchemaSnapshot `json:"data"`
		Error *string                  `json:"error"`
	}
	if err := json.Unmarshal(capRec.Body.Bytes(), &snap1Resp); err != nil {
		t.Fatalf("failed to parse captured snapshot: %v", err)
	}
	snap1 := snap1Resp.Data
	if snap1 == nil || snap1.ID == "" {
		t.Fatalf("expected valid snapshot with ID, got %+v", snap1)
	}
	if snap1.Label != "v1 Baseline" {
		t.Errorf("expected label 'v1 Baseline', got %s", snap1.Label)
	}

	// 3. Mutate live schema: Add a new table and column
	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to get driver for mutation: %v", err)
	}
	_, err = entry.Driver.ExecuteQuery(context.Background(), `CREATE TABLE orders (
		id INTEGER PRIMARY KEY,
		user_id INTEGER,
		total REAL
	);`)
	if err != nil {
		t.Fatalf("mutation query failed: %v", err)
	}

	// 4. Diff against live database
	diffLivePayload, _ := json.Marshal(api.DiffSnapshotsRequest{
		BaseID: snap1.ID,
		Live:   true,
	})
	diffLiveReq := httptest.NewRequest(http.MethodPost, "/api/connections/"+connID+"/snapshots/diff", bytes.NewReader(diffLivePayload))
	diffLiveReq.Header.Set("Content-Type", "application/json")
	diffLiveReq.Header.Set("X-DBLENS-DSN", dsn)
	diffLiveRec := httptest.NewRecorder()
	router.ServeHTTP(diffLiveRec, diffLiveReq)

	if diffLiveRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for diff live, got %d: %s", diffLiveRec.Code, diffLiveRec.Body.String())
	}
	var diffLiveResp struct {
		Data  *snapshot.SnapshotDiff `json:"data"`
		Error *string                `json:"error"`
	}
	if err := json.Unmarshal(diffLiveRec.Body.Bytes(), &diffLiveResp); err != nil {
		t.Fatalf("failed to parse diff live response: %v", err)
	}
	liveDiff := diffLiveResp.Data
	if liveDiff == nil {
		t.Fatalf("expected diff result, got nil")
	}
	if liveDiff.Summary.AddedTables != 1 {
		t.Errorf("expected 1 added table in live diff, got %d", liveDiff.Summary.AddedTables)
	}

	// 5. Capture second snapshot
	cap2Payload, _ := json.Marshal(api.CaptureSnapshotRequest{
		Label: "v2 Orders Added",
		Tag:   "pre-migration",
	})
	cap2Req := httptest.NewRequest(http.MethodPost, "/api/connections/"+connID+"/snapshots/capture", bytes.NewReader(cap2Payload))
	cap2Req.Header.Set("Content-Type", "application/json")
	cap2Req.Header.Set("X-DBLENS-DSN", dsn)
	cap2Rec := httptest.NewRecorder()
	router.ServeHTTP(cap2Rec, cap2Req)

	var snap2Resp struct {
		Data *snapshot.SchemaSnapshot `json:"data"`
	}
	_ = json.Unmarshal(cap2Rec.Body.Bytes(), &snap2Resp)
	snap2 := snap2Resp.Data

	// 6. Diff between snap1 and snap2
	diffPayload, _ := json.Marshal(api.DiffSnapshotsRequest{
		BaseID:   snap1.ID,
		TargetID: snap2.ID,
	})
	diffReq := httptest.NewRequest(http.MethodPost, "/api/connections/"+connID+"/snapshots/diff", bytes.NewReader(diffPayload))
	diffReq.Header.Set("Content-Type", "application/json")
	diffRec := httptest.NewRecorder()
	router.ServeHTTP(diffRec, diffReq)

	if diffRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for diff, got %d: %s", diffRec.Code, diffRec.Body.String())
	}

	// 7. Generate Rollback Plan
	planPayload, _ := json.Marshal(api.RollbackPlanRequest{
		BaseID:   snap1.ID,
		TargetID: snap2.ID,
	})
	planReq := httptest.NewRequest(http.MethodPost, "/api/connections/"+connID+"/snapshots/rollback-plan", bytes.NewReader(planPayload))
	planReq.Header.Set("Content-Type", "application/json")
	planRec := httptest.NewRecorder()
	router.ServeHTTP(planRec, planReq)

	if planRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for rollback plan, got %d: %s", planRec.Code, planRec.Body.String())
	}
	var planResp struct {
		Data  *snapshot.RollbackPlan `json:"data"`
		Error *string                `json:"error"`
	}
	if err := json.Unmarshal(planRec.Body.Bytes(), &planResp); err != nil {
		t.Fatalf("failed to parse rollback plan: %v", err)
	}
	plan := planResp.Data
	if plan == nil || plan.DownSQL == "" {
		t.Fatalf("expected non-empty rollback downSql, got %+v", plan)
	}

	// 8. Delete snap1 blocked by ReadOnly
	roDelReq := httptest.NewRequest(http.MethodDelete, "/api/connections/"+connID+"/snapshots/"+snap1.ID, nil)
	roDelReq.Header.Set("X-DBLENS-READONLY", "true")
	roDelRec := httptest.NewRecorder()
	router.ServeHTTP(roDelRec, roDelReq)
	if roDelRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for delete in read-only mode, got %d", roDelRec.Code)
	}

	roDelQueryReq := httptest.NewRequest(http.MethodDelete, "/api/connections/"+connID+"/snapshots/"+snap1.ID+"?readonly=1", nil)
	roDelQueryRec := httptest.NewRecorder()
	router.ServeHTTP(roDelQueryRec, roDelQueryReq)
	if roDelQueryRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for delete with ?readonly=1, got %d", roDelQueryRec.Code)
	}

	// 8b. Delete snap1 allowed normally
	delReq := httptest.NewRequest(http.MethodDelete, "/api/connections/"+connID+"/snapshots/"+snap1.ID, nil)
	delRec := httptest.NewRecorder()
	router.ServeHTTP(delRec, delReq)

	if delRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for delete, got %d: %s", delRec.Code, delRec.Body.String())
	}

	// List snapshots again: should contain only snap2
	listReq2 := httptest.NewRequest(http.MethodGet, "/api/connections/"+connID+"/snapshots", nil)
	listRec2 := httptest.NewRecorder()
	router.ServeHTTP(listRec2, listReq2)

	var list2Resp struct {
		Data []*snapshot.SchemaSnapshot `json:"data"`
	}
	_ = json.Unmarshal(listRec2.Body.Bytes(), &list2Resp)
	if len(list2Resp.Data) != 1 || list2Resp.Data[0].ID != snap2.ID {
		t.Fatalf("expected 1 remaining snapshot (%s), got %+v", snap2.ID, list2Resp.Data)
	}
}

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
	"github.com/dblens/dblens/internal/federation"
)

func TestFederationEndpoints(t *testing.T) {
	ctx := context.Background()

	fileA := fmt.Sprintf("/tmp/dblens_api_fed_a_%d.db", time.Now().UnixNano())
	fileB := fmt.Sprintf("/tmp/dblens_api_fed_b_%d.db", time.Now().UnixNano())
	defer os.Remove(fileA)
	defer os.Remove(fileB)

	dsnA := "sqlite://" + fileA
	dsnB := "sqlite://" + fileB

	mgr := connection.NewManager()

	entryA, err := mgr.GetByDSN(dsnA)
	if err != nil {
		t.Fatalf("failed to connect A: %v", err)
	}
	_, err = entryA.Driver.ExecuteQuery(ctx, `
		CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
		INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob');
	`)
	if err != nil {
		t.Fatalf("failed to seed A: %v", err)
	}

	entryB, err := mgr.GetByDSN(dsnB)
	if err != nil {
		t.Fatalf("failed to connect B: %v", err)
	}
	_, err = entryB.Driver.ExecuteQuery(ctx, `
		CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL);
		INSERT INTO orders VALUES (10, 1, 99.0), (20, 2, 45.5);
	`)
	if err != nil {
		t.Fatalf("failed to seed B: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	// 1. Test POST /api/federation/query
	t.Run("Federated Query Endpoint", func(t *testing.T) {
		reqBody := api.FederatedQueryAPIRequest{
			Query: `SELECT u.name, o.amount FROM [dbA].users u JOIN [dbB].orders o ON u.id = o.user_id ORDER BY u.name ASC`,
			Limit: 1000,
			Connections: []api.FederatedConnectionProfile{
				{ID: "dbA", DSN: dsnA},
				{ID: "dbB", DSN: dsnB},
			},
		}
		data, _ := json.Marshal(reqBody)
		req := httptest.NewRequest("POST", "/api/federation/query", bytes.NewReader(data))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
		}

		var resp struct {
			Data  *federation.QueryResult `json:"data"`
			Error *string                 `json:"error"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to parse json response: %v", err)
		}
		if resp.Error != nil {
			t.Fatalf("unexpected error response: %s", *resp.Error)
		}
		if resp.Data == nil || len(resp.Data.Result.Rows) != 2 {
			t.Fatalf("expected 2 rows in federated result, got %+v", resp.Data)
		}
		if fmt.Sprintf("%v", resp.Data.Result.Rows[0][0]) != "Alice" {
			t.Errorf("expected Alice first, got %v", resp.Data.Result.Rows[0][0])
		}
	})

	// 2. Test POST /api/federation/pipe
	t.Run("Data Pipe Endpoint", func(t *testing.T) {
		reqBody := api.DataPipeAPIRequest{
			SourceConnID: "dbA",
			SourceDSN:    dsnA,
			SourceTable:  "users",
			TargetConnID: "dbB",
			TargetDSN:    dsnB,
			TargetTable:  "migrated_users",
			CreateTable:  true,
			BatchSize:    100,
		}
		data, _ := json.Marshal(reqBody)
		req := httptest.NewRequest("POST", "/api/federation/pipe", bytes.NewReader(data))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("pipe failed %d: %s", rr.Code, rr.Body.String())
		}

		var resp struct {
			Data  *federation.PipeResult `json:"data"`
			Error *string                `json:"error"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode pipe resp: %v", err)
		}
		if resp.Data == nil || resp.Data.RowsMigrated != 2 {
			t.Fatalf("expected 2 rows migrated, got %+v", resp.Data)
		}

		// Verify target has migrated_users
		checkRes, err := entryB.Driver.ExecuteQuery(ctx, "SELECT COUNT(*) FROM migrated_users;")
		if err != nil {
			t.Fatalf("target check failed: %v", err)
		}
		if fmt.Sprintf("%v", checkRes.Rows[0][0]) != "2" {
			t.Fatalf("expected 2 rows in target, got %v", checkRes.Rows[0][0])
		}
	})

	// 3. Test POST /api/federation/reconcile
	t.Run("Reconcile Endpoint", func(t *testing.T) {
		reqBody := api.ReconcileAPIRequest{
			SourceConnID: "dbA",
			SourceDSN:    dsnA,
			SourceTable:  "users",
			TargetConnID: "dbB",
			TargetDSN:    dsnB,
			TargetTable:  "migrated_users",
		}
		data, _ := json.Marshal(reqBody)
		req := httptest.NewRequest("POST", "/api/federation/reconcile", bytes.NewReader(data))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("reconcile failed %d: %s", rr.Code, rr.Body.String())
		}

		var resp struct {
			Data  *federation.ReconcileResult `json:"data"`
			Error *string                     `json:"error"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode reconcile resp: %v", err)
		}
		if resp.Data == nil || resp.Data.Status != "IDENTICAL" {
			t.Fatalf("expected IDENTICAL status, got %+v", resp.Data)
		}
	})

	// 4. Test ReadOnly guardrail on Data Pipe
	t.Run("Data Pipe ReadOnly Forbidden", func(t *testing.T) {
		reqBody := api.DataPipeAPIRequest{
			SourceConnID: "dbA",
			SourceDSN:    dsnA,
			SourceTable:  "users",
			TargetConnID: "dbB",
			TargetDSN:    dsnB,
			TargetTable:  "users_readonly_fail",
			CreateTable:  true,
		}
		data, _ := json.Marshal(reqBody)
		req := httptest.NewRequest("POST", "/api/federation/pipe", bytes.NewReader(data))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-READONLY", "true")
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)

		if rr.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden, got %d: %s", rr.Code, rr.Body.String())
		}
	})
}

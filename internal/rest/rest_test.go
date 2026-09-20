package rest_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/driver/sqlite"
	"github.com/dblens/dblens/internal/rest"
)

func TestParseQueryParams(t *testing.T) {
	// 1. Full params test with all operators
	values := url.Values{
		"select": []string{"id,name,email"},
		"order":  []string{"created_at.desc,id.asc"},
		"limit":  []string{"25"},
		"offset": []string{"10"},
		"status": []string{"eq.active"},
		"age":    []string{"gte.18", "lt.65"},
		"score":  []string{"gt.50", "lte.100"},
		"name":   []string{"like.%alice%"},
		"role":   []string{"in.(admin,editor,author)"},
		"legacy": []string{"neq.deleted"},
	}

	qp, err := rest.ParseQueryParams(values)
	if err != nil {
		t.Fatalf("unexpected error parsing query params: %v", err)
	}

	if qp.Limit != 25 {
		t.Errorf("expected limit 25, got %d", qp.Limit)
	}
	if qp.Offset != 10 {
		t.Errorf("expected offset 10, got %d", qp.Offset)
	}
	if len(qp.Select) != 3 || qp.Select[0] != "id" || qp.Select[1] != "name" || qp.Select[2] != "email" {
		t.Errorf("unexpected select columns: %v", qp.Select)
	}
	if len(qp.Order) != 2 || qp.Order[0].Column != "created_at" || qp.Order[0].Direction != "DESC" {
		t.Errorf("unexpected order clauses: %v", qp.Order)
	}

	// Verify all filter operators are present
	opsFound := make(map[string]bool)
	for _, f := range qp.Filters {
		opsFound[f.Operator] = true
	}
	for _, expectedOp := range []string{"eq", "neq", "gt", "gte", "lt", "lte", "like", "in"} {
		if !opsFound[expectedOp] {
			t.Errorf("expected operator %q to be parsed, but was missing", expectedOp)
		}
	}

	// 2. Test invalid identifier rejected
	badValues := url.Values{
		"col; DROP TABLE users;--": []string{"eq.1"},
	}
	if _, err := rest.ParseQueryParams(badValues); err == nil {
		t.Errorf("expected error on malicious column identifier, got nil")
	}

	// 3. Test invalid in syntax rejected
	badIn := url.Values{
		"role": []string{"in.admin,editor"},
	}
	if _, err := rest.ParseQueryParams(badIn); err == nil {
		t.Errorf("expected error on missing parens in 'in', got nil")
	}

	// 4. Test unsupported operator rejected
	badOp := url.Values{
		"role": []string{"unknownop.admin"},
	}
	if _, err := rest.ParseQueryParams(badOp); err == nil {
		t.Errorf("expected error on unsupported operator, got nil")
	}
}

func TestSQLGenerationAcrossDialects(t *testing.T) {
	qp := rest.QueryParams{
		Select: []string{"id", "name", "role"},
		Filters: []rest.Filter{
			{Column: "status", Operator: "eq", Value: "active"},
			{Column: "role", Operator: "in", Values: []string{"admin", "editor"}},
			{Column: "age", Operator: "gte", Value: "21"},
		},
		Order: []rest.OrderClause{
			{Column: "id", Direction: "ASC"},
		},
		Limit:  10,
		Offset: 0,
	}

	// 1. PostgreSQL ($1, $2 and "identifier")
	pgSQL, pgArgs, err := rest.BuildSelectSQL("postgres", "public", "users", qp)
	if err != nil {
		t.Fatalf("postgres BuildSelectSQL error: %v", err)
	}
	if !strings.Contains(pgSQL, `"public"."users"`) {
		t.Errorf("postgres should use double quotes: %s", pgSQL)
	}
	if !strings.Contains(pgSQL, "$1") || !strings.Contains(pgSQL, "$2") || !strings.Contains(pgSQL, "$3") || !strings.Contains(pgSQL, "$4") {
		t.Errorf("postgres should use $1, $2, etc.: %s", pgSQL)
	}
	if len(pgArgs) != 4 {
		t.Errorf("expected 4 args, got %d (%v)", len(pgArgs), pgArgs)
	}

	// 2. MySQL (`identifier` and ?)
	mySQL, myArgs, err := rest.BuildSelectSQL("mysql", "appdb", "users", qp)
	if err != nil {
		t.Fatalf("mysql BuildSelectSQL error: %v", err)
	}
	if !strings.Contains(mySQL, "`appdb`.`users`") {
		t.Errorf("mysql should use backticks: %s", mySQL)
	}
	if strings.Contains(mySQL, "$") || !strings.Contains(mySQL, "?") {
		t.Errorf("mysql should use ? placeholders: %s", mySQL)
	}
	if len(myArgs) != 4 {
		t.Errorf("expected 4 args, got %d (%v)", len(myArgs), myArgs)
	}

	// 3. SQLite ("identifier" and ?)
	sqSQL, sqArgs, err := rest.BuildSelectSQL("sqlite", "", "users", qp)
	if err != nil {
		t.Fatalf("sqlite BuildSelectSQL error: %v", err)
	}
	if !strings.Contains(sqSQL, `"users"`) {
		t.Errorf("sqlite should use double quotes: %s", sqSQL)
	}
	if strings.Contains(sqSQL, "$") || !strings.Contains(sqSQL, "?") {
		t.Errorf("sqlite should use ? placeholders: %s", sqSQL)
	}
	if len(sqArgs) != 4 {
		t.Errorf("expected 4 args, got %d (%v)", len(sqArgs), sqArgs)
	}
}

func setupTestSQLite(t *testing.T) *sqlite.SQLiteDriver {
	drv, err := sqlite.New("sqlite://:memory:")
	if err != nil {
		t.Fatalf("failed to create sqlite in-memory driver: %v", err)
	}
	ctx := context.Background()
	createTable := `
	CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		email TEXT NOT NULL,
		role TEXT NOT NULL,
		age INTEGER,
		status TEXT DEFAULT 'active'
	);
	`
	if _, err := drv.ExecuteRaw(ctx, createTable); err != nil {
		t.Fatalf("failed to create users table: %v", err)
	}
	return drv
}

func TestCRUDOperations(t *testing.T) {
	drv := setupTestSQLite(t)
	defer drv.Close()

	// 1. POST: Insert single record
	postBody := `{"name": "Alice", "email": "alice@example.com", "role": "admin", "age": 28, "status": "active"}`
	reqPost := httptest.NewRequest(http.MethodPost, "/api/connections/1/rest/users", strings.NewReader(postBody))
	wPost := httptest.NewRecorder()
	rest.HandlePost(wPost, reqPost, drv, "", "users")
	if wPost.Code != http.StatusCreated {
		t.Fatalf("HandlePost failed with %d: %s", wPost.Code, wPost.Body.String())
	}

	// 2. POST: Insert multiple records (batch)
	batchBody := `[
		{"name": "Bob", "email": "bob@example.com", "role": "editor", "age": 34, "status": "active"},
		{"name": "Charlie", "email": "charlie@example.com", "role": "viewer", "age": 22, "status": "inactive"}
	]`
	reqBatch := httptest.NewRequest(http.MethodPost, "/api/connections/1/rest/users", strings.NewReader(batchBody))
	wBatch := httptest.NewRecorder()
	rest.HandlePost(wBatch, reqBatch, drv, "", "users")
	if wBatch.Code != http.StatusCreated {
		t.Fatalf("HandlePost batch failed with %d: %s", wBatch.Code, wBatch.Body.String())
	}

	// 3. GET: Query all rows with filter, order, and pagination
	reqGet := httptest.NewRequest(http.MethodGet, "/api/connections/1/rest/users?status=eq.active&order=id.asc&limit=10", nil)
	wGet := httptest.NewRecorder()
	rest.HandleGet(wGet, reqGet, drv, "", "users")
	if wGet.Code != http.StatusOK {
		t.Fatalf("HandleGet failed with %d: %s", wGet.Code, wGet.Body.String())
	}
	totalCount := wGet.Header().Get("X-Total-Count")
	if totalCount != "2" {
		t.Errorf("expected X-Total-Count 2, got %q", totalCount)
	}
	var getRows []map[string]interface{}
	if err := json.NewDecoder(wGet.Body).Decode(&getRows); err != nil {
		t.Fatalf("failed to decode GET response: %v", err)
	}
	if len(getRows) != 2 {
		t.Errorf("expected 2 active rows, got %d", len(getRows))
	}
	if getRows[0]["name"] != "Alice" || getRows[1]["name"] != "Bob" {
		t.Errorf("unexpected rows order or content: %v", getRows)
	}

	// 4. GET with IN filter
	reqGetIn := httptest.NewRequest(http.MethodGet, "/api/connections/1/rest/users?role=in.(admin,viewer)", nil)
	wGetIn := httptest.NewRecorder()
	rest.HandleGet(wGetIn, reqGetIn, drv, "", "users")
	if wGetIn.Code != http.StatusOK {
		t.Fatalf("HandleGet IN failed with %d: %s", wGetIn.Code, wGetIn.Body.String())
	}
	var inRows []map[string]interface{}
	_ = json.NewDecoder(wGetIn.Body).Decode(&inRows)
	if len(inRows) != 2 {
		t.Errorf("expected 2 rows with role in admin/viewer, got %d", len(inRows))
	}

	// 5. PATCH: Update record
	patchBody := `{"status": "archived", "age": 29}`
	reqPatch := httptest.NewRequest(http.MethodPatch, "/api/connections/1/rest/users?name=eq.Alice", strings.NewReader(patchBody))
	wPatch := httptest.NewRecorder()
	rest.HandlePatch(wPatch, reqPatch, drv, "", "users")
	if wPatch.Code != http.StatusOK {
		t.Fatalf("HandlePatch failed with %d: %s", wPatch.Code, wPatch.Body.String())
	}
	var patchRes map[string]interface{}
	_ = json.NewDecoder(wPatch.Body).Decode(&patchRes)
	if patchRes["rowsAffected"] != float64(1) {
		t.Errorf("expected 1 row affected, got %v", patchRes["rowsAffected"])
	}

	// 6. PATCH without filter must be rejected (400 Bad Request)
	reqPatchNoFilter := httptest.NewRequest(http.MethodPatch, "/api/connections/1/rest/users", strings.NewReader(patchBody))
	wPatchNoFilter := httptest.NewRecorder()
	rest.HandlePatch(wPatchNoFilter, reqPatchNoFilter, drv, "", "users")
	if wPatchNoFilter.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request on PATCH without filter, got %d", wPatchNoFilter.Code)
	}

	// 7. DELETE with filter
	reqDelete := httptest.NewRequest(http.MethodDelete, "/api/connections/1/rest/users?name=eq.Charlie", nil)
	wDelete := httptest.NewRecorder()
	rest.HandleDelete(wDelete, reqDelete, drv, "", "users")
	if wDelete.Code != http.StatusOK {
		t.Fatalf("HandleDelete failed with %d: %s", wDelete.Code, wDelete.Body.String())
	}
	var delRes map[string]interface{}
	_ = json.NewDecoder(wDelete.Body).Decode(&delRes)
	if delRes["rowsAffected"] != float64(1) {
		t.Errorf("expected 1 row affected, got %v", delRes["rowsAffected"])
	}

	// 8. DELETE without filter must be rejected (400 Bad Request)
	reqDeleteNoFilter := httptest.NewRequest(http.MethodDelete, "/api/connections/1/rest/users", nil)
	wDeleteNoFilter := httptest.NewRecorder()
	rest.HandleDelete(wDeleteNoFilter, reqDeleteNoFilter, drv, "", "users")
	if wDeleteNoFilter.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request on DELETE without filter, got %d", wDeleteNoFilter.Code)
	}
}

func TestSQLInjectionResistance(t *testing.T) {
	drv := setupTestSQLite(t)
	defer drv.Close()

	// 1. Column injection via filter key
	injFilter := url.Values{
		`id" OR 1=1 --`: []string{"eq.1"},
	}
	reqInjCol := httptest.NewRequest(http.MethodGet, "/api/connections/1/rest/users?"+injFilter.Encode(), nil)
	wInjCol := httptest.NewRecorder()
	rest.HandleGet(wInjCol, reqInjCol, drv, "", "users")
	if wInjCol.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request for malicious column in filter, got %d", wInjCol.Code)
	}

	// 2. Column injection via select
	reqInjSelect := httptest.NewRequest(http.MethodGet, "/api/connections/1/rest/users?select="+url.QueryEscape(`id,name"; DROP TABLE users;--`), nil)
	wInjSelect := httptest.NewRecorder()
	rest.HandleGet(wInjSelect, reqInjSelect, drv, "", "users")
	if wInjSelect.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request for malicious select column, got %d", wInjSelect.Code)
	}

	// 3. Table injection
	reqInjTable := httptest.NewRequest(http.MethodGet, "/api/connections/1/rest/users", nil)
	wInjTable := httptest.NewRecorder()
	rest.HandleGet(wInjTable, reqInjTable, drv, "", "users;DROP TABLE users;--")
	if wInjTable.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request for malicious table name, got %d", wInjTable.Code)
	}

	// 4. Malicious value in filter is safely parameterized, not executed
	reqInjVal := httptest.NewRequest(http.MethodGet, "/api/connections/1/rest/users?name="+url.QueryEscape(`eq.' OR '1'='1`), nil)
	wInjVal := httptest.NewRecorder()
	rest.HandleGet(wInjVal, reqInjVal, drv, "", "users")
	if wInjVal.Code != http.StatusOK {
		t.Fatalf("expected 200 OK with parameterized malicious value, got %d: %s", wInjVal.Code, wInjVal.Body.String())
	}
	var resRows []map[string]interface{}
	_ = json.NewDecoder(wInjVal.Body).Decode(&resRows)
	if len(resRows) != 0 {
		t.Errorf("malicious SQL injection value matched rows! rows: %v", resRows)
	}

	// Verify table still exists and is untouched
	checkRes, err := drv.ExecuteRaw(context.Background(), "SELECT COUNT(*) FROM users")
	if err != nil {
		t.Fatalf("table users was destroyed or altered by injection attempt: %v", err)
	}
	if len(checkRes.Rows) == 0 {
		t.Fatalf("users table missing")
	}

	// 5. Malicious keys in INSERT JSON
	maliciousJSON := []byte(`{"id": 99, "name'; DROP TABLE users;--": "evil"}`)
	reqBadInsert := httptest.NewRequest(http.MethodPost, "/api/connections/1/rest/users", bytes.NewReader(maliciousJSON))
	wBadInsert := httptest.NewRecorder()
	rest.HandlePost(wBadInsert, reqBadInsert, drv, "", "users")
	if wBadInsert.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request on malicious JSON key in INSERT, got %d", wBadInsert.Code)
	}
}

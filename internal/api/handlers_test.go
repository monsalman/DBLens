package api_test

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/api"
	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/diff"
	"github.com/dblens/dblens/internal/driver"
)

func TestMaskDSN(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{
			input:    "mysql://root:***@tcp(localhost:3306)/dbname",
			expected: "mysql://root:***@tcp(localhost:3306)/dbname",
		},
		{
			input:    "root:secret@tcp(localhost:3306)/dbname",
			expected: "root:***@tcp(localhost:3306)/dbname",
		},
		{
			input:    "postgres://user:***@localhost:5432/db",
			expected: "postgres://user:***@localhost:5432/db",
		},
		{
			input:    "root@tcp(localhost:3306)/dbname",
			expected: "root@tcp(localhost:3306)/dbname",
		},
		{
			input:    "sqlite:///data/test.db",
			expected: "sqlite:///data/test.db",
		},
		{
			input:    "postgres://user:p@ss@w0rd@localhost:5432/db",
			expected: "postgres://user:***@localhost:5432/db",
		},
		{
			input:    "root:p@ss@word@tcp(localhost:3306)/dbname",
			expected: "root:***@tcp(localhost:3306)/dbname",
		},
		{
			input:    "mysql://root:p@ss@word@tcp(localhost:3306)/dbname",
			expected: "mysql://root:***@tcp(localhost:3306)/dbname",
		},
		{
			input:    "user:pass:word@tcp(localhost:3306)/dbname",
			expected: "user:***@tcp(localhost:3306)/dbname",
		},
		{
			input:    "postgres://user:secret@localhost:5432/db?email=foo@bar.com",
			expected: "postgres://user:***@localhost:5432/db?email=foo@bar.com",
		},
		{
			input:    "oracle://scott:tiger@localhost:1521/xe",
			expected: "oracle://scott:***@localhost:1521/xe",
		},
		{
			input:    "postgres://user@localhost:5432/db",
			expected: "postgres://user@localhost:5432/db",
		},
		{
			input:    ":memory:",
			expected: ":memory:",
		},
	}

	for _, tc := range cases {
		got := api.MaskDSN(tc.input)
		if got != tc.expected {
			t.Errorf("MaskDSN(%q) = %q, want %q", tc.input, got, tc.expected)
		}
	}
}

func TestBatchInsertHandler(t *testing.T) {
	dbFile := "/tmp/dblens_api_batch_test.db"
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
		CREATE TABLE products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			price REAL NOT NULL
		);
	`)
	if err != nil {
		t.Fatalf("failed to create table: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	// 1. Successful Batch Insert
	body := `{
		"schema": "",
		"table": "products",
		"rows": [
			{"title": "Widget A", "price": 9.99},
			{"title": "Widget B", "price": 19.99}
		]
	}`
	req := httptest.NewRequest("POST", "/api/connections/default/batch-insert", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-DBLENS-DSN", dsn)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on batch insert, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"affectedRows":2`) {
		t.Fatalf("expected affectedRows: 2 in response, got: %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"generatedSQL"`) {
		t.Fatalf("expected generatedSQL in response, got: %s", rec.Body.String())
	}

	// 2. Empty table validation
	emptyTableBody := `{"table": "", "rows": [{"title": "Widget C"}]}`
	req2 := httptest.NewRequest("POST", "/api/connections/default/batch-insert", strings.NewReader(emptyTableBody))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("X-DBLENS-DSN", dsn)
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on empty table, got: %d", rec2.Code)
	}

	// 3. Empty rows validation
	emptyRowsBody := `{"table": "products", "rows": []}`
	req3 := httptest.NewRequest("POST", "/api/connections/default/batch-insert", strings.NewReader(emptyRowsBody))
	req3.Header.Set("Content-Type", "application/json")
	req3.Header.Set("X-DBLENS-DSN", dsn)
	rec3 := httptest.NewRecorder()
	router.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on empty rows, got: %d", rec3.Code)
	}

	// 4. Malformed JSON validation
	req4 := httptest.NewRequest("POST", "/api/connections/default/batch-insert", strings.NewReader(`{malformed`))
	req4.Header.Set("Content-Type", "application/json")
	req4.Header.Set("X-DBLENS-DSN", dsn)
	rec4 := httptest.NewRecorder()
	router.ServeHTTP(rec4, req4)
	if rec4.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on invalid json, got: %d", rec4.Code)
	}

	// 5. Exceeds max row limit validation (> 1000 rows)
	tooManyRows := make([]map[string]interface{}, 1001)
	for i := range tooManyRows {
		tooManyRows[i] = map[string]interface{}{"title": "item", "price": 1.0}
	}
	tooManyJSON, _ := json.Marshal(map[string]interface{}{
		"table": "products",
		"rows":  tooManyRows,
	})
	req5 := httptest.NewRequest("POST", "/api/connections/default/batch-insert", bytes.NewReader(tooManyJSON))
	req5.Header.Set("Content-Type", "application/json")
	req5.Header.Set("X-DBLENS-DSN", dsn)
	rec5 := httptest.NewRecorder()
	router.ServeHTTP(rec5, req5)
	if rec5.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on >1000 rows, got: %d", rec5.Code)
	}
	if !strings.Contains(rec5.Body.String(), "exceeds maximum limit") {
		t.Fatalf("expected limit error message, got: %s", rec5.Body.String())
	}
}

func TestExportTableStreaming(t *testing.T) {
	dbFile := "/tmp/dblens_api_export_test.db"
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
		CREATE TABLE books (
			id INTEGER PRIMARY KEY,
			title TEXT,
			author TEXT,
			price REAL
		);
		INSERT INTO books (id, title, author, price) VALUES (1, 'Book A', 'Alice', 12.50);
		INSERT INTO books (id, title, author, price) VALUES (2, 'Book B', NULL, 15.00);
	`)
	if err != nil {
		t.Fatalf("failed to create books table: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	// 1. Export CSV
	reqCSV := httptest.NewRequest("GET", "/api/connections/default/export?table=books&format=csv", nil)
	reqCSV.Header.Set("X-DBLENS-DSN", dsn)
	recCSV := httptest.NewRecorder()
	router.ServeHTTP(recCSV, reqCSV)

	if recCSV.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on CSV export, got %d: %s", recCSV.Code, recCSV.Body.String())
	}
	if !strings.Contains(recCSV.Header().Get("Content-Type"), "text/csv") {
		t.Fatalf("expected text/csv Content-Type, got %s", recCSV.Header().Get("Content-Type"))
	}
	rdr := csv.NewReader(recCSV.Body)
	csvRecords, err := rdr.ReadAll()
	if err != nil {
		t.Fatalf("failed to read exported CSV: %v", err)
	}
	if len(csvRecords) != 3 { // 1 header + 2 rows
		t.Fatalf("expected 3 CSV records, got %d", len(csvRecords))
	}
	if csvRecords[0][0] != "id" || csvRecords[0][1] != "title" {
		t.Fatalf("unexpected CSV headers: %v", csvRecords[0])
	}
	if csvRecords[2][2] != "" { // NULL author in row 2
		t.Fatalf("expected empty string for NULL author, got %q", csvRecords[2][2])
	}

	// 2. Export JSON
	reqJSON := httptest.NewRequest("GET", "/api/connections/default/export?table=books&format=json", nil)
	reqJSON.Header.Set("X-DBLENS-DSN", dsn)
	recJSON := httptest.NewRecorder()
	router.ServeHTTP(recJSON, reqJSON)

	if recJSON.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on JSON export, got %d", recJSON.Code)
	}
	var jsonRows []map[string]interface{}
	if err := json.Unmarshal(recJSON.Body.Bytes(), &jsonRows); err != nil {
		t.Fatalf("failed to parse exported JSON: %v. Body: %s", err, recJSON.Body.String())
	}
	if len(jsonRows) != 2 {
		t.Fatalf("expected 2 JSON rows, got %d", len(jsonRows))
	}
	if jsonRows[0]["title"] != "Book A" {
		t.Fatalf("unexpected row 0 title: %v", jsonRows[0]["title"])
	}

	// 3. Export SQL
	reqSQL := httptest.NewRequest("GET", "/api/connections/default/export?table=books&format=sql", nil)
	reqSQL.Header.Set("X-DBLENS-DSN", dsn)
	recSQL := httptest.NewRecorder()
	router.ServeHTTP(recSQL, reqSQL)

	if recSQL.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on SQL export, got %d", recSQL.Code)
	}
	sqlBody := recSQL.Body.String()
	if !strings.Contains(sqlBody, "INSERT INTO `books`") {
		t.Fatalf("expected INSERT INTO statement in SQL export, got: %s", sqlBody)
	}
	if !strings.Contains(sqlBody, "NULL") {
		t.Fatalf("expected NULL in SQL export for null author, got: %s", sqlBody)
	}

	// 4. Test dsn query parameter is rejected / header is required
	reqQueryDSN := httptest.NewRequest("GET", "/api/connections/default/export?table=books&format=csv&dsn="+dsn, nil)
	recQueryDSN := httptest.NewRecorder()
	router.ServeHTTP(recQueryDSN, reqQueryDSN)
	if recQueryDSN.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request with dsn query param, got %d", recQueryDSN.Code)
	}
	if !strings.Contains(recQueryDSN.Body.String(), "X-DBLENS-DSN header is required") {
		t.Fatalf("expected 'X-DBLENS-DSN header is required' error, got: %s", recQueryDSN.Body.String())
	}

	// 5. Test validation errors
	reqNoTable := httptest.NewRequest("GET", "/api/connections/default/export?format=csv", nil)
	reqNoTable.Header.Set("X-DBLENS-DSN", dsn)
	recNoTable := httptest.NewRecorder()
	router.ServeHTTP(recNoTable, reqNoTable)
	if recNoTable.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request when table is missing, got %d", recNoTable.Code)
	}

	reqBadFormat := httptest.NewRequest("GET", "/api/connections/default/export?table=books&format=xml", nil)
	reqBadFormat.Header.Set("X-DBLENS-DSN", dsn)
	recBadFormat := httptest.NewRecorder()
	router.ServeHTTP(recBadFormat, reqBadFormat)
	if recBadFormat.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on bad format, got %d", recBadFormat.Code)
	}

	// Control characters in table/schema (SQL comment injection protection)
	reqNewlineTable := httptest.NewRequest("GET", "/api/connections/default/export?table=books%0Ainjection&format=csv", nil)
	reqNewlineTable.Header.Set("X-DBLENS-DSN", dsn)
	recNewlineTable := httptest.NewRecorder()
	router.ServeHTTP(recNewlineTable, reqNewlineTable)
	if recNewlineTable.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on newline in table name, got %d", recNewlineTable.Code)
	}

	reqNullTable := httptest.NewRequest("GET", "/api/connections/default/export?table=books%00injection&format=csv", nil)
	reqNullTable.Header.Set("X-DBLENS-DSN", dsn)
	recNullTable := httptest.NewRecorder()
	router.ServeHTTP(recNullTable, reqNullTable)
	if recNullTable.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on null byte in table name, got %d", recNullTable.Code)
	}

	reqCrSchema := httptest.NewRequest("GET", "/api/connections/default/export?table=books&schema=pub%0Dlic&format=csv", nil)
	reqCrSchema.Header.Set("X-DBLENS-DSN", dsn)
	recCrSchema := httptest.NewRecorder()
	router.ServeHTTP(recCrSchema, reqCrSchema)
	if recCrSchema.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on carriage return in schema, got %d", recCrSchema.Code)
	}

	// 6. Test context cancellation
	canceledCtx, cancel := context.WithCancel(context.Background())
	cancel()
	reqCanceled := httptest.NewRequest("GET", "/api/connections/default/export?table=books&format=csv", nil).WithContext(canceledCtx)
	reqCanceled.Header.Set("X-DBLENS-DSN", dsn)
	recCanceled := httptest.NewRecorder()
	router.ServeHTTP(recCanceled, reqCanceled)
}

func TestImportCSVHandler(t *testing.T) {
	dbFile := "/tmp/dblens_api_import_csv_test.db"
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
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT,
			qty INTEGER
		);
	`)
	if err != nil {
		t.Fatalf("failed to create items table: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	csvData := "name,qty\nApple,10\nBanana,20\nOrange,\n"
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("table", "items")
	part, err := writer.CreateFormFile("file", "items.csv")
	if err != nil {
		t.Fatalf("failed to create form file: %v", err)
	}
	_, _ = part.Write([]byte(csvData))
	_ = writer.Close()

	req := httptest.NewRequest("POST", "/api/connections/default/import/csv", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("X-DBLENS-DSN", dsn)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on CSV import, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"affectedRows":3`) {
		t.Fatalf("expected affectedRows: 3 in response, got: %s", rec.Body.String())
	}

	// Verify data in table
	qr, err := entry.Driver.ExecuteQuery(ctx, "SELECT COUNT(*) FROM items")
	if err != nil {
		t.Fatalf("failed to count rows: %v", err)
	}
	if len(qr.Rows) != 1 || qr.Rows[0][0].(int64) != 3 {
		t.Fatalf("expected 3 rows in items table, got %v", qr.Rows)
	}
}

func TestImportSQLHandler(t *testing.T) {
	dbFile := "/tmp/dblens_api_import_sql_test.db"
	_ = os.Remove(dbFile)
	defer os.Remove(dbFile)

	dsn := "sqlite://" + dbFile
	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to create connection: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	sqlData := `
		-- Table creation
		CREATE TABLE customers (
			id INTEGER PRIMARY KEY,
			full_name TEXT
		);

		/* Insert records with semicolons inside strings */
		INSERT INTO customers (id, full_name) VALUES (1, 'Alice; Corporate & Co');
		INSERT INTO customers (id, full_name) VALUES (2, 'Bob Smith');
	`
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "script.sql")
	if err != nil {
		t.Fatalf("failed to create form file: %v", err)
	}
	_, _ = part.Write([]byte(sqlData))
	_ = writer.Close()

	req := httptest.NewRequest("POST", "/api/connections/default/import/sql", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("X-DBLENS-DSN", dsn)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on SQL import, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"statementsExecuted":3`) {
		t.Fatalf("expected statementsExecuted: 3 in response, got: %s", rec.Body.String())
	}

	// Verify data in table
	ctx := context.Background()
	qr, err := entry.Driver.ExecuteQuery(ctx, "SELECT full_name FROM customers WHERE id = 1")
	if err != nil {
		t.Fatalf("failed to query imported table: %v", err)
	}
	if len(qr.Rows) != 1 || qr.Rows[0][0] != "Alice; Corporate & Co" {
		t.Fatalf("expected 'Alice; Corporate & Co', got %v", qr.Rows)
	}
}

func TestFormatSQLValue(t *testing.T) {
	// MySQL escaping: backslash escaped first, then single quotes
	input := "C:\\dir\\sub\\'file'"
	gotMySQL := api.FormatSQLValue("mysql", input)
	expectedMySQL := "'C:\\\\dir\\\\sub\\\\''file'''"
	if gotMySQL != expectedMySQL {
		t.Errorf("FormatSQLValue(mysql) = %q, want %q", gotMySQL, expectedMySQL)
	}

	// SQLite/Postgres escaping: single quotes escaped only
	gotPG := api.FormatSQLValue("postgres", input)
	expectedPG := "'C:\\dir\\sub\\''file'''"
	if gotPG != expectedPG {
		t.Errorf("FormatSQLValue(postgres) = %q, want %q", gotPG, expectedPG)
	}

	// NULL, numbers, booleans
	if got := api.FormatSQLValue("mysql", nil); got != "NULL" {
		t.Errorf("expected NULL, got %s", got)
	}
	if got := api.FormatSQLValue("mysql", 42); got != "42" {
		t.Errorf("expected 42, got %s", got)
	}
	if got := api.FormatSQLValue("mysql", true); got != "TRUE" {
		t.Errorf("expected TRUE, got %s", got)
	}
}

func TestSplitSQLStatements(t *testing.T) {
	sql := `
		-- Line comment; with semicolon
		/* Block comment; with semicolon */
		INSERT INTO t (val) VALUES ('It\'s fine; with semicolon');
		SELECT ` + "`" + `col;name` + "`" + ` FROM ` + "`" + `tbl;name` + "`" + `;
		CREATE FUNCTION foo() RETURNS void AS $$
			BEGIN
				SELECT 1;
				-- comment;
			END;
		$$ LANGUAGE plpgsql;
		CREATE FUNCTION bar() RETURNS void AS $tag$
			BEGIN
				SELECT 2;
			END;
		$tag$ LANGUAGE plpgsql;
		SELECT 'regular ''quote''';
	`
	stmts := api.SplitSQLStatements(sql)
	if len(stmts) != 5 {
		t.Fatalf("expected 5 statements, got %d: %#v", len(stmts), stmts)
	}
	if !strings.Contains(stmts[0], "It\\'s fine; with semicolon") {
		t.Errorf("stmt 0 should preserve backslash escaped quote, got: %s", stmts[0])
	}
	if !strings.Contains(stmts[1], "`col;name`") {
		t.Errorf("stmt 1 should preserve backtick identifier, got: %s", stmts[1])
	}
	if !strings.Contains(stmts[2], "SELECT 1;") {
		t.Errorf("stmt 2 should preserve body inside $$, got: %s", stmts[2])
	}
	if !strings.Contains(stmts[3], "SELECT 2;") {
		t.Errorf("stmt 3 should preserve body inside $tag$, got: %s", stmts[3])
	}
	if !strings.Contains(stmts[4], "regular ''quote''") {
		t.Errorf("stmt 4 should preserve doubled quotes, got: %s", stmts[4])
	}
}

func TestCommandPaletteMetadataEndpoints(t *testing.T) {
	dbFile := "/tmp/dblens_palette_test.db"
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
		CREATE TABLE palette_items (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL
		);
		CREATE VIEW palette_items_view AS SELECT id, name FROM palette_items;
	`)
	if err != nil {
		t.Fatalf("failed to create table and view: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	// 1. Test Schemas Endpoint
	reqSchemas := httptest.NewRequest("GET", "/api/connections/default/schemas", nil)
	reqSchemas.Header.Set("X-DBLENS-DSN", dsn)
	recSchemas := httptest.NewRecorder()
	router.ServeHTTP(recSchemas, reqSchemas)

	if recSchemas.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on get schemas, got %d: %s", recSchemas.Code, recSchemas.Body.String())
	}

	var resSchemas struct {
		Data  []string `json:"data"`
		Error *string  `json:"error"`
	}
	if err := json.Unmarshal(recSchemas.Body.Bytes(), &resSchemas); err != nil {
		t.Fatalf("failed to decode schemas response: %v", err)
	}
	if len(resSchemas.Data) == 0 {
		t.Errorf("expected at least 1 schema, got %d", len(resSchemas.Data))
	}

	// 2. Test Tables & Views Endpoint
	reqTables := httptest.NewRequest("GET", "/api/connections/default/tables", nil)
	reqTables.Header.Set("X-DBLENS-DSN", dsn)
	recTables := httptest.NewRecorder()
	router.ServeHTTP(recTables, reqTables)

	if recTables.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on get tables, got %d: %s", recTables.Code, recTables.Body.String())
	}

	var resTables struct {
		Data  []map[string]interface{} `json:"data"`
		Error *string                  `json:"error"`
	}
	if err := json.Unmarshal(recTables.Body.Bytes(), &resTables); err != nil {
		t.Fatalf("failed to decode tables response: %v", err)
	}
	if len(resTables.Data) < 2 {
		t.Fatalf("expected at least 2 tables/views, got %d", len(resTables.Data))
	}

	foundTable := false
	foundView := false
	for _, tbl := range resTables.Data {
		name, _ := tbl["name"].(string)
		tblType, _ := tbl["type"].(string)
		if name == "palette_items" && tblType == "table" {
			foundTable = true
		}
		if name == "palette_items_view" && tblType == "view" {
			foundView = true
		}
	}

	if !foundTable {
		t.Errorf("expected palette_items table in metadata response")
	}
	if !foundView {
		t.Errorf("expected palette_items_view in metadata response")
	}
}

func TestGetTableDDL(t *testing.T) {
	dbFile := "/tmp/dblens_api_ddl_test.db"
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
		CREATE TABLE products (
			id INTEGER PRIMARY KEY,
			sku TEXT NOT NULL UNIQUE,
			price REAL DEFAULT 0.0
		);
		CREATE INDEX idx_products_price ON products(price);
	`)
	if err != nil {
		t.Fatalf("failed to create test table: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	req := httptest.NewRequest("GET", "/api/connections/default/tables/products/ddl?schema=main", nil)
	req.Header.Set("X-DBLENS-DSN", dsn)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on get table ddl, got %d: %s", rec.Code, rec.Body.String())
	}

	var res struct {
		Data struct {
			Table   string `json:"table"`
			Schema  string `json:"schema"`
			Dialect string `json:"dialect"`
			DDL     string `json:"ddl"`
		} `json:"data"`
		Error *string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to decode ddl response: %v", err)
	}

	if res.Data.Table != "products" {
		t.Errorf("expected table 'products', got %q", res.Data.Table)
	}
	if res.Data.Dialect != "sqlite" {
		t.Errorf("expected dialect 'sqlite', got %q", res.Data.Dialect)
	}
	if !strings.Contains(res.Data.DDL, "CREATE TABLE products") && !strings.Contains(res.Data.DDL, "CREATE TABLE `products`") {
		t.Errorf("expected CREATE TABLE in DDL, got: %s", res.Data.DDL)
	}
	if !strings.Contains(res.Data.DDL, "idx_products_price") {
		t.Errorf("expected idx_products_price in DDL, got: %s", res.Data.DDL)
	}
}

func TestGetTableDetails(t *testing.T) {
	dbFile := "/tmp/dblens_api_table_details_test.db"
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
		CREATE TABLE categories (
			id INTEGER PRIMARY KEY,
			title TEXT NOT NULL
		);
		CREATE TABLE items (
			id INTEGER PRIMARY KEY,
			cat_id INTEGER,
			sku TEXT NOT NULL,
			price REAL DEFAULT 9.99,
			CONSTRAINT fk_cat FOREIGN KEY (cat_id) REFERENCES categories(id) ON UPDATE CASCADE ON DELETE SET NULL
		);
		CREATE UNIQUE INDEX idx_items_sku ON items(sku);
	`)
	if err != nil {
		t.Fatalf("failed to create test tables: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	req := httptest.NewRequest("GET", "/api/connections/default/tables/items?schema=main", nil)
	req.Header.Set("X-DBLENS-DSN", dsn)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on get table details, got %d: %s", rec.Code, rec.Body.String())
	}

	var res struct {
		Data    driver.TableDetail `json:"data"`
		Error   *string            `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to decode table details response: %v", err)
	}

	detail := res.Data
	if detail.Name != "items" {
		t.Errorf("expected table 'items', got %q", detail.Name)
	}
	if detail.Dialect != "sqlite" {
		t.Errorf("expected dialect 'sqlite', got %q", detail.Dialect)
	}

	// Verify columns
	if len(detail.Columns) != 4 {
		t.Fatalf("expected 4 columns, got %d", len(detail.Columns))
	}
	colMap := make(map[string]driver.ColumnMeta)
	for _, c := range detail.Columns {
		colMap[c.Name] = c
	}
	if !colMap["id"].IsPrimary {
		t.Errorf("expected id to be primary key")
	}
	if !colMap["cat_id"].IsForeignKey {
		t.Errorf("expected cat_id to be foreign key")
	}
	if colMap["sku"].IsNullable {
		t.Errorf("expected sku to be NOT NULL")
	}
	if colMap["price"].Default == nil || !strings.Contains(*colMap["price"].Default, "9.99") {
		t.Errorf("expected price default 9.99, got %+v", colMap["price"].Default)
	}

	// Verify FKs
	if len(detail.FKs) == 0 {
		t.Fatalf("expected at least 1 FK, got 0")
	}
	fk := detail.FKs[0]
	if fk.Column != "cat_id" || fk.RefTable != "categories" || fk.RefColumn != "id" {
		t.Errorf("unexpected FK mapping: %+v", fk)
	}
	if fk.OnUpdate != "CASCADE" || fk.OnDelete != "SET NULL" {
		t.Errorf("unexpected FK action: update=%s delete=%s", fk.OnUpdate, fk.OnDelete)
	}

	// Verify Indexes
	foundSkuIdx := false
	for _, idx := range detail.Indexes {
		if idx.Name == "idx_items_sku" {
			foundSkuIdx = true
			if !idx.IsUnique {
				t.Errorf("expected idx_items_sku to be unique")
			}
		}
	}
	if !foundSkuIdx {
		t.Errorf("idx_items_sku index not found in table details")
	}

	// Verify DDL
	if !strings.Contains(detail.DDL, "CREATE TABLE items") && !strings.Contains(detail.DDL, "CREATE TABLE `items`") {
		t.Errorf("expected CREATE TABLE in detail.DDL, got: %s", detail.DDL)
	}

	// Verify control character sanitization (400 Bad Request)
	badReq := httptest.NewRequest("GET", "/api/connections/default/tables/items%00injection?schema=main", nil)
	badReq.Header.Set("X-DBLENS-DSN", dsn)
	badRec := httptest.NewRecorder()
	router.ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request on table with null byte, got %d", badRec.Code)
	}

	badDdlReq := httptest.NewRequest("GET", "/api/connections/default/tables/items/ddl?schema=main%0Ainjected", nil)
	badDdlReq.Header.Set("X-DBLENS-DSN", dsn)
	badDdlRec := httptest.NewRecorder()
	router.ServeHTTP(badDdlRec, badDdlReq)
	if badDdlRec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request on ddl schema with newline, got %d", badDdlRec.Code)
	}
}

func TestExecuteQueryHandler(t *testing.T) {
	dbFile := "/tmp/dblens_api_query_test.db"
	_ = os.Remove(dbFile)
	defer os.Remove(dbFile)

	dsn := "sqlite://" + dbFile

	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to create connection: %v", err)
	}

	ctx := context.Background()
	_, err = entry.Driver.ExecuteQuery(ctx, "CREATE TABLE items (id INT, name TEXT);")
	if err != nil {
		t.Fatalf("failed to create test table: %v", err)
	}
	_, err = entry.Driver.ExecuteQuery(ctx, "INSERT INTO items (id, name) VALUES (1, 'item1'), (2, 'item2');")
	if err != nil {
		t.Fatalf("failed to insert sample items: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	type queryResponse struct {
		Data struct {
			Columns      []string        `json:"columns"`
			Rows         [][]interface{} `json:"rows"`
			Elapsed      int64           `json:"elapsed"`
			AffectedRows int64           `json:"affectedRows"`
		} `json:"data"`
		Error *string `json:"error"`
	}

	// 1. Valid SELECT query with {"query": "SELECT * FROM items ORDER BY id ASC;"}
	{
		body := `{"query": "SELECT * FROM items ORDER BY id ASC;"}`
		req := httptest.NewRequest("POST", "/api/connections/default/query", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK on valid query, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp queryResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}

		if resp.Error != nil {
			t.Fatalf("expected nil error in response, got: %s", *resp.Error)
		}

		if len(resp.Data.Columns) != 2 || resp.Data.Columns[0] != "id" || resp.Data.Columns[1] != "name" {
			t.Fatalf("expected columns ['id', 'name'], got: %v", resp.Data.Columns)
		}

		if len(resp.Data.Rows) != 2 {
			t.Fatalf("expected 2 rows, got: %d", len(resp.Data.Rows))
		}

		// Row 1: id=1, name="item1"
		row1Name, ok := resp.Data.Rows[0][1].(string)
		if !ok || row1Name != "item1" {
			t.Errorf("expected row 1 name 'item1', got: %v", resp.Data.Rows[0][1])
		}

		// Row 2: id=2, name="item2"
		row2Name, ok := resp.Data.Rows[1][1].(string)
		if !ok || row2Name != "item2" {
			t.Errorf("expected row 2 name 'item2', got: %v", resp.Data.Rows[1][1])
		}
	}

	// 2. Syntax / Database error: non-existent table
	{
		body := `{"query": "SELECT * FROM non_existent_table_xyz;"}`
		req := httptest.NewRequest("POST", "/api/connections/default/query", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500 Internal Server Error for invalid query, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp queryResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode error response: %v", err)
		}

		if resp.Error == nil || *resp.Error == "" {
			t.Fatalf("expected non-empty error in response, got: %v", resp.Error)
		}
	}

	// 3. Empty query: {"query": ""}
	{
		body := `{"query": ""}`
		req := httptest.NewRequest("POST", "/api/connections/default/query", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request for empty query, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp queryResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode error response: %v", err)
		}

		if resp.Error == nil || *resp.Error == "" {
			t.Fatalf("expected non-empty error for empty query, got: %v", resp.Error)
		}
	}

	// 4. Backwards compatibility: {"sql": "SELECT COUNT(*) FROM items;"}
	{
		body := `{"sql": "SELECT COUNT(*) FROM items;"}`
		req := httptest.NewRequest("POST", "/api/connections/default/query", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for 'sql' field query, got %d: %s", rec.Code, rec.Body.String())
		}
	}

	// 5. Parameterized query execution with :param and {{param}}
	{
		body := `{"sql": "SELECT * FROM items WHERE id = :id", "params": {"id": 1}}`
		req := httptest.NewRequest("POST", "/api/connections/default/query", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for parameterized query, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp queryResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if len(resp.Data.Rows) != 1 {
			t.Fatalf("expected 1 row for id=1, got %d", len(resp.Data.Rows))
		}
		if resp.Data.Rows[0][1] != "item1" {
			t.Errorf("expected item1, got %v", resp.Data.Rows[0][1])
		}
	}

	// 6. Parameterized query with double brace {{var}}
	{
		body := `{"sql": "SELECT * FROM items WHERE name = {{ target_name }}", "params": {"target_name": "item2"}}`
		req := httptest.NewRequest("POST", "/api/connections/default/query", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for double-brace parameterized query, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp queryResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if len(resp.Data.Rows) != 1 {
			t.Fatalf("expected 1 row for item2, got %d", len(resp.Data.Rows))
		}
		if resp.Data.Rows[0][1] != "item2" {
			t.Errorf("expected item2, got %v", resp.Data.Rows[0][1])
		}
	}

	// 7. Missing parameter returns error
	{
		body := `{"sql": "SELECT * FROM items WHERE id = :missing_id", "params": {}}`
		req := httptest.NewRequest("POST", "/api/connections/default/query", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500 on missing parameter, got %d: %s", rec.Code, rec.Body.String())
		}
	}
}

func TestExplainQueryHandler(t *testing.T) {
	dbFile := "/tmp/dblens_api_explain_test.db"
	_ = os.Remove(dbFile)
	defer os.Remove(dbFile)

	dsn := "sqlite://" + dbFile

	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to create connection: %v", err)
	}

	ctx := context.Background()
	_, err = entry.Driver.ExecuteQuery(ctx, "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INT);")
	if err != nil {
		t.Fatalf("failed to create test table: %v", err)
	}
	_, err = entry.Driver.ExecuteQuery(ctx, "CREATE INDEX idx_age ON users(age);")
	if err != nil {
		t.Fatalf("failed to create index: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	type explainResponse struct {
		Data *driver.ExplainResult `json:"data"`
		Error *string              `json:"error"`
	}

	// 1. Valid EXPLAIN query on /connections/default/explain
	{
		body := `{"query": "SELECT * FROM users WHERE age > 20;"}`
		req := httptest.NewRequest("POST", "/api/connections/default/explain", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK on valid explain query, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp explainResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}

		if resp.Error != nil {
			t.Fatalf("expected nil error, got: %s", *resp.Error)
		}
		if resp.Data == nil {
			t.Fatalf("expected non-nil data in explain response")
		}
		if resp.Data.Dialect != "sqlite" {
			t.Errorf("expected dialect sqlite, got: %s", resp.Data.Dialect)
		}
		if resp.Data.Root == nil {
			t.Fatalf("expected non-nil root plan node")
		}
		if resp.Data.Raw == "" {
			t.Errorf("expected non-empty raw explain output")
		}
	}

	// 2. Valid EXPLAIN query on /connections/default/databases/main/explain
	{
		body := `{"sql": "SELECT * FROM users ORDER BY name;"}`
		req := httptest.NewRequest("POST", "/api/connections/default/databases/main/explain", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK on database explain query, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp explainResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if resp.Data == nil || resp.Data.Root == nil {
			t.Fatalf("expected valid explain plan data")
		}
	}

	// 3. Empty query returns 400
	{
		body := `{"sql": "   "}`
		req := httptest.NewRequest("POST", "/api/connections/default/explain", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request for empty explain query, got %d: %s", rec.Code, rec.Body.String())
		}
	}

	// 4. Invalid SQL query returns 500
	{
		body := `{"sql": "SELECT * FROM non_existent_table_xyz;"}`
		req := httptest.NewRequest("POST", "/api/connections/default/explain", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500 for invalid query explain, got %d: %s", rec.Code, rec.Body.String())
		}
	}
}

func TestAutocompleteSchemaEndpoints(t *testing.T) {
	dbFile := "/tmp/dblens_api_autocomplete_erd_test.db"
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
		CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL,
			email TEXT NOT NULL
		);
		CREATE TABLE orders (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			total REAL NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users(id)
		);
	`)
	if err != nil {
		t.Fatalf("failed to create tables: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	req := httptest.NewRequest("GET", "/api/connections/default/erd", nil)
	req.Header.Set("X-DBLENS-DSN", dsn)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on GET /erd, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Data  []driver.ERDTable `json:"data"`
		Error *string           `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse json response: %v", err)
	}

	if resp.Error != nil {
		t.Fatalf("unexpected error in response: %v", *resp.Error)
	}

	if len(resp.Data) < 2 {
		t.Fatalf("expected at least 2 tables, got %d", len(resp.Data))
	}

	var foundUsers, foundOrders bool
	for _, tbl := range resp.Data {
		if tbl.Name == "users" {
			foundUsers = true
			if len(tbl.Columns) < 3 {
				t.Fatalf("expected at least 3 columns for users, got %d", len(tbl.Columns))
			}
		}
		if tbl.Name == "orders" {
			foundOrders = true
			if len(tbl.Columns) < 3 {
				t.Fatalf("expected at least 3 columns for orders, got %d", len(tbl.Columns))
			}
			for _, fk := range tbl.FKs {
				if fk.Column == "user_id" && fk.Cardinality != "1:N" {
					t.Fatalf("expected orders.user_id FK cardinality '1:N', got '%s'", fk.Cardinality)
				}
			}
		}
	}

	if !foundUsers || !foundOrders {
		t.Fatalf("expected to find both users and orders tables, foundUsers=%v, foundOrders=%v", foundUsers, foundOrders)
	}
}

func TestAlterTablePreviewAndApply(t *testing.T) {
	dbFile := "/tmp/dblens_api_alter_test.db"
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
		CREATE TABLE widgets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			legacy_name TEXT NOT NULL,
			removable_col TEXT
		);
	`)
	if err != nil {
		t.Fatalf("failed to create table: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	// 1. Preview alter table
	previewPayload := `{
		"schema": "",
		"table": "widgets",
		"addedColumns": [
			{"name": "description", "type": "TEXT", "isNullable": true}
		],
		"renamedColumns": [
			{"from": "legacy_name", "to": "name"}
		],
		"droppedColumns": [
			"removable_col"
		],
		"addedIndexes": [
			{"name": "idx_widgets_desc", "columns": ["description"], "isUnique": false}
		]
	}`

	req := httptest.NewRequest("POST", "http://example.com/api/connections/default/tables/widgets/alter-preview", bytes.NewBufferString(previewPayload))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("preview status = %d, want %d, body: %s", w.Code, http.StatusOK, w.Body.String())
	}

	var previewResp struct {
		Data struct {
			Statements []string `json:"statements"`
			SQL        string   `json:"sql"`
			Dialect    string   `json:"dialect"`
		} `json:"data"`
		Error *string `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &previewResp); err != nil {
		t.Fatalf("failed to unmarshal preview response: %v", err)
	}

	if len(previewResp.Data.Statements) != 4 {
		t.Fatalf("expected 4 preview statements, got %d", len(previewResp.Data.Statements))
	}
	if !strings.Contains(previewResp.Data.SQL, `ALTER TABLE "widgets" ADD COLUMN "description" TEXT`) {
		t.Errorf("preview SQL missing add column: %s", previewResp.Data.SQL)
	}

	// 2. Apply alter table
	applyReq := httptest.NewRequest("POST", "http://example.com/api/connections/default/tables/widgets/alter", bytes.NewBufferString(previewPayload))
	applyReq.Header.Set("X-DBLENS-DSN", dsn)
	applyReq.Header.Set("Content-Type", "application/json")
	applyW := httptest.NewRecorder()
	router.ServeHTTP(applyW, applyReq)

	if applyW.Code != http.StatusOK {
		t.Fatalf("apply status = %d, want %d, body: %s", applyW.Code, http.StatusOK, applyW.Body.String())
	}

	var applyResp struct {
		Data struct {
			StatementsExecuted int `json:"statementsExecuted"`
		} `json:"data"`
		Error *string `json:"error"`
	}
	if err := json.Unmarshal(applyW.Body.Bytes(), &applyResp); err != nil {
		t.Fatalf("failed to unmarshal apply response: %v", err)
	}

	if applyResp.Data.StatementsExecuted != 4 {
		t.Fatalf("expected 4 statements executed, got %d", applyResp.Data.StatementsExecuted)
	}

	// 3. Verify changes in table by inserting into new schema
	_, err = entry.Driver.ExecuteQuery(ctx, `INSERT INTO widgets (name, description) VALUES ('Gadget', 'A cool gadget');`)
	if err != nil {
		t.Fatalf("failed to insert into altered table: %v", err)
	}

	// 4. Test error conditions: control characters
	badReq := httptest.NewRequest("POST", "http://example.com/api/connections/default/tables/widgets%00injection/alter-preview", bytes.NewBufferString(previewPayload))
	badReq.Header.Set("X-DBLENS-DSN", dsn)
	badW := httptest.NewRecorder()
	router.ServeHTTP(badW, badReq)
	if badW.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for control chars in table name, got %d", badW.Code)
	}

	// 5. Test table mismatch in request body
	mismatchPayload := `{"table": "other_table", "addedColumns": [{"name": "extra", "type": "TEXT"}]}`
	mismatchReq := httptest.NewRequest("POST", "http://example.com/api/connections/default/tables/widgets/alter", bytes.NewBufferString(mismatchPayload))
	mismatchReq.Header.Set("X-DBLENS-DSN", dsn)
	mismatchReq.Header.Set("Content-Type", "application/json")
	mismatchW := httptest.NewRecorder()
	router.ServeHTTP(mismatchW, mismatchReq)
	if mismatchW.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for table mismatch, got %d", mismatchW.Code)
	}
	if !strings.Contains(mismatchW.Body.String(), "table in request body does not match URL parameter") {
		t.Errorf("expected table mismatch error message, got: %s", mismatchW.Body.String())
	}

	// 6. Test control characters in request body table/schema
	crBody := `{"table": "widgets\ninjection"}`
	crReq := httptest.NewRequest("POST", "http://example.com/api/connections/default/tables/widgets/alter", bytes.NewBufferString(crBody))
	crReq.Header.Set("X-DBLENS-DSN", dsn)
	crReq.Header.Set("Content-Type", "application/json")
	crW := httptest.NewRecorder()
	router.ServeHTTP(crW, crReq)
	if crW.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for control chars in body table, got %d", crW.Code)
	}

	// 7. Verify arbitrary req.Statements and req.SQL are ignored/not executed
	backdoorPayload := `{"statements": ["DROP TABLE widgets"], "sql": "DROP TABLE widgets"}`
	backdoorReq := httptest.NewRequest("POST", "http://example.com/api/connections/default/tables/widgets/alter", bytes.NewBufferString(backdoorPayload))
	backdoorReq.Header.Set("X-DBLENS-DSN", dsn)
	backdoorReq.Header.Set("Content-Type", "application/json")
	backdoorW := httptest.NewRecorder()
	router.ServeHTTP(backdoorW, backdoorReq)
	if backdoorW.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for empty structured alter, got %d", backdoorW.Code)
	}
	// Verify widgets table was NOT dropped
	qr, err := entry.Driver.ExecuteQuery(ctx, "SELECT COUNT(*) FROM widgets")
	if err != nil || len(qr.Rows) == 0 {
		t.Fatalf("backdoor statements executed: widgets table dropped or inaccessible: %v", err)
	}

	// 8. Test transactional rollback on failure in SQLite
	_, err = entry.Driver.ExecuteQuery(ctx, "CREATE TABLE tx_test (id INT);")
	if err != nil {
		t.Fatalf("failed to create tx_test table: %v", err)
	}
	// Attempt to add duplicate column "dup_col" twice in same request
	failPayload := `{
		"addedColumns": [
			{"name": "dup_col", "type": "TEXT"},
			{"name": "dup_col", "type": "TEXT"}
		]
	}`
	failReq := httptest.NewRequest("POST", "http://example.com/api/connections/default/tables/tx_test/alter", bytes.NewBufferString(failPayload))
	failReq.Header.Set("X-DBLENS-DSN", dsn)
	failReq.Header.Set("Content-Type", "application/json")
	failW := httptest.NewRecorder()
	router.ServeHTTP(failW, failReq)
	if failW.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 on statement execution error, got %d", failW.Code)
	}
	// Verify rollback: dup_col should NOT exist on tx_test because transaction rolled back
	_, err = entry.Driver.ExecuteQuery(ctx, "SELECT dup_col FROM tx_test")
	if err == nil {
		t.Fatalf("expected error querying rolled-back column 'dup_col', but it exists (rollback failed)")
	}
}

func TestSchemaDiffAndApply(t *testing.T) {
	ctx := context.Background()
	srcDbFile := filepath.Join(t.TempDir(), "src.db")
	tgtDbFile := filepath.Join(t.TempDir(), "tgt.db")
	srcDSN := "sqlite://" + srcDbFile
	tgtDSN := "sqlite://" + tgtDbFile

	mgr := connection.NewManager()
	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	srcEntry, err := mgr.GetByDSN(srcDSN)
	if err != nil {
		t.Fatalf("failed to open src db: %v", err)
	}
	tgtEntry, err := mgr.GetByDSN(tgtDSN)
	if err != nil {
		t.Fatalf("failed to open tgt db: %v", err)
	}

	// Setup schemas:
	// src has authors (id, name, bio) and books (id, title)
	// tgt has authors (id, name) and old_logs (id)
	_, err = srcEntry.Driver.ExecuteQuery(ctx, "CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT, bio TEXT);")
	if err != nil {
		t.Fatalf("src setup failed: %v", err)
	}
	_, err = srcEntry.Driver.ExecuteQuery(ctx, "CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT);")
	if err != nil {
		t.Fatalf("src setup failed: %v", err)
	}

	_, err = tgtEntry.Driver.ExecuteQuery(ctx, "CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT);")
	if err != nil {
		t.Fatalf("tgt setup failed: %v", err)
	}
	_, err = tgtEntry.Driver.ExecuteQuery(ctx, "CREATE TABLE old_logs (id INTEGER PRIMARY KEY);")
	if err != nil {
		t.Fatalf("tgt setup failed: %v", err)
	}

	// 1. Test single table diff (authors)
	tableDiffPayload := fmt.Sprintf(`{
		"source": { "connId": "src", "schema": "main", "table": "authors", "dsn": "%s" },
		"target": { "connId": "tgt", "schema": "main", "table": "authors", "dsn": "%s" }
	}`, srcDSN, tgtDSN)

	req := httptest.NewRequest("POST", "http://example.com/api/connections/default/diff", bytes.NewBufferString(tableDiffPayload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("table diff status = %d, body: %s", w.Code, w.Body.String())
	}

	var tableDiffResp struct {
		Data diff.SchemaDiffResult `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &tableDiffResp); err != nil {
		t.Fatalf("failed to unmarshal table diff response: %v", err)
	}

	if tableDiffResp.Data.TotalTables != 1 {
		t.Fatalf("expected 1 table in single table diff, got %d", tableDiffResp.Data.TotalTables)
	}
	if tableDiffResp.Data.ModifiedCount != 1 {
		t.Fatalf("expected 1 modified table, got %d", tableDiffResp.Data.ModifiedCount)
	}
	if len(tableDiffResp.Data.MigrationSQL) == 0 {
		t.Fatalf("expected migration SQL for authors table diff")
	}

	// 2. Test full schema diff
	schemaDiffPayload := fmt.Sprintf(`{
		"source": { "connId": "src", "schema": "main", "dsn": "%s" },
		"target": { "connId": "tgt", "schema": "main", "dsn": "%s" }
	}`, srcDSN, tgtDSN)

	req2 := httptest.NewRequest("POST", "http://example.com/api/connections/default/diff", bytes.NewBufferString(schemaDiffPayload))
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("schema diff status = %d, body: %s", w2.Code, w2.Body.String())
	}

	var schemaDiffResp struct {
		Data diff.SchemaDiffResult `json:"data"`
	}
	if err := json.Unmarshal(w2.Body.Bytes(), &schemaDiffResp); err != nil {
		t.Fatalf("failed to unmarshal schema diff response: %v", err)
	}

	// books is added, old_logs is removed, authors is modified
	if schemaDiffResp.Data.AddedCount != 1 {
		t.Errorf("expected 1 added table (books), got %d", schemaDiffResp.Data.AddedCount)
	}
	if schemaDiffResp.Data.RemovedCount != 1 {
		t.Errorf("expected 1 removed table (old_logs), got %d", schemaDiffResp.Data.RemovedCount)
	}
	if schemaDiffResp.Data.ModifiedCount != 1 {
		t.Errorf("expected 1 modified table (authors), got %d", schemaDiffResp.Data.ModifiedCount)
	}

	// 3. Test apply diff to target
	applyPayload, _ := json.Marshal(map[string]interface{}{
		"statements": schemaDiffResp.Data.MigrationSQL,
		"targetDsn":  tgtDSN,
	})

	req3 := httptest.NewRequest("POST", "http://example.com/api/connections/default/diff/apply", bytes.NewReader(applyPayload))
	req3.Header.Set("Content-Type", "application/json")
	w3 := httptest.NewRecorder()
	router.ServeHTTP(w3, req3)

	if w3.Code != http.StatusOK {
		t.Fatalf("apply diff status = %d, body: %s", w3.Code, w3.Body.String())
	}

	// Verify target now has books and authors has bio
	_, err = tgtEntry.Driver.ExecuteQuery(ctx, "SELECT id, title FROM books")
	if err != nil {
		t.Fatalf("books table not found in target after migration: %v", err)
	}
	_, err = tgtEntry.Driver.ExecuteQuery(ctx, "SELECT bio FROM authors")
	if err != nil {
		t.Fatalf("bio column not found on authors in target after migration: %v", err)
	}
}

func TestApplyDiffCommentsAndErrorHandling(t *testing.T) {
	ctx := context.Background()
	tgtDbFile := filepath.Join(t.TempDir(), "tgt_apply.db")
	tgtDSN := "sqlite://" + tgtDbFile

	mgr := connection.NewManager()
	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	tgtEntry, err := mgr.GetByDSN(tgtDSN)
	if err != nil {
		t.Fatalf("failed to open tgt db: %v", err)
	}

	_, err = tgtEntry.Driver.ExecuteQuery(ctx, "CREATE TABLE users (id INTEGER PRIMARY KEY);")
	if err != nil {
		t.Fatalf("tgt setup failed: %v", err)
	}

	// 1. Statements with empty lines and comments (-- ...)
	payloadWithComments, _ := json.Marshal(map[string]interface{}{
		"statements": []string{
			"-- First comment line",
			"",
			"   ",
			"-- Another comment\n-- Second comment line",
			"ALTER TABLE users ADD COLUMN name TEXT;",
			"-- Trailing comment",
			"ALTER TABLE users ADD COLUMN email TEXT;",
		},
		"targetDsn": tgtDSN,
	})

	req := httptest.NewRequest("POST", "http://example.com/api/connections/default/diff/apply", bytes.NewReader(payloadWithComments))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data struct {
			StatementsExecuted int      `json:"statementsExecuted"`
			Statements         []string `json:"statements"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if resp.Data.StatementsExecuted != 2 {
		t.Fatalf("expected 2 statements executed (comments and empty lines ignored), got %d", resp.Data.StatementsExecuted)
	}
	if len(resp.Data.Statements) != 2 {
		t.Fatalf("expected 2 recorded statements, got %d", len(resp.Data.Statements))
	}

	// 2. All statements are comments or empty
	payloadOnlyComments, _ := json.Marshal(map[string]interface{}{
		"statements": []string{
			"-- Just a comment",
			"   ",
			"-- Another comment",
		},
		"targetDsn": tgtDSN,
	})

	req2 := httptest.NewRequest("POST", "http://example.com/api/connections/default/diff/apply", bytes.NewReader(payloadOnlyComments))
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for only comments, got %d: %s", w2.Code, w2.Body.String())
	}
	var resp2 struct {
		Data struct {
			StatementsExecuted int `json:"statementsExecuted"`
		} `json:"data"`
	}
	_ = json.Unmarshal(w2.Body.Bytes(), &resp2)
	if resp2.Data.StatementsExecuted != 0 {
		t.Fatalf("expected 0 statements executed, got %d", resp2.Data.StatementsExecuted)
	}

	// 3. Statement failure reports statement index and error
	payloadWithError, _ := json.Marshal(map[string]interface{}{
		"statements": []string{
			"-- comment before",
			"ALTER TABLE users ADD COLUMN age INTEGER;",
			"INVALID SQL SYNTAX HERE;",
		},
		"targetDsn": tgtDSN,
	})

	req3 := httptest.NewRequest("POST", "http://example.com/api/connections/default/diff/apply", bytes.NewReader(payloadWithError))
	req3.Header.Set("Content-Type", "application/json")
	w3 := httptest.NewRecorder()
	router.ServeHTTP(w3, req3)

	if w3.Code != http.StatusInternalServerError && w3.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 or 500 on statement error, got %d: %s", w3.Code, w3.Body.String())
	}
	bodyStr := w3.Body.String()
	if !strings.Contains(bodyStr, "statement 2") {
		t.Fatalf("expected error indicating statement 2 failed, got: %s", bodyStr)
	}
}

func TestDiffSchemasControlChars(t *testing.T) {
	mgr := connection.NewManager()
	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	tests := []struct {
		name string
		req  map[string]interface{}
	}{
		{
			name: "control char in source table",
			req: map[string]interface{}{
				"source": map[string]string{"table": "users\x00inject", "schema": "public"},
				"target": map[string]string{"table": "users", "schema": "public"},
			},
		},
		{
			name: "control char in source schema",
			req: map[string]interface{}{
				"source": map[string]string{"table": "users", "schema": "pub\nlic"},
				"target": map[string]string{"table": "users", "schema": "public"},
			},
		},
		{
			name: "control char in target table",
			req: map[string]interface{}{
				"source": map[string]string{"table": "users", "schema": "public"},
				"target": map[string]string{"table": "users\rinject", "schema": "public"},
			},
		},
		{
			name: "control char in target schema",
			req: map[string]interface{}{
				"source": map[string]string{"table": "users", "schema": "public"},
				"target": map[string]string{"table": "users", "schema": "pub\x01lic"},
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			b, _ := json.Marshal(tc.req)
			req := httptest.NewRequest("POST", "http://example.com/api/connections/default/diff", bytes.NewReader(b))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 Bad Request, got %d: %s", w.Code, w.Body.String())
			}
			if !strings.Contains(w.Body.String(), "control characters") {
				t.Fatalf("expected error message to mention control characters, got: %s", w.Body.String())
			}
		})
	}
}

func TestApplyDiffReadOnlyProtection(t *testing.T) {
	mgr := connection.NewManager()
	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	// 1. Rejection via X-DBLENS-READONLY header
	payload, _ := json.Marshal(map[string]interface{}{
		"statements": []string{"ALTER TABLE users ADD COLUMN age INTEGER;"},
		"targetDsn":  "sqlite:///tmp/test_readonly.db",
	})

	req := httptest.NewRequest("POST", "http://example.com/api/connections/default/diff/apply", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-DBLENS-READONLY", "true")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden with X-DBLENS-READONLY header, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "Target connection is read-only") {
		t.Fatalf("expected error 'Target connection is read-only', got: %s", w.Body.String())
	}

	// 2. Rejection via readOnly: true in body
	payloadRO, _ := json.Marshal(map[string]interface{}{
		"statements": []string{"ALTER TABLE users ADD COLUMN age INTEGER;"},
		"targetDsn":  "sqlite:///tmp/test_readonly.db",
		"readOnly":   true,
	})

	req2 := httptest.NewRequest("POST", "http://example.com/api/connections/default/diff/apply", bytes.NewReader(payloadRO))
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req2)

	if w2.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden with readOnly: true in body, got %d: %s", w2.Code, w2.Body.String())
	}
	if !strings.Contains(w2.Body.String(), "Target connection is read-only") {
		t.Fatalf("expected error 'Target connection is read-only', got: %s", w2.Body.String())
	}
}

func TestGetProcessesAndKillProcess(t *testing.T) {
	mgr := connection.NewManager()
	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	dbFile := filepath.Join(t.TempDir(), "processes_test.db")
	dsn := "sqlite://" + dbFile

	// 1. Get processes
	req := httptest.NewRequest("GET", "http://example.com/api/connections/default/processes", nil)
	req.Header.Set("X-DBLENS-DSN", dsn)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data []driver.ProcessInfo `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp.Data) == 0 {
		t.Fatalf("expected at least 1 process info for sqlite, got 0")
	}
	if resp.Data[0].Database != "main" || resp.Data[0].Host != "embedded" {
		t.Fatalf("unexpected sqlite process metadata: %+v", resp.Data[0])
	}

	// 2. Kill process with missing processId
	killEmptyPayload, _ := json.Marshal(map[string]interface{}{})
	reqKillEmpty := httptest.NewRequest("POST", "http://example.com/api/connections/default/processes/kill", bytes.NewReader(killEmptyPayload))
	reqKillEmpty.Header.Set("Content-Type", "application/json")
	reqKillEmpty.Header.Set("X-DBLENS-DSN", dsn)
	wKillEmpty := httptest.NewRecorder()
	router.ServeHTTP(wKillEmpty, reqKillEmpty)
	if wKillEmpty.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request, got %d: %s", wKillEmpty.Code, wKillEmpty.Body.String())
	}

	// 2b. Kill process with non-numeric or non-positive processId
	for _, invalidPID := range []string{"abc", "-1", "0", "xyz123"} {
		killInvalidPayload, _ := json.Marshal(map[string]interface{}{"processId": invalidPID})
		reqKillInvalid := httptest.NewRequest("POST", "http://example.com/api/connections/default/processes/kill", bytes.NewReader(killInvalidPayload))
		reqKillInvalid.Header.Set("Content-Type", "application/json")
		reqKillInvalid.Header.Set("X-DBLENS-DSN", dsn)
		wKillInvalid := httptest.NewRecorder()
		router.ServeHTTP(wKillInvalid, reqKillInvalid)
		if wKillInvalid.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request for processId %q, got %d: %s", invalidPID, wKillInvalid.Code, wKillInvalid.Body.String())
		}
		if !strings.Contains(wKillInvalid.Body.String(), "positive integer") {
			t.Fatalf("expected error mentioning positive integer, got: %s", wKillInvalid.Body.String())
		}
	}

	// 3. Kill process with read-only header
	killPayload, _ := json.Marshal(map[string]interface{}{"processId": "1"})
	reqKillRO := httptest.NewRequest("POST", "http://example.com/api/connections/default/processes/kill", bytes.NewReader(killPayload))
	reqKillRO.Header.Set("Content-Type", "application/json")
	reqKillRO.Header.Set("X-DBLENS-DSN", dsn)
	reqKillRO.Header.Set("X-DBLENS-READONLY", "true")
	wKillRO := httptest.NewRecorder()
	router.ServeHTTP(wKillRO, reqKillRO)
	if wKillRO.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden, got %d: %s", wKillRO.Code, wKillRO.Body.String())
	}

	// 4. Kill process on sqlite returns error (not supported)
	reqKill := httptest.NewRequest("POST", "http://example.com/api/connections/default/processes/kill", bytes.NewReader(killPayload))
	reqKill.Header.Set("Content-Type", "application/json")
	reqKill.Header.Set("X-DBLENS-DSN", dsn)
	wKill := httptest.NewRecorder()
	router.ServeHTTP(wKill, reqKill)
	if wKill.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 error when killing sqlite process, got %d: %s", wKill.Code, wKill.Body.String())
	}
	if !strings.Contains(wKill.Body.String(), "killing processes is not supported for sqlite") {
		t.Fatalf("expected unsupported message, got: %s", wKill.Body.String())
	}
}

func TestGetDatabaseHealth(t *testing.T) {
	mgr := connection.NewManager()
	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	dbFile := filepath.Join(t.TempDir(), "health_test.db")
	dsn := "sqlite://" + dbFile

	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to get connection: %v", err)
	}

	ctx := context.Background()
	_, err = entry.Driver.ExecuteQuery(ctx, `
		CREATE TABLE users (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL
		);
	`)
	if err != nil {
		t.Fatalf("failed to create table: %v", err)
	}
	_, err = entry.Driver.ExecuteQuery(ctx, `INSERT INTO users (name) VALUES ('Alice'), ('Bob');`)
	if err != nil {
		t.Fatalf("failed to insert data: %v", err)
	}

	req := httptest.NewRequest("GET", "http://example.com/api/connections/default/health", nil)
	req.Header.Set("X-DBLENS-DSN", dsn)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data driver.HealthReport `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Data.TotalTables != 1 {
		t.Fatalf("expected 1 table, got %d", resp.Data.TotalTables)
	}
	if len(resp.Data.Tables) != 1 || resp.Data.Tables[0].Table != "users" {
		t.Fatalf("expected table 'users', got %+v", resp.Data.Tables)
	}
	if resp.Data.Tables[0].RowCount != 2 {
		t.Fatalf("expected rowCount 2, got %d", resp.Data.Tables[0].RowCount)
	}
	if len(resp.Data.Recommendations) == 0 {
		t.Fatalf("expected at least 1 recommendation, got 0")
	}
}

func TestSafeModeReadOnlyEnforcement(t *testing.T) {
	dbFile := filepath.Join(t.TempDir(), "safemode_test.db")
	dsn := "sqlite://" + dbFile

	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to create connection: %v", err)
	}

	ctx := context.Background()
	_, err = entry.Driver.ExecuteQuery(ctx, `
		CREATE TABLE items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL
		);
		INSERT INTO items (name) VALUES ('item1');
	`)
	if err != nil {
		t.Fatalf("failed to init table: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	// 1. IsNonSelectSQL unit tests
	if api.IsNonSelectSQL("SELECT * FROM items") {
		t.Errorf("expected SELECT to be false for IsNonSelectSQL")
	}
	if api.IsNonSelectSQL("/* comment */ SELECT 1") {
		t.Errorf("expected commented SELECT to be false for IsNonSelectSQL")
	}
	if !api.IsNonSelectSQL("INSERT INTO items (name) VALUES ('item2')") {
		t.Errorf("expected INSERT to be true for IsNonSelectSQL")
	}
	if !api.IsNonSelectSQL("UPDATE items SET name = 'updated' WHERE id = 1") {
		t.Errorf("expected UPDATE to be true for IsNonSelectSQL")
	}
	if !api.IsNonSelectSQL("DELETE FROM items WHERE id = 1") {
		t.Errorf("expected DELETE to be true for IsNonSelectSQL")
	}
	if !api.IsNonSelectSQL("DROP TABLE items") {
		t.Errorf("expected DROP TABLE to be true for IsNonSelectSQL")
	}
	if !api.IsNonSelectSQL("TRUNCATE TABLE items") {
		t.Errorf("expected TRUNCATE to be true for IsNonSelectSQL")
	}

	// 2. ExecuteQuery with Read-Only header: SELECT should succeed (200)
	selectBody := `{"sql": "SELECT * FROM items"}`
	req := httptest.NewRequest("POST", "/api/connections/default/query", strings.NewReader(selectBody))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("X-DBLENS-READONLY", "true")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected SELECT to succeed with 200, got %d: %s", w.Code, w.Body.String())
	}

	// 3. ExecuteQuery with Read-Only header: INSERT should be blocked (403)
	insertBody := `{"sql": "INSERT INTO items (name) VALUES ('blocked')"}`
	req = httptest.NewRequest("POST", "/api/connections/default/query", strings.NewReader(insertBody))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("X-DBLENS-READONLY", "true")
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected INSERT to be 403 Forbidden, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "Safe Mode") {
		t.Fatalf("expected error message to mention Safe Mode, got %s", w.Body.String())
	}

	// 4. MutateRow with Read-Only header should be blocked (403)
	mutateBody := `{
		"schema": "",
		"table": "items",
		"type": "UPDATE",
		"data": {"name": "hacked"},
		"where": {"id": 1}
	}`
	req = httptest.NewRequest("POST", "/api/connections/default/mutate", strings.NewReader(mutateBody))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("X-DBLENS-READONLY", "true")
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected MutateRow to be 403 Forbidden, got %d: %s", w.Code, w.Body.String())
	}

	// 5. BatchInsert with Read-Only header should be blocked (403)
	batchBody := `{
		"schema": "",
		"table": "items",
		"rows": [{"name": "itemX"}]
	}`
	req = httptest.NewRequest("POST", "/api/connections/default/batch-insert", strings.NewReader(batchBody))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("X-DBLENS-READONLY", "true")
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected BatchInsert to be 403 Forbidden, got %d: %s", w.Code, w.Body.String())
	}

	// 6. AlterTableApply with Read-Only header should be blocked (403)
	alterBody := `{
		"table": "items",
		"addedColumns": [{"name": "price", "type": "REAL"}]
	}`
	req = httptest.NewRequest("POST", "/api/connections/default/tables/items/alter", strings.NewReader(alterBody))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("X-DBLENS-READONLY", "true")
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected AlterTableApply to be 403 Forbidden, got %d: %s", w.Code, w.Body.String())
	}

	// 7. Extended IsNonSelectSQL tests
	nonSelectCases := []struct {
		sql      string
		expected bool
		desc     string
	}{
		{"SELECT 1; DROP TABLE items;", true, "multi-statement with drop"},
		{"SELECT * FROM items WHERE name = 'foo; DROP TABLE items;'", false, "semicolon in string literal"},
		{"(SELECT 1)", false, "parenthesized SELECT"},
		{"(DROP TABLE items)", true, "parenthesized DROP"},
		{"(((UPDATE items SET name = 'foo')))", true, "deeply parenthesized UPDATE"},
		{"WITH cte AS (SELECT 1) SELECT * FROM cte", false, "read-only CTE"},
		{"WITH cte AS (SELECT 1) INSERT INTO items (name) VALUES ('a')", true, "CTE with INSERT"},
		{"WITH cte AS (SELECT 1) UPDATE items SET name = 'a'", true, "CTE with UPDATE"},
		{"WITH cte AS (SELECT 1) DELETE FROM items", true, "CTE with DELETE"},
		{"DO $$ BEGIN PERFORM 1; END $$;", true, "DO block"},
		{"CALL my_procedure()", true, "CALL statement"},
		{"RENAME TABLE a TO b", true, "RENAME statement"},
		{"EXPLAIN ANALYZE DELETE FROM items", true, "EXPLAIN ANALYZE mutation"},
		{"EXPLAIN SELECT * FROM items", false, "EXPLAIN plan only"},
		{"EXPLAIN ANALYZE SELECT * FROM items", false, "EXPLAIN ANALYZE SELECT"},
	}
	for _, tc := range nonSelectCases {
		if api.IsNonSelectSQL(tc.sql) != tc.expected {
			t.Errorf("IsNonSelectSQL failed for %s: got %v, expected %v", tc.desc, !tc.expected, tc.expected)
		}
	}

	// 8. Multi-statement mutation blocked under read-only
	multiStmtBody := `{"sql": "SELECT 1; DROP TABLE items;"}`
	req = httptest.NewRequest("POST", "/api/connections/default/query", strings.NewReader(multiStmtBody))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("X-DBLENS-READONLY", "true")
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected multi-statement mutation to be 403 Forbidden, got %d: %s", w.Code, w.Body.String())
	}

	// 9. CTE mutation blocked under read-only (case-insensitive True)
	cteMutBody := `{"sql": "WITH cte AS (SELECT 1) DELETE FROM items WHERE id = 1"}`
	req = httptest.NewRequest("POST", "/api/connections/default/query", strings.NewReader(cteMutBody))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("X-DBLENS-READONLY", "True")
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected CTE mutation to be 403 Forbidden, got %d: %s", w.Code, w.Body.String())
	}

	// 10. Parenthesized mutation blocked under read-only
	parenMutBody := `{"sql": "(((DELETE FROM items WHERE id = 1)))"}`
	req = httptest.NewRequest("POST", "/api/connections/default/query", strings.NewReader(parenMutBody))
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("X-DBLENS-READONLY", "TRUE")
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected parenthesized mutation to be 403 Forbidden, got %d: %s", w.Code, w.Body.String())
	}

	// 11. ImportCSV with Read-Only header should be blocked (403)
	csvBuf := &bytes.Buffer{}
	csvWriter := multipart.NewWriter(csvBuf)
	_ = csvWriter.WriteField("table", "items")
	csvPart, _ := csvWriter.CreateFormFile("file", "data.csv")
	_, _ = csvPart.Write([]byte("name\nitem_new\n"))
	_ = csvWriter.Close()

	req = httptest.NewRequest("POST", "/api/connections/default/import/csv", csvBuf)
	req.Header.Set("Content-Type", csvWriter.FormDataContentType())
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("X-DBLENS-READONLY", "true")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected ImportCSV to be 403 Forbidden under read-only, got %d: %s", w.Code, w.Body.String())
	}

	// 12. ImportSQL with Read-Only header should be blocked (403)
	sqlBuf := &bytes.Buffer{}
	sqlWriter := multipart.NewWriter(sqlBuf)
	sqlPart, _ := sqlWriter.CreateFormFile("file", "script.sql")
	_, _ = sqlPart.Write([]byte("INSERT INTO items (name) VALUES ('script');"))
	_ = sqlWriter.Close()

	req = httptest.NewRequest("POST", "/api/connections/default/import/sql", sqlBuf)
	req.Header.Set("Content-Type", sqlWriter.FormDataContentType())
	req.Header.Set("X-DBLENS-DSN", dsn)
	req.Header.Set("X-DBLENS-READONLY", "TRUE")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected ImportSQL to be 403 Forbidden under read-only, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDumpAndRestoreAPI(t *testing.T) {
	dbFile := "/tmp/dblens_api_dump_test.db"
	restoreFile := "/tmp/dblens_api_restore_test.db"
	_ = os.Remove(dbFile)
	_ = os.Remove(restoreFile)
	defer os.Remove(dbFile)
	defer os.Remove(restoreFile)

	dsn := "sqlite://" + dbFile
	restoreDSN := "sqlite://" + restoreFile
	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to create sqlite: %v", err)
	}

	ctx := context.Background()
	_, err = entry.Driver.ExecuteQuery(ctx, `
		CREATE TABLE products (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			price REAL
		);
		INSERT INTO products (id, name, price) VALUES (1, 'Widget', 19.99);
		INSERT INTO products (id, name, price) VALUES (2, 'Gadget', 49.95);
	`)
	if err != nil {
		t.Fatalf("failed to insert test data: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	// 1. Plain SQL Dump
	dumpReq := httptest.NewRequest("GET", "/api/connections/default/dump?database=shop", nil)
	dumpReq.Header.Set("X-DBLENS-DSN", dsn)
	dumpRec := httptest.NewRecorder()
	router.ServeHTTP(dumpRec, dumpReq)

	if dumpRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on dump, got %d: %s", dumpRec.Code, dumpRec.Body.String())
	}
	if dumpRec.Header().Get("Content-Type") != "application/sql" {
		t.Fatalf("expected Content-Type application/sql, got %s", dumpRec.Header().Get("Content-Type"))
	}
	disposition := dumpRec.Header().Get("Content-Disposition")
	if !strings.Contains(disposition, "attachment; filename=\"dblens-dump-shop-") || !strings.HasSuffix(disposition, ".sql\"") {
		t.Fatalf("unexpected Content-Disposition: %s", disposition)
	}
	dumpBody := dumpRec.Body.String()
	if !strings.Contains(dumpBody, "CREATE TABLE") || !strings.Contains(dumpBody, "Widget") {
		t.Fatalf("expected CREATE TABLE and Widget in dump body, got: %s", dumpBody)
	}

	// 2. Gzip Dump
	gzReq := httptest.NewRequest("GET", "/api/connections/default/dump?gzip=true&database=shop", nil)
	gzReq.Header.Set("X-DBLENS-DSN", dsn)
	gzRec := httptest.NewRecorder()
	router.ServeHTTP(gzRec, gzReq)

	if gzRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on gzip dump, got %d: %s", gzRec.Code, gzRec.Body.String())
	}
	if gzRec.Header().Get("Content-Type") != "application/gzip" {
		t.Fatalf("expected Content-Type application/gzip, got %s", gzRec.Header().Get("Content-Type"))
	}
	gzDisp := gzRec.Header().Get("Content-Disposition")
	if !strings.Contains(gzDisp, ".sql.gz\"") {
		t.Fatalf("expected .sql.gz filename in Content-Disposition, got %s", gzDisp)
	}
	gzBytes := gzRec.Body.Bytes()
	if len(gzBytes) < 2 || gzBytes[0] != 0x1f || gzBytes[1] != 0x8b {
		t.Fatalf("expected gzip magic bytes in response, got %x", gzBytes[:2])
	}

	// 3. Restore to new DB using raw stream
	restoreReq := httptest.NewRequest("POST", "/api/connections/default/restore", bytes.NewReader(gzBytes))
	restoreReq.Header.Set("X-DBLENS-DSN", restoreDSN)
	restoreReq.Header.Set("Content-Type", "application/gzip")
	restoreRec := httptest.NewRecorder()
	router.ServeHTTP(restoreRec, restoreReq)

	if restoreRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on restore, got %d: %s", restoreRec.Code, restoreRec.Body.String())
	}
	var restoreResp map[string]interface{}
	if err := json.Unmarshal(restoreRec.Body.Bytes(), &restoreResp); err != nil {
		t.Fatalf("failed to parse restore JSON: %v", err)
	}
	if restoreResp["total"].(float64) == 0 || restoreResp["executed"].(float64) == 0 {
		t.Fatalf("expected non-zero total and executed: %v", restoreResp)
	}

	// Verify data restored in restoreDSN
	restoreEntry, err := mgr.GetByDSN(restoreDSN)
	if err != nil {
		t.Fatalf("failed to connect restored db: %v", err)
	}
	defer restoreEntry.Driver.Close()
	rowsRes, err := restoreEntry.Driver.ExecuteQuery(ctx, "SELECT count(*) FROM products;")
	if err != nil {
		t.Fatalf("failed to query restored products: %v", err)
	}
	if len(rowsRes.Rows) == 0 || rowsRes.Rows[0][0].(int64) != 2 {
		t.Fatalf("expected 2 restored rows, got %v", rowsRes.Rows)
	}

	// 4. Restore under Read-Only header must be 403
	roReq := httptest.NewRequest("POST", "/api/connections/default/restore", strings.NewReader("SELECT 1;"))
	roReq.Header.Set("X-DBLENS-DSN", restoreDSN)
	roReq.Header.Set("X-DBLENS-READONLY", "true")
	roRec := httptest.NewRecorder()
	router.ServeHTTP(roRec, roReq)

	if roRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for restore under readonly, got %d", roRec.Code)
	}
}

func TestRestAPIEndpoints(t *testing.T) {
	tempFile, err := os.CreateTemp("", "rest_api_test_*.db")
	if err != nil {
		t.Fatalf("failed to create temp db: %v", err)
	}
	tempFile.Close()
	defer os.Remove(tempFile.Name())

	dsn := "sqlite://" + tempFile.Name()
	mgr := connection.NewManager()
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}
	defer entry.Driver.Close()

	ctx := context.Background()
	_, err = entry.Driver.ExecuteQuery(ctx, `
		CREATE TABLE items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			price REAL NOT NULL,
			status TEXT DEFAULT 'active'
		);
	`)
	if err != nil {
		t.Fatalf("failed to create items table: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	// 1. POST: Insert item
	body := `{"title": "Mechanical Keyboard", "price": 129.99, "status": "active"}`
	req := httptest.NewRequest("POST", "/api/connections/test-conn/rest/items", strings.NewReader(body))
	req.Header.Set("X-DBLENS-DSN", dsn)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created on REST POST, got %d: %s", rec.Code, rec.Body.String())
	}
	var postRes map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &postRes); err != nil {
		t.Fatalf("failed to parse POST response: %v", err)
	}
	if postRes["rowsAffected"].(float64) != 1 {
		t.Fatalf("expected rowsAffected 1, got %v", postRes["rowsAffected"])
	}

	// 2. GET: Query items
	getReq := httptest.NewRequest("GET", "/api/connections/test-conn/rest/items?status=eq.active&select=id,title,price", nil)
	getReq.Header.Set("X-DBLENS-DSN", dsn)
	getRec := httptest.NewRecorder()
	router.ServeHTTP(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on REST GET, got %d: %s", getRec.Code, getRec.Body.String())
	}
	if getRec.Header().Get("X-Total-Count") != "1" {
		t.Fatalf("expected X-Total-Count 1, got %q", getRec.Header().Get("X-Total-Count"))
	}
	var rows []map[string]interface{}
	if err := json.Unmarshal(getRec.Body.Bytes(), &rows); err != nil {
		t.Fatalf("failed to parse GET response: %v", err)
	}
	if len(rows) != 1 || rows[0]["title"] != "Mechanical Keyboard" {
		t.Fatalf("unexpected rows: %v", rows)
	}

	// 3. GET with schema in URL path: /rest/main/items
	getSchemaReq := httptest.NewRequest("GET", "/api/connections/test-conn/rest/main/items", nil)
	getSchemaReq.Header.Set("X-DBLENS-DSN", dsn)
	getSchemaRec := httptest.NewRecorder()
	router.ServeHTTP(getSchemaRec, getSchemaReq)
	if getSchemaRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on REST GET with schema, got %d: %s", getSchemaRec.Code, getSchemaRec.Body.String())
	}

	// 4. PATCH: Update item
	patchBody := `{"price": 99.99}`
	patchReq := httptest.NewRequest("PATCH", "/api/connections/test-conn/rest/items?title=eq.Mechanical%20Keyboard", strings.NewReader(patchBody))
	patchReq.Header.Set("X-DBLENS-DSN", dsn)
	patchRec := httptest.NewRecorder()
	router.ServeHTTP(patchRec, patchReq)

	if patchRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on REST PATCH, got %d: %s", patchRec.Code, patchRec.Body.String())
	}

	// 5. Read-only guardrail blocks POST, PATCH, DELETE
	roPostReq := httptest.NewRequest("POST", "/api/connections/test-conn/rest/items", strings.NewReader(body))
	roPostReq.Header.Set("X-DBLENS-DSN", dsn)
	roPostReq.Header.Set("X-DBLENS-READONLY", "true")
	roPostRec := httptest.NewRecorder()
	router.ServeHTTP(roPostRec, roPostReq)
	if roPostRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for POST under read-only, got %d", roPostRec.Code)
	}

	roPatchReq := httptest.NewRequest("PATCH", "/api/connections/test-conn/rest/items?id=eq.1", strings.NewReader(patchBody))
	roPatchReq.Header.Set("X-DBLENS-DSN", dsn)
	roPatchReq.Header.Set("X-DBLENS-READONLY", "true")
	roPatchRec := httptest.NewRecorder()
	router.ServeHTTP(roPatchRec, roPatchReq)
	if roPatchRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for PATCH under read-only, got %d", roPatchRec.Code)
	}

	roDelReq := httptest.NewRequest("DELETE", "/api/connections/test-conn/rest/items?id=eq.1", nil)
	roDelReq.Header.Set("X-DBLENS-DSN", dsn)
	roDelReq.Header.Set("X-DBLENS-READONLY", "true")
	roDelRec := httptest.NewRecorder()
	router.ServeHTTP(roDelRec, roDelReq)
	if roDelRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for DELETE under read-only, got %d", roDelRec.Code)
	}

	// Query param ?readonly=true also rejected
	roParamReq := httptest.NewRequest("DELETE", "/api/connections/test-conn/rest/items?id=eq.1&readonly=true", nil)
	roParamReq.Header.Set("X-DBLENS-DSN", dsn)
	roParamRec := httptest.NewRecorder()
	router.ServeHTTP(roParamRec, roParamReq)
	if roParamRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for DELETE with readonly param, got %d", roParamRec.Code)
	}

	// 6. DELETE item
	delReq := httptest.NewRequest("DELETE", "/api/connections/test-conn/rest/items?id=eq.1", nil)
	delReq.Header.Set("X-DBLENS-DSN", dsn)
	delRec := httptest.NewRecorder()
	router.ServeHTTP(delRec, delReq)
	if delRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on REST DELETE, got %d: %s", delRec.Code, delRec.Body.String())
	}
}

func TestRestEndpointsTruthyReadOnlyAndMaxBytesLimit(t *testing.T) {
	dbPath := "/tmp/test_rest_truthy.db"
	_ = os.Remove(dbPath)
	defer os.Remove(dbPath)

	mgr := connection.NewManager()
	dsn := "sqlite://" + dbPath
	entry, err := mgr.GetByDSN(dsn)
	if err != nil {
		t.Fatalf("failed to connect sqlite: %v", err)
	}
	defer entry.Driver.Close()

	ctx := context.Background()
	_, err = entry.Driver.ExecuteQuery(ctx, `
		CREATE TABLE items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			price REAL
		);
	`)
	if err != nil {
		t.Fatalf("failed to create items table: %v", err)
	}

	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	// 1. Test X-DBLENS-READONLY with "1" and "yes"
	for _, truthy := range []string{"1", "yes", "true", "TRUE", "Yes"} {
		req := httptest.NewRequest("POST", "/api/connections/test-conn/rest/items", strings.NewReader(`{"title": "Test", "price": 10}`))
		req.Header.Set("X-DBLENS-DSN", dsn)
		req.Header.Set("X-DBLENS-READONLY", truthy)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for X-DBLENS-READONLY=%q, got %d", truthy, rec.Code)
		}
	}

	// 2. Test readonly query param with "1" and "yes"
	for _, truthy := range []string{"1", "yes", "true", "YES"} {
		req := httptest.NewRequest("POST", "/api/connections/test-conn/rest/items?readonly="+truthy, strings.NewReader(`{"title": "Test", "price": 10}`))
		req.Header.Set("X-DBLENS-DSN", dsn)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for readonly param=%q, got %d", truthy, rec.Code)
		}
	}

	// 3. Test MaxBytesReader 10MB limit on RestPost
	reqLarge := httptest.NewRequest("POST", "/api/connections/test-conn/rest/items", bytes.NewReader(make([]byte, 10<<20+1024)))
	reqLarge.Header.Set("X-DBLENS-DSN", dsn)
	recLarge := httptest.NewRecorder()
	router.ServeHTTP(recLarge, reqLarge)
	if recLarge.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for body exceeding 10MB limit, got %d", recLarge.Code)
	}

	// 4. Test MaxBytesReader 10MB limit on RestPatch
	reqPatchLarge := httptest.NewRequest("PATCH", "/api/connections/test-conn/rest/items?id=eq.1", bytes.NewReader(make([]byte, 10<<20+1024)))
	reqPatchLarge.Header.Set("X-DBLENS-DSN", dsn)
	recPatchLarge := httptest.NewRecorder()
	router.ServeHTTP(recPatchLarge, reqPatchLarge)
	if recPatchLarge.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for PATCH body exceeding 10MB limit, got %d", recPatchLarge.Code)
	}
}










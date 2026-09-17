package api_test

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/dblens/dblens/internal/api"
	"github.com/dblens/dblens/internal/connection"
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






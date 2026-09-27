package dictionary_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/annotations"
	"github.com/dblens/dblens/internal/dictionary"
	"github.com/dblens/dblens/internal/driver/sqlite"
	"github.com/dblens/dblens/internal/driver/types"
)

type mockDriver struct {
	dialect      string
	executedDDLs []string
	tableDetails *types.TableDetail
}

func (m *mockDriver) Dialect() string                                  { return m.dialect }
func (m *mockDriver) InspectDatabases(ctx context.Context) ([]string, error) {
	return []string{"testdb"}, nil
}
func (m *mockDriver) SelectDatabase(ctx context.Context, dbName string) error { return nil }
func (m *mockDriver) InspectSchemas(ctx context.Context) ([]string, error) {
	return []string{"public"}, nil
}
func (m *mockDriver) InspectTables(ctx context.Context, schema string) ([]types.TableMeta, error) {
	return []types.TableMeta{{Name: "users", Schema: schema, Type: "table"}}, nil
}
func (m *mockDriver) InspectTableDetails(ctx context.Context, schema, table string) (*types.TableDetail, error) {
	if m.tableDetails != nil {
		return m.tableDetails, nil
	}
	return &types.TableDetail{
		Name:   table,
		Schema: schema,
		Columns: []types.ColumnMeta{
			{Name: "id", Type: "integer", DataType: "integer", IsPrimary: true},
			{Name: "bio", Type: "varchar(255)", DataType: "varchar", IsNullable: true},
		},
	}, nil
}
func (m *mockDriver) GenerateTableDDL(ctx context.Context, schema, table string) (string, error) {
	return "", nil
}
func (m *mockDriver) QueryTableData(ctx context.Context, opts types.QueryOptions) (*types.QueryResult, error) {
	return &types.QueryResult{}, nil
}
func (m *mockDriver) QueryTableStream(ctx context.Context, schema, table string) (*sql.Rows, error) {
	return nil, nil
}
func (m *mockDriver) ExecuteQuery(ctx context.Context, sql string) (*types.QueryResult, error) {
	return &types.QueryResult{}, nil
}
func (m *mockDriver) ExecuteQueryWithParams(ctx context.Context, sql string, params map[string]interface{}) (*types.QueryResult, error) {
	return &types.QueryResult{}, nil
}
func (m *mockDriver) ExecuteRaw(ctx context.Context, sql string, args ...interface{}) (*types.QueryResult, error) {
	m.executedDDLs = append(m.executedDDLs, sql)
	return &types.QueryResult{AffectedRows: 1}, nil
}
func (m *mockDriver) MutateRow(ctx context.Context, mut types.Mutation) (*types.MutationResult, error) {
	return &types.MutationResult{}, nil
}
func (m *mockDriver) BatchInsert(ctx context.Context, schema, table string, rows []map[string]interface{}) (*types.MutationResult, error) {
	return &types.MutationResult{}, nil
}
func (m *mockDriver) GetERDData(ctx context.Context) ([]types.ERDTable, error) {
	return nil, nil
}
func (m *mockDriver) ExplainQuery(ctx context.Context, sql string, opts types.ExplainOptions) (*types.ExplainResult, error) {
	return nil, nil
}
func (m *mockDriver) InspectProcesses(ctx context.Context) ([]types.ProcessInfo, error) {
	return nil, nil
}
func (m *mockDriver) KillProcess(ctx context.Context, id string) error { return nil }
func (m *mockDriver) InspectHealth(ctx context.Context) (*types.HealthReport, error) {
	return nil, nil
}
func (m *mockDriver) Ping(ctx context.Context) error { return nil }
func (m *mockDriver) Close() error                    { return nil }

func TestExtractCatalog_SQLite(t *testing.T) {
	tmpDir := t.TempDir()
	dbFile := filepath.Join(tmpDir, "test_dictionary.db")
	dsn := "sqlite://" + dbFile

	drv, err := sqlite.New(dsn)
	if err != nil {
		t.Fatalf("failed to create sqlite driver: %v", err)
	}
	defer drv.Close()

	ctx := context.Background()
	initSQL := `
		CREATE TABLE customers (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL,
			phone_number TEXT,
			credit_card TEXT,
			notes TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE orders (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			customer_id INTEGER NOT NULL,
			amount REAL NOT NULL,
			FOREIGN KEY (customer_id) REFERENCES customers(id)
		);

		CREATE INDEX idx_orders_customer ON orders(customer_id);
	`
	if _, err := drv.ExecuteQuery(ctx, initSQL); err != nil {
		t.Fatalf("failed to setup sqlite database: %v", err)
	}

	// Setup annotations store with notes
	annFile := filepath.Join(tmpDir, "annotations.json")
	store, err := annotations.NewStore(annFile)
	if err != nil {
		t.Fatalf("failed to create annotations store: %v", err)
	}

	connID := "local-test-sqlite"
	_ = store.Create(&annotations.Annotation{
		TargetType:   annotations.TargetTable,
		ConnectionID: connID,
		Schema:       "main",
		Table:        "customers",
		Note:         "Primary customer account entity.",
		Author:       "Security Team",
	})
	_ = store.Create(&annotations.Annotation{
		TargetType:   annotations.TargetColumn,
		ConnectionID: connID,
		Schema:       "main",
		Table:        "customers",
		Column:       "notes",
		Note:         "Unstructured CRM contact notes.",
		Author:       "Compliance",
	})

	dict, err := dictionary.ExtractCatalog(ctx, drv, connID, "", store)
	if err != nil {
		t.Fatalf("ExtractCatalog returned unexpected error: %v", err)
	}

	if dict.ConnectionID != connID {
		t.Errorf("expected connection ID %s, got %s", connID, dict.ConnectionID)
	}

	if len(dict.Schemas) == 0 {
		t.Fatalf("expected at least 1 schema, got 0")
	}

	schema := dict.Schemas[0]
	if len(schema.Tables) < 2 {
		t.Fatalf("expected at least 2 tables, got %d", len(schema.Tables))
	}

	// Verify customers table details and PII tagging
	var customersTable *dictionary.DictionaryTable
	for _, tbl := range schema.Tables {
		if tbl.Name == "customers" {
			customersTable = &tbl
			break
		}
	}
	if customersTable == nil {
		t.Fatalf("table customers not found in extracted catalog")
	}

	if customersTable.Comment != "Primary customer account entity." {
		t.Errorf("expected customer table comment from annotation, got %q", customersTable.Comment)
	}

	if customersTable.PIICount < 3 {
		t.Errorf("expected at least 3 PII columns in customers, got %d", customersTable.PIICount)
	}

	// Check individual columns
	colMap := make(map[string]dictionary.DictionaryColumn)
	for _, c := range customersTable.Columns {
		colMap[c.Name] = c
	}

	if colMap["email"].PIIType != "email" {
		t.Errorf("expected email column PII type 'email', got %q", colMap["email"].PIIType)
	}
	if colMap["phone_number"].PIIType != "phone" {
		t.Errorf("expected phone_number column PII type 'phone', got %q", colMap["phone_number"].PIIType)
	}
	if colMap["credit_card"].PIIType != "card" {
		t.Errorf("expected credit_card column PII type 'card', got %q", colMap["credit_card"].PIIType)
	}
	if colMap["notes"].Comment != "Unstructured CRM contact notes." {
		t.Errorf("expected notes column comment, got %q", colMap["notes"].Comment)
	}

	// Summary statistics verification
	summary := dict.Summary
	if summary.TotalTables < 2 {
		t.Errorf("expected summary TotalTables >= 2, got %d", summary.TotalTables)
	}
	if summary.TotalPIIColumns < 3 {
		t.Errorf("expected summary TotalPIIColumns >= 3, got %d", summary.TotalPIIColumns)
	}
	if summary.DocumentedColumns < 1 {
		t.Errorf("expected DocumentedColumns >= 1, got %d", summary.DocumentedColumns)
	}
	if summary.DocumentationCoverage <= 0.0 {
		t.Errorf("expected DocumentationCoverage > 0, got %f", summary.DocumentationCoverage)
	}
}

func TestSyncComment_Postgres(t *testing.T) {
	mockDrv := &mockDriver{dialect: "postgres"}
	ctx := context.Background()

	// 1. Table comment
	err := dictionary.SyncComment(ctx, mockDrv, "pg-conn", dictionary.CommentUpdateRequest{
		Schema:   "public",
		Table:    "users",
		Comment:  "User accounts table",
		SyncToDB: true,
	}, nil)
	if err != nil {
		t.Fatalf("SyncComment failed: %v", err)
	}

	if len(mockDrv.executedDDLs) == 0 {
		t.Fatalf("expected executed DDL for table comment, got none")
	}
	expectedTableDDL := `COMMENT ON TABLE "public"."users" IS 'User accounts table';`
	if mockDrv.executedDDLs[0] != expectedTableDDL {
		t.Errorf("expected DDL %q, got %q", expectedTableDDL, mockDrv.executedDDLs[0])
	}

	// 2. Column comment
	mockDrv.executedDDLs = nil
	err = dictionary.SyncComment(ctx, mockDrv, "pg-conn", dictionary.CommentUpdateRequest{
		Schema:   "public",
		Table:    "users",
		Column:   "email",
		Comment:  "Primary login email",
		SyncToDB: true,
	}, nil)
	if err != nil {
		t.Fatalf("SyncComment failed: %v", err)
	}

	expectedColDDL := `COMMENT ON COLUMN "public"."users"."email" IS 'Primary login email';`
	if len(mockDrv.executedDDLs) == 0 || mockDrv.executedDDLs[0] != expectedColDDL {
		t.Errorf("expected DDL %q, got %v", expectedColDDL, mockDrv.executedDDLs)
	}
}

func TestSyncComment_MySQL(t *testing.T) {
	mockDrv := &mockDriver{dialect: "mysql"}
	ctx := context.Background()

	// 1. Table comment
	err := dictionary.SyncComment(ctx, mockDrv, "mysql-conn", dictionary.CommentUpdateRequest{
		Schema:   "app_db",
		Table:    "users",
		Comment:  "User profiles",
		SyncToDB: true,
	}, nil)
	if err != nil {
		t.Fatalf("SyncComment failed: %v", err)
	}

	expectedTableDDL := "ALTER TABLE `app_db`.`users` COMMENT = 'User profiles';"
	if len(mockDrv.executedDDLs) == 0 || mockDrv.executedDDLs[0] != expectedTableDDL {
		t.Errorf("expected DDL %q, got %v", expectedTableDDL, mockDrv.executedDDLs)
	}

	// 2. Column comment
	mockDrv.executedDDLs = nil
	err = dictionary.SyncComment(ctx, mockDrv, "mysql-conn", dictionary.CommentUpdateRequest{
		Schema:   "app_db",
		Table:    "users",
		Column:   "bio",
		Comment:  "Personal biography",
		SyncToDB: true,
	}, nil)
	if err != nil {
		t.Fatalf("SyncComment failed: %v", err)
	}

	expectedColDDL := "ALTER TABLE `app_db`.`users` MODIFY COLUMN `bio` varchar(255) NULL COMMENT 'Personal biography';"
	if len(mockDrv.executedDDLs) == 0 || mockDrv.executedDDLs[0] != expectedColDDL {
		t.Errorf("expected DDL %q, got %v", expectedColDDL, mockDrv.executedDDLs)
	}
}

func TestSyncComment_SQLite_Annotations(t *testing.T) {
	tmpDir := t.TempDir()
	annFile := filepath.Join(tmpDir, "annotations.json")
	store, err := annotations.NewStore(annFile)
	if err != nil {
		t.Fatalf("failed to create annotations store: %v", err)
	}

	mockDrv := &mockDriver{dialect: "sqlite"}
	ctx := context.Background()
	connID := "sqlite-conn"

	// Create column comment
	err = dictionary.SyncComment(ctx, mockDrv, connID, dictionary.CommentUpdateRequest{
		Schema:   "main",
		Table:    "users",
		Column:   "bio",
		Comment:  "User biography note",
		SyncToDB: false,
	}, store)
	if err != nil {
		t.Fatalf("SyncComment failed: %v", err)
	}

	notes := store.ListByTarget(connID, "main", "users")
	if len(notes) != 1 {
		t.Fatalf("expected 1 annotation stored, got %d", len(notes))
	}
	if notes[0].Note != "User biography note" || notes[0].Column != "bio" {
		t.Errorf("unexpected annotation content: %+v", notes[0])
	}

	// Update existing column comment
	err = dictionary.SyncComment(ctx, mockDrv, connID, dictionary.CommentUpdateRequest{
		Schema:   "main",
		Table:    "users",
		Column:   "bio",
		Comment:  "Updated biography note",
		SyncToDB: false,
	}, store)
	if err != nil {
		t.Fatalf("SyncComment failed: %v", err)
	}

	notes = store.ListByTarget(connID, "main", "users")
	if len(notes) != 1 || notes[0].Note != "Updated biography note" {
		t.Errorf("expected updated note, got %+v", notes)
	}

	// Clear comment -> deletes annotation
	err = dictionary.SyncComment(ctx, mockDrv, connID, dictionary.CommentUpdateRequest{
		Schema:   "main",
		Table:    "users",
		Column:   "bio",
		Comment:  "",
		SyncToDB: false,
	}, store)
	if err != nil {
		t.Fatalf("SyncComment failed: %v", err)
	}

	notes = store.ListByTarget(connID, "main", "users")
	if len(notes) != 0 {
		t.Errorf("expected annotation deleted, got %d remaining", len(notes))
	}
}

func sampleTestDictionary() *dictionary.DataDictionary {
	return &dictionary.DataDictionary{
		ConnectionID: "prod-analytics-db",
		Dialect:      "postgres",
		GeneratedAt:  time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC),
		Schemas: []dictionary.DictionarySchema{
			{
				Name:        "public",
				TableCount:  1,
				ColumnCount: 3,
				Tables: []dictionary.DictionaryTable{
					{
						Name:          "accounts",
						Schema:        "public",
						Type:          "table",
						Comment:       "Registered user accounts and profiles",
						RowCount:      15420,
						SizeBytes:     4194304,
						SizeFormatted: "4.0 MB",
						PIICount:      1,
						Columns: []dictionary.DictionaryColumn{
							{
								Name:       "id",
								Type:       "bigint",
								DataType:   "bigint",
								IsPrimary:  true,
								IsNullable: false,
								Comment:    "Unique primary key",
								Ordinal:    1,
							},
							{
								Name:       "email",
								Type:       "varchar(255)",
								DataType:   "varchar",
								IsNullable: false,
								PIIType:    "email",
								Comment:    "Primary verified email",
								Ordinal:    2,
							},
							{
								Name:       "created_at",
								Type:       "timestamptz",
								DataType:   "timestamp with time zone",
								IsNullable: false,
								Ordinal:    3,
							},
						},
						Indexes: []dictionary.DictionaryIndex{
							{
								Name:      "accounts_pkey",
								Columns:   []string{"id"},
								IsUnique:  true,
								IsPrimary: true,
								Type:      "btree",
							},
						},
					},
				},
			},
		},
		Summary: dictionary.DictionarySummary{
			TotalSchemas:          1,
			TotalTables:           1,
			TotalColumns:          3,
			DocumentedColumns:     2,
			DocumentationCoverage: 66.7,
			TotalPIIColumns:       1,
		},
	}
}

func TestRenderHTML(t *testing.T) {
	dict := sampleTestDictionary()
	html, err := dictionary.RenderHTML(dict)
	if err != nil {
		t.Fatalf("RenderHTML returned error: %v", err)
	}

	if !strings.Contains(html, "<!DOCTYPE html>") {
		t.Errorf("expected HTML doctype")
	}
	if !strings.Contains(html, "prod-analytics-db") {
		t.Errorf("expected connection ID in HTML")
	}
	if !strings.Contains(html, "SOC 2 TYPE II AUDIT READY") {
		t.Errorf("expected compliance banner")
	}
	if !strings.Contains(html, "accounts") {
		t.Errorf("expected table accounts in HTML")
	}
	if !strings.Contains(html, "email") {
		t.Errorf("expected column email in HTML")
	}
	if !strings.Contains(html, "applyFilters") {
		t.Errorf("expected embedded filter javascript")
	}
}

func TestRenderMarkdown(t *testing.T) {
	dict := sampleTestDictionary()
	md, err := dictionary.RenderMarkdown(dict)
	if err != nil {
		t.Fatalf("RenderMarkdown returned error: %v", err)
	}

	if !strings.Contains(md, "# Data Dictionary: prod-analytics-db") {
		t.Errorf("expected markdown header")
	}
	if !strings.Contains(md, "## Executive Summary") {
		t.Errorf("expected executive summary")
	}
	if !strings.Contains(md, "### Table: `accounts`") {
		t.Errorf("expected table section in markdown")
	}
	if !strings.Contains(md, "🛡️ `email`") {
		t.Errorf("expected PII tag in markdown column row")
	}
}

func TestRenderOpenAPI(t *testing.T) {
	dict := sampleTestDictionary()
	oaJSON, err := dictionary.RenderOpenAPI(dict)
	if err != nil {
		t.Fatalf("RenderOpenAPI returned error: %v", err)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(oaJSON), &parsed); err != nil {
		t.Fatalf("RenderOpenAPI output is not valid JSON: %v", err)
	}

	if parsed["openapi"] != "3.0.3" {
		t.Errorf("expected openapi 3.0.3, got %v", parsed["openapi"])
	}

	components, ok := parsed["components"].(map[string]interface{})
	if !ok {
		t.Fatalf("components missing or not object")
	}

	schemas, ok := components["schemas"].(map[string]interface{})
	if !ok {
		t.Fatalf("components.schemas missing or not object")
	}

	accounts, ok := schemas["accounts"].(map[string]interface{})
	if !ok {
		t.Fatalf("schemas.accounts missing")
	}

	props, ok := accounts["properties"].(map[string]interface{})
	if !ok {
		t.Fatalf("accounts.properties missing")
	}

	emailProp, ok := props["email"].(map[string]interface{})
	if !ok {
		t.Fatalf("email property missing")
	}

	if emailProp["type"] != "string" || emailProp["format"] != "email" {
		t.Errorf("expected email property type string format email, got %v", emailProp)
	}
}

func TestMain(m *testing.M) {
	os.Exit(m.Run())
}

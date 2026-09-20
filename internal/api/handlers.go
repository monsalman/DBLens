package api

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/alter"
	"github.com/dblens/dblens/internal/assistant"
	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/diff"
	"github.com/dblens/dblens/internal/driver"
	"github.com/dblens/dblens/internal/driver/types"
	"github.com/dblens/dblens/internal/dump"
	"github.com/dblens/dblens/internal/masker"
	"github.com/dblens/dblens/internal/privilege"
	"github.com/dblens/dblens/internal/rest"
	"github.com/go-chi/chi/v5"
)

var (
	reBlockComment = regexp.MustCompile(`(?s)/\*.*?\*/`)
	reLineComment  = regexp.MustCompile(`--[^\r\n]*`)
	reCteMutation  = regexp.MustCompile(`(?i)\b(INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)\b`)
	reAnalyze      = regexp.MustCompile(`(?i)\bANALYZE\b`)
	reMutating     = regexp.MustCompile(`(?i)\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|MERGE|GRANT|REVOKE|DO|CALL|RENAME)\b`)
)

func splitStatements(sql string) []string {
	var stmts []string
	var current strings.Builder
	inSingleQuote := false
	inDoubleQuote := false
	inBacktick := false

	chars := []rune(sql)
	for i := 0; i < len(chars); i++ {
		ch := chars[i]
		if ch == '\'' && !inDoubleQuote && !inBacktick {
			if inSingleQuote && i+1 < len(chars) && chars[i+1] == '\'' {
				current.WriteRune(ch)
				current.WriteRune(chars[i+1])
				i++
				continue
			}
			inSingleQuote = !inSingleQuote
			current.WriteRune(ch)
		} else if ch == '"' && !inSingleQuote && !inBacktick {
			if inDoubleQuote && i+1 < len(chars) && chars[i+1] == '"' {
				current.WriteRune(ch)
				current.WriteRune(chars[i+1])
				i++
				continue
			}
			inDoubleQuote = !inDoubleQuote
			current.WriteRune(ch)
		} else if ch == '`' && !inSingleQuote && !inDoubleQuote {
			inBacktick = !inBacktick
			current.WriteRune(ch)
		} else if ch == ';' && !inSingleQuote && !inDoubleQuote && !inBacktick {
			stmts = append(stmts, current.String())
			current.Reset()
		} else {
			current.WriteRune(ch)
		}
	}
	if current.Len() > 0 {
		stmts = append(stmts, current.String())
	}
	return stmts
}

func stripOuterParens(s string) string {
	s = strings.TrimSpace(s)
	for strings.HasPrefix(s, "(") && strings.HasSuffix(s, ")") {
		depth := 0
		matched := true
		for i, ch := range s {
			if ch == '(' {
				depth++
			} else if ch == ')' {
				depth--
				if depth == 0 && i < len(s)-1 {
					matched = false
					break
				}
			}
		}
		if matched && depth == 0 {
			s = strings.TrimSpace(s[1 : len(s)-1])
		} else {
			break
		}
	}
	return s
}

// IsNonSelectSQL returns true if SQL statement is non-SELECT (mutation/DDL).
func IsNonSelectSQL(sql string) bool {
	cleaned := reBlockComment.ReplaceAllString(sql, " ")
	cleaned = reLineComment.ReplaceAllString(cleaned, " ")
	cleaned = strings.TrimSpace(cleaned)
	if cleaned == "" {
		return false
	}

	stmts := splitStatements(cleaned)
	for _, stmt := range stmts {
		stmt = stripOuterParens(stmt)
		if stmt == "" {
			continue
		}

		fields := strings.Fields(stmt)
		if len(fields) == 0 {
			continue
		}
		firstWord := strings.ToUpper(fields[0])

		switch firstWord {
		case "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE", "CREATE", "REPLACE", "MERGE", "GRANT", "REVOKE", "DO", "CALL", "RENAME":
			return true
		case "WITH":
			if reCteMutation.MatchString(stmt) {
				return true
			}
		case "EXPLAIN":
			if reAnalyze.MatchString(stmt) && reMutating.MatchString(stmt) {
				return true
			}
		}
	}

	return false
}

type Response struct {
	Data  interface{} `json:"data"`
	Error *string     `json:"error"`
}

func MaskDSN(dsn string) string {
	return driver.MaskDSN(dsn)
}

func sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Response{
		Data:  data,
		Error: nil,
	})
}

func sendError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Response{
		Data:  nil,
		Error: &msg,
	})
}

type Handler struct {
	mgr *connection.Manager
}

func NewHandler(mgr *connection.Manager) *Handler {
	return &Handler{mgr: mgr}
}

type TestConnectionRequest struct {
	DSN string `json:"dsn"`
}

// resolveDriver extracts DSN from X-DBLENS-DSN header first,
// and falls back to resolving global server-seeded connections by connId param.
func (h *Handler) resolveDriver(r *http.Request) (*connection.PoolEntry, error) {
	dsn := strings.TrimSpace(r.Header.Get("X-DBLENS-DSN"))
	if dsn != "" {
		return h.mgr.GetByDSN(dsn)
	}

	connID := chi.URLParam(r, "connId")
	if connID != "" {
		if globalDSN, ok := h.mgr.GetGlobalDSNByID(connID); ok {
			return h.mgr.GetByDSN(globalDSN)
		}
	}

	return nil, fmt.Errorf("X-DBLENS-DSN header is required")
}

func (h *Handler) ListGlobalProfiles(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, http.StatusOK, h.mgr.GlobalProfiles())
}

func (h *Handler) TestConnection(w http.ResponseWriter, r *http.Request) {
	var req TestConnectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}
	req.DSN = strings.TrimSpace(req.DSN)
	if req.DSN == "" {
		sendError(w, http.StatusBadRequest, "dsn is required")
		return
	}

	dialect, err := h.mgr.TestDSN(req.DSN)
	if err != nil {
		sendJSON(w, http.StatusOK, map[string]interface{}{
			"success": false,
			"message": "Connection failed: " + err.Error(),
			"dialect": dialect,
		})
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Connected successfully",
		"dialect": dialect,
	})
}

type SelectDatabaseRequest struct {
	Database string `json:"database"`
}

func (h *Handler) GetDatabases(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	dbs, err := entry.Driver.InspectDatabases(r.Context())
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, dbs)
}

func (h *Handler) SelectDatabase(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var req SelectDatabaseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}
	if req.Database == "" {
		sendError(w, http.StatusBadRequest, "database is required")
		return
	}

	if err := entry.Driver.SelectDatabase(r.Context(), req.Database); err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, map[string]string{"message": "database switched"})
}

func (h *Handler) GetSchemas(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	schemas, err := entry.Driver.InspectSchemas(r.Context())
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, schemas)
}

func (h *Handler) GetTables(w http.ResponseWriter, r *http.Request) {
	schema := r.URL.Query().Get("schema")

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	tables, err := entry.Driver.InspectTables(r.Context(), schema)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, tables)
}

func (h *Handler) GetTableDetails(w http.ResponseWriter, r *http.Request) {
	tableName := chi.URLParam(r, "table")
	schema := r.URL.Query().Get("schema")

	if hasControlChars(tableName) || hasControlChars(schema) {
		sendError(w, http.StatusBadRequest, "table or schema parameter contains invalid characters")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	details, err := entry.Driver.InspectTableDetails(r.Context(), schema, tableName)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, details)
}

func (h *Handler) GetTableDDL(w http.ResponseWriter, r *http.Request) {
	tableName := chi.URLParam(r, "table")
	schema := r.URL.Query().Get("schema")

	if hasControlChars(tableName) || hasControlChars(schema) {
		sendError(w, http.StatusBadRequest, "table or schema parameter contains invalid characters")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	ddl, err := entry.Driver.GenerateTableDDL(r.Context(), schema, tableName)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"table":   tableName,
		"schema":  schema,
		"dialect": entry.Driver.Dialect(),
		"ddl":     ddl,
	})
}

func (h *Handler) AlterTablePreview(w http.ResponseWriter, r *http.Request) {
	tableName := chi.URLParam(r, "table")
	schema := r.URL.Query().Get("schema")

	if hasControlChars(tableName) || hasControlChars(schema) {
		sendError(w, http.StatusBadRequest, "table or schema parameter contains invalid characters")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var req driver.AlterTableRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Table != "" && req.Table != tableName {
		sendError(w, http.StatusBadRequest, "table in request body does not match URL parameter")
		return
	}
	req.Table = tableName

	if req.Schema == "" {
		req.Schema = schema
	}
	if hasControlChars(req.Table) || hasControlChars(req.Schema) {
		sendError(w, http.StatusBadRequest, "table or schema contains invalid characters")
		return
	}

	stmts, ddl, err := alter.GenerateAlterDDL(entry.Driver.Dialect(), req)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"table":      tableName,
		"schema":     req.Schema,
		"dialect":    alter.NormalizeDialect(entry.Driver.Dialect()),
		"statements": stmts,
		"sql":        ddl,
	})
}

func (h *Handler) AlterTableApply(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}

	tableName := chi.URLParam(r, "table")
	schema := r.URL.Query().Get("schema")

	if hasControlChars(tableName) || hasControlChars(schema) {
		sendError(w, http.StatusBadRequest, "table or schema parameter contains invalid characters")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var req driver.AlterTableRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Table != "" && req.Table != tableName {
		sendError(w, http.StatusBadRequest, "table in request body does not match URL parameter")
		return
	}
	req.Table = tableName

	if req.Schema == "" {
		req.Schema = schema
	}
	if hasControlChars(req.Table) || hasControlChars(req.Schema) {
		sendError(w, http.StatusBadRequest, "table or schema contains invalid characters")
		return
	}

	statements, _, err := alter.GenerateAlterDDL(entry.Driver.Dialect(), req)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	if len(statements) == 0 {
		sendJSON(w, http.StatusOK, map[string]interface{}{
			"table":              tableName,
			"schema":             req.Schema,
			"statementsExecuted": 0,
			"elapsedMs":          0,
			"statements":         []string{},
			"message":            "No statements to execute",
		})
		return
	}

	dialect := alter.NormalizeDialect(entry.Driver.Dialect())
	useTx := dialect == "postgres" || dialect == "sqlite"

	if useTx {
		if _, err := entry.Driver.ExecuteQuery(r.Context(), "BEGIN"); err != nil {
			sendError(w, http.StatusInternalServerError, "failed to begin transaction: "+err.Error())
			return
		}
	}

	start := time.Now()
	var executedCount int
	for _, stmt := range statements {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		_, err := entry.Driver.ExecuteQuery(r.Context(), stmt)
		if err != nil {
			if useTx {
				_, _ = entry.Driver.ExecuteQuery(r.Context(), "ROLLBACK")
			}
			sendError(w, http.StatusInternalServerError, fmt.Sprintf("error executing statement %d: %s: %s", executedCount+1, stmt, err.Error()))
			return
		}
		executedCount++
	}

	if useTx {
		if _, err := entry.Driver.ExecuteQuery(r.Context(), "COMMIT"); err != nil {
			_, _ = entry.Driver.ExecuteQuery(r.Context(), "ROLLBACK")
			sendError(w, http.StatusInternalServerError, "failed to commit transaction: "+err.Error())
			return
		}
	}
	elapsed := time.Since(start)

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"table":              tableName,
		"schema":             req.Schema,
		"statementsExecuted": executedCount,
		"elapsedMs":          elapsed.Milliseconds(),
		"statements":         statements,
		"message":            fmt.Sprintf("Successfully executed %d DDL statement(s)", executedCount),
	})
}

func (h *Handler) QueryTableData(w http.ResponseWriter, r *http.Request) {
	tableName := chi.URLParam(r, "table")

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var opts driver.QueryOptions
	if err := json.NewDecoder(r.Body).Decode(&opts); err != nil {
		opts = driver.QueryOptions{}
	}
	opts.Table = tableName

	res, err := entry.Driver.QueryTableData(r.Context(), opts)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, res)
}

type ExecuteQueryRequest struct {
	SQL    string                 `json:"sql"`
	Query  string                 `json:"query"`
	Params map[string]interface{} `json:"params"`
}

func (h *Handler) ExecuteQuery(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var req ExecuteQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	sql := req.SQL
	if sql == "" {
		sql = req.Query
	}

	if sql == "" {
		sendError(w, http.StatusBadRequest, "sql field is required")
		return
	}

	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) && IsNonSelectSQL(sql) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}

	res, err := entry.Driver.ExecuteQueryWithParams(r.Context(), sql, req.Params)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, res)
}

type ExplainQueryRequest struct {
	SQL     string `json:"sql"`
	Query   string `json:"query"`
	Analyze *bool  `json:"analyze"`
	Schema  string `json:"schema"`
}

func (h *Handler) ExplainQuery(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req ExplainQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	sql := strings.TrimSpace(req.SQL)
	if sql == "" {
		sql = strings.TrimSpace(req.Query)
	}
	if sql == "" {
		sendError(w, http.StatusBadRequest, "sql field is required")
		return
	}

	dbParam := strings.TrimSpace(chi.URLParam(r, "db"))
	if dbParam != "" && entry.Driver.Dialect() != "sqlite" {
		if err := entry.Driver.SelectDatabase(r.Context(), dbParam); err != nil {
			sendError(w, http.StatusBadRequest, "Failed to select database: "+err.Error())
			return
		}
	}

	analyze := true
	if req.Analyze != nil {
		analyze = *req.Analyze
	}

	opts := driver.ExplainOptions{
		Analyze: analyze,
		Schema:  req.Schema,
	}

	res, err := entry.Driver.ExplainQuery(r.Context(), sql, opts)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, res)
}

func (h *Handler) MutateRow(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var mut driver.Mutation
	if err := json.NewDecoder(r.Body).Decode(&mut); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	res, err := entry.Driver.MutateRow(r.Context(), mut)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, res)
}

func (h *Handler) BatchInsert(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)

	var req driver.BatchInsertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	if strings.TrimSpace(req.Table) == "" {
		sendError(w, http.StatusBadRequest, "Table name is required")
		return
	}
	if len(req.Rows) == 0 {
		sendError(w, http.StatusBadRequest, "Rows must not be empty")
		return
	}
	if len(req.Rows) > 1000 {
		sendError(w, http.StatusBadRequest, "batch size exceeds maximum limit of 1000 rows")
		return
	}

	res, err := entry.Driver.BatchInsert(r.Context(), req.Schema, req.Table, req.Rows)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, res)
}

func (h *Handler) GetERDData(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	erd, err := entry.Driver.GetERDData(r.Context())
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, erd)
}

func hasControlChars(s string) bool {
	for _, r := range s {
		if r == 0 || r < 32 {
			return true
		}
	}
	return false
}

func formatSQLValue(dialect string, val interface{}) string {
	if val == nil {
		return "NULL"
	}
	escapeVal := func(s string) string {
		if dialect == "mysql" {
			s = strings.ReplaceAll(s, `\`, `\\`)
		}
		return "'" + strings.ReplaceAll(s, "'", "''") + "'"
	}
	switch v := val.(type) {
	case []byte:
		return escapeVal(string(v))
	case string:
		return escapeVal(v)
	case time.Time:
		return "'" + v.Format(time.RFC3339) + "'"
	case bool:
		if v {
			return "TRUE"
		}
		return "FALSE"
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return fmt.Sprintf("%d", v)
	case float32, float64:
		return fmt.Sprintf("%v", v)
	default:
		return escapeVal(fmt.Sprintf("%v", v))
	}
}

// FormatSQLValue formats and escapes a value for SQL INSERT statements.
func FormatSQLValue(dialect string, val interface{}) string {
	return formatSQLValue(dialect, val)
}

func (h *Handler) ExportTable(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	table := strings.TrimSpace(r.URL.Query().Get("table"))
	if table == "" {
		sendError(w, http.StatusBadRequest, "table query parameter is required")
		return
	}
	schema := strings.TrimSpace(r.URL.Query().Get("schema"))
	if hasControlChars(table) || hasControlChars(schema) {
		sendError(w, http.StatusBadRequest, "table or schema parameter contains invalid characters")
		return
	}
	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	if format == "" {
		format = "csv"
	}

	if format != "csv" && format != "json" && format != "sql" {
		sendError(w, http.StatusBadRequest, "unsupported export format: must be csv, json, or sql")
		return
	}

	maskParam := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("mask")))
	isMasking := maskParam == "true" || maskParam == "1"
	maskStrategy := masker.Strategy(strings.ToLower(strings.TrimSpace(r.URL.Query().Get("mask_strategy"))))
	if maskStrategy == "" {
		maskStrategy = masker.StrategyPartial
	}

	rows, err := entry.Driver.QueryTableStream(r.Context(), schema, table)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	flusher, _ := w.(http.Flusher)
	colVals := make([]interface{}, len(cols))
	colPointers := make([]interface{}, len(cols))
	for i := range colVals {
		colPointers[i] = &colVals[i]
	}

	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.csv\"", table))
		w.WriteHeader(http.StatusOK)

		csvWriter := csv.NewWriter(w)
		_ = csvWriter.Write(cols)

		var count int64
		record := make([]string, len(cols))
		for rows.Next() {
			if r.Context().Err() != nil {
				return
			}
			if err := rows.Scan(colPointers...); err != nil {
				break
			}
			for i, val := range colVals {
				if val == nil {
					record[i] = ""
				} else {
					switch v := val.(type) {
					case []byte:
						record[i] = string(v)
					case time.Time:
						record[i] = v.Format(time.RFC3339)
					case bool:
						if v {
							record[i] = "true"
						} else {
							record[i] = "false"
						}
					default:
						record[i] = fmt.Sprintf("%v", v)
					}
				}
			}
			rowOut := record
			if isMasking {
				rowOut = masker.MaskRecord(cols, record, maskStrategy)
			}
			_ = csvWriter.Write(rowOut)
			count++
			if count%500 == 0 {
				csvWriter.Flush()
				if flusher != nil {
					flusher.Flush()
				}
			}
		}
		if rows.Err() != nil {
			return
		}
		csvWriter.Flush()
		if flusher != nil {
			flusher.Flush()
		}

	case "json":
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.json\"", table))
		w.WriteHeader(http.StatusOK)

		_, _ = w.Write([]byte("[\n"))
		var count int64
		first := true
		for rows.Next() {
			if r.Context().Err() != nil {
				return
			}
			if err := rows.Scan(colPointers...); err != nil {
				break
			}
			rowMap := make(map[string]interface{}, len(cols))
			for i, col := range cols {
				val := colVals[i]
				if isMasking {
					val = masker.MaskValue(col, val, maskStrategy)
				}
				if b, ok := val.([]byte); ok {
					rowMap[col] = string(b)
				} else if t, ok := val.(time.Time); ok {
					rowMap[col] = t.Format(time.RFC3339)
				} else {
					rowMap[col] = val
				}
			}
			data, err := json.Marshal(rowMap)
			if err != nil {
				continue
			}
			if !first {
				_, _ = w.Write([]byte(",\n"))
			}
			first = false
			_, _ = w.Write(data)
			count++
			if flusher != nil && count%500 == 0 {
				flusher.Flush()
			}
		}
		if rows.Err() != nil {
			return
		}
		_, _ = w.Write([]byte("\n]\n"))
		if flusher != nil {
			flusher.Flush()
		}

	case "sql":
		w.Header().Set("Content-Type", "application/sql; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.sql\"", table))
		w.WriteHeader(http.StatusOK)

		dialect := entry.Driver.Dialect()
		quoteIdent := func(s string) string {
			if dialect == "postgres" {
				return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
			}
			return "`" + strings.ReplaceAll(s, "`", "``") + "`"
		}

		var targetTable string
		if schema != "" && schema != "main" {
			targetTable = fmt.Sprintf("%s.%s", quoteIdent(schema), quoteIdent(table))
		} else {
			targetTable = quoteIdent(table)
		}

		quotedCols := make([]string, len(cols))
		for i, c := range cols {
			quotedCols[i] = quoteIdent(c)
		}
		colsHeader := strings.Join(quotedCols, ", ")

		headerComment := fmt.Sprintf("-- DBLens Data Export\n-- Table: %s\n-- Format: SQL INSERT statements\n\n", targetTable)
		_, _ = w.Write([]byte(headerComment))

		var count int64
		for rows.Next() {
			if r.Context().Err() != nil {
				return
			}
			if err := rows.Scan(colPointers...); err != nil {
				break
			}
			valStrs := make([]string, len(cols))
			for i, val := range colVals {
				v := val
				if isMasking {
					v = masker.MaskValue(cols[i], val, maskStrategy)
				}
				valStrs[i] = formatSQLValue(dialect, v)
			}

			stmt := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s);\n", targetTable, colsHeader, strings.Join(valStrs, ", "))
			_, _ = w.Write([]byte(stmt))
			count++
			if flusher != nil && count%500 == 0 {
				flusher.Flush()
			}
		}
		if rows.Err() != nil {
			return
		}
		if flusher != nil {
			flusher.Flush()
		}
	}
}

func (h *Handler) ImportCSV(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 50<<20)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		sendError(w, http.StatusBadRequest, "failed to parse multipart form: "+err.Error())
		return
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	table := strings.TrimSpace(r.FormValue("table"))
	if table == "" {
		sendError(w, http.StatusBadRequest, "table is required")
		return
	}
	schema := strings.TrimSpace(r.FormValue("schema"))

	file, _, err := r.FormFile("file")
	if err != nil {
		sendError(w, http.StatusBadRequest, "file is required: "+err.Error())
		return
	}
	defer file.Close()

	reader := csv.NewReader(file)
	reader.FieldsPerRecord = -1
	reader.TrimLeadingSpace = true

	headers, err := reader.Read()
	if err == io.EOF {
		sendError(w, http.StatusBadRequest, "CSV file is empty")
		return
	}
	if err != nil {
		sendError(w, http.StatusBadRequest, "failed to read CSV headers: "+err.Error())
		return
	}

	for i := range headers {
		headers[i] = strings.TrimSpace(headers[i])
	}
	if len(headers) == 0 {
		sendError(w, http.StatusBadRequest, "CSV file has no headers")
		return
	}

	var totalAffected int64
	batch := make([]map[string]interface{}, 0, 500)

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			sendError(w, http.StatusBadRequest, "failed to read CSV row: "+err.Error())
			return
		}

		allBlank := true
		for _, v := range record {
			if strings.TrimSpace(v) != "" {
				allBlank = false
				break
			}
		}
		if allBlank && len(record) <= 1 {
			continue
		}

		rowMap := make(map[string]interface{}, len(headers))
		for i, h := range headers {
			if i < len(record) {
				val := record[i]
				if val == "" || val == "\\N" {
					rowMap[h] = nil
				} else {
					rowMap[h] = val
				}
			} else {
				rowMap[h] = nil
			}
		}
		batch = append(batch, rowMap)

		if len(batch) >= 500 {
			res, err := entry.Driver.BatchInsert(r.Context(), schema, table, batch)
			if err != nil {
				sendError(w, http.StatusInternalServerError, "batch insert error: "+err.Error())
				return
			}
			totalAffected += res.AffectedRows
			batch = batch[:0]
		}
	}

	if len(batch) > 0 {
		res, err := entry.Driver.BatchInsert(r.Context(), schema, table, batch)
		if err != nil {
			sendError(w, http.StatusInternalServerError, "batch insert error: "+err.Error())
			return
		}
		totalAffected += res.AffectedRows
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"affectedRows": totalAffected,
		"message":      fmt.Sprintf("Successfully imported %d rows", totalAffected),
	})
}

func isIdentStart(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == '_'
}

func isIdentPart(r rune) bool {
	return isIdentStart(r) || (r >= '0' && r <= '9')
}

// SplitSQLStatements splits raw SQL script into individual executable statements.
func SplitSQLStatements(sql string) []string {
	return splitSQLStatements(sql)
}

func splitSQLStatements(sql string) []string {
	var stmts []string
	var current strings.Builder
	inSingleQuote := false
	inDoubleQuote := false
	inBacktick := false
	inLineComment := false
	inBlockComment := false
	var dollarTag string

	runes := []rune(sql)
	n := len(runes)
	for i := 0; i < n; i++ {
		r := runes[i]
		next := rune(0)
		if i+1 < n {
			next = runes[i+1]
		}

		if inLineComment {
			if r == '\n' {
				inLineComment = false
				current.WriteRune(' ')
			}
			continue
		}
		if inBlockComment {
			if r == '*' && next == '/' {
				inBlockComment = false
				current.WriteRune(' ')
				i++
			}
			continue
		}

		if dollarTag != "" {
			tagRunes := []rune(dollarTag)
			tagLen := len(tagRunes)
			if i+tagLen <= n && string(runes[i:i+tagLen]) == dollarTag {
				current.WriteString(dollarTag)
				i += tagLen - 1
				dollarTag = ""
				continue
			}
			current.WriteRune(r)
			continue
		}

		if inSingleQuote {
			if r == '\\' && i+1 < n {
				current.WriteRune(r)
				current.WriteRune(next)
				i++
				continue
			}
			if r == '\'' {
				if next == '\'' {
					current.WriteRune(r)
					current.WriteRune(next)
					i++
					continue
				}
				inSingleQuote = false
			}
			current.WriteRune(r)
			continue
		}

		if inDoubleQuote {
			if r == '\\' && i+1 < n {
				current.WriteRune(r)
				current.WriteRune(next)
				i++
				continue
			}
			if r == '"' {
				if next == '"' {
					current.WriteRune(r)
					current.WriteRune(next)
					i++
					continue
				}
				inDoubleQuote = false
			}
			current.WriteRune(r)
			continue
		}

		if inBacktick {
			if r == '\\' && i+1 < n {
				current.WriteRune(r)
				current.WriteRune(next)
				i++
				continue
			}
			if r == '`' {
				if next == '`' {
					current.WriteRune(r)
					current.WriteRune(next)
					i++
					continue
				}
				inBacktick = false
			}
			current.WriteRune(r)
			continue
		}

		if r == '-' && next == '-' {
			inLineComment = true
			i++
			continue
		}
		if r == '/' && next == '*' {
			inBlockComment = true
			i++
			continue
		}

		if r == '\'' {
			inSingleQuote = true
			current.WriteRune(r)
			continue
		}
		if r == '"' {
			inDoubleQuote = true
			current.WriteRune(r)
			continue
		}
		if r == '`' {
			inBacktick = true
			current.WriteRune(r)
			continue
		}

		if r == '$' {
			var tag string
			if next == '$' {
				tag = "$$"
			} else if isIdentStart(next) {
				j := i + 2
				for j < n && isIdentPart(runes[j]) {
					j++
				}
				if j < n && runes[j] == '$' {
					tag = string(runes[i : j+1])
				}
			}
			if tag != "" {
				dollarTag = tag
				current.WriteString(tag)
				i += len([]rune(tag)) - 1
				continue
			}
		}

		if r == ';' {
			stmt := strings.TrimSpace(current.String())
			if stmt != "" {
				stmts = append(stmts, stmt)
			}
			current.Reset()
			continue
		}

		current.WriteRune(r)
	}

	remaining := strings.TrimSpace(current.String())
	if remaining != "" {
		stmts = append(stmts, remaining)
	}

	return stmts
}

func (h *Handler) ImportSQL(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 50<<20)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		sendError(w, http.StatusBadRequest, "failed to parse multipart form: "+err.Error())
		return
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	file, _, err := r.FormFile("file")
	if err != nil {
		sendError(w, http.StatusBadRequest, "file is required: "+err.Error())
		return
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		sendError(w, http.StatusBadRequest, "failed to read SQL file: "+err.Error())
		return
	}

	stmts := splitSQLStatements(string(content))
	if len(stmts) == 0 {
		sendError(w, http.StatusBadRequest, "no SQL statements found in file")
		return
	}

	var executedCount int
	var totalAffected int64
	for _, stmt := range stmts {
		res, err := entry.Driver.ExecuteQuery(r.Context(), stmt)
		if err != nil {
			sendError(w, http.StatusInternalServerError, fmt.Sprintf("error executing statement %d: %s", executedCount+1, err.Error()))
			return
		}
		executedCount++
		if res != nil {
			totalAffected += res.AffectedRows
		}
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"statementsExecuted": executedCount,
		"affectedRows":       totalAffected,
		"message":            fmt.Sprintf("Successfully executed %d SQL statements", executedCount),
	})
}

func sanitizeDumpDbName(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	res := strings.Trim(b.String(), "_")
	if res == "" {
		return "db"
	}
	return res
}

func (h *Handler) DumpDatabase(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	q := r.URL.Query()
	schema := strings.TrimSpace(q.Get("schema"))
	tablesParam := strings.TrimSpace(q.Get("tables"))
	var tables []string
	if tablesParam != "" {
		for _, t := range strings.Split(tablesParam, ",") {
			t = strings.TrimSpace(t)
			if t != "" {
				if hasControlChars(t) {
					sendError(w, http.StatusBadRequest, "invalid table parameter")
					return
				}
				tables = append(tables, t)
			}
		}
	}
	if hasControlChars(schema) {
		sendError(w, http.StatusBadRequest, "invalid schema parameter")
		return
	}

	includeSchema := true
	if v := q.Get("includeSchema"); v != "" {
		includeSchema = strings.EqualFold(v, "true") || v == "1"
	}
	includeData := true
	if v := q.Get("includeData"); v != "" {
		includeData = strings.EqualFold(v, "true") || v == "1"
	}
	useGzip := false
	if v := q.Get("gzip"); v != "" {
		useGzip = strings.EqualFold(v, "true") || v == "1"
	}

	dbName := strings.TrimSpace(q.Get("database"))
	if dbName == "" {
		dbName = schema
	}
	if dbName == "" {
		dbName = chi.URLParam(r, "connId")
	}
	if dbName == "" {
		dbName = "db"
	}
	cleanDb := sanitizeDumpDbName(dbName)
	timestamp := time.Now().UTC().Format("20060102-150405")

	var filename, contentType string
	if useGzip {
		filename = fmt.Sprintf("dblens-dump-%s-%s.sql.gz", cleanDb, timestamp)
		contentType = "application/gzip"
	} else {
		filename = fmt.Sprintf("dblens-dump-%s-%s.sql", cleanDb, timestamp)
		contentType = "application/sql"
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))

	opts := dump.DumpOptions{
		Schema:        schema,
		Tables:        tables,
		IncludeSchema: includeSchema,
		IncludeData:   includeData,
		UseGzip:       useGzip,
	}

	if err := dump.GenerateDump(r.Context(), entry.Driver, w, opts); err != nil {
		return
	}
}

func (h *Handler) RestoreDatabase(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 100<<20) // 100MB limit
	var reader io.Reader = r.Body

	contentType := r.Header.Get("Content-Type")
	if strings.HasPrefix(contentType, "multipart/form-data") {
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			sendError(w, http.StatusBadRequest, "failed to parse multipart form: "+err.Error())
			return
		}
		defer func() {
			if r.MultipartForm != nil {
				_ = r.MultipartForm.RemoveAll()
			}
		}()

		file, _, err := r.FormFile("file")
		if err != nil {
			sendError(w, http.StatusBadRequest, "file field is required in multipart form: "+err.Error())
			return
		}
		defer file.Close()
		reader = file
	}

	result, err := dump.RestoreDump(r.Context(), entry.Driver, reader)
	if err != nil {
		sendError(w, http.StatusBadRequest, "restore failed: "+err.Error())
		return
	}

	if result.Errors == nil {
		result.Errors = []string{}
	}

	payload := map[string]interface{}{
		"total":    result.Total,
		"executed": result.Executed,
		"errors":   result.Errors,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"total":    result.Total,
		"executed": result.Executed,
		"errors":   result.Errors,
		"data":     payload,
	})
}

type DiffEndpointSpec struct {
	ConnID string `json:"connId,omitempty"`
	Schema string `json:"schema,omitempty"`
	Table  string `json:"table,omitempty"`
	DSN    string `json:"dsn,omitempty"`
}

type SchemaDiffRequest struct {
	Source    DiffEndpointSpec `json:"source"`
	Target    DiffEndpointSpec `json:"target"`
	TargetDSN string           `json:"targetDsn,omitempty"`
	SourceDSN string           `json:"sourceDsn,omitempty"`
}

type SchemaDiffApplyRequest struct {
	Statements []string `json:"statements"`
	TargetDSN  string   `json:"targetDsn,omitempty"`
	ReadOnly   bool     `json:"readOnly,omitempty"`
}

func (h *Handler) resolveDriverWithFallback(r *http.Request, explicitDSN, connID string) (*connection.PoolEntry, error) {
	explicitDSN = strings.TrimSpace(explicitDSN)
	if explicitDSN != "" {
		return h.mgr.GetByDSN(explicitDSN)
	}

	connID = strings.TrimSpace(connID)
	if connID != "" {
		if globalDSN, ok := h.mgr.GetGlobalDSNByID(connID); ok {
			return h.mgr.GetByDSN(globalDSN)
		}
	}

	urlConnID := chi.URLParam(r, "connId")
	hdrDSN := strings.TrimSpace(r.Header.Get("X-DBLENS-DSN"))
	if (connID == "" || connID == urlConnID) && hdrDSN != "" {
		return h.mgr.GetByDSN(hdrDSN)
	}
	if hdrDSN != "" {
		return h.mgr.GetByDSN(hdrDSN)
	}

	if connID != "" {
		return nil, fmt.Errorf("could not resolve connection profile for id: %s", connID)
	}

	return h.resolveDriver(r)
}

func defaultSchemaForDriver(d types.Driver) string {
	switch alter.NormalizeDialect(d.Dialect()) {
	case "postgres":
		return "public"
	case "sqlite":
		return "main"
	default:
		return ""
	}
}

func (h *Handler) DiffSchemas(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	var req SchemaDiffRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if hasControlChars(req.Source.Schema) || hasControlChars(req.Source.Table) ||
		hasControlChars(req.Target.Schema) || hasControlChars(req.Target.Table) {
		sendError(w, http.StatusBadRequest, "table or schema name contains invalid control characters")
		return
	}

	// Resolve Source Driver
	srcDSN := req.SourceDSN
	if srcDSN == "" {
		srcDSN = req.Source.DSN
	}
	srcEntry, err := h.resolveDriverWithFallback(r, srcDSN, req.Source.ConnID)
	if err != nil {
		sendError(w, http.StatusBadRequest, "source database connection failed: "+err.Error())
		return
	}

	// Resolve Target Driver
	tgtDSN := req.TargetDSN
	if tgtDSN == "" {
		tgtDSN = req.Target.DSN
	}
	var tgtEntry *connection.PoolEntry
	if tgtDSN != "" || (req.Target.ConnID != "" && req.Target.ConnID != req.Source.ConnID) {
		tgtEntry, err = h.resolveDriverWithFallback(r, tgtDSN, req.Target.ConnID)
		if err != nil {
			sendError(w, http.StatusBadRequest, "target database connection failed: "+err.Error())
			return
		}
	} else {
		tgtEntry = srcEntry
	}

	sourceSchema := strings.TrimSpace(req.Source.Schema)
	if sourceSchema == "" {
		sourceSchema = defaultSchemaForDriver(srcEntry.Driver)
	}

	targetSchema := strings.TrimSpace(req.Target.Schema)
	if targetSchema == "" {
		if sourceSchema != "" && alter.NormalizeDialect(tgtEntry.Driver.Dialect()) == alter.NormalizeDialect(srcEntry.Driver.Dialect()) {
			targetSchema = sourceSchema
		} else {
			targetSchema = defaultSchemaForDriver(tgtEntry.Driver)
		}
	}

	sourceTable := strings.TrimSpace(req.Source.Table)
	targetTable := strings.TrimSpace(req.Target.Table)

	// Single table comparison
	if sourceTable != "" && targetTable != "" {
		srcDetail, err := srcEntry.Driver.InspectTableDetails(r.Context(), sourceSchema, sourceTable)
		if err != nil {
			sendError(w, http.StatusBadRequest, fmt.Sprintf("failed to inspect source table %s: %s", sourceTable, err.Error()))
			return
		}

		tgtDetail, _ := tgtEntry.Driver.InspectTableDetails(r.Context(), targetSchema, targetTable)

		tableDiff := diff.CompareTables(srcDetail, tgtDetail, tgtEntry.Driver.Dialect())
		tableDiff.Name = targetTable
		tableDiff.Schema = targetSchema

		res := diff.SchemaDiffResult{
			SourceSchema:  sourceSchema,
			TargetSchema:  targetSchema,
			SourceDialect: srcEntry.Driver.Dialect(),
			TargetDialect: tgtEntry.Driver.Dialect(),
			TotalTables:   1,
			Tables:        []diff.TableDiff{tableDiff},
			MigrationSQL:  tableDiff.MigrationSQL,
			SQL:           tableDiff.SQL,
		}
		switch tableDiff.Status {
		case diff.DiffAdded:
			res.AddedCount = 1
		case diff.DiffRemoved:
			res.RemovedCount = 1
		case diff.DiffModified:
			res.ModifiedCount = 1
		case diff.DiffIdentical:
			res.IdenticalCount = 1
		}
		sendJSON(w, http.StatusOK, res)
		return
	}

	// Full schema comparison
	srcMetaList, err := srcEntry.Driver.InspectTables(r.Context(), sourceSchema)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "failed to inspect source tables: "+err.Error())
		return
	}

	srcTables := make(map[string]*types.TableDetail, len(srcMetaList))
	for _, meta := range srcMetaList {
		if meta.Type == "view" {
			continue
		}
		detail, err := srcEntry.Driver.InspectTableDetails(r.Context(), sourceSchema, meta.Name)
		if err == nil && detail != nil {
			srcTables[meta.Name] = detail
		}
	}

	tgtMetaList, err := tgtEntry.Driver.InspectTables(r.Context(), targetSchema)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "failed to inspect target tables: "+err.Error())
		return
	}

	tgtTables := make(map[string]*types.TableDetail, len(tgtMetaList))
	for _, meta := range tgtMetaList {
		if meta.Type == "view" {
			continue
		}
		detail, err := tgtEntry.Driver.InspectTableDetails(r.Context(), targetSchema, meta.Name)
		if err == nil && detail != nil {
			tgtTables[meta.Name] = detail
		}
	}

	result := diff.CompareSchemas(srcTables, tgtTables, tgtEntry.Driver.Dialect(), sourceSchema, targetSchema)
	result.SourceDialect = srcEntry.Driver.Dialect()
	sendJSON(w, http.StatusOK, result)
}

func isCommentOrEmpty(s string) bool {
	lines := strings.Split(s, "\n")
	for _, line := range lines {
		l := strings.TrimSpace(line)
		if l != "" && !strings.HasPrefix(l, "--") && !strings.HasPrefix(l, "/*") && !strings.HasPrefix(l, "*") && !strings.HasSuffix(l, "*/") {
			return false
		}
	}
	return true
}

func trimLeadingComments(s string) string {
	lines := strings.Split(s, "\n")
	start := 0
	for start < len(lines) {
		l := strings.TrimSpace(lines[start])
		if l == "" || strings.HasPrefix(l, "--") {
			start++
		} else {
			break
		}
	}
	return strings.TrimSpace(strings.Join(lines[start:], "\n"))
}

func (h *Handler) ApplyDiff(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Target connection is read-only")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	var req SchemaDiffApplyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.ReadOnly {
		sendError(w, http.StatusForbidden, "Target connection is read-only")
		return
	}

	var executable []string
	for _, stmt := range req.Statements {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" || isCommentOrEmpty(stmt) {
			continue
		}
		trimmed := trimLeadingComments(stmt)
		if trimmed != "" {
			executable = append(executable, trimmed)
		}
	}

	if len(executable) == 0 {
		sendJSON(w, http.StatusOK, map[string]interface{}{
			"statementsExecuted": 0,
			"elapsedMs":          0,
			"statements":         []string{},
			"message":            "No statements to execute",
		})
		return
	}

	tgtEntry, err := h.resolveDriverWithFallback(r, req.TargetDSN, chi.URLParam(r, "connId"))
	if err != nil {
		sendError(w, http.StatusBadRequest, "could not resolve target database: "+err.Error())
		return
	}

	dialect := alter.NormalizeDialect(tgtEntry.Driver.Dialect())
	useTx := dialect == "postgres" || dialect == "sqlite"

	if useTx {
		if _, err := tgtEntry.Driver.ExecuteQuery(r.Context(), "BEGIN"); err != nil {
			sendError(w, http.StatusInternalServerError, "failed to begin transaction: "+err.Error())
			return
		}
	}

	start := time.Now()
	var executed []string
	for i, stmt := range executable {
		_, err := tgtEntry.Driver.ExecuteQuery(r.Context(), stmt)
		if err != nil {
			if useTx {
				_, _ = tgtEntry.Driver.ExecuteQuery(r.Context(), "ROLLBACK")
			}
			sendError(w, http.StatusInternalServerError, fmt.Sprintf("error executing statement %d: %s: %s", i+1, stmt, err.Error()))
			return
		}
		executed = append(executed, stmt)
	}

	if useTx {
		if _, err := tgtEntry.Driver.ExecuteQuery(r.Context(), "COMMIT"); err != nil {
			_, _ = tgtEntry.Driver.ExecuteQuery(r.Context(), "ROLLBACK")
			sendError(w, http.StatusInternalServerError, "failed to commit transaction: "+err.Error())
			return
		}
	}

	elapsed := time.Since(start)
	sendJSON(w, http.StatusOK, map[string]interface{}{
		"statementsExecuted": len(executed),
		"elapsedMs":          elapsed.Milliseconds(),
		"statements":         executed,
		"message":            fmt.Sprintf("Successfully executed %d migration statements", len(executed)),
	})
}

func (h *Handler) GetProcesses(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	processes, err := entry.Driver.InspectProcesses(r.Context())
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, processes)
}

type KillProcessRequest struct {
	ProcessID string `json:"processId"`
	ID        string `json:"id"`
}

func (h *Handler) KillProcess(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var req KillProcessRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	targetID := strings.TrimSpace(req.ProcessID)
	if targetID == "" {
		targetID = strings.TrimSpace(req.ID)
	}
	if targetID == "" {
		sendError(w, http.StatusBadRequest, "processId is required")
		return
	}

	pidNum, err := strconv.ParseInt(targetID, 10, 64)
	if err != nil || pidNum <= 0 {
		sendError(w, http.StatusBadRequest, "processId must be a positive integer")
		return
	}

	if err := entry.Driver.KillProcess(r.Context(), targetID); err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Process %s terminated", targetID),
	})
}

func (h *Handler) GetDatabaseHealth(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	report, err := entry.Driver.InspectHealth(r.Context())
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, report)
}

func getRestTarget(r *http.Request) (string, string) {
	table := chi.URLParam(r, "table")
	schema := chi.URLParam(r, "schema")
	if schema == "" {
		schema = r.URL.Query().Get("schema")
	}
	return schema, table
}

func isTruthy(s string) bool {
	s = strings.TrimSpace(strings.ToLower(s))
	return s == "true" || s == "1" || s == "yes"
}

func (h *Handler) isRestReadOnly(r *http.Request) bool {
	return isTruthy(r.Header.Get("X-DBLENS-READONLY")) ||
		isTruthy(r.URL.Query().Get("readonly"))
}

func (h *Handler) RestGet(w http.ResponseWriter, r *http.Request) {
	schema, table := getRestTarget(r)
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}
	rest.HandleGet(w, r, entry.Driver, schema, table)
}

func (h *Handler) RestPost(w http.ResponseWriter, r *http.Request) {
	if h.isRestReadOnly(r) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	schema, table := getRestTarget(r)
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}
	rest.HandlePost(w, r, entry.Driver, schema, table)
}

func (h *Handler) RestPatch(w http.ResponseWriter, r *http.Request) {
	if h.isRestReadOnly(r) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	schema, table := getRestTarget(r)
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}
	rest.HandlePatch(w, r, entry.Driver, schema, table)
}

func (h *Handler) RestDelete(w http.ResponseWriter, r *http.Request) {
	if h.isRestReadOnly(r) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}
	schema, table := getRestTarget(r)
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}
	rest.HandleDelete(w, r, entry.Driver, schema, table)
}

type DetectMaskRequest struct {
	Columns []string          `json:"columns"`
	Samples map[string]string `json:"samples"`
}

type ColumnPIIInfo struct {
	Column  string `json:"column"`
	PIIType string `json:"pii_type"`
	IsPII   bool   `json:"is_pii"`
}

type DetectMaskResponse struct {
	Detected map[string]string `json:"detected"`
	Columns  []ColumnPIIInfo   `json:"columns"`
}

// DetectMaskPII analyzes a list of columns and optional sample values to identify PII.
func (h *Handler) DetectMaskPII(w http.ResponseWriter, r *http.Request) {
	var req DetectMaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	detected := make(map[string]string)
	colInfos := make([]ColumnPIIInfo, 0, len(req.Columns))

	for _, col := range req.Columns {
		var sample string
		if req.Samples != nil {
			sample = req.Samples[col]
		}
		pii := masker.DetectPIIType(col, sample)
		if pii != "" {
			detected[col] = pii
			colInfos = append(colInfos, ColumnPIIInfo{
				Column:  col,
				PIIType: pii,
				IsPII:   true,
			})
		} else {
			colInfos = append(colInfos, ColumnPIIInfo{
				Column:  col,
				PIIType: "",
				IsPII:   false,
			})
		}
	}

	sendJSON(w, http.StatusOK, DetectMaskResponse{
		Detected: detected,
		Columns:  colInfos,
	})
}

type PreviewMaskRequest struct {
	Strategy string                   `json:"strategy"`
	Columns  []string                 `json:"columns"`
	Rows     []map[string]interface{} `json:"rows"`
	Table    string                   `json:"table"`
	Schema   string                   `json:"schema"`
	Limit    int                      `json:"limit"`
}

// PreviewMaskData previews masked data using provided rows or live sample query.
// ponytail: in-memory preview capped at 100 rows; upgrade to stream preview if multi-MB payloads requested.
func (h *Handler) PreviewMaskData(w http.ResponseWriter, r *http.Request) {
	var req PreviewMaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	strat := masker.Strategy(strings.ToLower(strings.TrimSpace(req.Strategy)))
	if strat == "" {
		strat = masker.StrategyPartial
	}

	// 1. Direct rows preview
	if len(req.Rows) > 0 {
		maskedRows := make([]map[string]interface{}, len(req.Rows))
		for i, row := range req.Rows {
			mRow := make(map[string]interface{}, len(row))
			for k, v := range row {
				mRow[k] = masker.MaskValue(k, v, strat)
			}
			maskedRows[i] = mRow
		}
		sendJSON(w, http.StatusOK, map[string]interface{}{
			"strategy": strat,
			"rows":     maskedRows,
		})
		return
	}

	// 2. Query table preview
	if req.Table != "" {
		entry, err := h.resolveDriver(r)
		if err != nil {
			sendError(w, http.StatusBadRequest, err.Error())
			return
		}

		limit := req.Limit
		if limit <= 0 || limit > 100 {
			limit = 5
		}

		res, err := entry.Driver.QueryTableData(r.Context(), types.QueryOptions{
			Schema: req.Schema,
			Table:  req.Table,
			Limit:  limit,
		})
		if err != nil {
			sendError(w, http.StatusInternalServerError, err.Error())
			return
		}

		maskedRows := make([]map[string]interface{}, len(res.Rows))
		for i, row := range res.Rows {
			mRow := make(map[string]interface{}, len(res.Columns))
			for j, col := range res.Columns {
				var val interface{}
				if j < len(row) {
					val = row[j]
				}
				mRow[col] = masker.MaskValue(col, val, strat)
			}
			maskedRows[i] = mRow
		}

		sendJSON(w, http.StatusOK, map[string]interface{}{
			"strategy": strat,
			"columns":  res.Columns,
			"rows":     maskedRows,
		})
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"strategy": strat,
		"rows":     []interface{}{},
	})
}

// GetPrivileges inspects database roles, table privileges, and available tables.
func (h *Handler) GetPrivileges(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	schema := strings.TrimSpace(r.URL.Query().Get("schema"))
	report, err := privilege.InspectPrivileges(r.Context(), entry.Driver, schema)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, report)
}

type PreviewPrivilegesRequest struct {
	Changes []privilege.PrivilegeChange `json:"changes"`
	Roles   []privilege.RoleInfo        `json:"roles"`
}

// PreviewPrivileges generates dry-run DDL and security warnings for staged privilege adjustments.
func (h *Handler) PreviewPrivileges(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var req PreviewPrivilegesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	plan, err := privilege.GeneratePlan(entry.Driver.Dialect(), req.Changes, req.Roles)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, plan)
}

type ApplyPrivilegesRequest struct {
	Plan    *privilege.PrivilegePlan    `json:"plan,omitempty"`
	Changes []privilege.PrivilegeChange `json:"changes,omitempty"`
	Roles   []privilege.RoleInfo        `json:"roles,omitempty"`
}

// ApplyPrivileges applies the generated privilege plan statements if not in read-only mode.
func (h *Handler) ApplyPrivileges(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Privilege modification blocked by Safe Mode.")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var req ApplyPrivilegesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	plan := req.Plan
	if plan == nil && len(req.Changes) > 0 {
		var genErr error
		plan, genErr = privilege.GeneratePlan(entry.Driver.Dialect(), req.Changes, req.Roles)
		if genErr != nil {
			sendError(w, http.StatusBadRequest, genErr.Error())
			return
		}
	}

	if plan == nil {
		sendError(w, http.StatusBadRequest, "no privilege plan or changes provided")
		return
	}

	if err := privilege.ApplyPlan(r.Context(), entry.Driver, plan); err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"success":            true,
		"executedStatements": len(plan.Statements),
	})
}

func extractLLMConfig(r *http.Request, bodyCfg assistant.LLMConfig) assistant.LLMConfig {
	cfg := bodyCfg
	if cfg.Provider == "" {
		cfg.Provider = r.Header.Get("X-AI-Provider")
	}
	if cfg.Endpoint == "" {
		cfg.Endpoint = r.Header.Get("X-AI-Endpoint")
	}
	if cfg.APIKey == "" {
		cfg.APIKey = r.Header.Get("X-AI-Key")
		if cfg.APIKey == "" {
			cfg.APIKey = r.Header.Get("X-AI-ApiKey")
		}
	}
	if cfg.Model == "" {
		cfg.Model = r.Header.Get("X-AI-Model")
	}
	if cfg.Provider == "" {
		cfg.Provider = "openai"
	}
	return cfg
}

// GetAssistantSchema returns compact table and DDL metadata for the assistant.
func (h *Handler) GetAssistantSchema(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	schema := r.URL.Query().Get("schema")
	schemaCtx, err := assistant.ExtractCompactSchema(r.Context(), entry.Driver, schema)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, schemaCtx)
}

type AssistantPromptRequest struct {
	Op     string `json:"op"`
	Prompt string `json:"prompt"`
	Query  string `json:"query"`
	Error  string `json:"error"`
	Schema string `json:"schema"`
}

// BuildAssistantPrompt generates offline prompt formatted with schema context for copy-paste.
func (h *Handler) BuildAssistantPrompt(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var req AssistantPromptRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	schemaCtx, err := assistant.ExtractCompactSchema(r.Context(), entry.Driver, req.Schema)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	op := req.Op
	if op == "" {
		if req.Error != "" {
			op = "fix"
		} else if req.Query != "" {
			op = "explain"
		} else {
			op = "generate"
		}
	}

	input := req.Prompt
	if op == "fix" || op == "explain" {
		if req.Query != "" {
			input = req.Query
		}
	}

	prompt := assistant.BuildPrompt(op, entry.Driver.Dialect(), schemaCtx, input, req.Error)
	sendJSON(w, http.StatusOK, map[string]string{
		"prompt": prompt,
	})
}

type AssistantGenerateRequest struct {
	Prompt string              `json:"prompt"`
	Schema string              `json:"schema"`
	Config assistant.LLMConfig `json:"config"`
}

// GenerateSQL converts natural language prompt into SQL.
func (h *Handler) GenerateSQL(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var req AssistantGenerateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if strings.TrimSpace(req.Prompt) == "" {
		sendError(w, http.StatusBadRequest, "prompt is required")
		return
	}

	cfg := extractLLMConfig(r, req.Config)
	resp, err := assistant.GenerateSQL(r.Context(), entry.Driver, cfg, req.Schema, req.Prompt)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]string{
		"sql": resp.Result,
		"raw": resp.Raw,
	})
}

type AssistantFixRequest struct {
	Query  string              `json:"query"`
	Error  string              `json:"error"`
	Schema string              `json:"schema"`
	Config assistant.LLMConfig `json:"config"`
}

// FixSQL corrects failing SQL from error message.
func (h *Handler) FixSQL(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var req AssistantFixRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if strings.TrimSpace(req.Query) == "" {
		sendError(w, http.StatusBadRequest, "query is required")
		return
	}

	cfg := extractLLMConfig(r, req.Config)
	resp, err := assistant.FixSQL(r.Context(), entry.Driver, cfg, req.Schema, req.Query, req.Error)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]string{
		"sql": resp.Result,
		"raw": resp.Raw,
	})
}

type AssistantExplainRequest struct {
	Query  string              `json:"query"`
	Schema string              `json:"schema"`
	Config assistant.LLMConfig `json:"config"`
}

// ExplainSQL explains SQL query in bullet points.
func (h *Handler) ExplainSQL(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var req AssistantExplainRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if strings.TrimSpace(req.Query) == "" {
		sendError(w, http.StatusBadRequest, "query is required")
		return
	}

	cfg := extractLLMConfig(r, req.Config)
	resp, err := assistant.ExplainSQL(r.Context(), entry.Driver, cfg, req.Schema, req.Query)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]string{
		"explanation": resp.Result,
		"raw":         resp.Raw,
	})
}







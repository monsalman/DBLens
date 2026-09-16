package api

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/driver"
	"github.com/go-chi/chi/v5"
)

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
	SQL string `json:"sql"`
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

	if req.SQL == "" {
		sendError(w, http.StatusBadRequest, "sql field is required")
		return
	}

	res, err := entry.Driver.ExecuteQuery(r.Context(), req.SQL)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, res)
}

func (h *Handler) MutateRow(w http.ResponseWriter, r *http.Request) {
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
			_ = csvWriter.Write(record)
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
				valStrs[i] = formatSQLValue(dialect, val)
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

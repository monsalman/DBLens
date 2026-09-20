package rest

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/dblens/dblens/internal/driver/types"
)

var (
	identRegex = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

	reservedQueryParams = map[string]bool{
		"select":   true,
		"order":    true,
		"limit":    true,
		"offset":   true,
		"schema":   true,
		"readonly": true,
		"_":        true,
	}
)

// ValidateIdentifier ensures an identifier (column, table, schema) contains only safe characters.
func ValidateIdentifier(name string) error {
	if !identRegex.MatchString(name) {
		return fmt.Errorf("invalid identifier: %q", name)
	}
	return nil
}

func isPostgres(dialect string) bool {
	d := strings.ToLower(dialect)
	return d == "postgres" || d == "postgresql" || d == "pg"
}

func isMySQL(dialect string) bool {
	d := strings.ToLower(dialect)
	return d == "mysql" || d == "mariadb"
}

// QuoteIdentifier safely quotes a column or table identifier based on SQL dialect.
func QuoteIdentifier(dialect string, name string) (string, error) {
	if err := ValidateIdentifier(name); err != nil {
		return "", err
	}
	if isMySQL(dialect) {
		return "`" + name + "`", nil
	}
	return `"` + name + `"`, nil
}

// QuoteTable quotes a table optionally qualified with schema.
func QuoteTable(dialect, schema, table string) (string, error) {
	if err := ValidateIdentifier(table); err != nil {
		return "", err
	}
	tQuoted, _ := QuoteIdentifier(dialect, table)
	if schema != "" && schema != "main" {
		if err := ValidateIdentifier(schema); err != nil {
			return "", err
		}
		sQuoted, _ := QuoteIdentifier(dialect, schema)
		return sQuoted + "." + tQuoted, nil
	}
	return tQuoted, nil
}

type Filter struct {
	Column   string
	Operator string // eq, neq, gt, gte, lt, lte, like, in, is
	Value    string
	Values   []string // parsed for in.(...)
}

type OrderClause struct {
	Column    string
	Direction string // ASC or DESC
}

type QueryParams struct {
	Select  []string
	Filters []Filter
	Order   []OrderClause
	Limit   int
	Offset  int
}

// ParseQueryParams parses PostgREST query parameters into QueryParams.
func ParseQueryParams(values url.Values) (QueryParams, error) {
	var qp QueryParams
	qp.Limit = 50
	qp.Offset = 0

	// Parse limit
	if lStr := values.Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil {
			if l <= 0 {
				qp.Limit = 50
			} else if l > 1000 {
				qp.Limit = 1000
			} else {
				qp.Limit = l
			}
		}
	}

	// Parse offset
	if oStr := values.Get("offset"); oStr != "" {
		if o, err := strconv.Atoi(oStr); err == nil {
			if o >= 0 {
				qp.Offset = o
			}
		}
	}

	// Parse select
	if sStr := values.Get("select"); sStr != "" {
		rawCols := strings.Split(sStr, ",")
		for _, rawCol := range rawCols {
			col := strings.TrimSpace(rawCol)
			if col == "" || col == "*" {
				continue
			}
			if err := ValidateIdentifier(col); err != nil {
				return qp, fmt.Errorf("invalid column in select: %w", err)
			}
			qp.Select = append(qp.Select, col)
		}
	}

	// Parse order
	if ordStr := values.Get("order"); ordStr != "" {
		rawOrders := strings.Split(ordStr, ",")
		for _, ro := range rawOrders {
			ro = strings.TrimSpace(ro)
			if ro == "" {
				continue
			}
			parts := strings.SplitN(ro, ".", 2)
			col := strings.TrimSpace(parts[0])
			if err := ValidateIdentifier(col); err != nil {
				return qp, fmt.Errorf("invalid column in order: %w", err)
			}
			dir := "ASC"
			if len(parts) == 2 && strings.EqualFold(strings.TrimSpace(parts[1]), "desc") {
				dir = "DESC"
			}
			qp.Order = append(qp.Order, OrderClause{Column: col, Direction: dir})
		}
	}

	// Parse filter parameters (keys not in reservedQueryParams)
	// Sort keys for deterministic filter ordering
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, k := range keys {
		if reservedQueryParams[strings.ToLower(k)] {
			continue
		}
		if err := ValidateIdentifier(k); err != nil {
			return qp, fmt.Errorf("invalid column in filter: %w", err)
		}

		for _, val := range values[k] {
			parts := strings.SplitN(val, ".", 2)
			if len(parts) != 2 {
				return qp, fmt.Errorf("invalid filter format for column %q: %q (expected operator.value)", k, val)
			}
			op := strings.ToLower(parts[0])
			filterVal := parts[1]

			switch op {
			case "eq", "neq", "gt", "gte", "lt", "lte", "like", "is":
				qp.Filters = append(qp.Filters, Filter{
					Column:   k,
					Operator: op,
					Value:    filterVal,
				})
			case "in":
				if !strings.HasPrefix(filterVal, "(") || !strings.HasSuffix(filterVal, ")") {
					return qp, fmt.Errorf("invalid 'in' syntax for column %q: %q (expected in.(v1,v2))", k, filterVal)
				}
				inner := filterVal[1 : len(filterVal)-1]
				var inVals []string
				if strings.TrimSpace(inner) != "" {
					for _, item := range strings.Split(inner, ",") {
						inVals = append(inVals, strings.TrimSpace(item))
					}
				}
				qp.Filters = append(qp.Filters, Filter{
					Column:   k,
					Operator: "in",
					Value:    filterVal,
					Values:   inVals,
				})
			default:
				return qp, fmt.Errorf("unsupported filter operator %q for column %q", op, k)
			}
		}
	}

	return qp, nil
}

type paramTracker struct {
	dialect string
	count   int
	args    []interface{}
}

func (p *paramTracker) nextPlaceholder(val interface{}) string {
	p.args = append(p.args, val)
	p.count++
	if isPostgres(p.dialect) {
		return fmt.Sprintf("$%d", p.count)
	}
	return "?"
}

func buildWhereClause(dialect string, filters []Filter, tracker *paramTracker) (string, error) {
	if len(filters) == 0 {
		return "", nil
	}

	var parts []string
	for _, f := range filters {
		colQuoted, err := QuoteIdentifier(dialect, f.Column)
		if err != nil {
			return "", err
		}

		switch f.Operator {
		case "eq":
			if strings.EqualFold(f.Value, "null") {
				parts = append(parts, colQuoted+" IS NULL")
			} else {
				parts = append(parts, colQuoted+" = "+tracker.nextPlaceholder(f.Value))
			}
		case "neq":
			if strings.EqualFold(f.Value, "null") {
				parts = append(parts, colQuoted+" IS NOT NULL")
			} else {
				parts = append(parts, colQuoted+" <> "+tracker.nextPlaceholder(f.Value))
			}
		case "gt":
			parts = append(parts, colQuoted+" > "+tracker.nextPlaceholder(f.Value))
		case "gte":
			parts = append(parts, colQuoted+" >= "+tracker.nextPlaceholder(f.Value))
		case "lt":
			parts = append(parts, colQuoted+" < "+tracker.nextPlaceholder(f.Value))
		case "lte":
			parts = append(parts, colQuoted+" <= "+tracker.nextPlaceholder(f.Value))
		case "like":
			parts = append(parts, colQuoted+" LIKE "+tracker.nextPlaceholder(f.Value))
		case "is":
			if strings.EqualFold(f.Value, "null") {
				parts = append(parts, colQuoted+" IS NULL")
			} else if strings.EqualFold(f.Value, "not.null") {
				parts = append(parts, colQuoted+" IS NOT NULL")
			} else {
				parts = append(parts, colQuoted+" IS "+tracker.nextPlaceholder(f.Value))
			}
		case "in":
			if len(f.Values) == 0 {
				parts = append(parts, "1 = 0")
			} else {
				phs := make([]string, len(f.Values))
				for i, v := range f.Values {
					phs[i] = tracker.nextPlaceholder(v)
				}
				parts = append(parts, fmt.Sprintf("%s IN (%s)", colQuoted, strings.Join(phs, ", ")))
			}
		default:
			return "", fmt.Errorf("unsupported operator: %s", f.Operator)
		}
	}

	return " WHERE " + strings.Join(parts, " AND "), nil
}

// BuildSelectSQL generates a parameterized SELECT statement with PostgREST query options.
func BuildSelectSQL(dialect, schema, table string, qp QueryParams) (string, []interface{}, error) {
	tableQuoted, err := QuoteTable(dialect, schema, table)
	if err != nil {
		return "", nil, err
	}

	tracker := &paramTracker{dialect: dialect}
	whereClause, err := buildWhereClause(dialect, qp.Filters, tracker)
	if err != nil {
		return "", nil, err
	}

	selectCols := "*"
	if len(qp.Select) > 0 {
		quotedCols := make([]string, len(qp.Select))
		for i, c := range qp.Select {
			qc, err := QuoteIdentifier(dialect, c)
			if err != nil {
				return "", nil, err
			}
			quotedCols[i] = qc
		}
		selectCols = strings.Join(quotedCols, ", ")
	}

	orderClause := ""
	if len(qp.Order) > 0 {
		var parts []string
		for _, o := range qp.Order {
			qc, err := QuoteIdentifier(dialect, o.Column)
			if err != nil {
				return "", nil, err
			}
			parts = append(parts, qc+" "+o.Direction)
		}
		orderClause = " ORDER BY " + strings.Join(parts, ", ")
	}

	limitClause := fmt.Sprintf(" LIMIT %d OFFSET %d", qp.Limit, qp.Offset)
	sql := fmt.Sprintf("SELECT %s FROM %s%s%s%s", selectCols, tableQuoted, whereClause, orderClause, limitClause)
	return sql, tracker.args, nil
}

// BuildCountSQL generates a parameterized SELECT COUNT(*) statement with matching WHERE filters.
func BuildCountSQL(dialect, schema, table string, filters []Filter) (string, []interface{}, error) {
	tableQuoted, err := QuoteTable(dialect, schema, table)
	if err != nil {
		return "", nil, err
	}

	tracker := &paramTracker{dialect: dialect}
	whereClause, err := buildWhereClause(dialect, filters, tracker)
	if err != nil {
		return "", nil, err
	}

	sql := fmt.Sprintf("SELECT COUNT(*) FROM %s%s", tableQuoted, whereClause)
	return sql, tracker.args, nil
}

// BuildInsertSQL generates a parameterized INSERT statement for a batch or single row.
func BuildInsertSQL(dialect, schema, table string, rows []map[string]interface{}) (string, []interface{}, error) {
	if len(rows) == 0 {
		return "", nil, fmt.Errorf("no rows provided for INSERT")
	}

	tableQuoted, err := QuoteTable(dialect, schema, table)
	if err != nil {
		return "", nil, err
	}

	// Determine column list from the first row and sort keys for consistency
	colMap := make(map[string]bool)
	for _, row := range rows {
		for k := range row {
			colMap[k] = true
		}
	}
	var cols []string
	for k := range colMap {
		cols = append(cols, k)
	}
	sort.Strings(cols)

	if len(cols) == 0 {
		return "", nil, fmt.Errorf("no columns provided for INSERT")
	}

	quotedCols := make([]string, len(cols))
	for i, c := range cols {
		qc, err := QuoteIdentifier(dialect, c)
		if err != nil {
			return "", nil, err
		}
		quotedCols[i] = qc
	}

	tracker := &paramTracker{dialect: dialect}
	var rowTuples []string

	for _, row := range rows {
		var placeholders []string
		for _, col := range cols {
			val := row[col]
			placeholders = append(placeholders, tracker.nextPlaceholder(val))
		}
		rowTuples = append(rowTuples, "("+strings.Join(placeholders, ", ")+")")
	}

	sql := fmt.Sprintf("INSERT INTO %s (%s) VALUES %s", tableQuoted, strings.Join(quotedCols, ", "), strings.Join(rowTuples, ", "))
	return sql, tracker.args, nil
}

// BuildUpdateSQL generates a parameterized UPDATE statement with filters.
func BuildUpdateSQL(dialect, schema, table string, data map[string]interface{}, filters []Filter) (string, []interface{}, error) {
	if len(data) == 0 {
		return "", nil, fmt.Errorf("no fields provided for UPDATE")
	}
	if len(filters) == 0 {
		return "", nil, fmt.Errorf("at least one filter required for UPDATE to prevent accidental full table modification")
	}

	tableQuoted, err := QuoteTable(dialect, schema, table)
	if err != nil {
		return "", nil, err
	}

	var cols []string
	for k := range data {
		cols = append(cols, k)
	}
	sort.Strings(cols)

	tracker := &paramTracker{dialect: dialect}
	var setParts []string
	for _, c := range cols {
		qc, err := QuoteIdentifier(dialect, c)
		if err != nil {
			return "", nil, err
		}
		setParts = append(setParts, qc+" = "+tracker.nextPlaceholder(data[c]))
	}

	whereClause, err := buildWhereClause(dialect, filters, tracker)
	if err != nil {
		return "", nil, err
	}

	sql := fmt.Sprintf("UPDATE %s SET %s%s", tableQuoted, strings.Join(setParts, ", "), whereClause)
	return sql, tracker.args, nil
}

// BuildDeleteSQL generates a parameterized DELETE statement with filters.
func BuildDeleteSQL(dialect, schema, table string, filters []Filter) (string, []interface{}, error) {
	if len(filters) == 0 {
		return "", nil, fmt.Errorf("at least one filter required for DELETE to prevent accidental full table wipe")
	}

	tableQuoted, err := QuoteTable(dialect, schema, table)
	if err != nil {
		return "", nil, err
	}

	tracker := &paramTracker{dialect: dialect}
	whereClause, err := buildWhereClause(dialect, filters, tracker)
	if err != nil {
		return "", nil, err
	}

	sql := fmt.Sprintf("DELETE FROM %s%s", tableQuoted, whereClause)
	return sql, tracker.args, nil
}

func sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func sendError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"error": msg,
	})
}

// HandleGet executes GET request for table rows, setting X-Total-Count header.
func HandleGet(w http.ResponseWriter, r *http.Request, drv types.Driver, schema, table string) {
	qp, err := ParseQueryParams(r.URL.Query())
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	// 1. Total matching count query
	countSQL, countArgs, err := BuildCountSQL(drv.Dialect(), schema, table, qp.Filters)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}
	countRes, err := drv.ExecuteRaw(r.Context(), countSQL, countArgs...)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "failed to get row count: "+err.Error())
		return
	}

	var totalCount int64
	if len(countRes.Rows) > 0 && len(countRes.Rows[0]) > 0 {
		switch v := countRes.Rows[0][0].(type) {
		case int64:
			totalCount = v
		case int:
			totalCount = int64(v)
		case float64:
			totalCount = int64(v)
		case string:
			totalCount, _ = strconv.ParseInt(v, 10, 64)
		}
	}

	// 2. Data rows query
	selectSQL, selectArgs, err := BuildSelectSQL(drv.Dialect(), schema, table, qp)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}
	dataRes, err := drv.ExecuteRaw(r.Context(), selectSQL, selectArgs...)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "failed to query rows: "+err.Error())
		return
	}

	rows := make([]map[string]interface{}, 0, len(dataRes.Rows))
	for _, row := range dataRes.Rows {
		rowMap := make(map[string]interface{}, len(dataRes.Columns))
		for i, colName := range dataRes.Columns {
			rowMap[colName] = row[i]
		}
		rows = append(rows, rowMap)
	}

	w.Header().Set("X-Total-Count", strconv.FormatInt(totalCount, 10))
	sendJSON(w, http.StatusOK, rows)
}

// HandlePost executes INSERT request for JSON object or array of objects.
func HandlePost(w http.ResponseWriter, r *http.Request, drv types.Driver, schema, table string) {
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		sendError(w, http.StatusBadRequest, "failed to read body: "+err.Error())
		return
	}

	trimmed := strings.TrimSpace(string(bodyBytes))
	if trimmed == "" {
		sendError(w, http.StatusBadRequest, "empty request body")
		return
	}

	var parsedRows []map[string]interface{}
	var isArray bool

	if strings.HasPrefix(trimmed, "[") {
		isArray = true
		if err := json.Unmarshal(bodyBytes, &parsedRows); err != nil {
			sendError(w, http.StatusBadRequest, "invalid JSON array: "+err.Error())
			return
		}
		if len(parsedRows) == 0 {
			sendJSON(w, http.StatusCreated, map[string]interface{}{
				"rowsAffected": 0,
				"data":         []map[string]interface{}{},
			})
			return
		}
	} else if strings.HasPrefix(trimmed, "{") {
		var singleRow map[string]interface{}
		if err := json.Unmarshal(bodyBytes, &singleRow); err != nil {
			sendError(w, http.StatusBadRequest, "invalid JSON object: "+err.Error())
			return
		}
		if len(singleRow) == 0 {
			sendError(w, http.StatusBadRequest, "no data provided in JSON object")
			return
		}
		parsedRows = []map[string]interface{}{singleRow}
	} else {
		sendError(w, http.StatusBadRequest, "request body must be a JSON object or array of objects")
		return
	}

	insertSQL, args, err := BuildInsertSQL(drv.Dialect(), schema, table, parsedRows)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	res, err := drv.ExecuteRaw(r.Context(), insertSQL, args...)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "failed to insert row(s): "+err.Error())
		return
	}

	var responseData interface{} = parsedRows
	if !isArray && len(parsedRows) == 1 {
		responseData = parsedRows[0]
	}

	sendJSON(w, http.StatusCreated, map[string]interface{}{
		"rowsAffected": res.AffectedRows,
		"data":         responseData,
	})
}

// HandlePatch executes UPDATE request for fields in JSON object filtered by query params.
func HandlePatch(w http.ResponseWriter, r *http.Request, drv types.Driver, schema, table string) {
	var updateData map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&updateData); err != nil {
		sendError(w, http.StatusBadRequest, "invalid JSON object body: "+err.Error())
		return
	}
	if len(updateData) == 0 {
		sendError(w, http.StatusBadRequest, "no update fields provided in JSON body")
		return
	}

	qp, err := ParseQueryParams(r.URL.Query())
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(qp.Filters) == 0 {
		sendError(w, http.StatusBadRequest, "at least one filter required for UPDATE to prevent accidental full table modification")
		return
	}

	updateSQL, args, err := BuildUpdateSQL(drv.Dialect(), schema, table, updateData, qp.Filters)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	res, err := drv.ExecuteRaw(r.Context(), updateSQL, args...)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "failed to update row(s): "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"rowsAffected": res.AffectedRows,
	})
}

// HandleDelete executes DELETE request filtered by query params.
func HandleDelete(w http.ResponseWriter, r *http.Request, drv types.Driver, schema, table string) {
	qp, err := ParseQueryParams(r.URL.Query())
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(qp.Filters) == 0 {
		sendError(w, http.StatusBadRequest, "at least one filter required for DELETE to prevent accidental full table wipe")
		return
	}

	deleteSQL, args, err := BuildDeleteSQL(drv.Dialect(), schema, table, qp.Filters)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	res, err := drv.ExecuteRaw(r.Context(), deleteSQL, args...)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "failed to delete row(s): "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"rowsAffected": res.AffectedRows,
	})
}

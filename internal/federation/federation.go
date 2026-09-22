package federation

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
	_ "modernc.org/sqlite"
)

const (
	DefaultMaxRowsPerTable  = 10000
	AbsoluteMaxRowsPerTable = 20000
	MaxFederatedResultRows  = 50000
)

var validIdentifier = regexp.MustCompile(`^[a-zA-Z0-9_]+$`)

func quoteIdentifier(dialect, ident string) (string, error) {
	if !validIdentifier.MatchString(ident) {
		return "", fmt.Errorf("invalid identifier: %q", ident)
	}
	d := strings.ToLower(dialect)
	if d == "mysql" || d == "mariadb" {
		return "`" + ident + "`", nil
	}
	return `"` + ident + `"`, nil
}

func quoteTable(dialect, schema, table string) (string, error) {
	qTable, err := quoteIdentifier(dialect, table)
	if err != nil {
		return "", err
	}
	if schema != "" {
		qSchema, err := quoteIdentifier(dialect, schema)
		if err != nil {
			return "", err
		}
		return qSchema + "." + qTable, nil
	}
	return qTable, nil
}

// TableRef represents a parsed connection reference in a federated query.
type TableRef struct {
	RawRef    string `json:"rawRef"`    // e.g. "[conn1].users" or "[conn1].public.users"
	ConnID    string `json:"connId"`    // e.g. "conn1"
	Schema    string `json:"schema"`    // e.g. "public" or ""
	Table     string `json:"table"`     // e.g. "users"
	TempTable string `json:"tempTable"` // ephemeral sqlite table name, e.g. "fed_conn1_users"
}

// TableStat tracks metrics for each table fetched during federation.
type TableStat struct {
	ConnID    string `json:"connId"`
	Schema    string `json:"schema,omitempty"`
	Table     string `json:"table"`
	TempTable string `json:"tempTable"`
	RowCount  int    `json:"rowCount"`
	ElapsedMs int64  `json:"elapsedMs"`
}

// QueryResult represents the complete federated execution result.
type QueryResult struct {
	Result       *types.QueryResult `json:"result"`
	TableStats   []TableStat        `json:"tableStats"`
	RewrittenSQL string             `json:"rewrittenSql"`
	ElapsedMs    int64              `json:"elapsedMs"`
}

// DriverResolver resolves a types.Driver instance for a given connection ID.
type DriverResolver func(ctx context.Context, connID string) (types.Driver, error)

// QueryConfig configures limits for federated query execution.
type QueryConfig struct {
	MaxRowsPerTable int
	Timeout         time.Duration
}

// reConnRef matches bracketed connection references:
// [conn_id].table or [conn_id].schema.table
var reConnRef = regexp.MustCompile(`\[([a-zA-Z0-9_\-]+)\]\.([a-zA-Z0-9_"` + "`" + `]+)(?:\.([a-zA-Z0-9_"` + "`" + `]+))?`)

func sanitizeIdentifier(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	res := strings.Trim(b.String(), "_")
	if res == "" {
		return "tbl"
	}
	return res
}

func cleanQuotes(s string) string {
	return strings.Trim(s, "`\"'")
}

// ParseQueryReferences extracts all table references and rewrites query with ephemeral table names.
func ParseQueryReferences(query string) ([]TableRef, string, error) {
	matches := reConnRef.FindAllStringSubmatchIndex(query, -1)
	if len(matches) == 0 {
		return nil, query, fmt.Errorf("no federated table references found; use [conn_id].table or [conn_id].schema.table syntax")
	}

	uniqueRefs := make(map[string]TableRef)
	var orderedKeys []string

	for _, idx := range matches {
		raw := query[idx[0]:idx[1]]
		connID := query[idx[2]:idx[3]]

		part1 := cleanQuotes(query[idx[4]:idx[5]])
		var schema, table string

		if idx[6] != -1 && idx[7] != -1 {
			schema = part1
			table = cleanQuotes(query[idx[6]:idx[7]])
		} else {
			schema = ""
			table = part1
		}

		key := fmt.Sprintf("%s:%s:%s", connID, schema, table)
		if _, exists := uniqueRefs[key]; !exists {
			var tempTable string
			if schema != "" {
				tempTable = fmt.Sprintf("fed_%s_%s_%s", sanitizeIdentifier(connID), sanitizeIdentifier(schema), sanitizeIdentifier(table))
			} else {
				tempTable = fmt.Sprintf("fed_%s_%s", sanitizeIdentifier(connID), sanitizeIdentifier(table))
			}

			ref := TableRef{
				RawRef:    raw,
				ConnID:    connID,
				Schema:    schema,
				Table:     table,
				TempTable: tempTable,
			}
			uniqueRefs[key] = ref
			orderedKeys = append(orderedKeys, key)
		}
	}

	// Rewrite query from right to left using indices to avoid offset shift or substring clash
	rewritten := query
	for i := len(matches) - 1; i >= 0; i-- {
		idx := matches[i]
		connID := query[idx[2]:idx[3]]
		part1 := cleanQuotes(query[idx[4]:idx[5]])
		var schema, table string
		if idx[6] != -1 && idx[7] != -1 {
			schema = part1
			table = cleanQuotes(query[idx[6]:idx[7]])
		} else {
			schema = ""
			table = part1
		}

		key := fmt.Sprintf("%s:%s:%s", connID, schema, table)
		ref := uniqueRefs[key]
		rewritten = rewritten[:idx[0]] + ref.TempTable + rewritten[idx[1]:]
	}

	refs := make([]TableRef, 0, len(orderedKeys))
	for _, k := range orderedKeys {
		refs = append(refs, uniqueRefs[k])
	}

	return refs, rewritten, nil
}

type fetchedTableData struct {
	Ref       TableRef
	Columns   []string
	Rows      [][]interface{}
	RowCount  int
	ElapsedMs int64
	Err       error
}

// ExecuteFederatedQuery runs queries across multiple connections concurrently and joins them in ephemeral SQLite.
func ExecuteFederatedQuery(ctx context.Context, query string, resolver DriverResolver, cfg QueryConfig) (*QueryResult, error) {
	totalStart := time.Now()

	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	ctxTimeout, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	refs, rewrittenSQL, err := ParseQueryReferences(query)
	if err != nil {
		return nil, err
	}

	maxRows := cfg.MaxRowsPerTable
	if maxRows <= 0 {
		maxRows = DefaultMaxRowsPerTable
	}
	if maxRows > AbsoluteMaxRowsPerTable {
		maxRows = AbsoluteMaxRowsPerTable
	}

	// Fetch tables in parallel
	results := make([]fetchedTableData, len(refs))
	var wg sync.WaitGroup

	for i, ref := range refs {
		wg.Add(1)
		go func(idx int, r TableRef) {
			defer wg.Done()
			fetchStart := time.Now()

			if !validIdentifier.MatchString(r.Table) {
				results[idx] = fetchedTableData{
					Ref: r,
					Err: fmt.Errorf("invalid table identifier: %q", r.Table),
				}
				return
			}
			if r.Schema != "" && !validIdentifier.MatchString(r.Schema) {
				results[idx] = fetchedTableData{
					Ref: r,
					Err: fmt.Errorf("invalid schema identifier: %q", r.Schema),
				}
				return
			}

			drv, dErr := resolver(ctxTimeout, r.ConnID)
			if dErr != nil || drv == nil {
				if dErr == nil {
					dErr = fmt.Errorf("nil driver returned")
				}
				results[idx] = fetchedTableData{
					Ref: r,
					Err: fmt.Errorf("connection %q resolution failed: %w", r.ConnID, dErr),
				}
				return
			}

			// Query data
			opts := types.QueryOptions{
				Schema: r.Schema,
				Table:  r.Table,
				Limit:  maxRows,
			}
			qr, qErr := drv.QueryTableData(ctxTimeout, opts)
			if qErr != nil {
				// Fallback to simple SELECT query
				targetTable, err := quoteTable(drv.Dialect(), r.Schema, r.Table)
				if err != nil {
					results[idx] = fetchedTableData{
						Ref: r,
						Err: err,
					}
					return
				}
				fallbackSQL := fmt.Sprintf("SELECT * FROM %s LIMIT %d", targetTable, maxRows)
				qr, qErr = drv.ExecuteQuery(ctxTimeout, fallbackSQL)
				if qErr != nil {
					results[idx] = fetchedTableData{
						Ref: r,
						Err: fmt.Errorf("fetch table %s from [%s] failed: %w", r.Table, r.ConnID, qErr),
					}
					return
				}
			}

			results[idx] = fetchedTableData{
				Ref:       r,
				Columns:   qr.Columns,
				Rows:      qr.Rows,
				RowCount:  len(qr.Rows),
				ElapsedMs: time.Since(fetchStart).Milliseconds(),
			}
		}(i, ref)
	}

	wg.Wait()

	// Check if any fetch failed
	var stats []TableStat
	for _, res := range results {
		if res.Err != nil {
			return nil, res.Err
		}
		stats = append(stats, TableStat{
			ConnID:    res.Ref.ConnID,
			Schema:    res.Ref.Schema,
			Table:     res.Ref.Table,
			TempTable: res.Ref.TempTable,
			RowCount:  res.RowCount,
			ElapsedMs: res.ElapsedMs,
		})
	}

	// Open ephemeral in-memory SQLite
	sqliteDB, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		return nil, fmt.Errorf("ephemeral sqlite init failed: %w", err)
	}
	sqliteDB.SetMaxOpenConns(1)
	defer sqliteDB.Close()

	// Load fetched data into ephemeral tables
	for _, data := range results {
		if len(data.Columns) == 0 {
			continue
		}

		// Build CREATE TABLE
		var colDefs []string
		for _, col := range data.Columns {
			sanitizedCol := strings.ReplaceAll(col, `"`, `""`)
			colDefs = append(colDefs, fmt.Sprintf(`"%s"`, sanitizedCol))
		}
		createSQL := fmt.Sprintf(`CREATE TABLE "%s" (%s);`, data.Ref.TempTable, strings.Join(colDefs, ", "))
		if _, err := sqliteDB.ExecContext(ctxTimeout, createSQL); err != nil {
			return nil, fmt.Errorf("create temp table %s failed: %w", data.Ref.TempTable, err)
		}

		if len(data.Rows) > 0 {
			tx, tErr := sqliteDB.BeginTx(ctxTimeout, nil)
			if tErr != nil {
				return nil, fmt.Errorf("sqlite tx begin failed: %w", tErr)
			}

			placeholders := make([]string, len(data.Columns))
			for p := range placeholders {
				placeholders[p] = "?"
			}
			insertSQL := fmt.Sprintf(`INSERT INTO "%s" VALUES (%s)`, data.Ref.TempTable, strings.Join(placeholders, ", "))
			stmt, sErr := tx.PrepareContext(ctxTimeout, insertSQL)
			if sErr != nil {
				_ = tx.Rollback()
				return nil, fmt.Errorf("prepare insert for %s failed: %w", data.Ref.TempTable, sErr)
			}

			for _, row := range data.Rows {
				vals := make([]interface{}, len(data.Columns))
				for c := range vals {
					if c < len(row) {
						vals[c] = row[c]
					}
				}
				if _, iErr := stmt.ExecContext(ctxTimeout, vals...); iErr != nil {
					_ = stmt.Close()
					_ = tx.Rollback()
					return nil, fmt.Errorf("insert row into %s failed: %w", data.Ref.TempTable, iErr)
				}
			}
			_ = stmt.Close()

			if cErr := tx.Commit(); cErr != nil {
				return nil, fmt.Errorf("sqlite tx commit for %s failed: %w", data.Ref.TempTable, cErr)
			}
		}
	}

	// Execute rewritten federated query in SQLite
	queryStart := time.Now()
	rows, err := sqliteDB.QueryContext(ctxTimeout, rewrittenSQL)
	if err != nil {
		return nil, fmt.Errorf("query execution failed: %w", err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("read query columns failed: %w", err)
	}

	var outputRows [][]interface{}
	for rows.Next() {
		if len(outputRows) >= MaxFederatedResultRows {
			break
		}
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, fmt.Errorf("scan result row failed: %w", err)
		}
		for i, v := range vals {
			if b, ok := v.([]byte); ok {
				vals[i] = string(b)
			}
		}
		outputRows = append(outputRows, vals)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows iteration failed: %w", err)
	}

	totalElapsed := time.Since(totalStart).Milliseconds()
	execElapsed := time.Since(queryStart).Milliseconds()

	// Sort table stats by connection and table name for deterministic output
	sort.Slice(stats, func(i, j int) bool {
		if stats[i].ConnID == stats[j].ConnID {
			return stats[i].Table < stats[j].Table
		}
		return stats[i].ConnID < stats[j].ConnID
	})

	return &QueryResult{
		Result: &types.QueryResult{
			Columns:      cols,
			Rows:         outputRows,
			Elapsed:      execElapsed,
			AffectedRows: int64(len(outputRows)),
		},
		TableStats:   stats,
		RewrittenSQL: rewrittenSQL,
		ElapsedMs:    totalElapsed,
	}, nil
}

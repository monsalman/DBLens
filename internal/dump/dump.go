package dump

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/dblens/dblens/internal/driver/types"
)

// DumpOptions configures database dump generation.
type DumpOptions struct {
	Schema        string   `json:"schema"`
	Tables        []string `json:"tables"`
	IncludeSchema bool     `json:"includeSchema"`
	IncludeData   bool     `json:"includeData"`
	UseGzip       bool     `json:"useGzip"`
}

// RestoreResult holds statistics from a restore execution.
type RestoreResult struct {
	Total    int      `json:"total"`
	Executed int      `json:"executed"`
	Errors   []string `json:"errors"`
}

// TopologicalSort sorts tables so referenced (parent) tables appear before referencing (child) tables.
// Cycles and self-referencing foreign keys are handled gracefully without deadlocks.
func TopologicalSort(tables []string, foreignKeys []types.ForeignKey) []string {
	if len(tables) <= 1 {
		return tables
	}

	// Deduplicate tables while preserving appearance order
	tableSet := make(map[string]bool, len(tables))
	uniqueTables := make([]string, 0, len(tables))
	for _, t := range tables {
		if !tableSet[t] {
			tableSet[t] = true
			uniqueTables = append(uniqueTables, t)
		}
	}

	// Build dependency graph:
	// A foreign key indicates child (fk.Table) references parent (fk.RefTable).
	// Therefore, parent must be restored before child.
	// Directed edge: parent -> child.
	// inDegree counts how many parents a child is waiting for.
	inDegree := make(map[string]int, len(uniqueTables))
	dependents := make(map[string][]string, len(uniqueTables))
	for _, t := range uniqueTables {
		inDegree[t] = 0
		dependents[t] = []string{}
	}

	type edge struct {
		from, to string
	}
	seenEdges := make(map[edge]bool)

	for _, fk := range foreignKeys {
		child := fk.Table
		parent := fk.RefTable
		if child == "" || parent == "" {
			continue
		}
		// Only consider foreign keys where both tables are within our dump set, ignoring self-loops
		if tableSet[child] && tableSet[parent] && child != parent {
			e := edge{from: parent, to: child}
			if !seenEdges[e] {
				seenEdges[e] = true
				dependents[parent] = append(dependents[parent], child)
				inDegree[child]++
			}
		}
	}

	// Ready queue: nodes with inDegree == 0 (no prerequisites)
	ready := make([]string, 0)
	for _, t := range uniqueTables {
		if inDegree[t] == 0 {
			ready = append(ready, t)
		}
	}
	sort.Strings(ready)

	result := make([]string, 0, len(uniqueTables))
	visited := make(map[string]bool, len(uniqueTables))

	for len(ready) > 0 {
		curr := ready[0]
		ready = ready[1:]

		if visited[curr] {
			continue
		}
		visited[curr] = true
		result = append(result, curr)

		for _, dep := range dependents[curr] {
			inDegree[dep]--
			if inDegree[dep] == 0 && !visited[dep] {
				ready = append(ready, dep)
				sort.Strings(ready)
			}
		}
	}

	// If cycles prevented all nodes from being visited, break cycles gracefully
	for len(result) < len(uniqueTables) {
		var best string
		minDeg := -1
		for _, t := range uniqueTables {
			if !visited[t] {
				deg := inDegree[t]
				if minDeg == -1 || deg < minDeg || (deg == minDeg && t < best) {
					minDeg = deg
					best = t
				}
			}
		}

		if best == "" {
			break
		}

		visited[best] = true
		result = append(result, best)

		for _, dep := range dependents[best] {
			inDegree[dep]--
			if inDegree[dep] == 0 && !visited[dep] {
				ready = append(ready, dep)
				sort.Strings(ready)
			}
		}

		for len(ready) > 0 {
			curr := ready[0]
			ready = ready[1:]
			if visited[curr] {
				continue
			}
			visited[curr] = true
			result = append(result, curr)

			for _, dep := range dependents[curr] {
				inDegree[dep]--
				if inDegree[dep] == 0 && !visited[dep] {
					ready = append(ready, dep)
					sort.Strings(ready)
				}
			}
		}
	}

	return result
}

// GenerateDump streams a complete logical backup to w.
func GenerateDump(ctx context.Context, drv types.Driver, w io.Writer, opts DumpOptions) error {
	dialect := strings.ToLower(drv.Dialect())

	var gw *gzip.Writer
	outWriter := w
	if opts.UseGzip {
		gw = gzip.NewWriter(w)
		defer gw.Close()
		outWriter = gw
	}

	// 1. Resolve tables
	tables := opts.Tables
	if len(tables) == 0 {
		allTables, err := drv.InspectTables(ctx, opts.Schema)
		if err != nil {
			return fmt.Errorf("failed to inspect tables: %w", err)
		}
		for _, t := range allTables {
			if t.Type == "table" || t.Type == "" {
				tables = append(tables, t.Name)
			}
		}
	}

	// 2. Fetch foreign keys for topological sorting
	var allFKs []types.ForeignKey
	for _, t := range tables {
		detail, err := drv.InspectTableDetails(ctx, opts.Schema, t)
		if err == nil && detail != nil {
			for _, fk := range detail.FKs {
				fk.Table = t
				allFKs = append(allFKs, fk)
			}
		}
	}

	sortedTables := TopologicalSort(tables, allFKs)

	// 3. Emit Header & Dialect safety pragmas
	nowStr := time.Now().UTC().Format(time.RFC3339)
	if _, err := fmt.Fprintf(outWriter, "-- --------------------------------------------------------\n-- DBLens Database Dump\n-- Dialect: %s\n-- Dumped at: %s\n-- --------------------------------------------------------\n\n", drv.Dialect(), nowStr); err != nil {
		return err
	}

	if isPostgres(dialect) {
		if _, err := fmt.Fprintf(outWriter, "SET session_replication_role = 'replica';\nSET standard_conforming_strings = on;\nSET client_encoding = 'UTF8';\n\n"); err != nil {
			return err
		}
	} else if isMySQL(dialect) {
		if _, err := fmt.Fprintf(outWriter, "SET FOREIGN_KEY_CHECKS = 0;\nSET NAMES utf8mb4;\n\n"); err != nil {
			return err
		}
	} else if isSQLite(dialect) {
		if _, err := fmt.Fprintf(outWriter, "PRAGMA foreign_keys = OFF;\n\n"); err != nil {
			return err
		}
	}

	// 4. Emit DDL (schema)
	if opts.IncludeSchema {
		for _, t := range sortedTables {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			ddl, err := drv.GenerateTableDDL(ctx, opts.Schema, t)
			if err != nil {
				return fmt.Errorf("failed to generate DDL for table %s: %w", t, err)
			}
			ddl = strings.TrimSpace(ddl)
			if !strings.HasSuffix(ddl, ";") {
				ddl += ";"
			}
			cleanTable := strings.ReplaceAll(strings.ReplaceAll(t, "\n", " "), "\r", " ")
			if _, err := fmt.Fprintf(outWriter, "--\n-- Table structure for table %s\n--\n\n%s\n\n", quoteIdentifier(dialect, cleanTable), ddl); err != nil {
				return err
			}
		}
	}

	// 5. Emit Data (inserts)
	if opts.IncludeData {
		for _, t := range sortedTables {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if err := dumpTableData(ctx, drv, outWriter, dialect, opts.Schema, t); err != nil {
				return fmt.Errorf("failed to dump data for table %s: %w", t, err)
			}
		}
	}

	// 6. Emit Footer pragmas
	if isPostgres(dialect) {
		if _, err := fmt.Fprintf(outWriter, "\nSET session_replication_role = 'origin';\n"); err != nil {
			return err
		}
	} else if isMySQL(dialect) {
		if _, err := fmt.Fprintf(outWriter, "\nSET FOREIGN_KEY_CHECKS = 1;\n"); err != nil {
			return err
		}
	} else if isSQLite(dialect) {
		if _, err := fmt.Fprintf(outWriter, "\nPRAGMA foreign_keys = ON;\n"); err != nil {
			return err
		}
	}

	if gw != nil {
		if err := gw.Close(); err != nil {
			return fmt.Errorf("failed to close gzip stream: %w", err)
		}
		gw = nil
	}

	return nil
}

func dumpTableData(ctx context.Context, drv types.Driver, w io.Writer, dialect, schema, table string) error {
	rows, err := drv.QueryTableStream(ctx, schema, table)
	if err != nil {
		return err
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return err
	}
	if len(cols) == 0 {
		return nil
	}

	quotedCols := make([]string, len(cols))
	for i, c := range cols {
		quotedCols[i] = quoteIdentifier(dialect, c)
	}
	colsPart := strings.Join(quotedCols, ", ")

	var targetTable string
	if schema != "" && schema != "public" && schema != "main" {
		targetTable = fmt.Sprintf("%s.%s", quoteIdentifier(dialect, schema), quoteIdentifier(dialect, table))
	} else {
		targetTable = quoteIdentifier(dialect, table)
	}

	colVals := make([]interface{}, len(cols))
	colPointers := make([]interface{}, len(cols))
	for i := range colVals {
		colPointers[i] = &colVals[i]
	}

	const batchSize = 100
	var batchRows []string
	hasWrittenHeader := false

	flushBatch := func() error {
		if len(batchRows) == 0 {
			return nil
		}
		if !hasWrittenHeader {
			cleanTable := strings.ReplaceAll(strings.ReplaceAll(table, "\n", " "), "\r", " ")
			if _, err := fmt.Fprintf(w, "--\n-- Dumping data for table %s\n--\n\n", quoteIdentifier(dialect, cleanTable)); err != nil {
				return err
			}
			hasWrittenHeader = true
		}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("INSERT INTO %s (%s) VALUES\n", targetTable, colsPart))
		for i, rowStr := range batchRows {
			sb.WriteString("  ")
			sb.WriteString(rowStr)
			if i < len(batchRows)-1 {
				sb.WriteString(",\n")
			} else {
				sb.WriteString(";\n\n")
			}
		}
		batchRows = batchRows[:0]
		_, err := io.WriteString(w, sb.String())
		return err
	}

	for rows.Next() {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := rows.Scan(colPointers...); err != nil {
			return err
		}

		formattedVals := make([]string, len(cols))
		for i, val := range colVals {
			formattedVals[i] = FormatSQLValue(dialect, val)
		}

		rowStr := "(" + strings.Join(formattedVals, ", ") + ")"
		batchRows = append(batchRows, rowStr)

		if len(batchRows) >= batchSize {
			if err := flushBatch(); err != nil {
				return err
			}
		}
	}

	if err := rows.Err(); err != nil {
		return err
	}

	return flushBatch()
}

// RestoreDump restores SQL statements from reader r to the database.
func RestoreDump(ctx context.Context, drv types.Driver, r io.Reader) (RestoreResult, error) {
	result := RestoreResult{
		Errors: []string{},
	}

	br := bufio.NewReader(r)
	magic, err := br.Peek(2)
	var reader io.Reader = br
	if err == nil && len(magic) >= 2 && magic[0] == 0x1f && magic[1] == 0x8b {
		gzr, err := gzip.NewReader(br)
		if err != nil {
			return result, fmt.Errorf("failed to open gzip reader: %w", err)
		}
		defer gzr.Close()
		reader = gzr
	}

	const maxRestoreBytes = 250 << 20 // 250MB
	limitedReader := io.LimitReader(reader, maxRestoreBytes+1)
	content, err := io.ReadAll(limitedReader)
	if err != nil {
		return result, fmt.Errorf("failed to read restore data: %w", err)
	}
	if int64(len(content)) > maxRestoreBytes {
		return result, fmt.Errorf("decompressed dump exceeds maximum limit of 250MB")
	}

	stmts := SplitSQLStatements(string(content))
	for _, stmt := range stmts {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		trimmed := strings.TrimSpace(stmt)
		if trimmed == "" {
			continue
		}
		result.Total++
		_, err := drv.ExecuteRaw(ctx, trimmed)
		if err != nil {
			if len(result.Errors) < 100 {
				result.Errors = append(result.Errors, fmt.Sprintf("statement %d: %s", result.Total, err.Error()))
			} else if len(result.Errors) == 100 {
				result.Errors = append(result.Errors, "...additional errors omitted")
			}
		} else {
			result.Executed++
		}
	}

	return result, nil
}

// SplitSQLStatements parses raw SQL into distinct statements, respecting quotes, dollar quotes, and comments.
func SplitSQLStatements(sql string) []string {
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

		if (r == '-' && next == '-') || (r == '#' && next == ' ') {
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

func isIdentStart(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == '_'
}

func isIdentPart(r rune) bool {
	return isIdentStart(r) || (r >= '0' && r <= '9')
}

// FormatSQLValue formats and escapes a value for SQL statements.
func FormatSQLValue(dialect string, val interface{}) string {
	if val == nil {
		return "NULL"
	}
	escapeStr := func(s string) string {
		if isMySQL(dialect) {
			s = strings.ReplaceAll(s, `\`, `\\`)
		}
		return "'" + strings.ReplaceAll(s, "'", "''") + "'"
	}
	switch v := val.(type) {
	case []byte:
		if utf8.Valid(v) && !bytes.ContainsRune(v, 0) {
			return escapeStr(string(v))
		}
		if isPostgres(dialect) {
			return fmt.Sprintf("decode('%x', 'hex')", v)
		}
		return fmt.Sprintf("X'%X'", v)
	case string:
		return escapeStr(v)
	case time.Time:
		return "'" + v.Format("2006-01-02 15:04:05.999999") + "'"
	case bool:
		if v {
			return "TRUE"
		}
		return "FALSE"
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return fmt.Sprintf("%d", v)
	case float32:
		if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
			return "NULL"
		}
		return strconv.FormatFloat(float64(v), 'g', -1, 32)
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return "NULL"
		}
		return strconv.FormatFloat(v, 'g', -1, 64)
	default:
		return escapeStr(fmt.Sprintf("%v", v))
	}
}

func quoteIdentifier(dialect, s string) string {
	if isMySQL(dialect) {
		return "`" + strings.ReplaceAll(s, "`", "``") + "`"
	}
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func isPostgres(d string) bool {
	return strings.Contains(d, "postgres") || strings.Contains(d, "pg")
}

func isMySQL(d string) bool {
	return strings.Contains(d, "mysql") || strings.Contains(d, "mariadb")
}

func isSQLite(d string) bool {
	return strings.Contains(d, "sqlite")
}

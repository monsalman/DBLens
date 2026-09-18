package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/driver/params"
	"github.com/dblens/dblens/internal/driver/types"
	"github.com/dblens/dblens/internal/explain"
	_ "modernc.org/sqlite"
)

type SQLiteDriver struct {
	db *sql.DB
}

func New(dsn string) (*SQLiteDriver, error) {
	cleanDSN := strings.TrimPrefix(dsn, "sqlite://")
	cleanDSN = strings.TrimPrefix(cleanDSN, "file:")
	db, err := sql.Open("sqlite", cleanDSN)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return &SQLiteDriver{db: db}, nil
}

func (s *SQLiteDriver) Dialect() string {
	return "sqlite"
}

func (s *SQLiteDriver) Ping(ctx context.Context) error {
	ctxTimeout, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return s.db.PingContext(ctxTimeout)
}

func (s *SQLiteDriver) Close() error {
	return s.db.Close()
}

func (s *SQLiteDriver) InspectDatabases(ctx context.Context) ([]string, error) {
	return []string{"main"}, nil
}

func (s *SQLiteDriver) SelectDatabase(ctx context.Context, dbName string) error {
	return nil
}

func (s *SQLiteDriver) InspectSchemas(ctx context.Context) ([]string, error) {
	return []string{"main"}, nil
}

func (s *SQLiteDriver) InspectTables(ctx context.Context, schema string) ([]types.TableMeta, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	query := `
		SELECT name, type 
		FROM sqlite_master 
		WHERE type IN ('table', 'view') 
		  AND name NOT LIKE 'sqlite_%'
		ORDER BY name;
	`
	rows, err := s.db.QueryContext(ctxTimeout, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []types.TableMeta
	for rows.Next() {
		var t types.TableMeta
		t.Schema = "main"
		if err := rows.Scan(&t.Name, &t.Type); err != nil {
			return nil, err
		}
		tables = append(tables, t)
	}
	return tables, nil
}

func (s *SQLiteDriver) InspectTableDetails(ctx context.Context, schema, table string) (*types.TableDetail, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	detail := &types.TableDetail{
		Name:    table,
		Schema:  "main",
		Dialect: "sqlite",
		Columns: []types.ColumnMeta{},
		FKs:     []types.ForeignKey{},
		Indexes: []types.IndexMeta{},
	}

	pragmaQuery := fmt.Sprintf("PRAGMA table_info(%s);", quoteIdent(table))
	rows, err := s.db.QueryContext(ctxTimeout, pragmaQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var pkCols []string
	for rows.Next() {
		var cid int
		var name, dType string
		var notNull, pk int
		var dfltVal sql.NullString

		if err := rows.Scan(&cid, &name, &dType, &notNull, &dfltVal, &pk); err != nil {
			return nil, err
		}
		col := types.ColumnMeta{
			Name:       name,
			Type:       dType,
			DataType:   dType,
			IsNullable: (notNull == 0),
			IsPrimary:  (pk > 0),
		}
		if pk > 0 {
			pkCols = append(pkCols, name)
		}
		if dfltVal.Valid {
			col.Default = &dfltVal.String
		}
		detail.Columns = append(detail.Columns, col)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	fkPragma := fmt.Sprintf("PRAGMA foreign_key_list(%s);", quoteIdent(table))
	fkRows, err := s.db.QueryContext(ctxTimeout, fkPragma)
	if err == nil {
		defer fkRows.Close()
		for fkRows.Next() {
			var id, seq int
			var refTable, fromCol, toCol, onUpdate, onDelete, match string
			if err := fkRows.Scan(&id, &seq, &refTable, &fromCol, &toCol, &onUpdate, &onDelete, &match); err == nil {
				detail.FKs = append(detail.FKs, types.ForeignKey{
					Name:      fmt.Sprintf("fk_%s_%d", table, id),
					Column:    fromCol,
					RefTable:  refTable,
					RefColumn: toCol,
					OnUpdate:  onUpdate,
					OnDelete:  onDelete,
				})
			}
		}
		fkRows.Close()

		fkCols := make(map[string]bool)
		for _, fk := range detail.FKs {
			fkCols[fk.Column] = true
		}
		for i := range detail.Columns {
			if fkCols[detail.Columns[i].Name] {
				detail.Columns[i].IsForeignKey = true
			}
		}
	}

	type rawIndex struct {
		name   string
		unique int
		origin string
	}
	var rawIndexes []rawIndex

	idxPragma := fmt.Sprintf("PRAGMA index_list(%s);", quoteIdent(table))
	idxRows, err := s.db.QueryContext(ctxTimeout, idxPragma)
	if err == nil {
		defer idxRows.Close()
		for idxRows.Next() {
			var seq int
			var idxName string
			var unique int
			var origin string
			var partial int
			if err := idxRows.Scan(&seq, &idxName, &unique, &origin, &partial); err == nil {
				rawIndexes = append(rawIndexes, rawIndex{name: idxName, unique: unique, origin: origin})
			}
		}
		idxRows.Close()
	}

	for _, raw := range rawIndexes {
		var cols []string
		infoPragma := fmt.Sprintf("PRAGMA index_info(%s);", quoteIdent(raw.name))
		infoRows, iErr := s.db.QueryContext(ctxTimeout, infoPragma)
		if iErr == nil {
			for infoRows.Next() {
				var seqno, cid int
				var colName string
				if err := infoRows.Scan(&seqno, &cid, &colName); err == nil {
					cols = append(cols, colName)
				}
			}
			infoRows.Close()
		}
		detail.Indexes = append(detail.Indexes, types.IndexMeta{
			Name:      raw.name,
			Columns:   cols,
			IsUnique:  raw.unique == 1,
			IsPrimary: raw.origin == "pk",
			Type:      "BTREE",
		})
	}

	if len(pkCols) > 0 {
		hasPKIndex := false
		for _, idx := range detail.Indexes {
			if idx.IsPrimary {
				hasPKIndex = true
				break
			}
		}
		if !hasPKIndex {
			detail.Indexes = append([]types.IndexMeta{{
				Name:      fmt.Sprintf("pk_%s", table),
				Columns:   pkCols,
				IsUnique:  true,
				IsPrimary: true,
				Type:      "BTREE",
			}}, detail.Indexes...)
		}
	}

	// Determine FK cardinality: 1:1 if referencing column is single-column PK or has single-column UNIQUE index
	uniqueCols := make(map[string]bool)
	if len(pkCols) == 1 {
		uniqueCols[pkCols[0]] = true
	}
	for _, idx := range detail.Indexes {
		if idx.IsUnique && len(idx.Columns) == 1 {
			uniqueCols[idx.Columns[0]] = true
		}
	}
	for i := range detail.FKs {
		if uniqueCols[detail.FKs[i].Column] {
			detail.FKs[i].Cardinality = "1:1"
		} else {
			detail.FKs[i].Cardinality = "1:N"
		}
	}

	if ddl, err := s.GenerateTableDDL(ctx, schema, table); err == nil {
		detail.DDL = ddl
	}

	return detail, nil
}

func (s *SQLiteDriver) GenerateTableDDL(ctx context.Context, schema, table string) (string, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	query := `SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('table', 'index', 'view') AND sql IS NOT NULL ORDER BY CASE WHEN type = 'table' THEN 0 WHEN type = 'view' THEN 1 ELSE 2 END;`
	rows, err := s.db.QueryContext(ctxTimeout, query, table)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	var stmts []string
	for rows.Next() {
		var sqlText string
		if err := rows.Scan(&sqlText); err != nil {
			return "", err
		}
		trimmed := strings.TrimSpace(sqlText)
		if trimmed != "" {
			trimmed = strings.TrimRight(trimmed, ";") + ";"
			stmts = append(stmts, trimmed)
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if len(stmts) == 0 {
		return "", fmt.Errorf("table not found: %s", table)
	}

	return strings.Join(stmts, "\n\n"), nil
}

func quoteIdent(s string) string {
	return "`" + strings.ReplaceAll(s, "`", "``") + "`"
}

// BuildQuerySQL constructs the SELECT query and parameter slice from QueryOptions for SQLite.
func BuildQuerySQL(opts types.QueryOptions) (string, []interface{}) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 500
	}
	if opts.Offset < 0 {
		opts.Offset = 0
	}

	var sb strings.Builder
	var args []interface{}

	sb.WriteString(fmt.Sprintf("SELECT * FROM %s", quoteIdent(opts.Table)))

	var validFilters []types.Filter
	for _, f := range opts.Filters {
		col := strings.TrimSpace(f.Column)
		if col == "" || col == "*" {
			continue
		}
		validFilters = append(validFilters, f)
	}

	if len(validFilters) > 0 {
		sb.WriteString(" WHERE ")
		for i, f := range validFilters {
			if i > 0 {
				sb.WriteString(" AND ")
			}
			col := quoteIdent(strings.TrimSpace(f.Column))
			switch strings.ToUpper(f.Operator) {
			case "=", "!=", ">", "<", ">=", "<=":
				sb.WriteString(fmt.Sprintf("%s %s ?", col, f.Operator))
				args = append(args, f.Value)
			case "LIKE", "ILIKE":
				sb.WriteString(fmt.Sprintf("%s LIKE ?", col))
				args = append(args, "%"+f.Value+"%")
			case "IS NULL":
				sb.WriteString(fmt.Sprintf("%s IS NULL", col))
			case "IS NOT NULL":
				sb.WriteString(fmt.Sprintf("%s IS NOT NULL", col))
			default:
				sb.WriteString(fmt.Sprintf("%s = ?", col))
				args = append(args, f.Value)
			}
		}
	}

	if opts.OrderBy != "" {
		dir := "ASC"
		if strings.EqualFold(strings.TrimSpace(opts.OrderDir), "DESC") {
			dir = "DESC"
		}
		sb.WriteString(fmt.Sprintf(" ORDER BY %s %s", quoteIdent(opts.OrderBy), dir))
	}

	sb.WriteString(" LIMIT ? OFFSET ?")
	args = append(args, opts.Limit, opts.Offset)

	return sb.String(), args
}

func (s *SQLiteDriver) QueryTableData(ctx context.Context, opts types.QueryOptions) (*types.QueryResult, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	sqlStr, args := BuildQuerySQL(opts)
	start := time.Now()
	rows, err := s.db.QueryContext(ctxTimeout, sqlStr, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	var resultRows [][]interface{}
	for rows.Next() {
		colVals := make([]interface{}, len(cols))
		colPointers := make([]interface{}, len(cols))
		for i := range colVals {
			colPointers[i] = &colVals[i]
		}
		if err := rows.Scan(colPointers...); err != nil {
			return nil, err
		}
		for i, v := range colVals {
			if b, ok := v.([]byte); ok {
				colVals[i] = string(b)
			}
		}
		resultRows = append(resultRows, colVals)
	}
	elapsed := time.Since(start).Milliseconds()

	return &types.QueryResult{
		Columns:      cols,
		Rows:         resultRows,
		Elapsed:      elapsed,
		AffectedRows: int64(len(resultRows)),
	}, nil
}

func (s *SQLiteDriver) QueryTableStream(ctx context.Context, schema, table string) (*sql.Rows, error) {
	var targetTable string
	if schema != "" && schema != "main" {
		targetTable = fmt.Sprintf("%s.%s", quoteIdent(schema), quoteIdent(table))
	} else {
		targetTable = quoteIdent(table)
	}
	query := fmt.Sprintf("SELECT * FROM %s", targetTable)
	return s.db.QueryContext(ctx, query)
}

func (s *SQLiteDriver) ExecuteQuery(ctx context.Context, rawSql string) (*types.QueryResult, error) {
	return s.ExecuteQueryWithParams(ctx, rawSql, nil)
}

func (s *SQLiteDriver) ExecuteQueryWithParams(ctx context.Context, rawSql string, queryParams map[string]interface{}) (*types.QueryResult, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	start := time.Now()
	trimmed := strings.TrimSpace(rawSql)

	compiledSql := trimmed
	var args []interface{}
	var err error
	if queryParams != nil || strings.Contains(trimmed, ":") || strings.Contains(trimmed, "{{") {
		compiledSql, args, err = params.CompileNamedParams(s.Dialect(), trimmed, queryParams)
		if err != nil {
			return nil, err
		}
	}

	upper := strings.ToUpper(compiledSql)

	if strings.HasPrefix(upper, "SELECT") || strings.HasPrefix(upper, "EXPLAIN") || strings.HasPrefix(upper, "PRAGMA") {
		rows, err := s.db.QueryContext(ctxTimeout, compiledSql, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		cols, err := rows.Columns()
		if err != nil {
			return nil, err
		}

		var resultRows [][]interface{}
		for rows.Next() {
			colVals := make([]interface{}, len(cols))
			colPointers := make([]interface{}, len(cols))
			for i := range colVals {
				colPointers[i] = &colVals[i]
			}
			if err := rows.Scan(colPointers...); err != nil {
				return nil, err
			}
			for i, v := range colVals {
				if b, ok := v.([]byte); ok {
					colVals[i] = string(b)
				}
			}
			resultRows = append(resultRows, colVals)
		}
		elapsed := time.Since(start).Milliseconds()
		return &types.QueryResult{
			Columns:      cols,
			Rows:         resultRows,
			Elapsed:      elapsed,
			AffectedRows: int64(len(resultRows)),
		}, nil
	}

	res, err := s.db.ExecContext(ctxTimeout, compiledSql, args...)
	if err != nil {
		return nil, err
	}
	affected, _ := res.RowsAffected()
	elapsed := time.Since(start).Milliseconds()

	return &types.QueryResult{
		Columns:      []string{},
		Rows:         [][]interface{}{},
		Elapsed:      elapsed,
		AffectedRows: affected,
	}, nil
}

func (s *SQLiteDriver) MutateRow(ctx context.Context, mut types.Mutation) (*types.MutationResult, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	targetTable := quoteIdent(mut.Table)
	var sqlStr string
	var args []interface{}

	switch mut.Type {
	case types.MutationInsert:
		var cols []string
		var placeholders []string
		for col, val := range mut.Data {
			cols = append(cols, quoteIdent(col))
			placeholders = append(placeholders, "?")
			args = append(args, val)
		}
		if len(cols) == 0 {
			return nil, fmt.Errorf("no columns provided for INSERT")
		}
		sqlStr = fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", targetTable, strings.Join(cols, ", "), strings.Join(placeholders, ", "))

	case types.MutationUpdate:
		var sets []string
		for col, val := range mut.Data {
			sets = append(sets, fmt.Sprintf("%s = ?", quoteIdent(col)))
			args = append(args, val)
		}
		var wheres []string
		for col, val := range mut.Where {
			wheres = append(wheres, fmt.Sprintf("%s = ?", quoteIdent(col)))
			args = append(args, val)
		}
		if len(sets) == 0 {
			return nil, fmt.Errorf("no columns provided for UPDATE")
		}
		if len(wheres) == 0 {
			return nil, fmt.Errorf("WHERE clause required for UPDATE")
		}
		sqlStr = fmt.Sprintf("UPDATE %s SET %s WHERE %s", targetTable, strings.Join(sets, ", "), strings.Join(wheres, " AND "))

	case types.MutationDelete:
		var wheres []string
		for col, val := range mut.Where {
			wheres = append(wheres, fmt.Sprintf("%s = ?", quoteIdent(col)))
			args = append(args, val)
		}
		if len(wheres) == 0 {
			return nil, fmt.Errorf("WHERE clause required for DELETE")
		}
		sqlStr = fmt.Sprintf("DELETE FROM %s WHERE %s", targetTable, strings.Join(wheres, " AND "))

	default:
		return nil, fmt.Errorf("unsupported mutation type: %s", mut.Type)
	}

	res, err := s.db.ExecContext(ctxTimeout, sqlStr, args...)
	if err != nil {
		return &types.MutationResult{GeneratedSQL: sqlStr}, err
	}
	affected, _ := res.RowsAffected()

	return &types.MutationResult{
		AffectedRows: affected,
		GeneratedSQL: sqlStr,
	}, nil
}

// BuildBatchInsertSQL constructs the parameterized INSERT statement and args for SQLite.
func BuildBatchInsertSQL(schema, table string, rows []map[string]interface{}) (string, []interface{}, error) {
	if len(rows) == 0 {
		return "", nil, fmt.Errorf("no rows provided for batch insert")
	}

	colSet := make(map[string]struct{})
	for _, row := range rows {
		for col := range row {
			colSet[col] = struct{}{}
		}
	}
	if len(colSet) == 0 {
		return "", nil, fmt.Errorf("no columns found in rows")
	}
	cols := make([]string, 0, len(colSet))
	for col := range colSet {
		cols = append(cols, col)
	}
	sort.Strings(cols)

	quotedCols := make([]string, len(cols))
	for i, c := range cols {
		quotedCols[i] = quoteIdent(c)
	}

	var targetTable string
	if schema != "" && schema != "main" {
		targetTable = fmt.Sprintf("%s.%s", quoteIdent(schema), quoteIdent(table))
	} else {
		targetTable = quoteIdent(table)
	}

	var valPlaceholders []string
	var args []interface{}
	for _, row := range rows {
		var rowPlaceholders []string
		for _, col := range cols {
			rowPlaceholders = append(rowPlaceholders, "?")
			args = append(args, row[col])
		}
		valPlaceholders = append(valPlaceholders, fmt.Sprintf("(%s)", strings.Join(rowPlaceholders, ", ")))
	}

	sqlStr := fmt.Sprintf("INSERT INTO %s (%s) VALUES %s",
		targetTable,
		strings.Join(quotedCols, ", "),
		strings.Join(valPlaceholders, ", "),
	)
	return sqlStr, args, nil
}

func (s *SQLiteDriver) BatchInsert(ctx context.Context, schema, table string, rows []map[string]interface{}) (*types.MutationResult, error) {
	if len(rows) == 0 {
		return nil, fmt.Errorf("no rows provided for batch insert")
	}

	colSet := make(map[string]struct{})
	for _, row := range rows {
		for col := range row {
			colSet[col] = struct{}{}
		}
	}
	if len(colSet) == 0 {
		return nil, fmt.Errorf("no columns found in rows")
	}
	cols := make([]string, 0, len(colSet))
	for col := range colSet {
		cols = append(cols, col)
	}
	sort.Strings(cols)

	// SQLite parameter limit: if rows * cols exceeds 500 parameters, batch into chunks within same transaction
	maxParams := 500
	chunkSize := maxParams / len(cols)
	if chunkSize < 1 {
		chunkSize = 1
	}

	ctxTimeout, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	tx, err := s.db.BeginTx(ctxTimeout, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var totalAffected int64
	var lastSQL string

	for i := 0; i < len(rows); i += chunkSize {
		end := i + chunkSize
		if end > len(rows) {
			end = len(rows)
		}
		chunkRows := rows[i:end]

		sqlStr, args, err := BuildBatchInsertSQL(schema, table, chunkRows)
		if err != nil {
			return nil, err
		}
		lastSQL = sqlStr

		res, err := tx.ExecContext(ctxTimeout, sqlStr, args...)
		if err != nil {
			return &types.MutationResult{GeneratedSQL: sqlStr}, err
		}
		aff, _ := res.RowsAffected()
		totalAffected += aff
	}

	if err := tx.Commit(); err != nil {
		return &types.MutationResult{GeneratedSQL: lastSQL}, err
	}

	return &types.MutationResult{
		AffectedRows: totalAffected,
		GeneratedSQL: lastSQL,
	}, nil
}

func (s *SQLiteDriver) GetERDData(ctx context.Context) ([]types.ERDTable, error) {
	tables, err := s.InspectTables(ctx, "main")
	if err != nil {
		return nil, err
	}

	var erd []types.ERDTable
	for _, t := range tables {
		details, err := s.InspectTableDetails(ctx, "main", t.Name)
		if err != nil {
			continue
		}
		erd = append(erd, types.ERDTable{
			Name:    t.Name,
			Schema:  "main",
			Columns: details.Columns,
			FKs:     details.FKs,
		})
	}

	for i := range erd {
		for j := range erd[i].FKs {
			if erd[i].FKs[j].Cardinality == "" {
				erd[i].FKs[j].Cardinality = "1:N"
			}
		}
	}

	return erd, nil
}

func (s *SQLiteDriver) ExplainQuery(ctx context.Context, rawSql string, opts types.ExplainOptions) (*types.ExplainResult, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	trimmed := strings.TrimSpace(rawSql)
	trimmed = strings.TrimRight(trimmed, ";")
	if trimmed == "" {
		return nil, fmt.Errorf("query cannot be empty")
	}

	explainSQL := fmt.Sprintf("EXPLAIN QUERY PLAN %s;", trimmed)
	rows, err := s.db.QueryContext(ctxTimeout, explainSQL)
	if err != nil {
		return nil, fmt.Errorf("sqlite explain error: %w", err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("sqlite explain columns error: %w", err)
	}

	var parsedRows []explain.SQLiteRow
	for rows.Next() {
		var id, parent, notused int
		var detail string

		if len(cols) == 4 {
			if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
				return nil, err
			}
		} else if len(cols) == 3 {
			if err := rows.Scan(&id, &parent, &detail); err != nil {
				return nil, err
			}
		} else {
			vals := make([]interface{}, len(cols))
			ptrs := make([]interface{}, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				return nil, err
			}
			if len(vals) > 0 {
				id = toSQLiteInt(vals[0])
			}
			if len(vals) > 1 {
				parent = toSQLiteInt(vals[1])
			}
			if len(vals) > 2 {
				detail = fmt.Sprintf("%v", vals[len(vals)-1])
			}
		}

		parsedRows = append(parsedRows, explain.SQLiteRow{
			ID:      id,
			Parent:  parent,
			NotUsed: notused,
			Detail:  detail,
		})
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return explain.ParseSQLite(parsedRows)
}

func toSQLiteInt(v interface{}) int {
	switch val := v.(type) {
	case int64:
		return int(val)
	case int:
		return val
	case float64:
		return int(val)
	default:
		return 0
	}
}

func (s *SQLiteDriver) InspectProcesses(ctx context.Context) ([]types.ProcessInfo, error) {
	return []types.ProcessInfo{
		{
			ID:       "1",
			User:     "sqlite",
			Database: "main",
			Host:     "embedded",
			Time:     0,
			State:    "idle",
			Query:    "",
			Command:  "in-process",
		},
	}, nil
}

func (s *SQLiteDriver) KillProcess(ctx context.Context, id string) error {
	return fmt.Errorf("killing processes is not supported for sqlite (in-process database)")
}

func (s *SQLiteDriver) InspectHealth(ctx context.Context) (*types.HealthReport, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	report := &types.HealthReport{
		Tables:          []types.TableStorageStat{},
		UnusedIndexes:   []types.UnusedIndexStat{},
		Recommendations: []types.RemediationAction{},
		CacheHitRatio:   100.0,
	}

	// 1. Page count, page size, freelist count
	var pageCount, pageSize, freelistCount int64
	_ = s.db.QueryRowContext(ctxTimeout, "PRAGMA page_count;").Scan(&pageCount)
	_ = s.db.QueryRowContext(ctxTimeout, "PRAGMA page_size;").Scan(&pageSize)
	_ = s.db.QueryRowContext(ctxTimeout, "PRAGMA freelist_count;").Scan(&freelistCount)

	totalDbBytes := pageCount * pageSize
	freeBytes := freelistCount * pageSize
	report.DatabaseSizeBytes = totalDbBytes
	report.DatabaseSize = types.FormatBytes(totalDbBytes)
	report.DeadTuples = freelistCount

	if pageCount > 0 {
		ratio := (1.0 - (float64(freelistCount) / float64(pageCount))) * 100.0
		if ratio < 0 {
			ratio = 0
		}
		if ratio > 100 {
			ratio = 100
		}
		report.CacheHitRatio = math.Round(ratio*10) / 10
	}

	// 2. Tables and row counts
	tableNamesRows, err := s.db.QueryContext(ctxTimeout, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC;")
	if err != nil {
		return nil, fmt.Errorf("failed to list tables: %w", err)
	}
	defer tableNamesRows.Close()

	var tableNames []string
	for tableNamesRows.Next() {
		var name string
		if err := tableNamesRows.Scan(&name); err == nil {
			tableNames = append(tableNames, name)
		}
	}
	tableNamesRows.Close()

	report.TotalTables = len(tableNames)
	totalIndexes := 0

	for _, name := range tableNames {
		var rowCount int64
		_ = s.db.QueryRowContext(ctxTimeout, fmt.Sprintf("SELECT count(*) FROM %s;", quoteIdent(name))).Scan(&rowCount)

		// Try dbstat for accurate size, fallback to rough estimate
		var tableBytes int64
		if err := s.db.QueryRowContext(ctxTimeout, "SELECT coalesce(sum(pgsize), 0) FROM dbstat WHERE name = ?;", name).Scan(&tableBytes); err != nil || tableBytes == 0 {
			if len(tableNames) > 0 {
				tableBytes = (totalDbBytes - freeBytes) / int64(len(tableNames))
			}
		}

		// Count indexes for this table
		idxCount := 0
		if idxRows, err := s.db.QueryContext(ctxTimeout, fmt.Sprintf("PRAGMA index_list(%s);", quoteIdent(name))); err == nil {
			for idxRows.Next() {
				idxCount++
			}
			idxRows.Close()
		}
		totalIndexes += idxCount

		stat := types.TableStorageStat{
			Schema:         "main",
			Table:          name,
			TotalBytes:     tableBytes,
			DataBytes:      tableBytes,
			IndexBytes:     0,
			TotalSize:      types.FormatBytes(tableBytes),
			DataSize:       types.FormatBytes(tableBytes),
			IndexSize:      "0 B",
			RowCount:       rowCount,
			DeadTuples:     0,
			RemediationSQL: fmt.Sprintf("ANALYZE %s;", quoteIdent(name)),
		}
		report.Tables = append(report.Tables, stat)
	}

	report.TotalIndexes = totalIndexes

	// 3. Recommendations
	recID := 1
	if freelistCount > 0 {
		severity := "info"
		if freeBytes > 1024*1024 || freelistCount > 100 {
			severity = "warning"
		}
		report.Recommendations = append(report.Recommendations, types.RemediationAction{
			ID:          fmt.Sprintf("rec-%d", recID),
			Title:       "Reclaim Disk Space with VACUUM",
			Description: fmt.Sprintf("SQLite has %d unused pages in freelist (%s). VACUUM defragments the database and shrinks the file size.", freelistCount, types.FormatBytes(freeBytes)),
			Severity:    severity,
			Category:    "bloat",
			SQL:         "VACUUM;",
		})
		recID++
	}

	report.Recommendations = append(report.Recommendations, types.RemediationAction{
		ID:          fmt.Sprintf("rec-%d", recID),
		Title:       "Run SQLite Query Optimizer",
		Description: "PRAGMA optimize analyzes table distributions and updates query planner index choices.",
		Severity:    "info",
		Category:    "maintenance",
		SQL:         "PRAGMA optimize;",
	})
	recID++

	report.Recommendations = append(report.Recommendations, types.RemediationAction{
		ID:          fmt.Sprintf("rec-%d", recID),
		Title:       "Analyze Database Statistics",
		Description: "Runs ANALYZE across all tables to collect statistical data for query optimization.",
		Severity:    "info",
		Category:    "maintenance",
		SQL:         "ANALYZE;",
	})

	return report, nil
}





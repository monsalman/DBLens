package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
	"github.com/dblens/dblens/internal/explain"
	_ "github.com/go-sql-driver/mysql"
)

type MySQLDriver struct {
	db *sql.DB
}

func New(dsn string) (*MySQLDriver, error) {
	cleanDSN := dsn
	if len(cleanDSN) >= 8 && strings.EqualFold(cleanDSN[:8], "mysql://") {
		cleanDSN = cleanDSN[8:]
	}
	if strings.Contains(cleanDSN, "@") && !strings.Contains(cleanDSN, "(") {
		atIdx := strings.LastIndex(cleanDSN, "@")
		auth := cleanDSN[:atIdx]
		hostAndDb := cleanDSN[atIdx+1:]
		if slashIdx := strings.Index(hostAndDb, "/"); slashIdx != -1 {
			hostPort := hostAndDb[:slashIdx]
			dbRest := hostAndDb[slashIdx:]
			cleanDSN = auth + "@tcp(" + hostPort + ")" + dbRest
		} else if hostAndDb != "" {
			cleanDSN = auth + "@tcp(" + hostAndDb + ")/"
		}
	}

	db, err := sql.Open("mysql", cleanDSN)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(10 * time.Minute)
	return &MySQLDriver{db: db}, nil
}

func NewDriver(dsn string) (*MySQLDriver, error) {
	return New(dsn)
}

func (m *MySQLDriver) Dialect() string {
	return "mysql"
}

func (m *MySQLDriver) Ping(ctx context.Context) error {
	ctxTimeout, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return m.db.PingContext(ctxTimeout)
}

func (m *MySQLDriver) Close() error {
	return m.db.Close()
}

func (m *MySQLDriver) InspectDatabases(ctx context.Context) ([]string, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	query := `SELECT schema_name FROM information_schema.schemata ORDER BY schema_name;`
	rows, err := m.db.QueryContext(ctxTimeout, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var dbs []string
	for rows.Next() {
		var dbName string
		if err := rows.Scan(&dbName); err != nil {
			return nil, err
		}
		dbs = append(dbs, dbName)
	}
	return dbs, nil
}

func (m *MySQLDriver) SelectDatabase(ctx context.Context, dbName string) error {
	ctxTimeout, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	_, err := m.db.ExecContext(ctxTimeout, fmt.Sprintf("USE `%s`", dbName))
	return err
}

func (m *MySQLDriver) InspectSchemas(ctx context.Context) ([]string, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	query := `
		SELECT schema_name 
		FROM information_schema.schemata 
		WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
		ORDER BY schema_name;
	`
	rows, err := m.db.QueryContext(ctxTimeout, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var schemas []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		schemas = append(schemas, s)
	}
	return schemas, nil
}

func (m *MySQLDriver) InspectTables(ctx context.Context, schema string) ([]types.TableMeta, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	query := `
		SELECT table_name, table_schema, table_type
		FROM information_schema.tables
		WHERE table_schema = CASE WHEN ? = '' THEN DATABASE() ELSE ? END
		ORDER BY table_name;
	`
	rows, err := m.db.QueryContext(ctxTimeout, query, schema, schema)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []types.TableMeta
	for rows.Next() {
		var t types.TableMeta
		var rawType string
		if err := rows.Scan(&t.Name, &t.Schema, &rawType); err != nil {
			return nil, err
		}
		if strings.Contains(strings.ToUpper(rawType), "VIEW") {
			t.Type = "view"
		} else {
			t.Type = "table"
		}
		tables = append(tables, t)
	}
	return tables, nil
}

func (m *MySQLDriver) InspectTableDetails(ctx context.Context, schema, table string) (*types.TableDetail, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	detail := &types.TableDetail{
		Name:    table,
		Schema:  schema,
		Dialect: "mysql",
		Columns: []types.ColumnMeta{},
		FKs:     []types.ForeignKey{},
		Indexes: []types.IndexMeta{},
	}

	colQuery := `
		SELECT 
			column_name, 
			data_type, 
			column_type,
			is_nullable, 
			column_default,
			column_key
		FROM information_schema.columns
		WHERE table_schema = CASE WHEN ? = '' THEN DATABASE() ELSE ? END 
		  AND table_name = ?
		ORDER BY ordinal_position;
	`
	colRows, err := m.db.QueryContext(ctxTimeout, colQuery, schema, schema, table)
	if err != nil {
		return nil, err
	}
	defer colRows.Close()

	for colRows.Next() {
		var col types.ColumnMeta
		var columnType string
		var isNullable string
		var colKey string
		var defVal sql.NullString

		if err := colRows.Scan(&col.Name, &col.DataType, &columnType, &isNullable, &defVal, &colKey); err != nil {
			return nil, err
		}
		col.Type = columnType
		if col.Type == "" {
			col.Type = col.DataType
		}
		col.IsNullable = (isNullable == "YES")
		col.IsPrimary = (colKey == "PRI")
		if defVal.Valid {
			col.Default = &defVal.String
		}
		detail.Columns = append(detail.Columns, col)
	}
	if err := colRows.Err(); err != nil {
		return nil, err
	}

	fkQuery := `
		SELECT 
			kcu.constraint_name,
			kcu.column_name, 
			kcu.referenced_table_name, 
			kcu.referenced_column_name,
			COALESCE(rc.update_rule, ''),
			COALESCE(rc.delete_rule, '')
		FROM information_schema.key_column_usage kcu
		JOIN information_schema.referential_constraints rc
			ON kcu.constraint_name = rc.constraint_name
			AND kcu.constraint_schema = rc.constraint_schema
		WHERE kcu.table_schema = CASE WHEN ? = '' THEN DATABASE() ELSE ? END 
		  AND kcu.table_name = ?
		  AND kcu.referenced_table_name IS NOT NULL
		ORDER BY kcu.ordinal_position;
	`
	fkRows, err := m.db.QueryContext(ctxTimeout, fkQuery, schema, schema, table)
	if err == nil {
		defer fkRows.Close()
		for fkRows.Next() {
			var fk types.ForeignKey
			if err := fkRows.Scan(&fk.Name, &fk.Column, &fk.RefTable, &fk.RefColumn, &fk.OnUpdate, &fk.OnDelete); err == nil {
				detail.FKs = append(detail.FKs, fk)
			}
		}

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

	idxQuery := `
		SELECT 
			index_name,
			non_unique,
			index_type,
			column_name
		FROM information_schema.statistics
		WHERE table_schema = CASE WHEN ? = '' THEN DATABASE() ELSE ? END 
		  AND table_name = ?
		ORDER BY index_name, seq_in_index;
	`
	idxRows, err := m.db.QueryContext(ctxTimeout, idxQuery, schema, schema, table)
	if err == nil {
		defer idxRows.Close()
		indexMap := make(map[string]*types.IndexMeta)
		var indexOrder []string

		for idxRows.Next() {
			var idxName, idxType, colName string
			var nonUnique int
			if err := idxRows.Scan(&idxName, &nonUnique, &idxType, &colName); err == nil {
				if meta, exists := indexMap[idxName]; exists {
					meta.Columns = append(meta.Columns, colName)
				} else {
					meta := &types.IndexMeta{
						Name:      idxName,
						Columns:   []string{colName},
						IsUnique:  nonUnique == 0,
						IsPrimary: strings.ToUpper(idxName) == "PRIMARY",
						Type:      idxType,
					}
					indexMap[idxName] = meta
					indexOrder = append(indexOrder, idxName)
				}
			}
		}
		for _, name := range indexOrder {
			detail.Indexes = append(detail.Indexes, *indexMap[name])
		}
	}

	if ddl, err := m.GenerateTableDDL(ctx, schema, table); err == nil {
		detail.DDL = ddl
	}

	return detail, nil
}

func (m *MySQLDriver) GenerateTableDDL(ctx context.Context, schema, table string) (string, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	var target string
	if schema != "" {
		target = fmt.Sprintf("%s.%s", quoteIdent(schema), quoteIdent(table))
	} else {
		target = quoteIdent(table)
	}

	query := fmt.Sprintf("SHOW CREATE TABLE %s", target)
	row := m.db.QueryRowContext(ctxTimeout, query)

	var tableName, createSQL string
	if err := row.Scan(&tableName, &createSQL); err != nil {
		return "", err
	}

	createSQL = strings.TrimSpace(createSQL)
	if !strings.HasSuffix(createSQL, ";") {
		createSQL += ";"
	}
	return createSQL, nil
}

func quoteIdent(s string) string {
	return "`" + strings.ReplaceAll(s, "`", "``") + "`"
}

// BuildQuerySQL constructs the SELECT query and parameter slice from QueryOptions for MySQL.
func BuildQuerySQL(opts types.QueryOptions) (string, []interface{}) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 500
	}
	if opts.Offset < 0 {
		opts.Offset = 0
	}

	var sb strings.Builder
	var args []interface{}

	if opts.Schema != "" {
		sb.WriteString(fmt.Sprintf("SELECT * FROM %s.%s", quoteIdent(opts.Schema), quoteIdent(opts.Table)))
	} else {
		sb.WriteString(fmt.Sprintf("SELECT * FROM %s", quoteIdent(opts.Table)))
	}

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

func (m *MySQLDriver) QueryTableData(ctx context.Context, opts types.QueryOptions) (*types.QueryResult, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	sqlStr, args := BuildQuerySQL(opts)
	start := time.Now()
	rows, err := m.db.QueryContext(ctxTimeout, sqlStr, args...)
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

func (m *MySQLDriver) QueryTableStream(ctx context.Context, schema, table string) (*sql.Rows, error) {
	var targetTable string
	if schema != "" {
		targetTable = fmt.Sprintf("%s.%s", quoteIdent(schema), quoteIdent(table))
	} else {
		targetTable = quoteIdent(table)
	}
	query := fmt.Sprintf("SELECT * FROM %s", targetTable)
	return m.db.QueryContext(ctx, query)
}

func (m *MySQLDriver) ExecuteQuery(ctx context.Context, rawSql string) (*types.QueryResult, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	start := time.Now()
	trimmed := strings.TrimSpace(rawSql)
	upper := strings.ToUpper(trimmed)

	if strings.HasPrefix(upper, "SELECT") || strings.HasPrefix(upper, "EXPLAIN") || strings.HasPrefix(upper, "SHOW") || strings.HasPrefix(upper, "DESCRIBE") {
		rows, err := m.db.QueryContext(ctxTimeout, trimmed)
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

	res, err := m.db.ExecContext(ctxTimeout, trimmed)
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

func (m *MySQLDriver) MutateRow(ctx context.Context, mut types.Mutation) (*types.MutationResult, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	var targetTable string
	if mut.Schema != "" {
		targetTable = fmt.Sprintf("%s.%s", quoteIdent(mut.Schema), quoteIdent(mut.Table))
	} else {
		targetTable = quoteIdent(mut.Table)
	}

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

	res, err := m.db.ExecContext(ctxTimeout, sqlStr, args...)
	if err != nil {
		return &types.MutationResult{GeneratedSQL: sqlStr}, err
	}
	affected, _ := res.RowsAffected()

	return &types.MutationResult{
		AffectedRows: affected,
		GeneratedSQL: sqlStr,
	}, nil
}

// BuildBatchInsertSQL constructs the parameterized INSERT statement and args for MySQL.
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
	if schema != "" {
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

func (m *MySQLDriver) BatchInsert(ctx context.Context, schema, table string, rows []map[string]interface{}) (*types.MutationResult, error) {
	sqlStr, args, err := BuildBatchInsertSQL(schema, table, rows)
	if err != nil {
		return nil, err
	}

	ctxTimeout, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	tx, err := m.db.BeginTx(ctxTimeout, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctxTimeout, sqlStr, args...)
	if err != nil {
		return &types.MutationResult{GeneratedSQL: sqlStr}, err
	}

	if err := tx.Commit(); err != nil {
		return &types.MutationResult{GeneratedSQL: sqlStr}, err
	}

	affected, _ := res.RowsAffected()
	return &types.MutationResult{
		AffectedRows: affected,
		GeneratedSQL: sqlStr,
	}, nil
}

func (m *MySQLDriver) GetERDData(ctx context.Context) ([]types.ERDTable, error) {
	schemas, err := m.InspectSchemas(ctx)
	if err != nil || len(schemas) == 0 {
		schemas = []string{""}
	}

	var erd []types.ERDTable
	for _, s := range schemas {
		tables, err := m.InspectTables(ctx, s)
		if err != nil {
			continue
		}
		for _, t := range tables {
			details, err := m.InspectTableDetails(ctx, s, t.Name)
			if err != nil {
				continue
			}
			erd = append(erd, types.ERDTable{
				Name:    t.Name,
				Schema:  s,
				Columns: details.Columns,
				FKs:     details.FKs,
			})
		}
	}
	return erd, nil
}

func (m *MySQLDriver) ExplainQuery(ctx context.Context, rawSql string, opts types.ExplainOptions) (*types.ExplainResult, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	trimmed := strings.TrimSpace(rawSql)
	trimmed = strings.TrimRight(trimmed, ";")
	if trimmed == "" {
		return nil, fmt.Errorf("query cannot be empty")
	}

	explainSQL := fmt.Sprintf("EXPLAIN FORMAT=JSON %s;", trimmed)
	var jsonOutput string
	err := m.db.QueryRowContext(ctxTimeout, explainSQL).Scan(&jsonOutput)
	if err != nil {
		return nil, fmt.Errorf("mysql explain error: %w", err)
	}

	return explain.ParseMySQL(jsonOutput)
}


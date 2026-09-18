package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
	"github.com/dblens/dblens/internal/explain"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type PostgresDriver struct {
	db  *sql.DB
	dsn string
}

func New(dsn string) (*PostgresDriver, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(10 * time.Minute)
	return &PostgresDriver{db: db, dsn: dsn}, nil
}

func (p *PostgresDriver) Dialect() string {
	return "postgres"
}

func (p *PostgresDriver) Ping(ctx context.Context) error {
	ctxTimeout, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return p.db.PingContext(ctxTimeout)
}

func (p *PostgresDriver) Close() error {
	return p.db.Close()
}

func (p *PostgresDriver) InspectDatabases(ctx context.Context) ([]string, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	query := `SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;`
	rows, err := p.db.QueryContext(ctxTimeout, query)
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

func (p *PostgresDriver) SelectDatabase(ctx context.Context, dbName string) error {
	var newDSN string
	if strings.Contains(p.dsn, "://") {
		parts := strings.SplitN(p.dsn, "?", 2)
		base := parts[0]
		query := ""
		if len(parts) > 1 {
			query = "?" + parts[1]
		}
		lastSlash := strings.LastIndex(base, "/")
		if lastSlash != -1 {
			newDSN = base[:lastSlash+1] + dbName + query
		} else {
			newDSN = base + "/" + dbName + query
		}
	} else {
		newDSN = p.dsn
	}

	newDB, err := sql.Open("pgx", newDSN)
	if err != nil {
		return err
	}
	newDB.SetMaxOpenConns(10)
	newDB.SetMaxIdleConns(5)
	newDB.SetConnMaxLifetime(10 * time.Minute)

	ctxTimeout, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := newDB.PingContext(ctxTimeout); err != nil {
		newDB.Close()
		return err
	}

	_ = p.db.Close()
	p.db = newDB
	p.dsn = newDSN
	return nil
}

func (p *PostgresDriver) InspectSchemas(ctx context.Context) ([]string, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	query := `
		SELECT schema_name 
		FROM information_schema.schemata 
		WHERE schema_name NOT LIKE 'pg_%' 
		  AND schema_name != 'information_schema'
		ORDER BY schema_name;
	`
	rows, err := p.db.QueryContext(ctxTimeout, query)
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

func (p *PostgresDriver) InspectTables(ctx context.Context, schema string) ([]types.TableMeta, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	if schema == "" {
		schema = "public"
	}

	query := `
		SELECT table_name, table_schema, table_type
		FROM information_schema.tables
		WHERE table_schema = $1
		ORDER BY table_name;
	`
	rows, err := p.db.QueryContext(ctxTimeout, query, schema)
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
		if rawType == "VIEW" {
			t.Type = "view"
		} else {
			t.Type = "table"
		}
		tables = append(tables, t)
	}
	return tables, nil
}

func (p *PostgresDriver) InspectTableDetails(ctx context.Context, schema, table string) (*types.TableDetail, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	if schema == "" {
		schema = "public"
	}

	detail := &types.TableDetail{
		Name:    table,
		Schema:  schema,
		Dialect: "postgres",
		Columns: []types.ColumnMeta{},
		FKs:     []types.ForeignKey{},
		Indexes: []types.IndexMeta{},
	}

	colQuery := `
		SELECT 
			c.column_name, 
			CASE 
				WHEN c.data_type = 'character varying' AND c.character_maximum_length IS NOT NULL 
					THEN 'varchar(' || c.character_maximum_length || ')'
				WHEN c.data_type = 'character' AND c.character_maximum_length IS NOT NULL 
					THEN 'char(' || c.character_maximum_length || ')'
				WHEN c.data_type = 'numeric' AND c.numeric_precision IS NOT NULL 
					THEN 'numeric(' || c.numeric_precision || COALESCE(',' || c.numeric_scale, '') || ')'
				ELSE c.data_type 
			END AS data_type,
			c.is_nullable, 
			c.column_default,
			COALESCE(tc.constraint_type = 'PRIMARY KEY', false) AS is_primary
		FROM information_schema.columns c
		LEFT JOIN information_schema.key_column_usage kcu 
			ON c.table_schema = kcu.table_schema 
			AND c.table_name = kcu.table_name 
			AND c.column_name = kcu.column_name
		LEFT JOIN information_schema.table_constraints tc 
			ON kcu.table_schema = tc.table_schema 
			AND kcu.table_name = tc.table_name 
			AND kcu.constraint_name = tc.constraint_name 
			AND tc.constraint_type = 'PRIMARY KEY'
		WHERE c.table_schema = $1 AND c.table_name = $2
		ORDER BY c.ordinal_position;
	`
	colRows, err := p.db.QueryContext(ctxTimeout, colQuery, schema, table)
	if err != nil {
		return nil, err
	}
	defer colRows.Close()

	seenCols := make(map[string]bool)
	for colRows.Next() {
		var col types.ColumnMeta
		var isNullable string
		var isPrimary sql.NullBool
		var defVal sql.NullString

		if err := colRows.Scan(&col.Name, &col.DataType, &isNullable, &defVal, &isPrimary); err != nil {
			return nil, err
		}
		col.IsNullable = (isNullable == "YES")
		col.IsPrimary = isPrimary.Valid && isPrimary.Bool
		if defVal.Valid {
			col.Default = &defVal.String
		}

		if !seenCols[col.Name] {
			seenCols[col.Name] = true
			col.Type = col.DataType
			detail.Columns = append(detail.Columns, col)
		} else if col.IsPrimary {
			for i := range detail.Columns {
				if detail.Columns[i].Name == col.Name {
					detail.Columns[i].IsPrimary = true
				}
			}
		}
	}
	if err := colRows.Err(); err != nil {
		return nil, err
	}

	fkQuery := `
		SELECT
			tc.constraint_name,
			kcu.column_name,
			ccu.table_name AS foreign_table_name,
			ccu.column_name AS foreign_column_name,
			COALESCE(rc.update_rule, ''),
			COALESCE(rc.delete_rule, '')
		FROM information_schema.table_constraints AS tc
		JOIN information_schema.key_column_usage AS kcu
			ON tc.constraint_name = kcu.constraint_name
			AND tc.table_schema = kcu.table_schema
		JOIN information_schema.constraint_column_usage AS ccu
			ON ccu.constraint_name = tc.constraint_name
			AND ccu.table_schema = tc.table_schema
		JOIN information_schema.referential_constraints AS rc
			ON rc.constraint_name = tc.constraint_name
			AND rc.constraint_schema = tc.table_schema
		WHERE tc.constraint_type = 'FOREIGN KEY'
			AND tc.table_schema = $1
			AND tc.table_name = $2
		ORDER BY tc.constraint_name, kcu.ordinal_position;
	`
	fkRows, err := p.db.QueryContext(ctxTimeout, fkQuery, schema, table)
	if err == nil {
		defer fkRows.Close()
		fkCols := make(map[string]bool)
		for fkRows.Next() {
			var fk types.ForeignKey
			if err := fkRows.Scan(&fk.Name, &fk.Column, &fk.RefTable, &fk.RefColumn, &fk.OnUpdate, &fk.OnDelete); err == nil {
				detail.FKs = append(detail.FKs, fk)
				fkCols[fk.Column] = true
			}
		}
		for i := range detail.Columns {
			if fkCols[detail.Columns[i].Name] {
				detail.Columns[i].IsForeignKey = true
			}
		}
	}

	idxQuery := `
		SELECT
			i.relname AS index_name,
			am.amname AS index_type,
			ix.indisunique,
			ix.indisprimary,
			pg_get_indexdef(ix.indexrelid) AS index_def
		FROM pg_index ix
		JOIN pg_class t ON t.oid = ix.indrelid
		JOIN pg_class i ON i.oid = ix.indexrelid
		JOIN pg_namespace n ON n.oid = t.relnamespace
		JOIN pg_am am ON am.oid = i.relam
		WHERE n.nspname = $1 AND t.relname = $2
		ORDER BY ix.indisprimary DESC, i.relname ASC;
	`
	idxRows, err := p.db.QueryContext(ctxTimeout, idxQuery, schema, table)
	if err == nil {
		defer idxRows.Close()
		for idxRows.Next() {
			var idxName, idxType, indexDef string
			var isUnique, isPrimary bool
			if err := idxRows.Scan(&idxName, &idxType, &isUnique, &isPrimary, &indexDef); err == nil {
				var cols []string
				start := strings.Index(indexDef, "(")
				end := strings.LastIndex(indexDef, ")")
				if start != -1 && end > start {
					colsStr := indexDef[start+1 : end]
					if whereIdx := strings.Index(indexDef, ") WHERE "); whereIdx != -1 && whereIdx > start {
						colsStr = indexDef[start+1 : whereIdx]
					}
					for _, p := range strings.Split(colsStr, ",") {
						c := strings.Trim(strings.TrimSpace(p), `"`)
						if c != "" {
							cols = append(cols, c)
						}
					}
				}
				detail.Indexes = append(detail.Indexes, types.IndexMeta{
					Name:      idxName,
					Columns:   cols,
					IsUnique:  isUnique,
					IsPrimary: isPrimary,
					Type:      idxType,
				})
			}
		}
	}

	if ddl, err := p.GenerateTableDDL(ctx, schema, table); err == nil {
		detail.DDL = ddl
	}

	// Cardinality: 1:1 if FK column is single-column UNIQUE or PK
	uniqueCols := make(map[string]bool)
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

	return detail, nil
}

func (p *PostgresDriver) GenerateTableDDL(ctx context.Context, schema, table string) (string, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	if schema == "" {
		schema = "public"
	}

	colQuery := `
		SELECT 
			a.attname,
			format_type(a.atttypid, a.atttypmod) AS data_type,
			a.attnotnull,
			COALESCE(pg_get_expr(d.adbin, d.adrelid), '') AS column_default
		FROM pg_attribute a
		JOIN pg_class t ON t.oid = a.attrelid
		JOIN pg_namespace n ON n.oid = t.relnamespace
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE n.nspname = $1 
		  AND t.relname = $2 
		  AND a.attnum > 0 
		  AND NOT a.attisdropped
		ORDER BY a.attnum;
	`
	colRows, err := p.db.QueryContext(ctxTimeout, colQuery, schema, table)
	if err != nil {
		return "", err
	}
	defer colRows.Close()

	var colDefs []string
	for colRows.Next() {
		var colName, dataType, colDefault string
		var notNull bool
		if err := colRows.Scan(&colName, &dataType, &notNull, &colDefault); err != nil {
			return "", err
		}
		def := fmt.Sprintf("  %s %s", quoteIdent(colName), dataType)
		if notNull {
			def += " NOT NULL"
		}
		if colDefault != "" {
			def += " DEFAULT " + colDefault
		}
		colDefs = append(colDefs, def)
	}
	if err := colRows.Err(); err != nil {
		return "", err
	}

	if len(colDefs) == 0 {
		return "", fmt.Errorf("table not found: %s.%s", schema, table)
	}

	conQuery := `
		SELECT 
			con.conname,
			con.contype,
			pg_get_constraintdef(con.oid) AS constraint_def
		FROM pg_constraint con
		JOIN pg_class t ON t.oid = con.conrelid
		JOIN pg_namespace n ON n.oid = t.relnamespace
		WHERE n.nspname = $1 
		  AND t.relname = $2
		ORDER BY CASE con.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'f' THEN 2 ELSE 3 END, con.conname;
	`
	conRows, err := p.db.QueryContext(ctxTimeout, conQuery, schema, table)
	if err == nil {
		defer conRows.Close()
		for conRows.Next() {
			var conName, conType, conDef string
			if err := conRows.Scan(&conName, &conType, &conDef); err == nil {
				colDefs = append(colDefs, fmt.Sprintf("  CONSTRAINT %s %s", quoteIdent(conName), conDef))
			}
		}
	}

	idxQuery := `
		SELECT 
			pg_get_indexdef(ix.indexrelid) AS index_def
		FROM pg_index ix
		JOIN pg_class t ON t.oid = ix.indrelid
		JOIN pg_class i ON i.oid = ix.indexrelid
		JOIN pg_namespace n ON n.oid = t.relnamespace
		WHERE n.nspname = $1 
		  AND t.relname = $2 
		  AND NOT ix.indisprimary
		  AND NOT EXISTS (
		      SELECT 1 FROM pg_constraint con WHERE con.conindid = ix.indexrelid
		  )
		ORDER BY i.relname;
	`
	idxRows, err := p.db.QueryContext(ctxTimeout, idxQuery, schema, table)
	var indexDefs []string
	if err == nil {
		defer idxRows.Close()
		for idxRows.Next() {
			var idxDef string
			if err := idxRows.Scan(&idxDef); err == nil {
				idxTrimmed := strings.TrimSpace(idxDef)
				if !strings.HasSuffix(idxTrimmed, ";") {
					idxTrimmed += ";"
				}
				indexDefs = append(indexDefs, idxTrimmed)
			}
		}
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("CREATE TABLE %s.%s (\n", quoteIdent(schema), quoteIdent(table)))
	sb.WriteString(strings.Join(colDefs, ",\n"))
	sb.WriteString("\n);")

	if len(indexDefs) > 0 {
		sb.WriteString("\n\n")
		sb.WriteString(strings.Join(indexDefs, "\n"))
	}

	return sb.String(), nil
}

func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

// BuildQuerySQL constructs the SELECT query and parameter slice from QueryOptions.
func BuildQuerySQL(opts types.QueryOptions) (string, []interface{}) {
	if opts.Schema == "" {
		opts.Schema = "public"
	}
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 500
	}
	if opts.Offset < 0 {
		opts.Offset = 0
	}

	var sb strings.Builder
	var args []interface{}
	argIdx := 1

	targetTable := fmt.Sprintf(`%s.%s`, quoteIdent(opts.Schema), quoteIdent(opts.Table))
	sb.WriteString(fmt.Sprintf(`SELECT * FROM %s`, targetTable))

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
			case "=":
				sb.WriteString(fmt.Sprintf("%s = $%d", col, argIdx))
				args = append(args, f.Value)
				argIdx++
			case "!=":
				sb.WriteString(fmt.Sprintf("%s != $%d", col, argIdx))
				args = append(args, f.Value)
				argIdx++
			case ">":
				sb.WriteString(fmt.Sprintf("%s > $%d", col, argIdx))
				args = append(args, f.Value)
				argIdx++
			case "<":
				sb.WriteString(fmt.Sprintf("%s < $%d", col, argIdx))
				args = append(args, f.Value)
				argIdx++
			case ">=":
				sb.WriteString(fmt.Sprintf("%s >= $%d", col, argIdx))
				args = append(args, f.Value)
				argIdx++
			case "<=":
				sb.WriteString(fmt.Sprintf("%s <= $%d", col, argIdx))
				args = append(args, f.Value)
				argIdx++
			case "LIKE":
				sb.WriteString(fmt.Sprintf("%s LIKE $%d", col, argIdx))
				args = append(args, "%"+f.Value+"%")
				argIdx++
			case "ILIKE":
				sb.WriteString(fmt.Sprintf("%s ILIKE $%d", col, argIdx))
				args = append(args, "%"+f.Value+"%")
				argIdx++
			case "IS NULL":
				sb.WriteString(fmt.Sprintf("%s IS NULL", col))
			case "IS NOT NULL":
				sb.WriteString(fmt.Sprintf("%s IS NOT NULL", col))
			default:
				sb.WriteString(fmt.Sprintf("%s = $%d", col, argIdx))
				args = append(args, f.Value)
				argIdx++
			}
		}
	}

	if opts.OrderBy != "" {
		dir := "ASC"
		if strings.EqualFold(strings.TrimSpace(opts.OrderDir), "DESC") {
			dir = "DESC"
		}
		sb.WriteString(fmt.Sprintf(` ORDER BY %s %s`, quoteIdent(opts.OrderBy), dir))
	}

	sb.WriteString(fmt.Sprintf(" LIMIT $%d OFFSET $%d", argIdx, argIdx+1))
	args = append(args, opts.Limit, opts.Offset)

	return sb.String(), args
}

func (p *PostgresDriver) QueryTableData(ctx context.Context, opts types.QueryOptions) (*types.QueryResult, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	sqlStr, args := BuildQuerySQL(opts)
	start := time.Now()
	rows, err := p.db.QueryContext(ctxTimeout, sqlStr, args...)
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

func (p *PostgresDriver) QueryTableStream(ctx context.Context, schema, table string) (*sql.Rows, error) {
	var targetTable string
	if schema != "" {
		targetTable = fmt.Sprintf("%s.%s", quoteIdent(schema), quoteIdent(table))
	} else {
		targetTable = quoteIdent(table)
	}
	query := fmt.Sprintf("SELECT * FROM %s", targetTable)
	return p.db.QueryContext(ctx, query)
}

func (p *PostgresDriver) ExecuteQuery(ctx context.Context, rawSql string) (*types.QueryResult, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	start := time.Now()
	trimmed := strings.TrimSpace(rawSql)
	upper := strings.ToUpper(trimmed)

	if strings.HasPrefix(upper, "SELECT") || strings.HasPrefix(upper, "EXPLAIN") || strings.HasPrefix(upper, "SHOW") || strings.HasPrefix(upper, "WITH") {
		rows, err := p.db.QueryContext(ctxTimeout, trimmed)
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

	res, err := p.db.ExecContext(ctxTimeout, trimmed)
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

func (p *PostgresDriver) MutateRow(ctx context.Context, m types.Mutation) (*types.MutationResult, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	if m.Schema == "" {
		m.Schema = "public"
	}
	targetTable := fmt.Sprintf(`%s.%s`, quoteIdent(m.Schema), quoteIdent(m.Table))

	var sqlStr string
	var args []interface{}
	argIdx := 1

	switch m.Type {
	case types.MutationInsert:
		var cols []string
		var placeholders []string
		for col, val := range m.Data {
			cols = append(cols, quoteIdent(col))
			placeholders = append(placeholders, fmt.Sprintf("$%d", argIdx))
			args = append(args, val)
			argIdx++
		}
		if len(cols) == 0 {
			return nil, fmt.Errorf("no columns provided for INSERT")
		}
		sqlStr = fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s)`, targetTable, strings.Join(cols, ", "), strings.Join(placeholders, ", "))

	case types.MutationUpdate:
		var sets []string
		for col, val := range m.Data {
			sets = append(sets, fmt.Sprintf(`%s = $%d`, quoteIdent(col), argIdx))
			args = append(args, val)
			argIdx++
		}
		var wheres []string
		for col, val := range m.Where {
			wheres = append(wheres, fmt.Sprintf(`%s = $%d`, quoteIdent(col), argIdx))
			args = append(args, val)
			argIdx++
		}
		if len(sets) == 0 {
			return nil, fmt.Errorf("no columns provided for UPDATE")
		}
		if len(wheres) == 0 {
			return nil, fmt.Errorf("WHERE clause required for UPDATE")
		}
		sqlStr = fmt.Sprintf(`UPDATE %s SET %s WHERE %s`, targetTable, strings.Join(sets, ", "), strings.Join(wheres, " AND "))

	case types.MutationDelete:
		var wheres []string
		for col, val := range m.Where {
			wheres = append(wheres, fmt.Sprintf(`%s = $%d`, quoteIdent(col), argIdx))
			args = append(args, val)
			argIdx++
		}
		if len(wheres) == 0 {
			return nil, fmt.Errorf("WHERE clause required for DELETE")
		}
		sqlStr = fmt.Sprintf(`DELETE FROM %s WHERE %s`, targetTable, strings.Join(wheres, " AND "))

	default:
		return nil, fmt.Errorf("unsupported mutation type: %s", m.Type)
	}

	res, err := p.db.ExecContext(ctxTimeout, sqlStr, args...)
	if err != nil {
		return &types.MutationResult{GeneratedSQL: sqlStr}, err
	}
	affected, _ := res.RowsAffected()

	return &types.MutationResult{
		AffectedRows: affected,
		GeneratedSQL: sqlStr,
	}, nil
}

// BuildBatchInsertSQL constructs the parameterized INSERT statement and args for PostgreSQL.
func BuildBatchInsertSQL(schema, table string, rows []map[string]interface{}) (string, []interface{}, error) {
	if len(rows) == 0 {
		return "", nil, fmt.Errorf("no rows provided for batch insert")
	}
	if schema == "" {
		schema = "public"
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

	targetTable := fmt.Sprintf(`%s.%s`, quoteIdent(schema), quoteIdent(table))

	var valPlaceholders []string
	var args []interface{}
	argIdx := 1
	for _, row := range rows {
		var rowPlaceholders []string
		for _, col := range cols {
			rowPlaceholders = append(rowPlaceholders, fmt.Sprintf("$%d", argIdx))
			args = append(args, row[col])
			argIdx++
		}
		valPlaceholders = append(valPlaceholders, fmt.Sprintf("(%s)", strings.Join(rowPlaceholders, ", ")))
	}

	sqlStr := fmt.Sprintf(`INSERT INTO %s (%s) VALUES %s`,
		targetTable,
		strings.Join(quotedCols, ", "),
		strings.Join(valPlaceholders, ", "),
	)
	return sqlStr, args, nil
}

func (p *PostgresDriver) BatchInsert(ctx context.Context, schema, table string, rows []map[string]interface{}) (*types.MutationResult, error) {
	sqlStr, args, err := BuildBatchInsertSQL(schema, table, rows)
	if err != nil {
		return nil, err
	}

	ctxTimeout, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	tx, err := p.db.BeginTx(ctxTimeout, nil)
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

func (p *PostgresDriver) GetERDData(ctx context.Context) ([]types.ERDTable, error) {
	schemas, err := p.InspectSchemas(ctx)
	if err != nil {
		return nil, err
	}

	var erd []types.ERDTable
	for _, s := range schemas {
		tables, err := p.InspectTables(ctx, s)
		if err != nil {
			continue
		}
		for _, t := range tables {
			details, err := p.InspectTableDetails(ctx, s, t.Name)
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

func (p *PostgresDriver) ExplainQuery(ctx context.Context, rawSql string, opts types.ExplainOptions) (*types.ExplainResult, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	trimmed := strings.TrimSpace(rawSql)
	trimmed = strings.TrimRight(trimmed, ";")
	if trimmed == "" {
		return nil, fmt.Errorf("query cannot be empty")
	}

	conn, err := p.db.Conn(ctxTimeout)
	if err != nil {
		return nil, fmt.Errorf("postgres explain conn error: %w", err)
	}
	defer conn.Close()

	if opts.Schema != "" {
		if strings.ContainsAny(opts.Schema, ";\x00\r\n") {
			return nil, fmt.Errorf("invalid schema name: %s", opts.Schema)
		}
		quotedSchema := `"` + strings.ReplaceAll(opts.Schema, `"`, `""`) + `"`
		_, _ = conn.ExecContext(ctxTimeout, fmt.Sprintf(`SET search_path TO %s, public;`, quotedSchema))
		defer func() {
			_, _ = conn.ExecContext(context.Background(), `RESET search_path;`)
		}()
	}

	// Safety: never run EXPLAIN ANALYZE on mutating statements
	analyze := opts.Analyze
	upper := strings.ToUpper(trimmed)
	if strings.HasPrefix(upper, "INSERT") ||
		strings.HasPrefix(upper, "UPDATE") ||
		strings.HasPrefix(upper, "DELETE") ||
		strings.HasPrefix(upper, "DROP") ||
		strings.HasPrefix(upper, "TRUNCATE") ||
		strings.HasPrefix(upper, "ALTER") ||
		strings.HasPrefix(upper, "CREATE") {
		analyze = false
	}

	var explainSQL string
	if analyze {
		explainSQL = fmt.Sprintf("EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT JSON) %s;", trimmed)
	} else {
		explainSQL = fmt.Sprintf("EXPLAIN (COSTS, VERBOSE, FORMAT JSON) %s;", trimmed)
	}

	var jsonOutput string
	err = conn.QueryRowContext(ctxTimeout, explainSQL).Scan(&jsonOutput)
	if err != nil {
		// Fallback to EXPLAIN (FORMAT JSON) without analyze if analyze failed
		fallbackSQL := fmt.Sprintf("EXPLAIN (FORMAT JSON) %s;", trimmed)
		errFallback := conn.QueryRowContext(ctxTimeout, fallbackSQL).Scan(&jsonOutput)
		if errFallback != nil {
			return nil, fmt.Errorf("postgres explain error: %w", err)
		}
	}

	return explain.ParsePostgres(jsonOutput)
}

func (p *PostgresDriver) InspectProcesses(ctx context.Context) ([]types.ProcessInfo, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	query := `
		SELECT
			pid::text,
			COALESCE(usename, '') AS usename,
			COALESCE(datname, '') AS datname,
			COALESCE(CASE 
				WHEN client_addr IS NOT NULL AND client_port IS NOT NULL THEN client_addr::text || ':' || client_port::text
				WHEN client_addr IS NOT NULL THEN client_addr::text
				ELSE 'local'
			END, 'local') AS client_host,
			GREATEST(0, COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - query_start))::bigint, 0)) AS duration,
			COALESCE(state, 'unknown') AS state,
			COALESCE(query, '') AS query,
			COALESCE(backend_type, 'client backend') AS backend_type
		FROM pg_stat_activity
		ORDER BY
			CASE WHEN state = 'active' THEN 0 ELSE 1 END,
			duration DESC,
			pid ASC;
	`

	rows, err := p.db.QueryContext(ctxTimeout, query)
	if err != nil {
		fallbackQuery := `
			SELECT
				pid::text,
				COALESCE(usename, '') AS usename,
				COALESCE(datname, '') AS datname,
				COALESCE(CASE 
					WHEN client_addr IS NOT NULL AND client_port IS NOT NULL THEN client_addr::text || ':' || client_port::text
					WHEN client_addr IS NOT NULL THEN client_addr::text
					ELSE 'local'
				END, 'local') AS client_host,
				GREATEST(0, COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - query_start))::bigint, 0)) AS duration,
				COALESCE(state, 'unknown') AS state,
				COALESCE(query, '') AS query,
				'client backend' AS backend_type
			FROM pg_stat_activity
			ORDER BY
				CASE WHEN state = 'active' THEN 0 ELSE 1 END,
				duration DESC,
				pid ASC;
		`
		var fallbackErr error
		rows, fallbackErr = p.db.QueryContext(ctxTimeout, fallbackQuery)
		if fallbackErr != nil {
			return nil, fmt.Errorf("inspect processes failed: %v (fallback: %w)", err, fallbackErr)
		}
	}
	defer rows.Close()

	var processes []types.ProcessInfo
	for rows.Next() {
		var pi types.ProcessInfo
		if err := rows.Scan(
			&pi.ID,
			&pi.User,
			&pi.Database,
			&pi.Host,
			&pi.Time,
			&pi.State,
			&pi.Query,
			&pi.Command,
		); err != nil {
			return nil, err
		}
		processes = append(processes, pi)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	if processes == nil {
		processes = []types.ProcessInfo{}
	}
	return processes, nil
}

func (p *PostgresDriver) KillProcess(ctx context.Context, id string) error {
	ctxTimeout, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	trimmed := strings.TrimSpace(id)
	pid, err := strconv.Atoi(trimmed)
	if err != nil || pid <= 0 {
		return fmt.Errorf("invalid process id: %s", id)
	}

	var terminated bool
	err = p.db.QueryRowContext(ctxTimeout, "SELECT pg_terminate_backend($1)", pid).Scan(&terminated)
	if err != nil {
		return fmt.Errorf("failed to terminate backend %d: %w", pid, err)
	}
	if !terminated {
		return fmt.Errorf("process %d could not be terminated or already terminated", pid)
	}
	return nil
}

func (p *PostgresDriver) InspectHealth(ctx context.Context) (*types.HealthReport, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	report := &types.HealthReport{
		Tables:          []types.TableStorageStat{},
		UnusedIndexes:   []types.UnusedIndexStat{},
		Recommendations: []types.RemediationAction{},
		CacheHitRatio:   100.0,
	}

	// 1. Cache hit ratio
	cacheQuery := `
		SELECT
			COALESCE(sum(heap_blks_hit), 0) AS hits,
			COALESCE(sum(heap_blks_read), 0) AS reads
		FROM pg_statio_user_tables;
	`
	var hits, reads int64
	if err := p.db.QueryRowContext(ctxTimeout, cacheQuery).Scan(&hits, &reads); err == nil {
		if hits+reads > 0 {
			report.CacheHitRatio = math.Round((float64(hits)/float64(hits+reads)*100.0)*10) / 10
		}
	}

	// 2. Database size
	var dbSizeBytes int64
	if err := p.db.QueryRowContext(ctxTimeout, "SELECT COALESCE(pg_database_size(current_database()), 0);").Scan(&dbSizeBytes); err == nil {
		report.DatabaseSizeBytes = dbSizeBytes
		report.DatabaseSize = types.FormatBytes(dbSizeBytes)
	}

	// 3. Table storage and dead tuples
	tablesQuery := `
		SELECT
			schemaname,
			relname,
			COALESCE(pg_total_relation_size(relid), 0) AS total_bytes,
			COALESCE(pg_relation_size(relid), 0) AS data_bytes,
			COALESCE(pg_indexes_size(relid), 0) AS index_bytes,
			COALESCE(n_live_tup, 0) AS row_count,
			COALESCE(n_dead_tup, 0) AS dead_tuples
		FROM pg_stat_user_tables
		ORDER BY total_bytes DESC;
	`
	rows, err := p.db.QueryContext(ctxTimeout, tablesQuery)
	if err != nil {
		return nil, fmt.Errorf("failed to query table stats: %w", err)
	}
	defer rows.Close()

	var totalDeadTuples int64
	for rows.Next() {
		var stat types.TableStorageStat
		if err := rows.Scan(
			&stat.Schema,
			&stat.Table,
			&stat.TotalBytes,
			&stat.DataBytes,
			&stat.IndexBytes,
			&stat.RowCount,
			&stat.DeadTuples,
		); err != nil {
			return nil, err
		}
		stat.TotalSize = types.FormatBytes(stat.TotalBytes)
		stat.DataSize = types.FormatBytes(stat.DataBytes)
		stat.IndexSize = types.FormatBytes(stat.IndexBytes)
		stat.RemediationSQL = fmt.Sprintf(`VACUUM ANALYZE "%s"."%s";`, stat.Schema, stat.Table)

		totalDeadTuples += stat.DeadTuples
		report.Tables = append(report.Tables, stat)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	report.TotalTables = len(report.Tables)
	report.DeadTuples = totalDeadTuples

	// 4. Unused indexes (idx_scan = 0 and not primary key)
	unusedIdxQuery := `
		SELECT
			s.schemaname,
			s.relname,
			s.indexrelname,
			COALESCE(pg_relation_size(s.indexrelid), 0) AS size_bytes,
			COALESCE(s.idx_scan, 0) AS scans
		FROM pg_stat_user_indexes s
		JOIN pg_index i ON s.indexrelid = i.indexrelid
		WHERE s.idx_scan = 0
		  AND NOT i.indisprimary
		ORDER BY size_bytes DESC;
	`
	idxRows, err := p.db.QueryContext(ctxTimeout, unusedIdxQuery)
	if err == nil {
		defer idxRows.Close()
		for idxRows.Next() {
			var uidx types.UnusedIndexStat
			if err := idxRows.Scan(
				&uidx.Schema,
				&uidx.Table,
				&uidx.Index,
				&uidx.SizeBytes,
				&uidx.Scans,
			); err == nil {
				uidx.Size = types.FormatBytes(uidx.SizeBytes)
				uidx.RemediationSQL = fmt.Sprintf(`DROP INDEX CONCURRENTLY "%s"."%s";`, uidx.Schema, uidx.Index)
				report.UnusedIndexes = append(report.UnusedIndexes, uidx)
			}
		}
	}

	// Also count total indexes
	var totalIndexes int
	_ = p.db.QueryRowContext(ctxTimeout, "SELECT count(*) FROM pg_stat_user_indexes;").Scan(&totalIndexes)
	report.TotalIndexes = totalIndexes

	// 5. Recommendations
	recID := 1
	if report.CacheHitRatio < 80.0 {
		report.Recommendations = append(report.Recommendations, types.RemediationAction{
			ID:          fmt.Sprintf("rec-%d", recID),
			Title:       "Low Cache Hit Ratio (< 80%)",
			Description: fmt.Sprintf("Buffer cache hit ratio is %.1f%%. Many queries read directly from disk. Consider increasing shared_buffers and running ANALYZE.", report.CacheHitRatio),
			Severity:    "critical",
			Category:    "cache",
			SQL:         "ANALYZE;",
		})
		recID++
	} else if report.CacheHitRatio < 95.0 {
		report.Recommendations = append(report.Recommendations, types.RemediationAction{
			ID:          fmt.Sprintf("rec-%d", recID),
			Title:       "Cache Hit Ratio Below Target (< 95%)",
			Description: fmt.Sprintf("Buffer cache hit ratio is %.1f%%. Target is >= 95%% for optimal performance. Refresh table planner statistics.", report.CacheHitRatio),
			Severity:    "warning",
			Category:    "cache",
			SQL:         "ANALYZE;",
		})
		recID++
	}

	for _, tbl := range report.Tables {
		if tbl.DeadTuples > 0 {
			severity := "info"
			if tbl.DeadTuples > 10000 || (tbl.RowCount > 0 && float64(tbl.DeadTuples)/float64(tbl.RowCount) > 0.2) {
				severity = "critical"
			} else if tbl.DeadTuples > 500 {
				severity = "warning"
			}
			report.Recommendations = append(report.Recommendations, types.RemediationAction{
				ID:          fmt.Sprintf("rec-%d", recID),
				Title:       fmt.Sprintf(`Vacuum Analyze "%s"."%s"`, tbl.Schema, tbl.Table),
				Description: fmt.Sprintf("Table has %d dead tuples. VACUUM ANALYZE will reclaim dead row storage and update query planner cost estimates.", tbl.DeadTuples),
				Severity:    severity,
				Category:    "bloat",
				SQL:         fmt.Sprintf(`VACUUM ANALYZE "%s"."%s";`, tbl.Schema, tbl.Table),
			})
			recID++
		}
	}

	for _, uidx := range report.UnusedIndexes {
		severity := "info"
		if uidx.SizeBytes > 10*1024*1024 {
			severity = "warning"
		}
		report.Recommendations = append(report.Recommendations, types.RemediationAction{
			ID:          fmt.Sprintf("rec-%d", recID),
			Title:       fmt.Sprintf(`Drop Unused Index "%s"`, uidx.Index),
			Description: fmt.Sprintf("Index on %s.%s has 0 scans and occupies %s of disk space. Dropping unused indexes saves storage and avoids index maintenance on writes.", uidx.Schema, uidx.Table, uidx.Size),
			Severity:    severity,
			Category:    "unused_index",
			SQL:         fmt.Sprintf(`DROP INDEX CONCURRENTLY "%s"."%s";`, uidx.Schema, uidx.Index),
		})
		recID++
	}

	return report, nil
}




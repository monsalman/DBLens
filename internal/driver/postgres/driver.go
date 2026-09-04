package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
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
		Columns: []types.ColumnMeta{},
		FKs:     []types.ForeignKey{},
		Indexes: []string{},
	}

	colQuery := `
		SELECT 
			c.column_name, 
			c.data_type, 
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

	fkQuery := `
		SELECT
			kcu.column_name,
			ccu.table_name AS foreign_table_name,
			ccu.column_name AS foreign_column_name
		FROM information_schema.table_constraints AS tc
		JOIN information_schema.key_column_usage AS kcu
			ON tc.constraint_name = kcu.constraint_name
			AND tc.table_schema = kcu.table_schema
		JOIN information_schema.constraint_column_usage AS ccu
			ON ccu.constraint_name = tc.constraint_name
			AND ccu.table_schema = tc.table_schema
		WHERE tc.constraint_type = 'FOREIGN KEY'
			AND tc.table_schema = $1
			AND tc.table_name = $2;
	`
	fkRows, err := p.db.QueryContext(ctxTimeout, fkQuery, schema, table)
	if err == nil {
		defer fkRows.Close()
		fkCols := make(map[string]bool)
		for fkRows.Next() {
			var fk types.ForeignKey
			if err := fkRows.Scan(&fk.Column, &fk.RefTable, &fk.RefColumn); err == nil {
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
		SELECT indexname
		FROM pg_indexes
		WHERE schemaname = $1 AND tablename = $2;
	`
	idxRows, err := p.db.QueryContext(ctxTimeout, idxQuery, schema, table)
	if err == nil {
		defer idxRows.Close()
		for idxRows.Next() {
			var idxName string
			if err := idxRows.Scan(&idxName); err == nil {
				detail.Indexes = append(detail.Indexes, idxName)
			}
		}
	}

	return detail, nil
}

func (p *PostgresDriver) QueryTableData(ctx context.Context, opts types.QueryOptions) (*types.QueryResult, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

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

	targetTable := fmt.Sprintf(`"%s"."%s"`, opts.Schema, opts.Table)
	sb.WriteString(fmt.Sprintf(`SELECT * FROM %s`, targetTable))

	if len(opts.Filters) > 0 {
		sb.WriteString(" WHERE ")
		for i, f := range opts.Filters {
			if i > 0 {
				sb.WriteString(" AND ")
			}
			col := fmt.Sprintf(`"%s"`, f.Column)
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
		if strings.ToUpper(opts.OrderDir) == "DESC" {
			dir = "DESC"
		}
		sb.WriteString(fmt.Sprintf(` ORDER BY "%s" %s`, opts.OrderBy, dir))
	}

	sb.WriteString(fmt.Sprintf(" LIMIT $%d OFFSET $%d", argIdx, argIdx+1))
	args = append(args, opts.Limit, opts.Offset)

	sqlStr := sb.String()
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
	targetTable := fmt.Sprintf(`"%s"."%s"`, m.Schema, m.Table)

	var sqlStr string
	var args []interface{}
	argIdx := 1

	switch m.Type {
	case types.MutationInsert:
		var cols []string
		var placeholders []string
		for col, val := range m.Data {
			cols = append(cols, fmt.Sprintf(`"%s"`, col))
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
			sets = append(sets, fmt.Sprintf(`"%s" = $%d`, col, argIdx))
			args = append(args, val)
			argIdx++
		}
		var wheres []string
		for col, val := range m.Where {
			wheres = append(wheres, fmt.Sprintf(`"%s" = $%d`, col, argIdx))
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
			wheres = append(wheres, fmt.Sprintf(`"%s" = $%d`, col, argIdx))
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

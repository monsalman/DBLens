package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
	_ "github.com/go-sql-driver/mysql"
)

type MySQLDriver struct {
	db *sql.DB
}

func New(dsn string) (*MySQLDriver, error) {
	cleanDSN := strings.TrimPrefix(dsn, "mysql://")
	db, err := sql.Open("mysql", cleanDSN)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(10 * time.Minute)
	return &MySQLDriver{db: db}, nil
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
		Columns: []types.ColumnMeta{},
		FKs:     []types.ForeignKey{},
		Indexes: []string{},
	}

	colQuery := `
		SELECT 
			column_name, 
			data_type, 
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
		var isNullable string
		var colKey string
		var defVal sql.NullString

		if err := colRows.Scan(&col.Name, &col.DataType, &isNullable, &defVal, &colKey); err != nil {
			return nil, err
		}
		col.IsNullable = (isNullable == "YES")
		col.IsPrimary = (colKey == "PRI")
		if defVal.Valid {
			col.Default = &defVal.String
		}
		detail.Columns = append(detail.Columns, col)
	}

	fkQuery := `
		SELECT 
			column_name, 
			referenced_table_name, 
			referenced_column_name
		FROM information_schema.key_column_usage
		WHERE table_schema = CASE WHEN ? = '' THEN DATABASE() ELSE ? END 
		  AND table_name = ?
		  AND referenced_table_name IS NOT NULL;
	`
	fkRows, err := m.db.QueryContext(ctxTimeout, fkQuery, schema, schema, table)
	if err == nil {
		defer fkRows.Close()
		for fkRows.Next() {
			var fk types.ForeignKey
			if err := fkRows.Scan(&fk.Column, &fk.RefTable, &fk.RefColumn); err == nil {
				detail.FKs = append(detail.FKs, fk)
			}
		}
	}

	idxQuery := `
		SELECT DISTINCT index_name
		FROM information_schema.statistics
		WHERE table_schema = CASE WHEN ? = '' THEN DATABASE() ELSE ? END 
		  AND table_name = ?;
	`
	idxRows, err := m.db.QueryContext(ctxTimeout, idxQuery, schema, schema, table)
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

func (m *MySQLDriver) QueryTableData(ctx context.Context, opts types.QueryOptions) (*types.QueryResult, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 500
	}
	if opts.Offset < 0 {
		opts.Offset = 0
	}

	var sb strings.Builder
	var args []interface{}

	if opts.Schema != "" {
		sb.WriteString(fmt.Sprintf("SELECT * FROM `%s`.`%s`", opts.Schema, opts.Table))
	} else {
		sb.WriteString(fmt.Sprintf("SELECT * FROM `%s`", opts.Table))
	}

	if len(opts.Filters) > 0 {
		sb.WriteString(" WHERE ")
		for i, f := range opts.Filters {
			if i > 0 {
				sb.WriteString(" AND ")
			}
			col := fmt.Sprintf("`%s`", f.Column)
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
		if strings.ToUpper(opts.OrderDir) == "DESC" {
			dir = "DESC"
		}
		sb.WriteString(fmt.Sprintf(" ORDER BY `%s` %s", opts.OrderBy, dir))
	}

	sb.WriteString(" LIMIT ? OFFSET ?")
	args = append(args, opts.Limit, opts.Offset)

	sqlStr := sb.String()
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
		targetTable = fmt.Sprintf("`%s`.`%s`", mut.Schema, mut.Table)
	} else {
		targetTable = fmt.Sprintf("`%s`", mut.Table)
	}

	var sqlStr string
	var args []interface{}

	switch mut.Type {
	case types.MutationInsert:
		var cols []string
		var placeholders []string
		for col, val := range mut.Data {
			cols = append(cols, fmt.Sprintf("`%s`", col))
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
			sets = append(sets, fmt.Sprintf("`%s` = ?", col))
			args = append(args, val)
		}
		var wheres []string
		for col, val := range mut.Where {
			wheres = append(wheres, fmt.Sprintf("`%s` = ?", col))
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
			wheres = append(wheres, fmt.Sprintf("`%s` = ?", col))
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

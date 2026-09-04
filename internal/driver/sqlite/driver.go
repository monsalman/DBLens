package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
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
		Columns: []types.ColumnMeta{},
		FKs:     []types.ForeignKey{},
		Indexes: []string{},
	}

	pragmaQuery := fmt.Sprintf("PRAGMA table_info(`%s`);", table)
	rows, err := s.db.QueryContext(ctxTimeout, pragmaQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

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
			DataType:   dType,
			IsNullable: (notNull == 0),
			IsPrimary:  (pk > 0),
		}
		if dfltVal.Valid {
			col.Default = &dfltVal.String
		}
		detail.Columns = append(detail.Columns, col)
	}

	fkPragma := fmt.Sprintf("PRAGMA foreign_key_list(`%s`);", table)
	fkRows, err := s.db.QueryContext(ctxTimeout, fkPragma)
	if err == nil {
		defer fkRows.Close()
		for fkRows.Next() {
			var id, seq int
			var refTable, fromCol, toCol, onUpdate, onDelete, match string
			if err := fkRows.Scan(&id, &seq, &refTable, &fromCol, &toCol, &onUpdate, &onDelete, &match); err == nil {
				detail.FKs = append(detail.FKs, types.ForeignKey{
					Column:    fromCol,
					RefTable:  refTable,
					RefColumn: toCol,
				})
			}
		}
	}

	idxPragma := fmt.Sprintf("PRAGMA index_list(`%s`);", table)
	idxRows, err := s.db.QueryContext(ctxTimeout, idxPragma)
	if err == nil {
		defer idxRows.Close()
		for idxRows.Next() {
			var seq int
			var idxName string
			var unique, origin, partial int
			if err := idxRows.Scan(&seq, &idxName, &unique, &origin, &partial); err == nil {
				detail.Indexes = append(detail.Indexes, idxName)
			}
		}
	}

	return detail, nil
}

func (s *SQLiteDriver) QueryTableData(ctx context.Context, opts types.QueryOptions) (*types.QueryResult, error) {
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

	sb.WriteString(fmt.Sprintf("SELECT * FROM `%s`", opts.Table))

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

func (s *SQLiteDriver) ExecuteQuery(ctx context.Context, rawSql string) (*types.QueryResult, error) {
	ctxTimeout, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	start := time.Now()
	trimmed := strings.TrimSpace(rawSql)
	upper := strings.ToUpper(trimmed)

	if strings.HasPrefix(upper, "SELECT") || strings.HasPrefix(upper, "EXPLAIN") || strings.HasPrefix(upper, "PRAGMA") {
		rows, err := s.db.QueryContext(ctxTimeout, trimmed)
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

	res, err := s.db.ExecContext(ctxTimeout, trimmed)
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

	targetTable := fmt.Sprintf("`%s`", mut.Table)
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
	return erd, nil
}

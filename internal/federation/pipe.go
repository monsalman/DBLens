package federation

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/alter"
	"github.com/dblens/dblens/internal/driver/types"
)

// PipeRequest specifies parameters for streaming a table from source to target database.
type PipeRequest struct {
	SourceConnID  string `json:"sourceConnId"`
	TargetConnID  string `json:"targetConnId"`
	SourceSchema  string `json:"sourceSchema"`
	SourceTable   string `json:"sourceTable"`
	TargetSchema  string `json:"targetSchema"`
	TargetTable   string `json:"targetTable"`
	CreateTable   bool   `json:"createTable"`
	TruncateTable bool   `json:"truncateTable"`
	BatchSize     int    `json:"batchSize"`
}

// PipeResult captures metrics from the data migration stream.
type PipeResult struct {
	RowsMigrated int64  `json:"rowsMigrated"`
	ElapsedMs    int64  `json:"elapsedMs"`
	SourceTable  string `json:"sourceTable"`
	TargetTable  string `json:"targetTable"`
	Message      string `json:"message"`
}

// MapColumnType converts a column type between SQL dialects (Postgres, MySQL, SQLite).
func MapColumnType(srcDialect, tgtDialect, colType string) string {
	src := alter.NormalizeDialect(srcDialect)
	tgt := alter.NormalizeDialect(tgtDialect)
	cleanType := strings.TrimSpace(colType)
	if cleanType == "" {
		cleanType = "TEXT"
	}
	lower := strings.ToLower(cleanType)

	if src == tgt {
		return cleanType
	}

	switch tgt {
	case "sqlite":
		if strings.Contains(lower, "int") || strings.Contains(lower, "serial") {
			return "INTEGER"
		}
		if strings.Contains(lower, "float") || strings.Contains(lower, "double") ||
			strings.Contains(lower, "real") || strings.Contains(lower, "numeric") ||
			strings.Contains(lower, "decimal") {
			return "REAL"
		}
		if strings.Contains(lower, "bool") {
			return "INTEGER"
		}
		if strings.Contains(lower, "blob") || strings.Contains(lower, "bytea") || strings.Contains(lower, "binary") {
			return "BLOB"
		}
		return "TEXT"

	case "mysql":
		if strings.Contains(lower, "uuid") {
			return "VARCHAR(36)"
		}
		if strings.Contains(lower, "jsonb") {
			return "JSON"
		}
		if strings.Contains(lower, "bool") {
			return "TINYINT(1)"
		}
		if strings.Contains(lower, "bytea") {
			return "LONGBLOB"
		}
		if strings.Contains(lower, "timestamptz") || strings.Contains(lower, "timestamp with time zone") {
			return "DATETIME"
		}
		if lower == "serial" {
			return "INT AUTO_INCREMENT"
		}
		if lower == "bigserial" {
			return "BIGINT AUTO_INCREMENT"
		}
		return cleanType

	case "postgres":
		if lower == "tinyint(1)" || lower == "bool" || lower == "boolean" {
			return "BOOLEAN"
		}
		if lower == "tinyint" {
			return "SMALLINT"
		}
		if lower == "mediumint" {
			return "INTEGER"
		}
		if strings.Contains(lower, "datetime") {
			return "TIMESTAMP"
		}
		if strings.Contains(lower, "longtext") || strings.Contains(lower, "mediumtext") || strings.Contains(lower, "tinytext") {
			return "TEXT"
		}
		if strings.Contains(lower, "blob") || strings.Contains(lower, "binary") {
			return "BYTEA"
		}
		if strings.Contains(lower, "double") {
			return "DOUBLE PRECISION"
		}
		return cleanType

	default:
		return cleanType
	}
}

func quoteIdent(name, dialect string) string {
	d := alter.NormalizeDialect(dialect)
	switch d {
	case "mysql":
		return fmt.Sprintf("`%s`", strings.ReplaceAll(name, "`", "``"))
	default:
		return fmt.Sprintf(`"%s"`, strings.ReplaceAll(name, `"`, `""`))
	}
}

func quoteTableRef(schema, table, dialect string) string {
	d := alter.NormalizeDialect(dialect)
	cleanSchema := strings.TrimSpace(schema)
	cleanTable := strings.TrimSpace(table)

	if cleanSchema == "" || d == "sqlite" {
		return quoteIdent(cleanTable, d)
	}
	return fmt.Sprintf("%s.%s", quoteIdent(cleanSchema, d), quoteIdent(cleanTable, d))
}

// GenerateCreateTableDDL constructs a CREATE TABLE statement for the target driver.
func GenerateCreateTableDDL(cols []types.ColumnMeta, schema, table, srcDialect, tgtDialect string) string {
	tgt := alter.NormalizeDialect(tgtDialect)
	var colDefs []string
	var pks []string

	for _, c := range cols {
		mapped := MapColumnType(srcDialect, tgt, c.Type)
		colSQL := fmt.Sprintf("  %s %s", quoteIdent(c.Name, tgt), mapped)
		if !c.IsNullable {
			colSQL += " NOT NULL"
		}
		if c.IsPrimary {
			pks = append(pks, quoteIdent(c.Name, tgt))
		}
		colDefs = append(colDefs, colSQL)
	}

	if len(pks) > 0 {
		colDefs = append(colDefs, fmt.Sprintf("  PRIMARY KEY (%s)", strings.Join(pks, ", ")))
	}

	tblRef := quoteTableRef(schema, table, tgt)
	return fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s (\n%s\n);", tblRef, strings.Join(colDefs, ",\n"))
}

// ExecutePipe streams rows from source driver into target driver.
func ExecutePipe(ctx context.Context, req PipeRequest, srcDriver, tgtDriver types.Driver) (*PipeResult, error) {
	start := time.Now()

	batchSize := req.BatchSize
	if batchSize < 10 {
		batchSize = 500
	}
	if batchSize > 5000 {
		batchSize = 5000
	}

	targetTable := strings.TrimSpace(req.TargetTable)
	if targetTable == "" {
		targetTable = strings.TrimSpace(req.SourceTable)
	}
	if targetTable == "" {
		return nil, fmt.Errorf("target table name is required")
	}

	sourceTable := strings.TrimSpace(req.SourceTable)
	if sourceTable == "" {
		return nil, fmt.Errorf("source table name is required")
	}

	// 1. Inspect source table schema if CreateTable is requested
	if req.CreateTable {
		details, err := srcDriver.InspectTableDetails(ctx, req.SourceSchema, sourceTable)
		if err != nil || details == nil || len(details.Columns) == 0 {
			// Fallback to querying 1 row to get column names
			opts := types.QueryOptions{Schema: req.SourceSchema, Table: sourceTable, Limit: 1}
			res, qErr := srcDriver.QueryTableData(ctx, opts)
			if qErr != nil {
				return nil, fmt.Errorf("could not inspect source table: %v", err)
			}
			var fallbackCols []types.ColumnMeta
			for _, col := range res.Columns {
				fallbackCols = append(fallbackCols, types.ColumnMeta{
					Name: col,
					Type: "TEXT",
				})
			}
			details = &types.TableDetail{Columns: fallbackCols}
		}

		ddl := GenerateCreateTableDDL(details.Columns, req.TargetSchema, targetTable, srcDriver.Dialect(), tgtDriver.Dialect())
		if _, err := tgtDriver.ExecuteQuery(ctx, ddl); err != nil {
			return nil, fmt.Errorf("failed to create target table: %w", err)
		}
	}

	// 2. Truncate target table if requested
	if req.TruncateTable {
		var truncSQL string
		tblRef := quoteTableRef(req.TargetSchema, targetTable, tgtDriver.Dialect())
		if alter.NormalizeDialect(tgtDriver.Dialect()) == "sqlite" {
			truncSQL = fmt.Sprintf("DELETE FROM %s;", tblRef)
		} else {
			truncSQL = fmt.Sprintf("TRUNCATE TABLE %s;", tblRef)
		}
		if _, err := tgtDriver.ExecuteQuery(ctx, truncSQL); err != nil {
			return nil, fmt.Errorf("failed to truncate target table: %w", err)
		}
	}

	// 3. Stream data from source driver
	var rowsMigrated int64
	var streamRows *sql.Rows
	var streamErr error

	streamRows, streamErr = srcDriver.QueryTableStream(ctx, req.SourceSchema, sourceTable)
	if streamErr == nil && streamRows != nil {
		defer streamRows.Close()
		cols, err := streamRows.Columns()
		if err != nil {
			return nil, fmt.Errorf("read stream columns failed: %w", err)
		}

		batch := make([]map[string]interface{}, 0, batchSize)
		for streamRows.Next() {
			vals := make([]interface{}, len(cols))
			ptrs := make([]interface{}, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if err := streamRows.Scan(ptrs...); err != nil {
				return nil, fmt.Errorf("scan stream row failed: %w", err)
			}

			rowMap := make(map[string]interface{}, len(cols))
			for i, col := range cols {
				val := vals[i]
				if b, ok := val.([]byte); ok {
					rowMap[col] = string(b)
				} else {
					rowMap[col] = val
				}
			}
			batch = append(batch, rowMap)

			if len(batch) >= batchSize {
				if _, err := tgtDriver.BatchInsert(ctx, req.TargetSchema, targetTable, batch); err != nil {
					return nil, fmt.Errorf("batch insert failed at row %d: %w", rowsMigrated, err)
				}
				rowsMigrated += int64(len(batch))
				batch = batch[:0]
			}
		}

		if err := streamRows.Err(); err != nil {
			return nil, fmt.Errorf("stream read error: %w", err)
		}

		if len(batch) > 0 {
			if _, err := tgtDriver.BatchInsert(ctx, req.TargetSchema, targetTable, batch); err != nil {
				return nil, fmt.Errorf("batch insert final chunk failed: %w", err)
			}
			rowsMigrated += int64(len(batch))
		}
	} else {
		// Fallback: QueryTableData with chunked offset loop
		limit := batchSize
		offset := 0
		for {
			opts := types.QueryOptions{
				Schema: req.SourceSchema,
				Table:  sourceTable,
				Limit:  limit,
				Offset: offset,
			}
			res, err := srcDriver.QueryTableData(ctx, opts)
			if err != nil {
				return nil, fmt.Errorf("fallback query failed at offset %d: %w", offset, err)
			}
			if len(res.Rows) == 0 {
				break
			}

			batch := make([]map[string]interface{}, len(res.Rows))
			for rIdx, r := range res.Rows {
				rowMap := make(map[string]interface{}, len(res.Columns))
				for cIdx, col := range res.Columns {
					if cIdx < len(r) {
						rowMap[col] = r[cIdx]
					}
				}
				batch[rIdx] = rowMap
			}

			if _, err := tgtDriver.BatchInsert(ctx, req.TargetSchema, targetTable, batch); err != nil {
				return nil, fmt.Errorf("batch insert failed at offset %d: %w", offset, err)
			}
			rowsMigrated += int64(len(batch))
			if len(res.Rows) < limit {
				break
			}
			offset += limit
		}
	}

	elapsed := time.Since(start).Milliseconds()

	return &PipeResult{
		RowsMigrated: rowsMigrated,
		ElapsedMs:    elapsed,
		SourceTable:  sourceTable,
		TargetTable:  targetTable,
		Message:      fmt.Sprintf("Successfully migrated %d rows in %d ms", rowsMigrated, elapsed),
	}, nil
}

package seeder

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
)

// TableData holds the table name, generated rows, primary key column, and deferred updates.
type TableData struct {
	Table       string                   `json:"table"`
	Schema      string                   `json:"schema,omitempty"`
	PKColumn    string                   `json:"pkColumn,omitempty"`
	Rows        []map[string]interface{} `json:"rows"`
	DeferredFKs []DeferredUpdate         `json:"deferredFks,omitempty"`
}

// DeferredUpdate specifies a second-pass update for a self-referencing or circular FK.
type DeferredUpdate struct {
	PKValue interface{} `json:"pkValue"`
	FKCol   string      `json:"fkCol"`
	FKValue interface{} `json:"fkValue"`
}

// WriteBatch inserts rows into the specified table in chunks of batchSize.
func WriteBatch(ctx context.Context, drv types.Driver, schema, table string, rows []map[string]interface{}, batchSize int) (int64, error) {
	if len(rows) == 0 {
		return 0, nil
	}
	if batchSize <= 0 {
		batchSize = 500
	}

	var totalInserted int64
	for i := 0; i < len(rows); i += batchSize {
		end := i + batchSize
		if end > len(rows) {
			end = len(rows)
		}
		chunk := rows[i:end]
		res, err := drv.BatchInsert(ctx, schema, table, chunk)
		if err != nil {
			return totalInserted, fmt.Errorf("batch insert failed at row %d-%d for table %s: %w", i, end, table, err)
		}
		if res != nil {
			totalInserted += res.AffectedRows
		} else {
			totalInserted += int64(len(chunk))
		}
	}
	return totalInserted, nil
}

// ApplyDeferredUpdates executes pass-2 updates for self-referencing and circular foreign keys.
func ApplyDeferredUpdates(ctx context.Context, drv types.Driver, schema, table, pkCol string, updates []DeferredUpdate) error {
	if len(updates) == 0 || pkCol == "" {
		return nil
	}
	dialect := drv.Dialect()
	quotedTable := quoteTable(dialect, schema, table)
	quotedPK := quoteIdent(dialect, pkCol)

	for _, upd := range updates {
		quotedFK := quoteIdent(dialect, upd.FKCol)
		var query string
		var args []interface{}

		if dialect == "postgres" {
			query = fmt.Sprintf("UPDATE %s SET %s = $1 WHERE %s = $2", quotedTable, quotedFK, quotedPK)
			args = []interface{}{upd.FKValue, upd.PKValue}
		} else {
			query = fmt.Sprintf("UPDATE %s SET %s = ? WHERE %s = ?", quotedTable, quotedFK, quotedPK)
			args = []interface{}{upd.FKValue, upd.PKValue}
		}

		if _, err := drv.ExecuteRaw(ctx, query, args...); err != nil {
			return fmt.Errorf("deferred update failed for %s.%s: %w", table, upd.FKCol, err)
		}
	}
	return nil
}

// FormatSQLLiteral converts a Go value into a safe SQL literal for standalone script export.
func FormatSQLLiteral(val interface{}) string {
	if val == nil {
		return "NULL"
	}
	switch v := val.(type) {
	case string:
		escaped := strings.ReplaceAll(v, "'", "''")
		return fmt.Sprintf("'%s'", escaped)
	case bool:
		if v {
			return "TRUE"
		}
		return "FALSE"
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return fmt.Sprintf("%d", v)
	case float32, float64:
		return fmt.Sprintf("%v", v)
	case time.Time:
		return fmt.Sprintf("'%s'", v.Format(time.RFC3339))
	case []byte:
		escaped := strings.ReplaceAll(string(v), "'", "''")
		return fmt.Sprintf("'%s'", escaped)
	case map[string]interface{}, []interface{}:
		b, err := json.Marshal(v)
		if err == nil {
			escaped := strings.ReplaceAll(string(b), "'", "''")
			return fmt.Sprintf("'%s'", escaped)
		}
		return "NULL"
	default:
		escaped := strings.ReplaceAll(fmt.Sprintf("%v", v), "'", "''")
		return fmt.Sprintf("'%s'", escaped)
	}
}

// ExportSQL renders a complete standalone SQL script with transactions and DML statements.
func ExportSQL(dialect, schema string, tables []TableData) (string, error) {
	var sb strings.Builder

	// Header & Foreign Key safety pragmas
	switch dialect {
	case "mysql":
		sb.WriteString("-- DBLens Relational Synthetic Fixture (MySQL)\n")
		sb.WriteString("SET FOREIGN_KEY_CHECKS = 0;\n")
		sb.WriteString("START TRANSACTION;\n\n")
	case "postgres":
		sb.WriteString("-- DBLens Relational Synthetic Fixture (PostgreSQL)\n")
		sb.WriteString("SET CONSTRAINTS ALL DEFERRED;\n")
		sb.WriteString("BEGIN;\n\n")
	default: // sqlite
		sb.WriteString("-- DBLens Relational Synthetic Fixture (SQLite)\n")
		sb.WriteString("PRAGMA foreign_keys = OFF;\n")
		sb.WriteString("BEGIN TRANSACTION;\n\n")
	}

	// 1. First-pass INSERT statements for each table
	for _, td := range tables {
		if len(td.Rows) == 0 {
			continue
		}
		quotedTable := quoteTable(dialect, schema, td.Table)
		sb.WriteString(fmt.Sprintf("-- Table: %s (%d rows)\n", td.Table, len(td.Rows)))

		for _, row := range td.Rows {
			cols := make([]string, 0, len(row))
			vals := make([]string, 0, len(row))
			for col, val := range row {
				cols = append(cols, quoteIdent(dialect, col))
				vals = append(vals, FormatSQLLiteral(val))
			}
			sb.WriteString(fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s);\n",
				quotedTable,
				strings.Join(cols, ", "),
				strings.Join(vals, ", "),
			))
		}
		sb.WriteString("\n")
	}

	// 2. Second-pass deferred UPDATE statements
	hasUpdates := false
	for _, td := range tables {
		if len(td.DeferredFKs) > 0 && td.PKColumn != "" {
			if !hasUpdates {
				sb.WriteString("-- Second Pass: Deferred Foreign Key Updates\n")
				hasUpdates = true
			}
			quotedTable := quoteTable(dialect, schema, td.Table)
			quotedPK := quoteIdent(dialect, td.PKColumn)
			for _, upd := range td.DeferredFKs {
				quotedFK := quoteIdent(dialect, upd.FKCol)
				sb.WriteString(fmt.Sprintf("UPDATE %s SET %s = %s WHERE %s = %s;\n",
					quotedTable,
					quotedFK,
					FormatSQLLiteral(upd.FKValue),
					quotedPK,
					FormatSQLLiteral(upd.PKValue),
				))
			}
			sb.WriteString("\n")
		}
	}

	// Footer & Commit
	switch dialect {
	case "mysql":
		sb.WriteString("COMMIT;\n")
		sb.WriteString("SET FOREIGN_KEY_CHECKS = 1;\n")
	case "postgres":
		sb.WriteString("COMMIT;\n")
	default: // sqlite
		sb.WriteString("COMMIT;\n")
		sb.WriteString("PRAGMA foreign_keys = ON;\n")
	}

	return sb.String(), nil
}

// ExportJSON generates structured JSON fixture output.
func ExportJSON(seed int64, tables []TableData) ([]byte, error) {
	tableMap := make(map[string][]map[string]interface{})
	totalRows := 0
	for _, td := range tables {
		tableMap[td.Table] = td.Rows
		totalRows += len(td.Rows)
	}

	output := map[string]interface{}{
		"generatedAt": time.Now().UTC().Format(time.RFC3339),
		"seed":        seed,
		"totalRows":   totalRows,
		"tables":      tableMap,
	}

	return json.MarshalIndent(output, "", "  ")
}

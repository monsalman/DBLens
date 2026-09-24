package datadiff

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/dblens/dblens/internal/alter"
)

var reStrictIdentifier = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// IsValidIdentifier checks whether the string is a safe SQL identifier (table, schema, column).
func IsValidIdentifier(name string) bool {
	return reStrictIdentifier.MatchString(name)
}

// QuoteIdent quotes an identifier based on SQL dialect.
func QuoteIdent(name, dialect string) string {
	d := alter.NormalizeDialect(dialect)
	if d == "mysql" {
		return "`" + strings.ReplaceAll(name, "`", "``") + "`"
	}
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

// QuoteTableRef quotes schema.table properly.
func QuoteTableRef(schema, table, dialect string) string {
	d := alter.NormalizeDialect(dialect)
	schema = strings.TrimSpace(schema)
	table = strings.TrimSpace(table)
	if d == "sqlite" || schema == "" || schema == "main" {
		return QuoteIdent(table, d)
	}
	return QuoteIdent(schema, d) + "." + QuoteIdent(table, d)
}

// FormatLiteral escapes and formats a Go value into a safe SQL literal.
func FormatLiteral(val any, dialect string) string {
	if val == nil {
		return "NULL"
	}

	d := alter.NormalizeDialect(dialect)

	switch v := val.(type) {
	case bool:
		if d == "sqlite" {
			if v {
				return "1"
			}
			return "0"
		}
		if v {
			return "TRUE"
		}
		return "FALSE"

	case int, int8, int16, int32, int64:
		return fmt.Sprintf("%d", v)
	case uint, uint8, uint16, uint32, uint64:
		return fmt.Sprintf("%d", v)
	case float32, float64:
		return fmt.Sprintf("%v", v)

	case []byte:
		return fmt.Sprintf("X'%X'", v)

	case string:
		escaped := strings.ReplaceAll(v, "'", "''")
		if d == "mysql" {
			escaped = strings.ReplaceAll(escaped, `\`, `\\`)
		}
		return "'" + escaped + "'"

	default:
		// Map, slice, or structured type -> JSON string
		b, err := json.Marshal(v)
		if err != nil {
			escaped := strings.ReplaceAll(fmt.Sprintf("%v", v), "'", "''")
			if d == "mysql" {
				escaped = strings.ReplaceAll(escaped, `\`, `\\`)
			}
			return "'" + escaped + "'"
		}
		escaped := strings.ReplaceAll(string(b), "'", "''")
		if d == "mysql" {
			escaped = strings.ReplaceAll(escaped, `\`, `\\`)
		}
		return "'" + escaped + "'"
	}
}

// GenerateSyncScript generates DML statements and a transactional script according to the strategy.
func GenerateSyncScript(req SyncScriptRequest) (*SyncScriptResponse, error) {
	strategy := req.Strategy
	if strategy == "" {
		strategy = StrategySourceWins
	}

	// Validate target / source table names
	targetDialect := alter.NormalizeDialect(req.TargetDialect)
	if targetDialect == "" {
		targetDialect = "postgres"
	}

	for _, pk := range req.PrimaryKeys {
		if !IsValidIdentifier(pk) {
			return nil, fmt.Errorf("invalid primary key identifier: %q", pk)
		}
	}
	for _, col := range req.Columns {
		if !IsValidIdentifier(col) {
			return nil, fmt.Errorf("invalid column identifier: %q", col)
		}
	}

	var targetSchema, targetTable string
	var statements []string
	var insertCount, updateCount, deleteCount int

	// Primary key set for fast lookup
	pkSet := make(map[string]bool)
	for _, pk := range req.PrimaryKeys {
		pkSet[pk] = true
	}

	// Determine destination table and columns based on strategy
	switch strategy {
	case StrategySourceWins:
		targetSchema = req.TargetSchema
		targetTable = req.TargetTable
		if !IsValidIdentifier(targetTable) {
			return nil, fmt.Errorf("invalid target table identifier: %q", targetTable)
		}
		if targetSchema != "" && !IsValidIdentifier(targetSchema) {
			return nil, fmt.Errorf("invalid target schema identifier: %q", targetSchema)
		}
		tableRef := QuoteTableRef(targetSchema, targetTable, targetDialect)

		for _, row := range req.Rows {
			switch row.Status {
			case StatusAdded:
				// Row exists in source, missing in target -> INSERT into target
				stmt := buildInsertOrUpsert(tableRef, req.Columns, req.PrimaryKeys, row.SourceValues, targetDialect)
				if stmt != "" {
					statements = append(statements, stmt)
					insertCount++
				}

			case StatusModified:
				// Row exists in both, differs -> UPDATE target
				stmt := buildUpdate(tableRef, req.Columns, req.PrimaryKeys, pkSet, row.SourceValues, row.PKValues, targetDialect)
				if stmt != "" {
					statements = append(statements, stmt)
					updateCount++
				}

			case StatusDeleted:
				// Row missing in source, exists in target -> DELETE from target if DeleteExcess
				if req.DeleteExcess {
					stmt := buildDelete(tableRef, req.PrimaryKeys, row.PKValues, targetDialect)
					if stmt != "" {
						statements = append(statements, stmt)
						deleteCount++
					}
				}
			}
		}

	case StrategyTargetWins:
		// Opposite direction: source is updated to match target
		targetSchema = req.SourceSchema
		targetTable = req.SourceTable
		if !IsValidIdentifier(targetTable) {
			return nil, fmt.Errorf("invalid source table identifier: %q", targetTable)
		}
		if targetSchema != "" && !IsValidIdentifier(targetSchema) {
			return nil, fmt.Errorf("invalid source schema identifier: %q", targetSchema)
		}
		tableRef := QuoteTableRef(targetSchema, targetTable, targetDialect)

		for _, row := range req.Rows {
			switch row.Status {
			case StatusDeleted:
				// Row exists in target, missing in source -> INSERT into source
				stmt := buildInsertOrUpsert(tableRef, req.Columns, req.PrimaryKeys, row.TargetValues, targetDialect)
				if stmt != "" {
					statements = append(statements, stmt)
					insertCount++
				}

			case StatusModified:
				// Row differs -> UPDATE source to target values
				stmt := buildUpdate(tableRef, req.Columns, req.PrimaryKeys, pkSet, row.TargetValues, row.PKValues, targetDialect)
				if stmt != "" {
					statements = append(statements, stmt)
					updateCount++
				}

			case StatusAdded:
				// Row exists in source, missing in target -> DELETE from source if DeleteExcess
				if req.DeleteExcess {
					stmt := buildDelete(tableRef, req.PrimaryKeys, row.PKValues, targetDialect)
					if stmt != "" {
						statements = append(statements, stmt)
						deleteCount++
					}
				}
			}
		}

	case StrategyInsertMissingOnly:
		// Only insert rows that exist in source but not in target
		targetSchema = req.TargetSchema
		targetTable = req.TargetTable
		if !IsValidIdentifier(targetTable) {
			return nil, fmt.Errorf("invalid target table identifier: %q", targetTable)
		}
		if targetSchema != "" && !IsValidIdentifier(targetSchema) {
			return nil, fmt.Errorf("invalid target schema identifier: %q", targetSchema)
		}
		tableRef := QuoteTableRef(targetSchema, targetTable, targetDialect)

		for _, row := range req.Rows {
			if row.Status == StatusAdded {
				stmt := buildInsertOrUpsert(tableRef, req.Columns, req.PrimaryKeys, row.SourceValues, targetDialect)
				if stmt != "" {
					statements = append(statements, stmt)
					insertCount++
				}
			}
		}

	default:
		return nil, fmt.Errorf("unsupported conflict strategy: %q", strategy)
	}

	// Format full transactional script
	var scriptBuilder strings.Builder
	scriptBuilder.WriteString(fmt.Sprintf("-- Data Diff Sync Script (%s)\n", strategy))
	scriptBuilder.WriteString(fmt.Sprintf("-- Dialect: %s | Generated Statements: %d\n", targetDialect, len(statements)))

	switch targetDialect {
	case "mysql":
		scriptBuilder.WriteString("START TRANSACTION;\n\n")
	case "sqlite":
		scriptBuilder.WriteString("BEGIN TRANSACTION;\n\n")
	default: // postgres
		scriptBuilder.WriteString("BEGIN;\n\n")
	}

	for _, stmt := range statements {
		scriptBuilder.WriteString(stmt)
		scriptBuilder.WriteString(";\n")
	}

	scriptBuilder.WriteString("\nCOMMIT;\n")

	return &SyncScriptResponse{
		SQL:           scriptBuilder.String(),
		Statements:    statements,
		InsertCount:   insertCount,
		UpdateCount:   updateCount,
		DeleteCount:   deleteCount,
		Strategy:      strategy,
		TargetDialect: targetDialect,
	}, nil
}

func buildInsertOrUpsert(tableRef string, columns, pks []string, values map[string]any, dialect string) string {
	if len(values) == 0 {
		return ""
	}

	var quotedCols []string
	var formattedVals []string

	for _, col := range columns {
		if val, exists := values[col]; exists {
			quotedCols = append(quotedCols, QuoteIdent(col, dialect))
			formattedVals = append(formattedVals, FormatLiteral(val, dialect))
		}
	}
	if len(quotedCols) == 0 {
		return ""
	}

	colList := strings.Join(quotedCols, ", ")
	valList := strings.Join(formattedVals, ", ")

	// If no PKs provided, standard INSERT
	if len(pks) == 0 {
		return fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", tableRef, colList, valList)
	}

	// Build idempotent UPSERT for PostgreSQL, MySQL, SQLite
	pkSet := make(map[string]bool)
	var quotedPKs []string
	for _, pk := range pks {
		pkSet[pk] = true
		quotedPKs = append(quotedPKs, QuoteIdent(pk, dialect))
	}

	var nonPKCols []string
	for _, col := range columns {
		if !pkSet[col] {
			if _, exists := values[col]; exists {
				nonPKCols = append(nonPKCols, col)
			}
		}
	}

	switch dialect {
	case "postgres":
		if len(nonPKCols) == 0 {
			return fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (%s) DO NOTHING",
				tableRef, colList, valList, strings.Join(quotedPKs, ", "))
		}
		var updates []string
		for _, col := range nonPKCols {
			qCol := QuoteIdent(col, dialect)
			updates = append(updates, fmt.Sprintf("%s = EXCLUDED.%s", qCol, qCol))
		}
		return fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (%s) DO UPDATE SET %s",
			tableRef, colList, valList, strings.Join(quotedPKs, ", "), strings.Join(updates, ", "))

	case "mysql":
		if len(nonPKCols) == 0 {
			return fmt.Sprintf("INSERT IGNORE INTO %s (%s) VALUES (%s)", tableRef, colList, valList)
		}
		var updates []string
		for _, col := range nonPKCols {
			qCol := QuoteIdent(col, dialect)
			updates = append(updates, fmt.Sprintf("%s = VALUES(%s)", qCol, qCol))
		}
		return fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) ON DUPLICATE KEY UPDATE %s",
			tableRef, colList, valList, strings.Join(updates, ", "))

	case "sqlite":
		if len(nonPKCols) == 0 {
			return fmt.Sprintf("INSERT OR IGNORE INTO %s (%s) VALUES (%s)", tableRef, colList, valList)
		}
		var updates []string
		for _, col := range nonPKCols {
			qCol := QuoteIdent(col, dialect)
			updates = append(updates, fmt.Sprintf("%s = excluded.%s", qCol, qCol))
		}
		return fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (%s) DO UPDATE SET %s",
			tableRef, colList, valList, strings.Join(quotedPKs, ", "), strings.Join(updates, ", "))

	default:
		return fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", tableRef, colList, valList)
	}
}

func buildUpdate(tableRef string, columns, pks []string, pkSet map[string]bool, values, pkValues map[string]any, dialect string) string {
	var setClauses []string
	for _, col := range columns {
		if !pkSet[col] {
			if val, exists := values[col]; exists {
				setClauses = append(setClauses, fmt.Sprintf("%s = %s", QuoteIdent(col, dialect), FormatLiteral(val, dialect)))
			}
		}
	}
	if len(setClauses) == 0 {
		return ""
	}

	whereClause := buildPKWhere(pks, pkValues, values, dialect)
	if whereClause == "" {
		return ""
	}

	return fmt.Sprintf("UPDATE %s SET %s WHERE %s", tableRef, strings.Join(setClauses, ", "), whereClause)
}

func buildDelete(tableRef string, pks []string, pkValues map[string]any, dialect string) string {
	whereClause := buildPKWhere(pks, pkValues, nil, dialect)
	if whereClause == "" {
		return ""
	}
	return fmt.Sprintf("DELETE FROM %s WHERE %s", tableRef, whereClause)
}

func buildPKWhere(pks []string, pkValues, fallbackValues map[string]any, dialect string) string {
	var conds []string
	for _, pk := range pks {
		var val any
		var ok bool
		if pkValues != nil {
			val, ok = pkValues[pk]
		}
		if !ok && fallbackValues != nil {
			val, ok = fallbackValues[pk]
		}
		if !ok {
			return ""
		}
		qPK := QuoteIdent(pk, dialect)
		if val == nil {
			conds = append(conds, fmt.Sprintf("%s IS NULL", qPK))
		} else {
			conds = append(conds, fmt.Sprintf("%s = %s", qPK, FormatLiteral(val, dialect)))
		}
	}
	if len(conds) == 0 {
		return ""
	}
	return strings.Join(conds, " AND ")
}

package alter

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/dblens/dblens/internal/driver/types"
)

var (
	validDataTypeRegex = regexp.MustCompile(`^[A-Za-z0-9_(), ]+$`)
	safeExprRegex     = regexp.MustCompile(`^[A-Za-z0-9_]+(\(\))?$`)
	allowedFKActions  = map[string]bool{
		"CASCADE":     true,
		"SET NULL":    true,
		"SET DEFAULT": true,
		"RESTRICT":    true,
		"NO ACTION":   true,
	}
)

// NormalizeDialect maps dialect strings to standard keys: "postgres", "mysql", "sqlite".
func NormalizeDialect(d string) string {
	d = strings.ToLower(strings.TrimSpace(d))
	switch d {
	case "postgres", "postgresql", "pg":
		return "postgres"
	case "mysql", "mariadb":
		return "mysql"
	case "sqlite", "sqlite3":
		return "sqlite"
	default:
		return "postgres"
	}
}

func quoteIdentPostgres(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func quoteIdentMySQL(s string) string {
	return "`" + strings.ReplaceAll(s, "`", "``") + "`"
}

func quoteIdentSQLite(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func quoteQualifiedIdent(ident string, defaultSchema string, quoteFn func(string) string) string {
	ident = strings.TrimSpace(ident)
	if strings.Contains(ident, ".") {
		parts := strings.Split(ident, ".")
		quoted := make([]string, 0, len(parts))
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if p != "" {
				quoted = append(quoted, quoteFn(p))
			}
		}
		return strings.Join(quoted, ".")
	}
	if defaultSchema != "" {
		return quoteFn(defaultSchema) + "." + quoteFn(ident)
	}
	return quoteFn(ident)
}

func ValidateDataType(dt string) error {
	dt = strings.TrimSpace(dt)
	if dt == "" {
		return errors.New("data type cannot be empty")
	}
	if len(dt) > 64 {
		return fmt.Errorf("data type length exceeds maximum of 64 characters: %d", len(dt))
	}
	if strings.ContainsAny(dt, ";\x00\r\n") || strings.Contains(dt, "--") || strings.Contains(dt, "/*") {
		return errors.New("data type contains dangerous or invalid characters")
	}
	if !validDataTypeRegex.MatchString(dt) {
		return fmt.Errorf("data type %q contains invalid characters", dt)
	}
	return nil
}

func ValidateFKAction(action string) (string, error) {
	action = strings.ToUpper(strings.TrimSpace(action))
	if action == "" {
		return "", nil
	}
	if !allowedFKActions[action] {
		return "", fmt.Errorf("invalid foreign key action %q: must be one of CASCADE, SET NULL, SET DEFAULT, RESTRICT, NO ACTION", action)
	}
	return action, nil
}

func FormatDefaultValue(val string) (string, error) {
	val = strings.TrimSpace(val)
	if val == "" {
		return "", nil
	}
	if strings.ContainsAny(val, ";\x00\r\n") || strings.Contains(val, "--") || strings.Contains(val, "/*") {
		return "", errors.New("default value contains dangerous characters")
	}

	upper := strings.ToUpper(val)
	if upper == "NULL" || upper == "TRUE" || upper == "FALSE" ||
		upper == "CURRENT_TIMESTAMP" || upper == "CURRENT_DATE" ||
		upper == "CURRENT_TIME" || upper == "NOW()" {
		return val, nil
	}

	// PostgreSQL type casts (e.g. 'active'::character varying) or sequence nextval(...) expressions
	if strings.Contains(val, "::") || strings.HasPrefix(strings.ToLower(val), "nextval(") {
		return val, nil
	}

	// Quoted string literal: strip outer single quotes, normalize inner quotes
	if strings.HasPrefix(val, "'") && strings.HasSuffix(val, "'") && len(val) >= 2 {
		inner := val[1 : len(val)-1]
		unquoted := strings.ReplaceAll(inner, "''", "'")
		return "'" + strings.ReplaceAll(unquoted, "'", "''") + "'", nil
	}

	// Number
	if _, err := strconv.ParseFloat(val, 64); err == nil {
		return val, nil
	}

	// Safe function call or expression like gen_random_uuid() or uuid_generate_v4()
	if strings.HasSuffix(val, ")") && strings.Contains(val, "(") {
		if !safeExprRegex.MatchString(val) {
			return "", fmt.Errorf("unsafe default expression: %s", val)
		}
		return val, nil
	}

	// Raw unquoted string: escape single quotes and wrap in quotes
	return "'" + strings.ReplaceAll(val, "'", "''") + "'", nil
}

func quoteColumnList(cols []string, quoteFn func(string) string) string {
	quoted := make([]string, len(cols))
	for i, c := range cols {
		quoted[i] = quoteFn(c)
	}
	return strings.Join(quoted, ", ")
}

// GenerateAlterDDL produces a list of executable DDL statements and a combined preview string.
func GenerateAlterDDL(dialect string, req types.AlterTableRequest) ([]string, string, error) {
	if strings.TrimSpace(req.Table) == "" {
		return nil, "", errors.New("table name is required")
	}

	normDialect := NormalizeDialect(dialect)
	var statements []string
	var err error

	switch normDialect {
	case "postgres":
		statements, err = generatePostgresDDL(req)
	case "mysql":
		statements, err = generateMySQLDDL(req)
	case "sqlite":
		statements, err = generateSQLiteDDL(req)
	default:
		statements, err = generatePostgresDDL(req)
	}

	if err != nil {
		return nil, "", err
	}

	var combined string
	if len(statements) > 0 {
		combined = strings.Join(statements, ";\n\n") + ";"
	}

	return statements, combined, nil
}

func postgresTableRef(schema, table string) string {
	if schema != "" {
		return quoteIdentPostgres(schema) + "." + quoteIdentPostgres(table)
	}
	return quoteIdentPostgres(table)
}

func generatePostgresDDL(req types.AlterTableRequest) ([]string, error) {
	var stmts []string
	tbl := postgresTableRef(req.Schema, req.Table)

	// 1. Dropped Foreign Keys
	for _, fkName := range req.DroppedForeignKeys {
		fkName = strings.TrimSpace(fkName)
		if fkName != "" {
			stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s DROP CONSTRAINT IF EXISTS %s", tbl, quoteIdentPostgres(fkName)))
		}
	}

	// 2. Dropped Indexes
	for _, idx := range req.DroppedIndexes {
		idx = strings.TrimSpace(idx)
		if idx != "" {
			if req.Schema != "" {
				stmts = append(stmts, fmt.Sprintf("DROP INDEX IF EXISTS %s.%s", quoteIdentPostgres(req.Schema), quoteIdentPostgres(idx)))
			} else {
				stmts = append(stmts, fmt.Sprintf("DROP INDEX IF EXISTS %s", quoteIdentPostgres(idx)))
			}
		}
	}

	// 3. Dropped Columns
	for _, col := range req.DroppedColumns {
		col = strings.TrimSpace(col)
		if col != "" {
			stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", tbl, quoteIdentPostgres(col)))
		}
	}

	// 4. Renamed Columns
	for _, ren := range req.RenamedColumns {
		oldN := strings.TrimSpace(ren.Old())
		newN := strings.TrimSpace(ren.New())
		if oldN != "" && newN != "" && oldN != newN {
			stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s", tbl, quoteIdentPostgres(oldN), quoteIdentPostgres(newN)))
		}
	}

	// 5. Altered Columns
	for _, alt := range req.AlteredColumns {
		colName := strings.TrimSpace(alt.Name)
		if colName == "" {
			continue
		}
		qCol := quoteIdentPostgres(colName)

		if colType := strings.TrimSpace(alt.GetType()); colType != "" {
			if err := ValidateDataType(colType); err != nil {
				return nil, err
			}
			stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s TYPE %s", tbl, qCol, colType))
		}
		if alt.GetNullable() != nil {
			if *alt.GetNullable() {
				stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s DROP NOT NULL", tbl, qCol))
			} else {
				stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s SET NOT NULL", tbl, qCol))
			}
		}
		if alt.DropDefault {
			stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s DROP DEFAULT", tbl, qCol))
		} else if def := alt.GetDefault(); def != nil && *def != "" {
			formattedDef, err := FormatDefaultValue(*def)
			if err != nil {
				return nil, err
			}
			stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s SET DEFAULT %s", tbl, qCol, formattedDef))
		}
	}

	// 6. Added Columns
	for _, col := range req.AddedColumns {
		cName := strings.TrimSpace(col.Name)
		if cName == "" {
			continue
		}
		cType := strings.TrimSpace(col.Type)
		if cType == "" {
			cType = strings.TrimSpace(col.DataType)
		}
		if cType == "" {
			cType = "TEXT"
		}
		if err := ValidateDataType(cType); err != nil {
			return nil, err
		}
		stmt := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", tbl, quoteIdentPostgres(cName), cType)
		if col.Default != nil && strings.TrimSpace(*col.Default) != "" {
			formattedDef, err := FormatDefaultValue(*col.Default)
			if err != nil {
				return nil, err
			}
			stmt += " DEFAULT " + formattedDef
		}
		if !col.IsNullable {
			stmt += " NOT NULL"
		}
		if col.IsPrimary {
			stmt += " PRIMARY KEY"
		}
		stmts = append(stmts, stmt)
	}

	// 7. Added Foreign Keys
	for _, fk := range req.AddedForeignKeys {
		if strings.TrimSpace(fk.Column) == "" || strings.TrimSpace(fk.RefTable) == "" || strings.TrimSpace(fk.RefColumn) == "" {
			continue
		}
		fkName := strings.TrimSpace(fk.Name)
		if fkName == "" {
			fkName = fmt.Sprintf("fk_%s_%s", req.Table, fk.Column)
		}
		refTableRef := quoteQualifiedIdent(fk.RefTable, req.Schema, quoteIdentPostgres)

		onUpdate, err := ValidateFKAction(fk.OnUpdate)
		if err != nil {
			return nil, err
		}
		onDelete, err := ValidateFKAction(fk.OnDelete)
		if err != nil {
			return nil, err
		}

		stmt := fmt.Sprintf("ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s)",
			tbl, quoteIdentPostgres(fkName), quoteIdentPostgres(fk.Column), refTableRef, quoteIdentPostgres(fk.RefColumn))
		if onUpdate != "" {
			stmt += " ON UPDATE " + onUpdate
		}
		if onDelete != "" {
			stmt += " ON DELETE " + onDelete
		}
		stmts = append(stmts, stmt)
	}

	// 8. Added Indexes
	for _, idx := range req.AddedIndexes {
		if len(idx.Columns) == 0 {
			continue
		}
		idxName := strings.TrimSpace(idx.Name)
		if idxName == "" {
			idxName = fmt.Sprintf("idx_%s_%s", req.Table, strings.Join(idx.Columns, "_"))
		}
		uniq := ""
		if idx.IsUnique {
			uniq = "UNIQUE "
		}
		cols := quoteColumnList(idx.Columns, quoteIdentPostgres)
		stmts = append(stmts, fmt.Sprintf("CREATE %sINDEX IF NOT EXISTS %s ON %s (%s)", uniq, quoteIdentPostgres(idxName), tbl, cols))
	}

	return stmts, nil
}

func mysqlTableRef(schema, table string) string {
	if schema != "" {
		return quoteIdentMySQL(schema) + "." + quoteIdentMySQL(table)
	}
	return quoteIdentMySQL(table)
}

func generateMySQLDDL(req types.AlterTableRequest) ([]string, error) {
	var stmts []string
	tbl := mysqlTableRef(req.Schema, req.Table)

	// 1. Dropped Foreign Keys
	for _, fkName := range req.DroppedForeignKeys {
		fkName = strings.TrimSpace(fkName)
		if fkName != "" {
			stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s DROP FOREIGN KEY %s", tbl, quoteIdentMySQL(fkName)))
		}
	}

	// 2. Dropped Indexes
	for _, idx := range req.DroppedIndexes {
		idx = strings.TrimSpace(idx)
		if idx != "" {
			stmts = append(stmts, fmt.Sprintf("DROP INDEX %s ON %s", quoteIdentMySQL(idx), tbl))
		}
	}

	// 3. Dropped Columns
	for _, col := range req.DroppedColumns {
		col = strings.TrimSpace(col)
		if col != "" {
			stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", tbl, quoteIdentMySQL(col)))
		}
	}

	// 4. Renamed Columns
	for _, ren := range req.RenamedColumns {
		oldN := strings.TrimSpace(ren.Old())
		newN := strings.TrimSpace(ren.New())
		if oldN != "" && newN != "" && oldN != newN {
			stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s", tbl, quoteIdentMySQL(oldN), quoteIdentMySQL(newN)))
		}
	}

	// 5. Altered Columns (MODIFY COLUMN)
	for _, alt := range req.AlteredColumns {
		colName := strings.TrimSpace(alt.Name)
		if colName == "" {
			continue
		}
		qCol := quoteIdentMySQL(colName)
		colType := strings.TrimSpace(alt.GetType())
		if colType != "" {
			if err := ValidateDataType(colType); err != nil {
				return nil, err
			}
			stmt := fmt.Sprintf("ALTER TABLE %s MODIFY COLUMN %s %s", tbl, qCol, colType)
			if alt.GetNullable() != nil {
				if *alt.GetNullable() {
					stmt += " NULL"
				} else {
					stmt += " NOT NULL"
				}
			}
			if alt.DropDefault {
				// handled after or as drop default
			} else if def := alt.GetDefault(); def != nil && *def != "" {
				formattedDef, err := FormatDefaultValue(*def)
				if err != nil {
					return nil, err
				}
				stmt += " DEFAULT " + formattedDef
			}
			stmts = append(stmts, stmt)
		}
		if alt.DropDefault {
			stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s DROP DEFAULT", tbl, qCol))
		} else if colType == "" && alt.GetDefault() != nil && *alt.GetDefault() != "" {
			formattedDef, err := FormatDefaultValue(*alt.GetDefault())
			if err != nil {
				return nil, err
			}
			stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s SET DEFAULT %s", tbl, qCol, formattedDef))
		}
	}

	// 6. Added Columns
	for _, col := range req.AddedColumns {
		cName := strings.TrimSpace(col.Name)
		if cName == "" {
			continue
		}
		cType := strings.TrimSpace(col.Type)
		if cType == "" {
			cType = strings.TrimSpace(col.DataType)
		}
		if cType == "" {
			cType = "VARCHAR(255)"
		}
		if err := ValidateDataType(cType); err != nil {
			return nil, err
		}
		stmt := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", tbl, quoteIdentMySQL(cName), cType)
		if col.Default != nil && strings.TrimSpace(*col.Default) != "" {
			formattedDef, err := FormatDefaultValue(*col.Default)
			if err != nil {
				return nil, err
			}
			stmt += " DEFAULT " + formattedDef
		}
		if !col.IsNullable {
			stmt += " NOT NULL"
		}
		if col.IsPrimary {
			stmt += " PRIMARY KEY"
		}
		stmts = append(stmts, stmt)
	}

	// 7. Added Foreign Keys
	for _, fk := range req.AddedForeignKeys {
		if strings.TrimSpace(fk.Column) == "" || strings.TrimSpace(fk.RefTable) == "" || strings.TrimSpace(fk.RefColumn) == "" {
			continue
		}
		fkName := strings.TrimSpace(fk.Name)
		if fkName == "" {
			fkName = fmt.Sprintf("fk_%s_%s", req.Table, fk.Column)
		}
		refTableRef := quoteQualifiedIdent(fk.RefTable, req.Schema, quoteIdentMySQL)

		onUpdate, err := ValidateFKAction(fk.OnUpdate)
		if err != nil {
			return nil, err
		}
		onDelete, err := ValidateFKAction(fk.OnDelete)
		if err != nil {
			return nil, err
		}

		stmt := fmt.Sprintf("ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s)",
			tbl, quoteIdentMySQL(fkName), quoteIdentMySQL(fk.Column), refTableRef, quoteIdentMySQL(fk.RefColumn))
		if onUpdate != "" {
			stmt += " ON UPDATE " + onUpdate
		}
		if onDelete != "" {
			stmt += " ON DELETE " + onDelete
		}
		stmts = append(stmts, stmt)
	}

	// 8. Added Indexes
	for _, idx := range req.AddedIndexes {
		if len(idx.Columns) == 0 {
			continue
		}
		idxName := strings.TrimSpace(idx.Name)
		if idxName == "" {
			idxName = fmt.Sprintf("idx_%s_%s", req.Table, strings.Join(idx.Columns, "_"))
		}
		uniq := ""
		if idx.IsUnique {
			uniq = "UNIQUE "
		}
		cols := quoteColumnList(idx.Columns, quoteIdentMySQL)
		stmts = append(stmts, fmt.Sprintf("CREATE %sINDEX %s ON %s (%s)", uniq, quoteIdentMySQL(idxName), tbl, cols))
	}

	return stmts, nil
}

func sqliteTableRef(schema, table string) string {
	if schema != "" && schema != "main" {
		return quoteIdentSQLite(schema) + "." + quoteIdentSQLite(table)
	}
	return quoteIdentSQLite(table)
}

func generateSQLiteDDL(req types.AlterTableRequest) ([]string, error) {
	// SQLite dialect limitations: altering column types/constraints or adding/dropping FKs requires table recreation
	if len(req.AlteredColumns) > 0 {
		return nil, errors.New("sqlite does not support altering column types, nullability, or defaults via ALTER TABLE (requires table recreation)")
	}
	if len(req.AddedForeignKeys) > 0 {
		return nil, errors.New("sqlite does not support adding foreign keys via ALTER TABLE (requires table recreation)")
	}
	if len(req.DroppedForeignKeys) > 0 {
		return nil, errors.New("sqlite does not support dropping foreign keys via ALTER TABLE (requires table recreation)")
	}

	var stmts []string
	tbl := sqliteTableRef(req.Schema, req.Table)

	// 1. Dropped Indexes
	for _, idx := range req.DroppedIndexes {
		idx = strings.TrimSpace(idx)
		if idx != "" {
			stmts = append(stmts, fmt.Sprintf("DROP INDEX IF EXISTS %s", quoteIdentSQLite(idx)))
		}
	}

	// 2. Dropped Columns (SQLite 3.35.0+)
	for _, col := range req.DroppedColumns {
		col = strings.TrimSpace(col)
		if col != "" {
			stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", tbl, quoteIdentSQLite(col)))
		}
	}

	// 3. Renamed Columns
	for _, ren := range req.RenamedColumns {
		oldN := strings.TrimSpace(ren.Old())
		newN := strings.TrimSpace(ren.New())
		if oldN != "" && newN != "" && oldN != newN {
			stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s", tbl, quoteIdentSQLite(oldN), quoteIdentSQLite(newN)))
		}
	}

	// 4. Added Columns
	for _, col := range req.AddedColumns {
		cName := strings.TrimSpace(col.Name)
		if cName == "" {
			continue
		}
		cType := strings.TrimSpace(col.Type)
		if cType == "" {
			cType = strings.TrimSpace(col.DataType)
		}
		if cType == "" {
			cType = "TEXT"
		}
		if err := ValidateDataType(cType); err != nil {
			return nil, err
		}
		stmt := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", tbl, quoteIdentSQLite(cName), cType)
		if col.Default != nil && strings.TrimSpace(*col.Default) != "" {
			formattedDef, err := FormatDefaultValue(*col.Default)
			if err != nil {
				return nil, err
			}
			stmt += " DEFAULT " + formattedDef
		}
		if !col.IsNullable {
			stmt += " NOT NULL"
		}
		if col.IsPrimary {
			stmt += " PRIMARY KEY"
		}
		stmts = append(stmts, stmt)
	}

	// 5. Added Indexes
	for _, idx := range req.AddedIndexes {
		if len(idx.Columns) == 0 {
			continue
		}
		idxName := strings.TrimSpace(idx.Name)
		if idxName == "" {
			idxName = fmt.Sprintf("idx_%s_%s", req.Table, strings.Join(idx.Columns, "_"))
		}
		uniq := ""
		if idx.IsUnique {
			uniq = "UNIQUE "
		}
		cols := quoteColumnList(idx.Columns, quoteIdentSQLite)
		stmts = append(stmts, fmt.Sprintf("CREATE %sINDEX IF NOT EXISTS %s ON %s (%s)", uniq, quoteIdentSQLite(idxName), tbl, cols))
	}

	return stmts, nil
}

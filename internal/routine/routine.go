package routine

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
)

// RoutineArg represents a parameter definition for a routine.
type RoutineArg struct {
	Name            string `json:"name"`
	Type            string `json:"type"`
	Mode            string `json:"mode"` // "IN", "OUT", "INOUT", "VARIADIC"
	OrdinalPosition int    `json:"ordinalPosition"`
	DefaultValue    string `json:"defaultValue,omitempty"`
}

// RoutineItem represents a stored procedure or user-defined function.
type RoutineItem struct {
	Schema      string       `json:"schema"`
	Name        string       `json:"name"`
	RoutineType string       `json:"routineType"` // "PROCEDURE" or "FUNCTION"
	Language    string       `json:"language,omitempty"`
	ReturnType  string       `json:"returnType,omitempty"`
	Arguments   []RoutineArg `json:"arguments"`
	Definition  string       `json:"definition,omitempty"`
	Comment     string       `json:"comment,omitempty"`
}

// TriggerItem represents a database trigger.
type TriggerItem struct {
	Schema      string `json:"schema"`
	Name        string `json:"name"`
	TableSchema string `json:"tableSchema"`
	TableName   string `json:"tableName"`
	Timing      string `json:"timing"`      // "BEFORE", "AFTER", "INSTEAD OF"
	Event       string `json:"event"`       // "INSERT", "UPDATE", "DELETE", "TRUNCATE"
	Statement   string `json:"statement"`   // SQL body/definition
	Enabled     bool   `json:"enabled"`
	Orientation string `json:"orientation"` // "ROW", "STATEMENT"
}

// ViewItem represents a database view or materialized view.
type ViewItem struct {
	Schema         string `json:"schema"`
	Name           string `json:"name"`
	Definition     string `json:"definition"`
	IsMaterialized bool   `json:"isMaterialized"`
	CheckOption    string `json:"checkOption,omitempty"`
	IsUpdatable    string `json:"isUpdatable,omitempty"`
	Owner          string `json:"owner,omitempty"`
}

// InvokeRoutineRequest specifies the routine and arguments to run.
type InvokeRoutineRequest struct {
	Schema      string        `json:"schema"`
	Name        string        `json:"name"`
	RoutineType string        `json:"routineType"` // "PROCEDURE" or "FUNCTION"
	Parameters  []interface{} `json:"parameters"`
}

// InvokeRoutineResponse contains the execution results and telemetry.
type InvokeRoutineResponse struct {
	Columns      []string        `json:"columns"`
	Rows         [][]interface{} `json:"rows"`
	DurationMs   int64           `json:"durationMs"`
	AffectedRows int64           `json:"affectedRows"`
	Message      string          `json:"message,omitempty"`
}

// ToggleTriggerRequest toggles trigger enabled/disabled state.
type ToggleTriggerRequest struct {
	Schema  string `json:"schema"`
	Table   string `json:"table"`
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
}

// RefreshViewRequest triggers a materialized view refresh.
type RefreshViewRequest struct {
	Schema       string `json:"schema"`
	Name         string `json:"name"`
	Concurrently bool   `json:"concurrently,omitempty"`
}

func NormalizeDialect(dialect string) string {
	d := strings.ToLower(strings.TrimSpace(dialect))
	switch d {
	case "postgres", "postgresql", "pg":
		return "postgres"
	case "mysql", "mariadb":
		return "mysql"
	case "sqlite", "sqlite3":
		return "sqlite"
	default:
		return d
	}
}

func quoteIdentifier(dialect, ident string) string {
	ident = strings.TrimSpace(ident)
	d := NormalizeDialect(dialect)
	switch d {
	case "mysql":
		return "`" + strings.ReplaceAll(ident, "`", "``") + "`"
	default:
		return `"` + strings.ReplaceAll(ident, `"`, `""`) + `"`
	}
}

func qualify(dialect, schema, name string) string {
	schema = strings.TrimSpace(schema)
	name = strings.TrimSpace(name)
	if schema == "" {
		return quoteIdentifier(dialect, name)
	}
	return quoteIdentifier(dialect, schema) + "." + quoteIdentifier(dialect, name)
}

// BuildInvokeStatement constructs dialect-specific invocation SQL.
func BuildInvokeStatement(dialect, schema, name, routineType string, argCount int) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("routine name cannot be empty")
	}

	d := NormalizeDialect(dialect)
	rType := strings.ToUpper(strings.TrimSpace(routineType))
	if rType != "PROCEDURE" && rType != "FUNCTION" {
		rType = "FUNCTION"
	}

	switch d {
	case "postgres":
		placeholders := make([]string, argCount)
		for i := 0; i < argCount; i++ {
			placeholders[i] = fmt.Sprintf("$%d", i+1)
		}
		ph := strings.Join(placeholders, ", ")
		target := qualify(d, schema, name)
		if rType == "PROCEDURE" {
			return fmt.Sprintf("CALL %s(%s);", target, ph), nil
		}
		return fmt.Sprintf("SELECT * FROM %s(%s);", target, ph), nil

	case "mysql":
		placeholders := make([]string, argCount)
		for i := 0; i < argCount; i++ {
			placeholders[i] = "?"
		}
		ph := strings.Join(placeholders, ", ")
		target := qualify(d, schema, name)
		if rType == "PROCEDURE" {
			return fmt.Sprintf("CALL %s(%s);", target, ph), nil
		}
		return fmt.Sprintf("SELECT %s(%s) AS result;", target, ph), nil

	case "sqlite":
		if rType == "PROCEDURE" {
			return "", fmt.Errorf("sqlite does not support stored procedures")
		}
		placeholders := make([]string, argCount)
		for i := 0; i < argCount; i++ {
			placeholders[i] = "?"
		}
		ph := strings.Join(placeholders, ", ")
		target := quoteIdentifier(d, name)
		return fmt.Sprintf("SELECT %s(%s) AS result;", target, ph), nil

	default:
		return "", fmt.Errorf("unsupported dialect: %s", dialect)
	}
}

// BuildTriggerToggleStatement generates trigger enable/disable SQL.
func BuildTriggerToggleStatement(dialect, schema, table, name string, enabled bool) (string, error) {
	name = strings.TrimSpace(name)
	table = strings.TrimSpace(table)
	if name == "" {
		return "", fmt.Errorf("trigger name cannot be empty")
	}
	if table == "" {
		return "", fmt.Errorf("table name is required for trigger toggle")
	}

	d := NormalizeDialect(dialect)
	switch d {
	case "postgres":
		action := "ENABLE"
		if !enabled {
			action = "DISABLE"
		}
		return fmt.Sprintf("ALTER TABLE %s %s TRIGGER %s;", qualify(d, schema, table), action, quoteIdentifier(d, name)), nil
	default:
		return "", fmt.Errorf("trigger toggle is only supported on PostgreSQL (current dialect: %s)", dialect)
	}
}

// BuildTriggerDropStatement generates DROP TRIGGER SQL.
func BuildTriggerDropStatement(dialect, schema, table, name string) (string, error) {
	name = strings.TrimSpace(name)
	table = strings.TrimSpace(table)
	if name == "" {
		return "", fmt.Errorf("trigger name cannot be empty")
	}

	d := NormalizeDialect(dialect)
	switch d {
	case "postgres":
		if table == "" {
			return "", fmt.Errorf("table name is required to drop trigger in PostgreSQL")
		}
		return fmt.Sprintf("DROP TRIGGER IF EXISTS %s ON %s;", quoteIdentifier(d, name), qualify(d, schema, table)), nil

	case "mysql":
		return fmt.Sprintf("DROP TRIGGER IF EXISTS %s;", qualify(d, schema, name)), nil

	case "sqlite":
		return fmt.Sprintf("DROP TRIGGER IF EXISTS %s;", quoteIdentifier(d, name)), nil

	default:
		return "", fmt.Errorf("unsupported dialect: %s", dialect)
	}
}

// BuildViewRefreshStatement generates materialized view refresh statement.
func BuildViewRefreshStatement(dialect, schema, name string, concurrently bool) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("view name cannot be empty")
	}

	d := NormalizeDialect(dialect)
	switch d {
	case "postgres":
		target := qualify(d, schema, name)
		if concurrently {
			return fmt.Sprintf("REFRESH MATERIALIZED VIEW CONCURRENTLY %s;", target), nil
		}
		return fmt.Sprintf("REFRESH MATERIALIZED VIEW %s;", target), nil
	default:
		return "", fmt.Errorf("view refresh is only supported for PostgreSQL materialized views (current dialect: %s)", dialect)
	}
}

// BuildRoutineDropStatement generates DROP PROCEDURE/FUNCTION SQL.
func BuildRoutineDropStatement(dialect, schema, name, routineType string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("routine name cannot be empty")
	}

	d := NormalizeDialect(dialect)
	rType := strings.ToUpper(strings.TrimSpace(routineType))
	if rType != "PROCEDURE" && rType != "FUNCTION" {
		rType = "FUNCTION"
	}

	switch d {
	case "postgres":
		return fmt.Sprintf("DROP %s IF EXISTS %s;", rType, qualify(d, schema, name)), nil
	case "mysql":
		return fmt.Sprintf("DROP %s IF EXISTS %s;", rType, qualify(d, schema, name)), nil
	case "sqlite":
		return "", fmt.Errorf("routines are not supported for SQLite")
	default:
		return "", fmt.Errorf("unsupported dialect: %s", dialect)
	}
}

// ParsePostgresArguments parses an argument signature string into RoutineArg structs.
func ParsePostgresArguments(argsStr string) []RoutineArg {
	parts := splitArgList(argsStr)
	var args []RoutineArg
	for i, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed == "" {
			continue
		}

		mode := "IN"
		upper := strings.ToUpper(trimmed)
		if strings.HasPrefix(upper, "INOUT ") {
			mode = "INOUT"
			trimmed = strings.TrimSpace(trimmed[6:])
		} else if strings.HasPrefix(upper, "OUT ") {
			mode = "OUT"
			trimmed = strings.TrimSpace(trimmed[4:])
		} else if strings.HasPrefix(upper, "IN ") {
			mode = "IN"
			trimmed = strings.TrimSpace(trimmed[3:])
		} else if strings.HasPrefix(upper, "VARIADIC ") {
			mode = "VARIADIC"
			trimmed = strings.TrimSpace(trimmed[9:])
		}

		var defaultVal string
		upperTrimmed := strings.ToUpper(trimmed)
		if idx := strings.Index(upperTrimmed, " DEFAULT "); idx != -1 {
			defaultVal = strings.TrimSpace(trimmed[idx+9:])
			trimmed = strings.TrimSpace(trimmed[:idx])
		}

		fields := strings.Fields(trimmed)
		var argName, argType string
		if len(fields) == 1 {
			argType = fields[0]
		} else if len(fields) > 1 {
			argName = fields[0]
			argType = strings.Join(fields[1:], " ")
		}

		args = append(args, RoutineArg{
			Name:            argName,
			Type:            argType,
			Mode:            mode,
			OrdinalPosition: i + 1,
			DefaultValue:    defaultVal,
		})
	}
	if args == nil {
		return []RoutineArg{}
	}
	return args
}

func splitArgList(s string) []string {
	var parts []string
	var cur strings.Builder
	parenCount := 0
	for _, r := range s {
		if r == '(' {
			parenCount++
		} else if r == ')' {
			parenCount--
		} else if r == ',' && parenCount == 0 {
			p := strings.TrimSpace(cur.String())
			if p != "" {
				parts = append(parts, p)
			}
			cur.Reset()
			continue
		}
		cur.WriteRune(r)
	}
	if cur.Len() > 0 {
		p := strings.TrimSpace(cur.String())
		if p != "" {
			parts = append(parts, p)
		}
	}
	return parts
}

func getStringVal(row []interface{}, colMap map[string]int, colName string) string {
	idx, ok := colMap[strings.ToLower(colName)]
	if !ok || idx < 0 || idx >= len(row) || row[idx] == nil {
		return ""
	}
	switch v := row[idx].(type) {
	case string:
		return v
	case []byte:
		return string(v)
	default:
		return fmt.Sprintf("%v", v)
	}
}

func getBoolVal(row []interface{}, colMap map[string]int, colName string) bool {
	idx, ok := colMap[strings.ToLower(colName)]
	if !ok || idx < 0 || idx >= len(row) || row[idx] == nil {
		return false
	}
	switch v := row[idx].(type) {
	case bool:
		return v
	case int64:
		return v != 0
	case int:
		return v != 0
	case string:
		s := strings.ToLower(v)
		return s == "true" || s == "t" || s == "1" || s == "yes"
	case []byte:
		s := strings.ToLower(string(v))
		return s == "true" || s == "t" || s == "1" || s == "yes"
	default:
		return false
	}
}

func buildColMap(cols []string) map[string]int {
	m := make(map[string]int, len(cols))
	for i, c := range cols {
		m[strings.ToLower(c)] = i
	}
	return m
}

// InspectRoutines lists routines from the database catalog.
func InspectRoutines(ctx context.Context, d types.Driver, schemaFilter string) ([]RoutineItem, error) {
	dialect := NormalizeDialect(d.Dialect())
	switch dialect {
	case "postgres":
		query := `
SELECT
    n.nspname AS schema_name,
    p.proname AS routine_name,
    CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS routine_type,
    l.lanname AS language,
    pg_get_function_result(p.oid) AS return_type,
    pg_get_function_arguments(p.oid) AS arguments,
    pg_get_functiondef(p.oid) AS definition,
    COALESCE(d.description, '') AS comment
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
JOIN pg_language l ON p.prolang = l.oid
LEFT JOIN pg_description d ON d.objoid = p.oid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
  AND n.nspname NOT LIKE 'pg_toast%'`

		var args []interface{}
		if schemaFilter != "" {
			query += " AND n.nspname = $1"
			args = append(args, schemaFilter)
		}
		query += " ORDER BY n.nspname, p.proname;"

		res, err := d.ExecuteRaw(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("failed to inspect postgres routines: %w", err)
		}
		if res == nil || len(res.Rows) == 0 {
			return []RoutineItem{}, nil
		}

		colMap := buildColMap(res.Columns)
		var routines []RoutineItem
		for _, row := range res.Rows {
			argStr := getStringVal(row, colMap, "arguments")
			routines = append(routines, RoutineItem{
				Schema:      getStringVal(row, colMap, "schema_name"),
				Name:        getStringVal(row, colMap, "routine_name"),
				RoutineType: getStringVal(row, colMap, "routine_type"),
				Language:    getStringVal(row, colMap, "language"),
				ReturnType:  getStringVal(row, colMap, "return_type"),
				Arguments:   ParsePostgresArguments(argStr),
				Definition:  getStringVal(row, colMap, "definition"),
				Comment:     getStringVal(row, colMap, "comment"),
			})
		}
		return routines, nil

	case "mysql":
		query := `
SELECT
    ROUTINE_SCHEMA,
    ROUTINE_NAME,
    ROUTINE_TYPE,
    COALESCE(ROUTINE_BODY, 'SQL') AS ROUTINE_LANGUAGE,
    COALESCE(DTD_IDENTIFIER, DATA_TYPE, '') AS RETURN_TYPE,
    COALESCE(ROUTINE_DEFINITION, '') AS ROUTINE_DEFINITION,
    COALESCE(ROUTINE_COMMENT, '') AS ROUTINE_COMMENT
FROM information_schema.routines
WHERE ROUTINE_SCHEMA NOT IN ('sys', 'information_schema', 'mysql', 'performance_schema')`

		var args []interface{}
		if schemaFilter != "" {
			query += " AND ROUTINE_SCHEMA = ?"
			args = append(args, schemaFilter)
		}
		query += " ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME;"

		res, err := d.ExecuteRaw(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("failed to inspect mysql routines: %w", err)
		}
		if res == nil || len(res.Rows) == 0 {
			return []RoutineItem{}, nil
		}

		// Also query parameters
		paramQuery := `
SELECT
    SPECIFIC_SCHEMA,
    SPECIFIC_NAME,
    COALESCE(PARAMETER_NAME, '') AS PARAMETER_NAME,
    COALESCE(DTD_IDENTIFIER, DATA_TYPE, '') AS DATA_TYPE,
    COALESCE(PARAMETER_MODE, 'IN') AS PARAMETER_MODE,
    COALESCE(ORDINAL_POSITION, 0) AS ORDINAL_POSITION
FROM information_schema.parameters
WHERE SPECIFIC_SCHEMA NOT IN ('sys', 'information_schema', 'mysql', 'performance_schema')`
		var pArgs []interface{}
		if schemaFilter != "" {
			paramQuery += " AND SPECIFIC_SCHEMA = ?"
			pArgs = append(pArgs, schemaFilter)
		}
		paramQuery += " ORDER BY SPECIFIC_SCHEMA, SPECIFIC_NAME, ORDINAL_POSITION;"

		paramMap := make(map[string][]RoutineArg)
		if pRes, pErr := d.ExecuteRaw(ctx, paramQuery, pArgs...); pErr == nil && pRes != nil {
			pCols := buildColMap(pRes.Columns)
			for _, pRow := range pRes.Rows {
				sKey := fmt.Sprintf("%s.%s", getStringVal(pRow, pCols, "specific_schema"), getStringVal(pRow, pCols, "specific_name"))
				name := getStringVal(pRow, pCols, "parameter_name")
				if name == "" {
					continue // Return value placeholder in MySQL parameters
				}
				paramMap[sKey] = append(paramMap[sKey], RoutineArg{
					Name:            name,
					Type:            getStringVal(pRow, pCols, "data_type"),
					Mode:            getStringVal(pRow, pCols, "parameter_mode"),
					OrdinalPosition: int(getIntVal(pRow, pCols, "ordinal_position")),
				})
			}
		}

		colMap := buildColMap(res.Columns)
		var routines []RoutineItem
		for _, row := range res.Rows {
			sSchema := getStringVal(row, colMap, "routine_schema")
			sName := getStringVal(row, colMap, "routine_name")
			key := fmt.Sprintf("%s.%s", sSchema, sName)
			args := paramMap[key]
			if args == nil {
				args = []RoutineArg{}
			}
			routines = append(routines, RoutineItem{
				Schema:      sSchema,
				Name:        sName,
				RoutineType: getStringVal(row, colMap, "routine_type"),
				Language:    getStringVal(row, colMap, "routine_language"),
				ReturnType:  getStringVal(row, colMap, "return_type"),
				Arguments:   args,
				Definition:  getStringVal(row, colMap, "routine_definition"),
				Comment:     getStringVal(row, colMap, "routine_comment"),
			})
		}
		return routines, nil

	case "sqlite":
		return []RoutineItem{}, nil

	default:
		return nil, fmt.Errorf("unsupported dialect: %s", dialect)
	}
}

func getIntVal(row []interface{}, colMap map[string]int, colName string) int64 {
	idx, ok := colMap[strings.ToLower(colName)]
	if !ok || idx < 0 || idx >= len(row) || row[idx] == nil {
		return 0
	}
	switch v := row[idx].(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	default:
		return 0
	}
}

// InspectRoutineDetail fetches a single routine detail with full definition and arguments.
func InspectRoutineDetail(ctx context.Context, d types.Driver, schema, name string) (*RoutineItem, error) {
	dialect := NormalizeDialect(d.Dialect())
	if dialect == "sqlite" {
		return nil, fmt.Errorf("routines are not supported in SQLite")
	}

	routines, err := InspectRoutines(ctx, d, schema)
	if err != nil {
		return nil, err
	}

	for _, r := range routines {
		if (schema == "" || strings.EqualFold(r.Schema, schema)) && strings.EqualFold(r.Name, name) {
			// If MySQL definition is empty, try SHOW CREATE
			if dialect == "mysql" && r.Definition == "" {
				showCmd := fmt.Sprintf("SHOW CREATE %s %s;", r.RoutineType, qualify("mysql", r.Schema, r.Name))
				if sRes, sErr := d.ExecuteRaw(ctx, showCmd); sErr == nil && sRes != nil && len(sRes.Rows) > 0 {
					sCols := buildColMap(sRes.Columns)
					defKey := "create " + strings.ToLower(r.RoutineType)
					if def := getStringVal(sRes.Rows[0], sCols, defKey); def != "" {
						r.Definition = def
					} else if len(sRes.Rows[0]) > 2 {
						r.Definition = fmt.Sprintf("%v", sRes.Rows[0][2])
					}
				}
			}
			return &r, nil
		}
	}
	return nil, fmt.Errorf("routine not found: %s.%s", schema, name)
}

var sqliteTriggerRegex = regexp.MustCompile(`(?i)CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["` + "`" + `]?([a-zA-Z0-9_]+)["` + "`" + `]?\s+)?(BEFORE|AFTER|INSTEAD\s+OF)?\s*(INSERT|UPDATE|DELETE)\s+ON\s+["` + "`" + `]?([a-zA-Z0-9_]+)["` + "`" + `]?`)

// InspectTriggers queries database triggers.
func InspectTriggers(ctx context.Context, d types.Driver, schemaFilter, tableFilter string) ([]TriggerItem, error) {
	dialect := NormalizeDialect(d.Dialect())
	switch dialect {
	case "postgres":
		query := `
SELECT
    n.nspname AS trigger_schema,
    t.tgname AS trigger_name,
    n.nspname AS table_schema,
    c.relname AS table_name,
    CASE
        WHEN (t.tgtype & 2) != 0 THEN 'BEFORE'
        WHEN (t.tgtype & 64) != 0 THEN 'INSTEAD OF'
        ELSE 'AFTER'
    END AS timing,
    ARRAY_TO_STRING(ARRAY[
        CASE WHEN (t.tgtype & 4) != 0 THEN 'INSERT' END,
        CASE WHEN (t.tgtype & 8) != 0 THEN 'DELETE' END,
        CASE WHEN (t.tgtype & 16) != 0 THEN 'UPDATE' END,
        CASE WHEN (t.tgtype & 32) != 0 THEN 'TRUNCATE' END
    ], ' OR ') AS event,
    pg_get_triggerdef(t.oid) AS statement,
    CASE WHEN t.tgenabled = 'D' THEN false ELSE true END AS enabled,
    CASE WHEN (t.tgtype & 1) != 0 THEN 'ROW' ELSE 'STATEMENT' END AS orientation
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND NOT t.tgisinternal`

		var args []interface{}
		argIdx := 1
		if schemaFilter != "" {
			query += fmt.Sprintf(" AND n.nspname = $%d", argIdx)
			args = append(args, schemaFilter)
			argIdx++
		}
		if tableFilter != "" {
			query += fmt.Sprintf(" AND c.relname = $%d", argIdx)
			args = append(args, tableFilter)
			argIdx++
		}
		query += " ORDER BY n.nspname, c.relname, t.tgname;"

		res, err := d.ExecuteRaw(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("failed to inspect postgres triggers: %w", err)
		}
		if res == nil || len(res.Rows) == 0 {
			return []TriggerItem{}, nil
		}

		colMap := buildColMap(res.Columns)
		var triggers []TriggerItem
		for _, row := range res.Rows {
			triggers = append(triggers, TriggerItem{
				Schema:      getStringVal(row, colMap, "trigger_schema"),
				Name:        getStringVal(row, colMap, "trigger_name"),
				TableSchema: getStringVal(row, colMap, "table_schema"),
				TableName:   getStringVal(row, colMap, "table_name"),
				Timing:      getStringVal(row, colMap, "timing"),
				Event:       getStringVal(row, colMap, "event"),
				Statement:   getStringVal(row, colMap, "statement"),
				Enabled:     getBoolVal(row, colMap, "enabled"),
				Orientation: getStringVal(row, colMap, "orientation"),
			})
		}
		return triggers, nil

	case "mysql":
		query := `
SELECT
    TRIGGER_SCHEMA,
    TRIGGER_NAME,
    TRIGGER_SCHEMA AS TABLE_SCHEMA,
    EVENT_OBJECT_TABLE AS TABLE_NAME,
    ACTION_TIMING AS TIMING,
    EVENT_MANIPULATION AS EVENT,
    ACTION_STATEMENT AS STATEMENT,
    ACTION_ORIENTATION AS ORIENTATION
FROM information_schema.triggers
WHERE TRIGGER_SCHEMA NOT IN ('sys', 'information_schema', 'mysql', 'performance_schema')`

		var args []interface{}
		if schemaFilter != "" {
			query += " AND TRIGGER_SCHEMA = ?"
			args = append(args, schemaFilter)
		}
		if tableFilter != "" {
			query += " AND EVENT_OBJECT_TABLE = ?"
			args = append(args, tableFilter)
		}
		query += " ORDER BY TRIGGER_SCHEMA, EVENT_OBJECT_TABLE, TRIGGER_NAME;"

		res, err := d.ExecuteRaw(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("failed to inspect mysql triggers: %w", err)
		}
		if res == nil || len(res.Rows) == 0 {
			return []TriggerItem{}, nil
		}

		colMap := buildColMap(res.Columns)
		var triggers []TriggerItem
		for _, row := range res.Rows {
			triggers = append(triggers, TriggerItem{
				Schema:      getStringVal(row, colMap, "trigger_schema"),
				Name:        getStringVal(row, colMap, "trigger_name"),
				TableSchema: getStringVal(row, colMap, "table_schema"),
				TableName:   getStringVal(row, colMap, "table_name"),
				Timing:      getStringVal(row, colMap, "timing"),
				Event:       getStringVal(row, colMap, "event"),
				Statement:   getStringVal(row, colMap, "statement"),
				Enabled:     true,
				Orientation: getStringVal(row, colMap, "orientation"),
			})
		}
		return triggers, nil

	case "sqlite":
		query := `SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger'`
		var args []interface{}
		if tableFilter != "" {
			query += " AND tbl_name = ?"
			args = append(args, tableFilter)
		}
		query += " ORDER BY name;"

		res, err := d.ExecuteRaw(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("failed to inspect sqlite triggers: %w", err)
		}
		if res == nil || len(res.Rows) == 0 {
			return []TriggerItem{}, nil
		}

		colMap := buildColMap(res.Columns)
		var triggers []TriggerItem
		for _, row := range res.Rows {
			tName := getStringVal(row, colMap, "name")
			tblName := getStringVal(row, colMap, "tbl_name")
			sqlText := getStringVal(row, colMap, "sql")

			timing := "AFTER"
			event := "UPDATE"
			if matches := sqliteTriggerRegex.FindStringSubmatch(sqlText); len(matches) >= 4 {
				if matches[2] != "" {
					timing = strings.ToUpper(strings.TrimSpace(matches[2]))
				}
				if matches[3] != "" {
					event = strings.ToUpper(strings.TrimSpace(matches[3]))
				}
				if matches[4] != "" && tblName == "" {
					tblName = matches[4]
				}
			}

			triggers = append(triggers, TriggerItem{
				Schema:      "main",
				Name:        tName,
				TableSchema: "main",
				TableName:   tblName,
				Timing:      timing,
				Event:       event,
				Statement:   sqlText,
				Enabled:     true,
				Orientation: "ROW",
			})
		}
		return triggers, nil

	default:
		return nil, fmt.Errorf("unsupported dialect: %s", dialect)
	}
}

// InspectViews queries standard and materialized views.
func InspectViews(ctx context.Context, d types.Driver, schemaFilter string) ([]ViewItem, error) {
	dialect := NormalizeDialect(d.Dialect())
	switch dialect {
	case "postgres":
		query := `
SELECT
    n.nspname AS view_schema,
    c.relname AS view_name,
    pg_get_viewdef(c.oid, true) AS definition,
    (c.relkind = 'm') AS is_materialized,
    COALESCE(r.rolname, '') AS owner
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
LEFT JOIN pg_roles r ON c.relowner = r.oid
WHERE c.relkind IN ('v', 'm')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')`

		var args []interface{}
		if schemaFilter != "" {
			query += " AND n.nspname = $1"
			args = append(args, schemaFilter)
		}
		query += " ORDER BY n.nspname, c.relname;"

		res, err := d.ExecuteRaw(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("failed to inspect postgres views: %w", err)
		}
		if res == nil || len(res.Rows) == 0 {
			return []ViewItem{}, nil
		}

		colMap := buildColMap(res.Columns)
		var views []ViewItem
		for _, row := range res.Rows {
			views = append(views, ViewItem{
				Schema:         getStringVal(row, colMap, "view_schema"),
				Name:           getStringVal(row, colMap, "view_name"),
				Definition:     getStringVal(row, colMap, "definition"),
				IsMaterialized: getBoolVal(row, colMap, "is_materialized"),
				Owner:          getStringVal(row, colMap, "owner"),
			})
		}
		return views, nil

	case "mysql":
		query := `
SELECT
    TABLE_SCHEMA AS VIEW_SCHEMA,
    TABLE_NAME AS VIEW_NAME,
    COALESCE(VIEW_DEFINITION, '') AS VIEW_DEFINITION,
    COALESCE(CHECK_OPTION, '') AS CHECK_OPTION,
    COALESCE(IS_UPDATABLE, '') AS IS_UPDATABLE
FROM information_schema.views
WHERE TABLE_SCHEMA NOT IN ('sys', 'information_schema', 'mysql', 'performance_schema')`

		var args []interface{}
		if schemaFilter != "" {
			query += " AND TABLE_SCHEMA = ?"
			args = append(args, schemaFilter)
		}
		query += " ORDER BY TABLE_SCHEMA, TABLE_NAME;"

		res, err := d.ExecuteRaw(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("failed to inspect mysql views: %w", err)
		}
		if res == nil || len(res.Rows) == 0 {
			return []ViewItem{}, nil
		}

		colMap := buildColMap(res.Columns)
		var views []ViewItem
		for _, row := range res.Rows {
			views = append(views, ViewItem{
				Schema:         getStringVal(row, colMap, "view_schema"),
				Name:           getStringVal(row, colMap, "view_name"),
				Definition:     getStringVal(row, colMap, "view_definition"),
				IsMaterialized: false,
				CheckOption:    getStringVal(row, colMap, "check_option"),
				IsUpdatable:    getStringVal(row, colMap, "is_updatable"),
			})
		}
		return views, nil

	case "sqlite":
		query := `SELECT name, sql FROM sqlite_master WHERE type = 'view' ORDER BY name;`
		res, err := d.ExecuteRaw(ctx, query)
		if err != nil {
			return nil, fmt.Errorf("failed to inspect sqlite views: %w", err)
		}
		if res == nil || len(res.Rows) == 0 {
			return []ViewItem{}, nil
		}

		colMap := buildColMap(res.Columns)
		var views []ViewItem
		for _, row := range res.Rows {
			views = append(views, ViewItem{
				Schema:         "main",
				Name:           getStringVal(row, colMap, "name"),
				Definition:     getStringVal(row, colMap, "sql"),
				IsMaterialized: false,
			})
		}
		return views, nil

	default:
		return nil, fmt.Errorf("unsupported dialect: %s", dialect)
	}
}

// InvokeRoutine executes a procedure or function with parameter binding.
func InvokeRoutine(ctx context.Context, d types.Driver, req InvokeRoutineRequest) (*InvokeRoutineResponse, error) {
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return nil, fmt.Errorf("routine name cannot be empty")
	}

	query, err := BuildInvokeStatement(d.Dialect(), req.Schema, req.Name, req.RoutineType, len(req.Parameters))
	if err != nil {
		return nil, err
	}

	start := time.Now()
	res, err := d.ExecuteRaw(ctx, query, req.Parameters...)
	elapsed := time.Since(start).Milliseconds()
	if err != nil {
		return nil, fmt.Errorf("routine execution failed: %w", err)
	}

	resp := &InvokeRoutineResponse{
		Columns:      []string{},
		Rows:         [][]interface{}{},
		DurationMs:   elapsed,
		AffectedRows: 0,
	}

	if res != nil {
		if res.Columns != nil {
			resp.Columns = res.Columns
		}
		if res.Rows != nil {
			resp.Rows = res.Rows
		}
		resp.AffectedRows = res.AffectedRows
		if res.Elapsed > 0 {
			resp.DurationMs = res.Elapsed
		}
	}

	rType := strings.ToUpper(strings.TrimSpace(req.RoutineType))
	if rType == "PROCEDURE" {
		resp.Message = fmt.Sprintf("Procedure %s executed successfully in %d ms (affected rows: %d)", req.Name, resp.DurationMs, resp.AffectedRows)
	} else {
		resp.Message = fmt.Sprintf("Function %s executed successfully in %d ms (rows returned: %d)", req.Name, resp.DurationMs, len(resp.Rows))
	}

	return resp, nil
}

// SaveRoutine creates or replaces a routine using the provided DDL.
func SaveRoutine(ctx context.Context, d types.Driver, ddl string) error {
	ddl = strings.TrimSpace(ddl)
	if ddl == "" {
		return fmt.Errorf("routine DDL cannot be empty")
	}
	if NormalizeDialect(d.Dialect()) == "sqlite" {
		return fmt.Errorf("SQLite does not support stored routines DDL")
	}

	_, err := d.ExecuteRaw(ctx, ddl)
	return err
}

// DeleteRoutine drops a stored procedure or function.
func DeleteRoutine(ctx context.Context, d types.Driver, schema, name, routineType string) error {
	query, err := BuildRoutineDropStatement(d.Dialect(), schema, name, routineType)
	if err != nil {
		return err
	}
	_, err = d.ExecuteRaw(ctx, query)
	return err
}

// ToggleTrigger enables or disables a trigger.
func ToggleTrigger(ctx context.Context, d types.Driver, req ToggleTriggerRequest) error {
	query, err := BuildTriggerToggleStatement(d.Dialect(), req.Schema, req.Table, req.Name, req.Enabled)
	if err != nil {
		return err
	}
	_, err = d.ExecuteRaw(ctx, query)
	return err
}

// DeleteTrigger drops a trigger.
func DeleteTrigger(ctx context.Context, d types.Driver, schema, table, name string) error {
	query, err := BuildTriggerDropStatement(d.Dialect(), schema, table, name)
	if err != nil {
		return err
	}
	_, err = d.ExecuteRaw(ctx, query)
	return err
}

// RefreshView refreshes a materialized view.
func RefreshView(ctx context.Context, d types.Driver, req RefreshViewRequest) error {
	query, err := BuildViewRefreshStatement(d.Dialect(), req.Schema, req.Name, req.Concurrently)
	if err != nil {
		return err
	}
	_, err = d.ExecuteRaw(ctx, query)
	return err
}

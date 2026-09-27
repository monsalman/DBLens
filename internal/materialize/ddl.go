package materialize

import (
	"fmt"
	"strings"

	"github.com/dblens/dblens/internal/alter"
	"github.com/dblens/dblens/internal/driver/types"
	"github.com/dblens/dblens/internal/federation"
)

const (
	ModeCreate           = "create"
	ModeReplace          = "replace"
	ModeAppend           = "append"
	ModeTemp             = "temp"
	ModeView             = "view"
	ModeMaterializedView = "materialized_view"
)

// NormalizeDialect maps dialect strings to standard keys: "postgres", "mysql", "sqlite".
func NormalizeDialect(d string) string {
	return alter.NormalizeDialect(d)
}

// QuoteIdent quotes an identifier according to the database dialect.
func QuoteIdent(name, dialect string) string {
	d := NormalizeDialect(dialect)
	switch d {
	case "mysql":
		return fmt.Sprintf("`%s`", strings.ReplaceAll(name, "`", "``"))
	default:
		return fmt.Sprintf(`"%s"`, strings.ReplaceAll(name, `"`, `""`))
	}
}

// QuoteTableRef produces a fully qualified and quoted table reference.
func QuoteTableRef(schema, table, dialect string) string {
	d := NormalizeDialect(dialect)
	cleanSchema := strings.TrimSpace(schema)
	cleanTable := strings.TrimSpace(table)

	if cleanSchema == "" || d == "sqlite" {
		return QuoteIdent(cleanTable, d)
	}
	return fmt.Sprintf("%s.%s", QuoteIdent(cleanSchema, d), QuoteIdent(cleanTable, d))
}

// CleanQuery strips trailing semicolons and extraneous whitespace.
func CleanQuery(q string) string {
	s := strings.TrimSpace(q)
	s = strings.TrimRight(s, ";")
	return strings.TrimSpace(s)
}

// BuildStatements produces executable SQL statements for the materialize mode.
func BuildStatements(dialect string, req MaterializeRequest) ([]string, error) {
	d := NormalizeDialect(dialect)
	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = ModeCreate
	}

	cleanTable := strings.TrimSpace(req.TargetTable)
	if cleanTable == "" {
		return nil, fmt.Errorf("target table name is required")
	}

	cleanQ := CleanQuery(req.SourceQuery)
	if cleanQ == "" {
		return nil, fmt.Errorf("source query is required")
	}

	targetRef := QuoteTableRef(req.TargetSchema, cleanTable, d)

	switch mode {
	case ModeCreate:
		return []string{
			fmt.Sprintf("CREATE TABLE %s AS %s;", targetRef, cleanQ),
		}, nil

	case ModeReplace:
		dropStmt := fmt.Sprintf("DROP TABLE IF EXISTS %s;", targetRef)
		createStmt := fmt.Sprintf("CREATE TABLE %s AS %s;", targetRef, cleanQ)
		return []string{dropStmt, createStmt}, nil

	case ModeAppend:
		if len(req.Columns) > 0 {
			var quotedCols []string
			for _, col := range req.Columns {
				quotedCols = append(quotedCols, QuoteIdent(strings.TrimSpace(col), d))
			}
			return []string{
				fmt.Sprintf("INSERT INTO %s (%s) %s;", targetRef, strings.Join(quotedCols, ", "), cleanQ),
			}, nil
		}
		return []string{
			fmt.Sprintf("INSERT INTO %s %s;", targetRef, cleanQ),
		}, nil

	case ModeTemp:
		if d == "mysql" {
			return []string{
				fmt.Sprintf("CREATE TEMPORARY TABLE %s AS %s;", targetRef, cleanQ),
			}, nil
		}
		return []string{
			fmt.Sprintf("CREATE TEMP TABLE %s AS %s;", targetRef, cleanQ),
		}, nil

	case ModeView:
		if d == "postgres" || d == "mysql" {
			return []string{
				fmt.Sprintf("CREATE OR REPLACE VIEW %s AS %s;", targetRef, cleanQ),
			}, nil
		}
		// SQLite does not support CREATE OR REPLACE VIEW
		return []string{
			fmt.Sprintf("DROP VIEW IF EXISTS %s;", targetRef),
			fmt.Sprintf("CREATE VIEW %s AS %s;", targetRef, cleanQ),
		}, nil

	case ModeMaterializedView:
		if d != "postgres" {
			return nil, fmt.Errorf("materialized views are only supported in PostgreSQL (got dialect: %s)", dialect)
		}
		return []string{
			fmt.Sprintf("CREATE MATERIALIZED VIEW %s AS %s;", targetRef, cleanQ),
		}, nil

	default:
		return nil, fmt.Errorf("unsupported materialize mode: %s", req.Mode)
	}
}

// BuildDDL generates a single combined DDL string for preview or inspection.
func BuildDDL(dialect string, req MaterializeRequest) (string, error) {
	stmts, err := BuildStatements(dialect, req)
	if err != nil {
		return "", err
	}
	return strings.Join(stmts, "\n"), nil
}

// GenerateCrossConnCreateTableDDL creates a target table DDL from column metadata across connections.
func GenerateCrossConnCreateTableDDL(cols []types.ColumnMeta, schema, table, srcDialect, tgtDialect string, isTemp bool) string {
	tgt := NormalizeDialect(tgtDialect)
	var colDefs []string
	for _, c := range cols {
		mapped := federation.MapColumnType(srcDialect, tgt, c.Type)
		colSQL := fmt.Sprintf("  %s %s", QuoteIdent(c.Name, tgt), mapped)
		colDefs = append(colDefs, colSQL)
	}

	tblRef := QuoteTableRef(schema, table, tgt)
	if isTemp {
		prefix := "CREATE TEMP TABLE IF NOT EXISTS"
		if tgt == "mysql" {
			prefix = "CREATE TEMPORARY TABLE IF NOT EXISTS"
		}
		return fmt.Sprintf("%s %s (\n%s\n);", prefix, tblRef, strings.Join(colDefs, ",\n"))
	}
	return fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s (\n%s\n);", tblRef, strings.Join(colDefs, ",\n"))
}

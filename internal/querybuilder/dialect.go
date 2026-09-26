package querybuilder

import (
	"fmt"
	"strconv"
	"strings"
)

// Dialect abstracts database-specific SQL dialect formatting.
type Dialect interface {
	Name() string
	QuoteIdentifier(name string) string
	QuoteTableRef(schema, table string) string
	FormatFilter(tableAlias, column, op, val, val2 string) string
	FormatHaving(agg, tableAlias, column, op, val string) string
	FormatOrderBy(tableAlias, column, direction, nulls string) string
	FormatLimitOffset(limit, offset *int) string
}

// NormalizeDialect normalizes a dialect string to postgres, mysql, or sqlite.
func NormalizeDialect(name string) string {
	lower := strings.ToLower(strings.TrimSpace(name))
	switch lower {
	case "mysql", "mariadb":
		return "mysql"
	case "sqlite", "sqlite3":
		return "sqlite"
	case "postgres", "postgresql", "pg":
		return "postgres"
	default:
		if strings.Contains(lower, "mysql") {
			return "mysql"
		}
		if strings.Contains(lower, "sqlite") {
			return "sqlite"
		}
		return "postgres"
	}
}

// GetDialect returns the Dialect implementation for the given name.
func GetDialect(name string) Dialect {
	switch NormalizeDialect(name) {
	case "mysql":
		return &mysqlDialect{}
	case "sqlite":
		return &sqliteDialect{}
	default:
		return &postgresDialect{}
	}
}

// postgresDialect
type postgresDialect struct{}

func (d *postgresDialect) Name() string { return "postgres" }

func (d *postgresDialect) QuoteIdentifier(name string) string {
	clean := strings.ReplaceAll(name, `"`, `""`)
	return `"` + clean + `"`
}

func (d *postgresDialect) QuoteTableRef(schema, table string) string {
	t := d.QuoteIdentifier(table)
	if strings.TrimSpace(schema) != "" {
		return d.QuoteIdentifier(schema) + "." + t
	}
	return t
}

func (d *postgresDialect) FormatFilter(tableAlias, column, op, val, val2 string) string {
	colRef := d.QuoteIdentifier(tableAlias) + "." + d.QuoteIdentifier(column)
	return formatGenericFilter(colRef, op, val, val2, true)
}

func (d *postgresDialect) FormatHaving(agg, tableAlias, column, op, val string) string {
	colRef := d.QuoteIdentifier(tableAlias) + "." + d.QuoteIdentifier(column)
	expr := formatAggExpr(agg, colRef)
	return expr + " " + op + " " + formatLiteral(val)
}

func (d *postgresDialect) FormatOrderBy(tableAlias, column, direction, nulls string) string {
	colRef := d.QuoteIdentifier(tableAlias) + "." + d.QuoteIdentifier(column)
	dir := strings.ToUpper(strings.TrimSpace(direction))
	if dir != "DESC" {
		dir = "ASC"
	}
	res := colRef + " " + dir
	switch strings.ToUpper(strings.TrimSpace(nulls)) {
	case "FIRST":
		res += " NULLS FIRST"
	case "LAST":
		res += " NULLS LAST"
	}
	return res
}

func (d *postgresDialect) FormatLimitOffset(limit, offset *int) string {
	return formatGenericLimitOffset(limit, offset)
}

// mysqlDialect
type mysqlDialect struct{}

func (d *mysqlDialect) Name() string { return "mysql" }

func (d *mysqlDialect) QuoteIdentifier(name string) string {
	clean := strings.ReplaceAll(name, "`", "``")
	return "`" + clean + "`"
}

func (d *mysqlDialect) QuoteTableRef(schema, table string) string {
	t := d.QuoteIdentifier(table)
	if strings.TrimSpace(schema) != "" {
		return d.QuoteIdentifier(schema) + "." + t
	}
	return t
}

func (d *mysqlDialect) FormatFilter(tableAlias, column, op, val, val2 string) string {
	colRef := d.QuoteIdentifier(tableAlias) + "." + d.QuoteIdentifier(column)
	// In MySQL ILIKE is not native; map ILIKE to LIKE or LOWER
	upperOp := strings.ToUpper(strings.TrimSpace(op))
	if upperOp == "ILIKE" {
		op = "LIKE"
	}
	return formatGenericFilter(colRef, op, val, val2, false)
}

func (d *mysqlDialect) FormatHaving(agg, tableAlias, column, op, val string) string {
	colRef := d.QuoteIdentifier(tableAlias) + "." + d.QuoteIdentifier(column)
	expr := formatAggExpr(agg, colRef)
	return expr + " " + op + " " + formatLiteral(val)
}

func (d *mysqlDialect) FormatOrderBy(tableAlias, column, direction, nulls string) string {
	colRef := d.QuoteIdentifier(tableAlias) + "." + d.QuoteIdentifier(column)
	dir := strings.ToUpper(strings.TrimSpace(direction))
	if dir != "DESC" {
		dir = "ASC"
	}
	// MySQL does not have NULLS FIRST / LAST syntax; use IS NULL ordering prefix
	n := strings.ToUpper(strings.TrimSpace(nulls))
	if n == "FIRST" {
		return fmt.Sprintf("%s IS NOT NULL, %s %s", colRef, colRef, dir)
	} else if n == "LAST" {
		return fmt.Sprintf("%s IS NULL, %s %s", colRef, colRef, dir)
	}
	return colRef + " " + dir
}

func (d *mysqlDialect) FormatLimitOffset(limit, offset *int) string {
	return formatGenericLimitOffset(limit, offset)
}

// sqliteDialect
type sqliteDialect struct{}

func (d *sqliteDialect) Name() string { return "sqlite" }

func (d *sqliteDialect) QuoteIdentifier(name string) string {
	clean := strings.ReplaceAll(name, `"`, `""`)
	return `"` + clean + `"`
}

func (d *sqliteDialect) QuoteTableRef(schema, table string) string {
	t := d.QuoteIdentifier(table)
	if strings.TrimSpace(schema) != "" && strings.ToLower(schema) != "main" {
		return d.QuoteIdentifier(schema) + "." + t
	}
	return t
}

func (d *sqliteDialect) FormatFilter(tableAlias, column, op, val, val2 string) string {
	colRef := d.QuoteIdentifier(tableAlias) + "." + d.QuoteIdentifier(column)
	upperOp := strings.ToUpper(strings.TrimSpace(op))
	if upperOp == "ILIKE" {
		// SQLite LIKE is case-insensitive by default for ASCII
		op = "LIKE"
	}
	return formatGenericFilter(colRef, op, val, val2, false)
}

func (d *sqliteDialect) FormatHaving(agg, tableAlias, column, op, val string) string {
	colRef := d.QuoteIdentifier(tableAlias) + "." + d.QuoteIdentifier(column)
	expr := formatAggExpr(agg, colRef)
	return expr + " " + op + " " + formatLiteral(val)
}

func (d *sqliteDialect) FormatOrderBy(tableAlias, column, direction, nulls string) string {
	colRef := d.QuoteIdentifier(tableAlias) + "." + d.QuoteIdentifier(column)
	dir := strings.ToUpper(strings.TrimSpace(direction))
	if dir != "DESC" {
		dir = "ASC"
	}
	res := colRef + " " + dir
	switch strings.ToUpper(strings.TrimSpace(nulls)) {
	case "FIRST":
		res += " NULLS FIRST"
	case "LAST":
		res += " NULLS LAST"
	}
	return res
}

func (d *sqliteDialect) FormatLimitOffset(limit, offset *int) string {
	return formatGenericLimitOffset(limit, offset)
}

// formatGenericLimitOffset formats standard LIMIT / OFFSET.
func formatGenericLimitOffset(limit, offset *int) string {
	var parts []string
	if limit != nil && *limit >= 0 {
		parts = append(parts, fmt.Sprintf("LIMIT %d", *limit))
	}
	if offset != nil && *offset > 0 {
		// In SQLite/MySQL, OFFSET requires LIMIT to precede it
		if limit == nil || *limit < 0 {
			parts = append(parts, "LIMIT -1")
		}
		parts = append(parts, fmt.Sprintf("OFFSET %d", *offset))
	}
	return strings.Join(parts, " ")
}

// formatAggExpr wraps colRef with the aggregate function.
func formatAggExpr(agg, colRef string) string {
	switch strings.ToUpper(strings.TrimSpace(agg)) {
	case "COUNT":
		return "COUNT(" + colRef + ")"
	case "COUNT_DISTINCT":
		return "COUNT(DISTINCT " + colRef + ")"
	case "SUM":
		return "SUM(" + colRef + ")"
	case "AVG":
		return "AVG(" + colRef + ")"
	case "MIN":
		return "MIN(" + colRef + ")"
	case "MAX":
		return "MAX(" + colRef + ")"
	default:
		return colRef
	}
}

// formatLiteral safely formats a string, number, boolean, or null as a SQL literal.
func formatLiteral(v string) string {
	trimmed := strings.TrimSpace(v)
	if strings.EqualFold(trimmed, "null") {
		return "NULL"
	}
	if strings.EqualFold(trimmed, "true") || strings.EqualFold(trimmed, "false") {
		return strings.ToUpper(trimmed)
	}
	// Check if integer or float
	if _, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
		return trimmed
	}
	if _, err := strconv.ParseFloat(trimmed, 64); err == nil && !strings.HasPrefix(trimmed, "0") || trimmed == "0" {
		return trimmed
	}
	// Escape single quotes: ' -> ''
	escaped := strings.ReplaceAll(v, "'", "''")
	return "'" + escaped + "'"
}

// formatGenericFilter formats a filter predicate.
func formatGenericFilter(colRef, op, val, val2 string, supportsIlike bool) string {
	upperOp := strings.ToUpper(strings.TrimSpace(op))
	switch upperOp {
	case "IS NULL", "IS NOT NULL":
		return colRef + " " + upperOp
	case "BETWEEN":
		return fmt.Sprintf("%s BETWEEN %s AND %s", colRef, formatLiteral(val), formatLiteral(val2))
	case "NOT BETWEEN":
		return fmt.Sprintf("%s NOT BETWEEN %s AND %s", colRef, formatLiteral(val), formatLiteral(val2))
	case "IN", "NOT IN":
		// Val may be comma-separated values: e.g. "1, 2, 3" or "'a', 'b'"
		items := splitInItems(val)
		var formatted []string
		for _, it := range items {
			formatted = append(formatted, formatLiteral(it))
		}
		if len(formatted) == 0 {
			formatted = append(formatted, "NULL")
		}
		return fmt.Sprintf("%s %s (%s)", colRef, upperOp, strings.Join(formatted, ", "))
	case "ILIKE":
		if supportsIlike {
			return colRef + " ILIKE " + formatLiteral(val)
		}
		return fmt.Sprintf("LOWER(%s) LIKE LOWER(%s)", colRef, formatLiteral(val))
	case "LIKE", "NOT LIKE":
		return fmt.Sprintf("%s %s %s", colRef, upperOp, formatLiteral(val))
	case "=", "!=", "<>", ">", ">=", "<", "<=":
		return fmt.Sprintf("%s %s %s", colRef, upperOp, formatLiteral(val))
	default:
		return fmt.Sprintf("%s = %s", colRef, formatLiteral(val))
	}
}

// splitInItems handles comma-separated list of items for IN clauses.
func splitInItems(s string) []string {
	var items []string
	raw := strings.Trim(strings.TrimSpace(s), "()")
	for _, part := range strings.Split(raw, ",") {
		clean := strings.TrimSpace(part)
		clean = strings.Trim(clean, "'\"")
		if clean != "" {
			items = append(items, clean)
		}
	}
	return items
}

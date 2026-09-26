package pivot

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

var (
	reBlockComment = regexp.MustCompile(`(?s)/\*.*?\*/`)
	reLineComment  = regexp.MustCompile(`(?m)(?:--|#).*$`)
	reCteMutation  = regexp.MustCompile(`(?i)\b(INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)\b`)
)

// normalizeDialect standardizes dialect name to postgres, mysql, or sqlite.
func normalizeDialect(d string) string {
	d = strings.ToLower(strings.TrimSpace(d))
	switch d {
	case "mysql", "mariadb":
		return "mysql"
	case "sqlite", "sqlite3":
		return "sqlite"
	case "postgres", "postgresql", "pg":
		return "postgres"
	default:
		return "postgres"
	}
}

// quoteIdent escapes and quotes identifiers based on dialect.
func quoteIdent(name, dialect string) string {
	d := normalizeDialect(dialect)
	if d == "mysql" {
		return "`" + strings.ReplaceAll(name, "`", "``") + "`"
	}
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

// escapeLiteral escapes and wraps string literals in single quotes.
func escapeLiteral(val, dialect string) string {
	if normalizeDialect(dialect) == "mysql" {
		val = strings.ReplaceAll(val, `\`, `\\`)
	}
	return "'" + strings.ReplaceAll(val, "'", "''") + "'"
}

// hasUnquotedSemicolon checks if sql contains a semicolon outside quotes and comments.
func hasUnquotedSemicolon(sql string) bool {
	inSingle := false
	inDouble := false
	inBacktick := false
	chars := []rune(sql)
	n := len(chars)

	for i := 0; i < n; i++ {
		ch := chars[i]
		if ch == '\'' && !inDouble && !inBacktick {
			if inSingle && i+1 < n && chars[i+1] == '\'' {
				i++
				continue
			}
			inSingle = !inSingle
		} else if ch == '"' && !inSingle && !inBacktick {
			if inDouble && i+1 < n && chars[i+1] == '"' {
				i++
				continue
			}
			inDouble = !inDouble
		} else if ch == '`' && !inSingle && !inDouble {
			inBacktick = !inBacktick
		} else if !inSingle && !inDouble && !inBacktick {
			if ch == '-' && i+1 < n && chars[i+1] == '-' {
				for i < n && chars[i] != '\n' {
					i++
				}
				continue
			}
			if ch == '#' {
				for i < n && chars[i] != '\n' {
					i++
				}
				continue
			}
			if ch == '/' && i+1 < n && chars[i+1] == '*' {
				i += 2
				for i+1 < n && !(chars[i] == '*' && chars[i+1] == '/') {
					i++
				}
				i++
				continue
			}
			if ch == ';' {
				return true
			}
		}
	}
	return false
}

func isSelectOrWith(sql string) bool {
	cleaned := reBlockComment.ReplaceAllString(sql, " ")
	cleaned = reLineComment.ReplaceAllString(cleaned, " ")
	cleaned = strings.TrimSpace(cleaned)
	for strings.HasPrefix(cleaned, "(") && strings.HasSuffix(cleaned, ")") {
		cleaned = strings.TrimSpace(cleaned[1 : len(cleaned)-1])
	}
	fields := strings.Fields(cleaned)
	if len(fields) == 0 {
		return false
	}
	firstWord := strings.ToUpper(fields[0])
	if firstWord != "SELECT" && firstWord != "WITH" {
		return false
	}
	if firstWord == "WITH" && reCteMutation.MatchString(cleaned) {
		return false
	}
	return true
}

// GeneratePushdownSQL builds a SQL statement pushing aggregation and pivoting into the DB engine.
func GeneratePushdownSQL(req PushdownRequest) (string, error) {
	q := strings.TrimSpace(req.Query)
	for strings.HasSuffix(q, ";") {
		q = strings.TrimSpace(strings.TrimSuffix(q, ";"))
	}
	if q == "" {
		return "", errors.New("query is required for pushdown")
	}

	if hasUnquotedSemicolon(q) {
		return "", errors.New("query cannot contain multiple statements or unquoted semicolons")
	}

	if !isSelectOrWith(q) {
		return "", errors.New("query must be a SELECT or WITH statement")
	}

	colField := strings.TrimSpace(req.ColField)
	if colField == "" {
		return "", errors.New("colField is required for pushdown")
	}

	if len(req.ColValues) == 0 {
		return "", errors.New("colValues must contain at least one column value")
	}

	agg := strings.ToUpper(strings.TrimSpace(req.Aggregator))
	if agg == "" {
		agg = "SUM"
	}
	switch agg {
	case "SUM", "COUNT", "AVG", "MIN", "MAX":
		// valid
	default:
		return "", fmt.Errorf("unsupported aggregator: %s", req.Aggregator)
	}

	valField := strings.TrimSpace(req.ValueField)
	if agg != "COUNT" && valField == "" {
		return "", errors.New("valueField is required for numeric aggregators")
	}

	dialect := normalizeDialect(req.Dialect)
	colRef := quoteIdent(colField, dialect)

	var valExpr string
	if valField != "" && valField != "*" {
		valExpr = quoteIdent(valField, dialect)
	}

	// 1. Build SELECT column expressions
	var selectCols []string
	for _, rf := range req.RowFields {
		rf = strings.TrimSpace(rf)
		if rf != "" {
			selectCols = append(selectCols, quoteIdent(rf, dialect))
		}
	}

	for _, cv := range req.ColValues {
		alias := quoteIdent(cv, dialect)
		colLit := escapeLiteral(cv, dialect)

		var colSql string
		if dialect == "postgres" {
			// PostgreSQL FILTER (WHERE ...) syntax
			if agg == "COUNT" {
				if valExpr == "" {
					colSql = fmt.Sprintf("COUNT(*) FILTER (WHERE %s = %s) AS %s", colRef, colLit, alias)
				} else {
					colSql = fmt.Sprintf("COUNT(%s) FILTER (WHERE %s = %s) AS %s", valExpr, colRef, colLit, alias)
				}
			} else {
				colSql = fmt.Sprintf("%s(%s) FILTER (WHERE %s = %s) AS %s", agg, valExpr, colRef, colLit, alias)
			}
		} else {
			// MySQL & SQLite CASE WHEN ... THEN ... END syntax
			if agg == "COUNT" {
				if valExpr == "" {
					colSql = fmt.Sprintf("COUNT(CASE WHEN %s = %s THEN 1 ELSE NULL END) AS %s", colRef, colLit, alias)
				} else {
					colSql = fmt.Sprintf("COUNT(CASE WHEN %s = %s THEN %s ELSE NULL END) AS %s", colRef, colLit, valExpr, alias)
				}
			} else {
				colSql = fmt.Sprintf("%s(CASE WHEN %s = %s THEN %s ELSE NULL END) AS %s", agg, colRef, colLit, valExpr, alias)
			}
		}
		selectCols = append(selectCols, colSql)
	}

	// 2. FROM subquery
	fromClause := fmt.Sprintf("FROM (%s) AS _src", q)

	// 3. GROUP BY and ORDER BY clauses
	var groupByClause string
	var orderByClause string

	var validRowFields []string
	for _, rf := range req.RowFields {
		rf = strings.TrimSpace(rf)
		if rf != "" {
			validRowFields = append(validRowFields, quoteIdent(rf, dialect))
		}
	}

	if len(validRowFields) > 0 {
		rowFieldsList := strings.Join(validRowFields, ", ")
		if req.Subtotals {
			switch dialect {
			case "postgres":
				groupByClause = "GROUP BY ROLLUP (" + rowFieldsList + ")"
			case "mysql":
				groupByClause = "GROUP BY " + rowFieldsList + " WITH ROLLUP"
			default: // sqlite doesn't support ROLLUP syntax
				groupByClause = "GROUP BY " + rowFieldsList
			}
		} else {
			groupByClause = "GROUP BY " + rowFieldsList
			orderByClause = "ORDER BY " + rowFieldsList
		}
	}

	var sb strings.Builder
	sb.WriteString("SELECT\n  ")
	sb.WriteString(strings.Join(selectCols, ",\n  "))
	sb.WriteString("\n")
	sb.WriteString(fromClause)

	if groupByClause != "" {
		sb.WriteString("\n")
		sb.WriteString(groupByClause)
	}
	if orderByClause != "" {
		sb.WriteString("\n")
		sb.WriteString(orderByClause)
	}
	sb.WriteString(";")

	return sb.String(), nil
}

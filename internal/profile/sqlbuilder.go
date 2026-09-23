package profile

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/dblens/dblens/internal/driver/types"
)

func NormalizeDialect(d string) string {
	d = strings.ToLower(strings.TrimSpace(d))
	switch d {
	case "mysql", "mariadb":
		return "mysql"
	case "sqlite", "sqlite3":
		return "sqlite"
	default:
		return "postgres"
	}
}

func QuoteIdentifier(dialect, ident string) string {
	ident = strings.TrimSpace(ident)
	if dialect == "mysql" {
		return "`" + strings.ReplaceAll(ident, "`", "``") + "`"
	}
	return `"` + strings.ReplaceAll(ident, `"`, `""`) + `"`
}

func QualifyTable(dialect, schema, table string) string {
	quotedTable := QuoteIdentifier(dialect, table)
	if schema == "" || (dialect == "sqlite" && (schema == "main" || schema == "")) {
		return quotedTable
	}
	return QuoteIdentifier(dialect, schema) + "." + quotedTable
}

func IsTextType(dataType string) bool {
	dt := strings.ToLower(dataType)
	return strings.Contains(dt, "char") ||
		strings.Contains(dt, "text") ||
		strings.Contains(dt, "clob") ||
		strings.Contains(dt, "string") ||
		strings.Contains(dt, "json")
}

func IsNumericType(dataType string) bool {
	dt := strings.ToLower(dataType)
	return strings.Contains(dt, "int") ||
		strings.Contains(dt, "float") ||
		strings.Contains(dt, "double") ||
		strings.Contains(dt, "decimal") ||
		strings.Contains(dt, "numeric") ||
		strings.Contains(dt, "real") ||
		strings.Contains(dt, "number") ||
		strings.Contains(dt, "serial")
}

func BuildColumnMetricsQuery(dialect, fromClause, quotedCol string, isText, isNum bool) string {
	var parts []string
	parts = append(parts, "COUNT(*)")
	parts = append(parts, fmt.Sprintf("COUNT(%s)", quotedCol))
	parts = append(parts, fmt.Sprintf("COUNT(DISTINCT %s)", quotedCol))

	if isText {
		parts = append(parts, fmt.Sprintf("SUM(CASE WHEN %s = '' THEN 1 ELSE 0 END)", quotedCol))
	}

	if isNum {
		parts = append(parts, fmt.Sprintf("MIN(%s)", quotedCol))
		parts = append(parts, fmt.Sprintf("MAX(%s)", quotedCol))
		parts = append(parts, fmt.Sprintf("AVG(%s)", quotedCol))
		if dialect == "postgres" || dialect == "mysql" {
			parts = append(parts, fmt.Sprintf("STDDEV_POP(%s)", quotedCol))
		}
	}

	return fmt.Sprintf("SELECT %s FROM %s", strings.Join(parts, ", "), fromClause)
}

func BuildTopValuesQuery(fromClause, quotedCol string, limit int) string {
	if limit <= 0 {
		limit = 10
	}
	return fmt.Sprintf(
		"SELECT %s, COUNT(*) AS cnt FROM %s WHERE %s IS NOT NULL GROUP BY %s ORDER BY cnt DESC, %s ASC LIMIT %d",
		quotedCol, fromClause, quotedCol, quotedCol, quotedCol, limit,
	)
}

func GenerateHistogram(ctx context.Context, drv types.Driver, fromClause, quotedCol string, minVal, maxVal float64, numBuckets int) []Bucket {
	if math.IsNaN(minVal) || math.IsNaN(maxVal) || math.IsInf(minVal, 0) || math.IsInf(maxVal, 0) {
		return []Bucket{}
	}
	if numBuckets <= 0 {
		numBuckets = 5
	}
	if maxVal <= minVal {
		return []Bucket{{Min: minVal, Max: maxVal, Count: 0}}
	}

	step := (maxVal - minVal) / float64(numBuckets)
	buckets := make([]Bucket, numBuckets)
	for i := 0; i < numBuckets; i++ {
		bMin := roundFloat(minVal+float64(i)*step, 2)
		bMax := roundFloat(minVal+float64(i+1)*step, 2)
		if i == numBuckets-1 {
			bMax = roundFloat(maxVal, 2)
		}
		buckets[i] = Bucket{
			Min:   bMin,
			Max:   bMax,
			Count: 0,
		}
	}

	// Build WHEN clauses
	var whenCases []string
	for i := 0; i < numBuckets-1; i++ {
		boundary := minVal + float64(i+1)*step
		whenCases = append(whenCases, fmt.Sprintf("WHEN %s < %f THEN %d", quotedCol, boundary, i))
	}
	caseExpr := fmt.Sprintf("CASE %s ELSE %d END", strings.Join(whenCases, " "), numBuckets-1)

	histQuery := fmt.Sprintf(
		"SELECT %s AS b_idx, COUNT(*) FROM %s WHERE %s IS NOT NULL GROUP BY 1 ORDER BY 1",
		caseExpr, fromClause, quotedCol,
	)

	res, err := drv.ExecuteQuery(ctx, histQuery)
	if err == nil && res != nil {
		for _, r := range res.Rows {
			if len(r) >= 2 {
				idx := int(toInt64(r[0]))
				cnt := toInt64(r[1])
				if idx >= 0 && idx < len(buckets) {
					buckets[idx].Count = cnt
				}
			}
		}
	}

	return buckets
}

func generateHistogram(ctx context.Context, drv types.Driver, fromClause, quotedCol string, minVal, maxVal float64, numBuckets int) []Bucket {
	return GenerateHistogram(ctx, drv, fromClause, quotedCol, minVal, maxVal, numBuckets)
}

func toInt64(v interface{}) int64 {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case int64:
		return val
	case int:
		return int64(val)
	case int32:
		return int64(val)
	case float64:
		return int64(val)
	case float32:
		return int64(val)
	case []byte:
		n, _ := strconv.ParseInt(string(val), 10, 64)
		return n
	case string:
		n, _ := strconv.ParseInt(strings.TrimSpace(val), 10, 64)
		return n
	default:
		return 0
	}
}

func toFloat64(v interface{}) float64 {
	if v == nil {
		return 0.0
	}
	switch val := v.(type) {
	case float64:
		return val
	case float32:
		return float64(val)
	case int64:
		return float64(val)
	case int:
		return float64(val)
	case []byte:
		f, _ := strconv.ParseFloat(string(val), 64)
		return f
	case string:
		f, _ := strconv.ParseFloat(strings.TrimSpace(val), 64)
		return f
	default:
		return 0.0
	}
}

func roundFloat(val float64, precision int) float64 {
	ratio := math.Pow(10, float64(precision))
	return math.Round(val*ratio) / ratio
}

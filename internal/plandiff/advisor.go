package plandiff

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/dblens/dblens/internal/driver/types"
)

var (
	reStringLiteral = regexp.MustCompile(`'[^']*'`)
	reTypeCast      = regexp.MustCompile(`::[a-zA-Z0-9_]+`)
	reParens        = regexp.MustCompile(`[()]`)
	reIdent         = regexp.MustCompile(`\b([a-zA-Z_][a-zA-Z0-9_]*)\b`)
)

var sqlKeywords = map[string]bool{
	"and": true, "or": true, "not": true, "null": true, "true": true, "false": true,
	"case": true, "when": true, "then": true, "else": true, "end": true, "in": true,
	"is": true, "like": true, "ilike": true, "between": true, "cast": true,
	"select": true, "from": true, "where": true, "asc": true, "desc": true,
	"order": true, "by": true, "group": true, "having": true, "join": true,
	"on": true, "limit": true, "offset": true, "as": true, "text": true,
	"int": true, "integer": true, "bigint": true, "boolean": true, "timestamp": true,
	"date": true, "varchar": true, "numeric": true, "float": true, "filter": true,
}

type filterColumns struct {
	equality []string
	rangeCol []string
	isJSON   bool
}

// RecommendIndexes scans execution plans for unindexed table scans, filters, and sorts.
func RecommendIndexes(candidate, baseline *types.ExplainResult, dialect, schema string) []IndexRecommendation {
	dialect = strings.ToLower(dialect)
	if dialect == "" {
		dialect = "postgres"
	}

	var recs []IndexRecommendation
	seen := make(map[string]bool)

	// Collect nodes from candidate (or baseline if candidate is nil)
	var nodes []*types.PlanNode
	if candidate != nil && candidate.Root != nil {
		collectPlanNodes(candidate.Root, &nodes)
	} else if baseline != nil && baseline.Root != nil {
		collectPlanNodes(baseline.Root, &nodes)
	}

	for _, node := range nodes {
		table := node.RelationName
		if table == "" {
			continue
		}

		filter := node.Filter
		if filter == "" && node.HashCond != "" {
			filter = node.HashCond
		}
		if filter == "" && node.IndexCond != "" && node.IndexName == "" {
			filter = node.IndexCond
		}

		isSeq := isSeqScan(node)
		if !isSeq && filter == "" {
			continue
		}

		cols := extractColumnsFromFilter(filter, table)

		// Check for accompanying sort node on same table
		if len(cols.equality) == 0 && len(cols.rangeCol) == 0 {
			// If it's a seq scan without clear filter parse, check if filter has any identifier
			fallbackCols := extractFallbackIdentifiers(filter, table)
			if len(fallbackCols) > 0 {
				cols.equality = append(cols.equality, fallbackCols[0])
			}
		}

		var allCols []string
		for _, c := range cols.equality {
			if !contains(allCols, c) {
				allCols = append(allCols, c)
			}
		}
		for _, c := range cols.rangeCol {
			if !contains(allCols, c) {
				allCols = append(allCols, c)
			}
		}

		if len(allCols) == 0 {
			continue
		}

		// Cap index columns to 4
		if len(allCols) > 4 {
			allCols = allCols[:4]
		}

		key := fmt.Sprintf("%s:%s", strings.ToLower(table), strings.Join(allCols, ","))
		if seen[key] {
			continue
		}
		seen[key] = true

		idxType := "btree"
		if cols.isJSON || strings.Contains(filter, "->") || strings.Contains(filter, "@@") {
			idxType = "gin"
		}

		savings := EstimateCostSavings(node, allCols, len(cols.equality) > 0, len(cols.rangeCol) > 0)

		reason := fmt.Sprintf("Sequential scan on table '%s' with filter (%s) lacks supporting index", table, summarizeFilter(filter))
		if strings.Contains(strings.ToLower(node.NodeType), "sort") {
			reason = fmt.Sprintf("In-memory sort/filter on table '%s' would benefit from indexed ordering", table)
		}

		ddl, rollback := generateIndexDDL(table, schema, allCols, idxType, dialect)

		recs = append(recs, IndexRecommendation{
			Table:                   table,
			Columns:                 allCols,
			IndexType:               idxType,
			Reason:                  reason,
			EstimatedCostSavingsPct: savings,
			DDL:                     ddl,
			RollbackDDL:             rollback,
		})
	}

	return recs
}

func collectPlanNodes(node *types.PlanNode, out *[]*types.PlanNode) {
	if node == nil {
		return
	}
	*out = append(*out, node)
	for i := range node.Children {
		collectPlanNodes(&node.Children[i], out)
	}
}

func extractColumnsFromFilter(filter, table string) filterColumns {
	var fc filterColumns
	if filter == "" {
		return fc
	}

	if strings.Contains(filter, "->") || strings.Contains(filter, "->>") || strings.Contains(filter, "@@") {
		fc.isJSON = true
	}

	cleaned := reStringLiteral.ReplaceAllString(filter, " ")
	cleaned = reTypeCast.ReplaceAllString(cleaned, " ")
	cleaned = strings.ReplaceAll(cleaned, "`", "")
	cleaned = strings.ReplaceAll(cleaned, "\"", "")

	// Split by AND / OR to isolate clauses
	clauses := strings.FieldsFunc(cleaned, func(r rune) bool {
		return r == ';' || r == '\n'
	})
	if len(clauses) <= 1 {
		clauses = strings.Split(cleaned, " AND ")
	}

	for _, clause := range clauses {
		clause = strings.TrimSpace(clause)
		if clause == "" {
			continue
		}

		isEq := strings.Contains(clause, "=") && !strings.Contains(clause, "!=") && !strings.Contains(clause, "<>") && !strings.Contains(clause, "<=") && !strings.Contains(clause, ">=")
		isRange := strings.Contains(clause, ">") || strings.Contains(clause, "<") || strings.Contains(strings.ToUpper(clause), "BETWEEN") || strings.Contains(strings.ToUpper(clause), "LIKE") || strings.Contains(strings.ToUpper(clause), "IN")

		words := reIdent.FindAllString(clause, -1)
		for _, w := range words {
			col := cleanColumn(w, table)
			if col == "" {
				continue
			}

			if isEq {
				if !contains(fc.equality, col) {
					fc.equality = append(fc.equality, col)
				}
			} else if isRange {
				if !contains(fc.rangeCol, col) && !contains(fc.equality, col) {
					fc.rangeCol = append(fc.rangeCol, col)
				}
			} else {
				if !contains(fc.equality, col) && !contains(fc.rangeCol, col) {
					fc.equality = append(fc.equality, col)
				}
			}
		}
	}

	return fc
}

func extractFallbackIdentifiers(filter, table string) []string {
	if filter == "" {
		return nil
	}
	cleaned := reStringLiteral.ReplaceAllString(filter, " ")
	cleaned = reTypeCast.ReplaceAllString(cleaned, " ")
	cleaned = strings.ReplaceAll(cleaned, "`", "")
	cleaned = strings.ReplaceAll(cleaned, "\"", "")

	words := reIdent.FindAllString(cleaned, -1)
	var res []string
	for _, w := range words {
		col := cleanColumn(w, table)
		if col != "" && !contains(res, col) {
			res = append(res, col)
		}
	}
	return res
}

func cleanColumn(w, table string) string {
	lower := strings.ToLower(w)
	if sqlKeywords[lower] {
		return ""
	}
	if strings.HasPrefix(lower, "idx_") || strings.HasPrefix(lower, "pk_") || strings.HasPrefix(lower, "fk_") {
		return ""
	}
	if strings.EqualFold(w, table) {
		return ""
	}
	// Check if identifier contains dot table.col
	if strings.Contains(w, ".") {
		parts := strings.Split(w, ".")
		w = parts[len(parts)-1]
	}
	if len(w) < 2 {
		return ""
	}
	return strings.ToLower(w)
}

func contains(slice []string, s string) bool {
	for _, v := range slice {
		if strings.EqualFold(v, s) {
			return true
		}
	}
	return false
}

func summarizeFilter(f string) string {
	f = strings.TrimSpace(f)
	if len(f) > 50 {
		return f[:47] + "..."
	}
	if f == "" {
		return "unfiltered"
	}
	return f
}

func generateIndexDDL(table, schema string, cols []string, indexType, dialect string) (string, string) {
	colList := strings.Join(cols, ", ")
	colSuffix := strings.Join(cols, "_")
	colSuffix = regexp.MustCompile(`[^a-zA-Z0-9_]`).ReplaceAllString(colSuffix, "")
	if len(colSuffix) > 30 {
		colSuffix = colSuffix[:30]
	}

	idxName := fmt.Sprintf("idx_%s_%s", table, colSuffix)
	tableRef := table
	if schema != "" && !strings.EqualFold(schema, "public") && !strings.EqualFold(schema, "main") {
		tableRef = fmt.Sprintf("%s.%s", schema, table)
	}

	switch strings.ToLower(dialect) {
	case "mysql", "mariadb":
		ddl := fmt.Sprintf("CREATE INDEX %s ON %s (%s);", idxName, tableRef, colList)
		rollback := fmt.Sprintf("DROP INDEX %s ON %s;", idxName, tableRef)
		return ddl, rollback

	case "sqlite":
		ddl := fmt.Sprintf("CREATE INDEX %s ON %s (%s);", idxName, tableRef, colList)
		rollback := fmt.Sprintf("DROP INDEX IF EXISTS %s;", idxName)
		return ddl, rollback

	default: // postgres
		method := ""
		if strings.EqualFold(indexType, "gin") {
			method = " USING gin"
		}
		ddl := fmt.Sprintf("CREATE INDEX CONCURRENTLY %s ON %s%s (%s);", idxName, tableRef, method, colList)
		rollback := fmt.Sprintf("DROP INDEX CONCURRENTLY IF EXISTS %s;", idxName)
		return ddl, rollback
	}
}

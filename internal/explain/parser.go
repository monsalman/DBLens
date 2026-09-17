package explain

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/dblens/dblens/internal/driver/types"
)

func toFloat64(val interface{}) float64 {
	if val == nil {
		return 0
	}
	switch v := val.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case string:
		f, _ := strconv.ParseFloat(strings.TrimSpace(v), 64)
		return f
	case json.Number:
		f, _ := v.Float64()
		return f
	default:
		return 0
	}
}

func toInt64(val interface{}) int64 {
	if val == nil {
		return 0
	}
	switch v := val.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	case string:
		n, _ := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
		return n
	case json.Number:
		n, _ := v.Int64()
		return n
	default:
		return 0
	}
}

func toString(val interface{}) string {
	if val == nil {
		return ""
	}
	if s, ok := val.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", val)
}

// ParsePostgres parses PostgreSQL EXPLAIN (FORMAT JSON) or EXPLAIN (ANALYZE, FORMAT JSON) output.
func ParsePostgres(rawJSON string) (*types.ExplainResult, error) {
	rawTrim := strings.TrimSpace(rawJSON)
	if rawTrim == "" {
		return nil, fmt.Errorf("empty explain output")
	}

	var parsed interface{}
	decoder := json.NewDecoder(strings.NewReader(rawTrim))
	decoder.UseNumber()
	if err := decoder.Decode(&parsed); err != nil {
		return nil, fmt.Errorf("failed to parse postgres explain json: %w", err)
	}

	var rootMap map[string]interface{}
	var planObj map[string]interface{}
	var planningTime float64
	var executionTime float64

	switch v := parsed.(type) {
	case []interface{}:
		if len(v) == 0 {
			return nil, fmt.Errorf("empty plan array")
		}
		if firstMap, ok := v[0].(map[string]interface{}); ok {
			rootMap = firstMap
		}
	case map[string]interface{}:
		rootMap = v
	default:
		return nil, fmt.Errorf("unexpected json structure for postgres explain")
	}

	if rootMap != nil {
		if p, ok := rootMap["Plan"].(map[string]interface{}); ok {
			planObj = p
		}
		planningTime = toFloat64(rootMap["Planning Time"])
		executionTime = toFloat64(rootMap["Execution Time"])
	}

	if planObj == nil {
		return nil, fmt.Errorf("no 'Plan' node found in postgres explain output")
	}

	rootNode := parsePostgresPlanNode(planObj)
	summary := types.ExplainSummary{
		TotalCost:     rootNode.TotalCost,
		PlanningTime:  planningTime,
		ExecutionTime: executionTime,
	}

	return &types.ExplainResult{
		Dialect: "postgres",
		Root:    &rootNode,
		Summary: summary,
		Raw:     rawTrim,
		Format:  "json",
	}, nil
}

func parsePostgresPlanNode(m map[string]interface{}, depth ...int) types.PlanNode {
	d := 0
	if len(depth) > 0 {
		d = depth[0]
	}
	if d > 100 {
		return types.PlanNode{NodeType: toString(m["Node Type"])}
	}

	nodeType := toString(m["Node Type"])
	relationName := toString(m["Relation Name"])
	schema := toString(m["Schema"])
	alias := toString(m["Alias"])
	indexName := toString(m["Index Name"])
	startupCost := toFloat64(m["Startup Cost"])
	totalCost := toFloat64(m["Total Cost"])
	planRows := toFloat64(m["Plan Rows"])
	planWidth := toInt64(m["Plan Width"])
	actualStartupTime := toFloat64(m["Actual Startup Time"])
	actualTotalTime := toFloat64(m["Actual Total Time"])
	actualRows := toFloat64(m["Actual Rows"])
	actualLoops := toInt64(m["Actual Loops"])
	filter := toString(m["Filter"])
	indexCond := toString(m["Index Cond"])
	hashCond := toString(m["Hash Cond"])
	joinType := toString(m["Join Type"])

	var warnings []string
	isExpensive := false

	if strings.EqualFold(nodeType, "Seq Scan") {
		isExpensive = true
		if relationName != "" {
			warnings = append(warnings, fmt.Sprintf("Sequential scan on table '%s'", relationName))
		} else {
			warnings = append(warnings, "Sequential scan on table")
		}
	}

	if totalCost >= 1000.0 {
		isExpensive = true
		warnings = append(warnings, fmt.Sprintf("High estimated cost: %.1f", totalCost))
	}

	if actualTotalTime >= 50.0 {
		isExpensive = true
		warnings = append(warnings, fmt.Sprintf("High actual execution time: %.2fms", actualTotalTime))
	}

	if rowsRemoved := toFloat64(m["Rows Removed by Filter"]); rowsRemoved > 500 {
		warnings = append(warnings, fmt.Sprintf("High filter elimination: %.0f rows discarded by filter", rowsRemoved))
	}

	var children []types.PlanNode
	if plans, ok := m["Plans"].([]interface{}); ok {
		for _, child := range plans {
			if childMap, ok := child.(map[string]interface{}); ok {
				children = append(children, parsePostgresPlanNode(childMap, d+1))
			}
		}
	}

	extra := make(map[string]interface{})
	for k, v := range m {
		switch k {
		case "Node Type", "Relation Name", "Schema", "Alias", "Index Name",
			"Startup Cost", "Total Cost", "Plan Rows", "Plan Width",
			"Actual Startup Time", "Actual Total Time", "Actual Rows", "Actual Loops",
			"Filter", "Index Cond", "Hash Cond", "Join Type", "Plans":
			continue
		default:
			extra[k] = v
		}
	}

	return types.PlanNode{
		NodeType:          nodeType,
		RelationName:      relationName,
		Schema:            schema,
		Alias:             alias,
		IndexName:         indexName,
		Cost:              totalCost,
		StartupCost:       startupCost,
		TotalCost:         totalCost,
		Rows:              planRows,
		PlanRows:          planRows,
		PlanWidth:         planWidth,
		ActualTime:        actualTotalTime,
		ActualStartupTime: actualStartupTime,
		ActualTotalTime:   actualTotalTime,
		ActualRows:        actualRows,
		ActualLoops:       actualLoops,
		Filter:            filter,
		IndexCond:         indexCond,
		HashCond:          hashCond,
		JoinType:          joinType,
		IsExpensive:       isExpensive,
		Warnings:          warnings,
		Children:          children,
		Extra:             extra,
	}
}

// ParseMySQL parses MySQL EXPLAIN FORMAT=JSON output.
func ParseMySQL(rawJSON string) (*types.ExplainResult, error) {
	rawTrim := strings.TrimSpace(rawJSON)
	if rawTrim == "" {
		return nil, fmt.Errorf("empty explain output")
	}

	var parsed map[string]interface{}
	decoder := json.NewDecoder(strings.NewReader(rawTrim))
	decoder.UseNumber()
	if err := decoder.Decode(&parsed); err != nil {
		return nil, fmt.Errorf("failed to parse mysql explain json: %w", err)
	}

	rootNode, totalCost := parseMySQLBlock(parsed)
	if rootNode == nil {
		empty := types.PlanNode{NodeType: "EMPTY PLAN"}
		rootNode = &empty
	}

	summary := types.ExplainSummary{
		TotalCost: totalCost,
	}

	return &types.ExplainResult{
		Dialect: "mysql",
		Root:    rootNode,
		Summary: summary,
		Raw:     rawTrim,
		Format:  "json",
	}, nil
}

func parseMySQLBlock(m map[string]interface{}, depth ...int) (*types.PlanNode, float64) {
	d := 0
	if len(depth) > 0 {
		d = depth[0]
	}
	if d > 100 {
		return &types.PlanNode{NodeType: "MAX_DEPTH_REACHED"}, 0
	}

	if qb, ok := m["query_block"].(map[string]interface{}); ok {
		return parseMySQLBlock(qb, d+1)
	}

	var totalCost float64
	if costInfo, ok := m["cost_info"].(map[string]interface{}); ok {
		totalCost = toFloat64(costInfo["query_cost"])
	}

	if grp, ok := m["grouping_operation"].(map[string]interface{}); ok {
		node := types.PlanNode{
			NodeType: "Aggregate (GROUP BY)",
			Cost:     totalCost,
		}
		if grp["using_filesort"] == true {
			node.Warnings = append(node.Warnings, "Using filesort for grouping")
			node.IsExpensive = true
		}
		if grp["using_temporary_table"] == true {
			node.Warnings = append(node.Warnings, "Using temporary table for grouping")
			node.IsExpensive = true
		}
		child, _ := parseMySQLBlock(grp, d+1)
		if child != nil {
			node.Children = append(node.Children, *child)
		}
		return &node, totalCost
	}

	if ord, ok := m["ordering_operation"].(map[string]interface{}); ok {
		node := types.PlanNode{
			NodeType: "Sort (ORDER BY)",
			Cost:     totalCost,
		}
		if ord["using_filesort"] == true {
			node.Warnings = append(node.Warnings, "Using filesort for ordering")
			node.IsExpensive = true
		}
		child, _ := parseMySQLBlock(ord, d+1)
		if child != nil {
			node.Children = append(node.Children, *child)
		}
		return &node, totalCost
	}

	if dup, ok := m["duplicates_removal"].(map[string]interface{}); ok {
		node := types.PlanNode{
			NodeType: "Distinct",
			Cost:     totalCost,
		}
		if dup["using_temporary_table"] == true {
			node.Warnings = append(node.Warnings, "Using temporary table for distinct")
			node.IsExpensive = true
		}
		child, _ := parseMySQLBlock(dup, d+1)
		if child != nil {
			node.Children = append(node.Children, *child)
		}
		return &node, totalCost
	}

	if nl, ok := m["nested_loop"].([]interface{}); ok {
		node := types.PlanNode{
			NodeType: "Nested Loop Join",
			Cost:     totalCost,
		}
		for _, item := range nl {
			if itemMap, ok := item.(map[string]interface{}); ok {
				child, _ := parseMySQLBlock(itemMap, d+1)
				if child != nil {
					node.Children = append(node.Children, *child)
				}
			}
		}
		return &node, totalCost
	}

	if tbl, ok := m["table"].(map[string]interface{}); ok {
		tableName := toString(tbl["table_name"])
		accessType := strings.ToUpper(toString(tbl["access_type"]))
		key := toString(tbl["key"])
		filter := toString(tbl["attached_condition"])
		rows := toFloat64(tbl["rows_examined_per_scan"])
		if rows == 0 {
			rows = toFloat64(tbl["rows_produced_per_join"])
		}

		var tableCost float64
		if costInfo, ok := tbl["cost_info"].(map[string]interface{}); ok {
			tableCost = toFloat64(costInfo["prefix_cost"])
			if tableCost == 0 {
				tableCost = toFloat64(costInfo["read_cost"])
			}
		}
		if tableCost == 0 {
			tableCost = totalCost
		}

		nodeType := "Table Access"
		isExpensive := false
		var warnings []string

		switch accessType {
		case "ALL":
			nodeType = "Table Scan (ALL)"
			isExpensive = true
			warnings = append(warnings, fmt.Sprintf("Full table scan on '%s' (access_type=ALL)", tableName))
		case "INDEX":
			nodeType = "Full Index Scan"
		case "RANGE":
			nodeType = "Index Range Scan"
		case "REF":
			nodeType = "Index Lookup (ref)"
		case "EQ_REF":
			nodeType = "Index Lookup (eq_ref)"
		case "CONST", "SYSTEM":
			nodeType = "Const Lookup"
		default:
			if accessType != "" {
				nodeType = fmt.Sprintf("Table Access (%s)", strings.ToLower(accessType))
			}
		}

		if tbl["using_filesort"] == true {
			warnings = append(warnings, "Using filesort")
			isExpensive = true
		}
		if tbl["using_temporary_table"] == true {
			warnings = append(warnings, "Using temporary table")
			isExpensive = true
		}

		node := types.PlanNode{
			NodeType:     nodeType,
			RelationName: tableName,
			IndexName:    key,
			Cost:         tableCost,
			TotalCost:    tableCost,
			Rows:         rows,
			PlanRows:     rows,
			Filter:       filter,
			IsExpensive:  isExpensive,
			Warnings:     warnings,
		}

		// Check for subqueries inside table block
		if subqueries, ok := tbl["subqueries"].([]interface{}); ok {
			for _, sub := range subqueries {
				if subMap, ok := sub.(map[string]interface{}); ok {
					child, _ := parseMySQLBlock(subMap, d+1)
					if child != nil {
						node.Children = append(node.Children, *child)
					}
				}
			}
		}

		return &node, totalCost
	}

	if subqueries, ok := m["subqueries"].([]interface{}); ok {
		node := types.PlanNode{
			NodeType: "Subqueries",
			Cost:     totalCost,
		}
		for _, sub := range subqueries {
			if subMap, ok := sub.(map[string]interface{}); ok {
				child, _ := parseMySQLBlock(subMap, d+1)
				if child != nil {
					node.Children = append(node.Children, *child)
				}
			}
		}
		return &node, totalCost
	}

	if union, ok := m["union_result"].(map[string]interface{}); ok {
		node := types.PlanNode{
			NodeType: "Union",
			Cost:     totalCost,
		}
		if specs, ok := union["query_specifications"].([]interface{}); ok {
			for _, spec := range specs {
				if specMap, ok := spec.(map[string]interface{}); ok {
					child, _ := parseMySQLBlock(specMap, d+1)
					if child != nil {
						node.Children = append(node.Children, *child)
					}
				}
			}
		}
		return &node, totalCost
	}

	return nil, totalCost
}

// SQLiteRow represents a row from EXPLAIN QUERY PLAN.
type SQLiteRow struct {
	ID      int
	Parent  int
	NotUsed int
	Detail  string
}

// ParseSQLite parses SQLite EXPLAIN QUERY PLAN rows.
func ParseSQLite(rows []SQLiteRow) (*types.ExplainResult, error) {
	if len(rows) == 0 {
		empty := types.PlanNode{NodeType: "EMPTY PLAN"}
		return &types.ExplainResult{
			Dialect: "sqlite",
			Root:    &empty,
			Summary: types.ExplainSummary{},
			Raw:     "EMPTY PLAN",
			Format:  "text",
		}, nil
	}

	// Format raw output as readable tree & table
	var rawBuilder strings.Builder
	rawBuilder.WriteString("id | parent | notused | detail\n")
	rawBuilder.WriteString("---+--------+---------+------------------------------------------\n")
	for _, r := range rows {
		rawBuilder.WriteString(fmt.Sprintf("%-2d | %-6d | %-7d | %s\n", r.ID, r.Parent, r.NotUsed, r.Detail))
	}

	nodeMap := make(map[int]types.PlanNode, len(rows))
	childrenMap := make(map[int][]int, len(rows))
	isChild := make(map[int]bool, len(rows))

	for _, r := range rows {
		nodeMap[r.ID] = parseSQLiteDetail(r.Detail)
	}

	for _, r := range rows {
		if r.Parent != 0 && r.Parent != r.ID {
			childrenMap[r.Parent] = append(childrenMap[r.Parent], r.ID)
			isChild[r.ID] = true
		}
	}

	var buildTree func(id int, visited map[int]bool, depth int) types.PlanNode
	buildTree = func(id int, visited map[int]bool, depth int) types.PlanNode {
		node := nodeMap[id]
		if visited[id] || depth > 50 {
			return node
		}
		visited[id] = true
		for _, childID := range childrenMap[id] {
			if _, exists := nodeMap[childID]; exists {
				node.Children = append(node.Children, buildTree(childID, visited, depth+1))
			}
		}
		delete(visited, id)
		return node
	}

	var topLevelNodes []types.PlanNode
	for _, r := range rows {
		if !isChild[r.ID] {
			topLevelNodes = append(topLevelNodes, buildTree(r.ID, make(map[int]bool), 0))
		}
	}

	var rootNode types.PlanNode
	if len(topLevelNodes) == 1 {
		rootNode = topLevelNodes[0]
	} else if len(topLevelNodes) > 1 {
		rootNode = types.PlanNode{
			NodeType: "QUERY PLAN",
			Children: topLevelNodes,
		}
	} else if len(rows) > 0 {
		rootNode = buildTree(rows[0].ID, make(map[int]bool), 0)
	}

	return &types.ExplainResult{
		Dialect: "sqlite",
		Root:    &rootNode,
		Summary: types.ExplainSummary{},
		Raw:     rawBuilder.String(),
		Format:  "text",
	}, nil
}

func parseSQLiteDetail(detail string) types.PlanNode {
	d := strings.TrimSpace(detail)
	upper := strings.ToUpper(d)

	var nodeType string
	var relationName string
	var alias string
	var indexName string
	var filter string
	var warnings []string
	isExpensive := false

	// Extract predicate in parens if present at the end
	if idxOpen := strings.LastIndex(d, "("); idxOpen != -1 && strings.HasSuffix(d, ")") {
		filter = d[idxOpen+1 : len(d)-1]
	}

	if strings.HasPrefix(upper, "SCAN") {
		nodeType = "Seq Scan"
		isExpensive = true
		relationName, alias = extractTableAndAlias(d, "SCAN")
		if relationName != "" {
			warnings = append(warnings, fmt.Sprintf("Full table scan on '%s'", relationName))
		} else {
			warnings = append(warnings, "Full table scan")
		}
	} else if strings.HasPrefix(upper, "SEARCH") {
		relationName, alias = extractTableAndAlias(d, "SEARCH")
		if strings.Contains(upper, "COVERING INDEX") {
			nodeType = "Covering Index Scan"
			indexName = extractIndexName(d, "COVERING INDEX")
		} else if strings.Contains(upper, "INTEGER PRIMARY KEY") {
			nodeType = "Primary Key Lookup"
			indexName = "PRIMARY KEY"
		} else if strings.Contains(upper, "AUTOMATIC") {
			nodeType = "Auto Index Scan"
			indexName = "AUTOMATIC INDEX"
			isExpensive = true
			warnings = append(warnings, "Automatic index built on the fly (consider adding permanent index)")
		} else if strings.Contains(upper, "USING INDEX") {
			nodeType = "Index Search"
			indexName = extractIndexName(d, "USING INDEX")
		} else {
			nodeType = "Search"
		}
	} else if strings.HasPrefix(upper, "USE TEMP B-TREE") {
		isExpensive = true
		if strings.Contains(upper, "ORDER BY") {
			nodeType = "Temp B-Tree (ORDER BY)"
			warnings = append(warnings, "Temporary B-Tree used for sorting")
		} else if strings.Contains(upper, "GROUP BY") {
			nodeType = "Temp B-Tree (GROUP BY)"
			warnings = append(warnings, "Temporary B-Tree used for grouping")
		} else if strings.Contains(upper, "DISTINCT") {
			nodeType = "Temp B-Tree (DISTINCT)"
			warnings = append(warnings, "Temporary B-Tree used for distinct")
		} else {
			nodeType = "Temp B-Tree"
			warnings = append(warnings, "Temporary B-Tree created")
		}
	} else if strings.HasPrefix(upper, "CO-ROUTINE") {
		nodeType = "Co-routine"
		parts := strings.Fields(d)
		if len(parts) >= 2 {
			relationName = parts[1]
		}
	} else if strings.HasPrefix(upper, "SUBQUERY") {
		nodeType = "Subquery"
	} else if strings.HasPrefix(upper, "COMPOUND QUERY") {
		nodeType = "Compound Query"
	} else {
		// Fallback: use first 2-3 words as node type
		words := strings.Fields(d)
		if len(words) > 3 {
			nodeType = strings.Join(words[:3], " ")
		} else {
			nodeType = d
		}
	}

	return types.PlanNode{
		NodeType:     nodeType,
		RelationName: relationName,
		Alias:        alias,
		IndexName:    indexName,
		Filter:       filter,
		IsExpensive:  isExpensive,
		Warnings:     warnings,
		Extra: map[string]interface{}{
			"detail": d,
		},
	}
}

func extractTableAndAlias(detail, prefix string) (string, string) {
	d := strings.TrimSpace(detail)
	if strings.HasPrefix(strings.ToUpper(d), prefix) {
		d = strings.TrimSpace(d[len(prefix):])
	}
	if strings.HasPrefix(strings.ToUpper(d), "TABLE ") {
		d = strings.TrimSpace(d[6:])
	}

	// Cut off at "USING" or "("
	cutIdx := len(d)
	if idx := strings.Index(strings.ToUpper(d), " USING "); idx != -1 {
		cutIdx = idx
	}
	if idx := strings.Index(d, "("); idx != -1 && idx < cutIdx {
		cutIdx = idx
	}
	tablePart := strings.TrimSpace(d[:cutIdx])

	parts := strings.Fields(tablePart)
	if len(parts) == 0 {
		return "", ""
	}
	tableName := parts[0]
	var alias string
	if len(parts) >= 3 && strings.EqualFold(parts[1], "AS") {
		alias = parts[2]
	} else if len(parts) >= 2 {
		alias = parts[1]
	}
	return tableName, alias
}

func extractIndexName(detail, marker string) string {
	idx := strings.Index(strings.ToUpper(detail), marker)
	if idx == -1 {
		return ""
	}
	rest := strings.TrimSpace(detail[idx+len(marker):])
	// Rest starts with index name, ends at space or '('
	end := len(rest)
	if sp := strings.Index(rest, " "); sp != -1 {
		end = sp
	}
	if paren := strings.Index(rest, "("); paren != -1 && paren < end {
		end = paren
	}
	return strings.TrimSpace(rest[:end])
}

package impact

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/dblens/dblens/internal/driver/types"
)

func normalizeDialect(dialect string) string {
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

var (
	singleLineCommentRegex = regexp.MustCompile(`(?m)(?:--|#).*$`)
	multiLineCommentRegex  = regexp.MustCompile(`(?s)/\*.*?\*/`)
	stringLiteralRegex     = regexp.MustCompile(`'(''|[^'])*'`)
)

func maskDollarQuotes(sql string) string {
	b := []byte(sql)
	n := len(b)
	i := 0
	for i < n {
		if b[i] == '$' {
			// Find closing '$' of opening tag
			tagEnd := i + 1
			for tagEnd < n && (b[tagEnd] == '_' || (b[tagEnd] >= 'a' && b[tagEnd] <= 'z') || (b[tagEnd] >= 'A' && b[tagEnd] <= 'Z') || (b[tagEnd] >= '0' && b[tagEnd] <= '9')) {
				tagEnd++
			}
			if tagEnd < n && b[tagEnd] == '$' {
				tag := string(b[i : tagEnd+1])
				// Find matching closing tag
				closeIdx := strings.Index(string(b[tagEnd+1:]), tag)
				if closeIdx != -1 {
					fullEnd := tagEnd + 1 + closeIdx + len(tag)
					for k := i; k < fullEnd; k++ {
						b[k] = ' '
					}
					i = fullEnd
					continue
				}
			}
		}
		i++
	}
	return string(b)
}

// MaskCommentsAndLiterals replaces comments and string literals with whitespace
// so textual reference scanning does not match occurrences inside literals or comments.
func MaskCommentsAndLiterals(sql string) string {
	if sql == "" {
		return ""
	}
	// 1. Dollar quoted strings (Postgres)
	cleaned := maskDollarQuotes(sql)
	// 2. Multi-line comments
	cleaned = multiLineCommentRegex.ReplaceAllStringFunc(cleaned, func(m string) string {
		return strings.Repeat(" ", len(m))
	})
	// 3. Single-line comments
	cleaned = singleLineCommentRegex.ReplaceAllStringFunc(cleaned, func(m string) string {
		return strings.Repeat(" ", len(m))
	})
	// 4. String literals
	cleaned = stringLiteralRegex.ReplaceAllStringFunc(cleaned, func(m string) string {
		return strings.Repeat(" ", len(m))
	})
	return cleaned
}

// TextualReferenceMatches checks if an unmasked SQL body references a given object or column.
func TextualReferenceMatches(sql, table, column string) bool {
	if sql == "" || (table == "" && column == "") {
		return false
	}
	masked := MaskCommentsAndLiterals(sql)

	// If column is specified, match qualified table.column or column standalone
	if column != "" {
		if table != "" {
			// e.g. users.id or `users`.`id` or "users"."id"
			pattern := fmt.Sprintf(`(?i)(?:["`+"`"+`]?%s["`+"`"+`]?\s*\.\s*["`+"`"+`]?%s["`+"`"+`]?)\b`,
				regexp.QuoteMeta(table), regexp.QuoteMeta(column))
			if matched, _ := regexp.MatchString(pattern, masked); matched {
				return true
			}
		}
		// Standalone column boundary check
		patternCol := fmt.Sprintf(`(?i)\b%s\b`, regexp.QuoteMeta(column))
		if matched, _ := regexp.MatchString(patternCol, masked); matched {
			// Verify table is also present in definition to reduce false positives
			if table == "" {
				return true
			}
			patternTbl := fmt.Sprintf(`(?i)\b%s\b`, regexp.QuoteMeta(table))
			if matchedTbl, _ := regexp.MatchString(patternTbl, masked); matchedTbl {
				return true
			}
		}
		return false
	}

	// Table only match
	pattern := fmt.Sprintf(`(?i)\b%s\b`, regexp.QuoteMeta(table))
	matched, _ := regexp.MatchString(pattern, masked)
	return matched
}

// AnalyzeImpact resolves all dependents and constructs the ImpactGraph.
func AnalyzeImpact(ctx context.Context, d types.Driver, req ImpactRequest) (*ImpactGraph, error) {
	dialect := normalizeDialect(d.Dialect())

	if req.Depth <= 0 {
		req.Depth = 5
	}
	if req.Depth > 10 {
		req.Depth = 10
	}
	if req.ObjectType == "" {
		if req.Column != "" {
			req.ObjectType = "column"
		} else {
			req.ObjectType = "table"
		}
	}
	if req.Schema == "" {
		switch dialect {
		case "postgres":
			req.Schema = "public"
		case "sqlite":
			req.Schema = "main"
		}
	}

	rootID := req.Object
	if req.Schema != "" {
		rootID = req.Schema + "." + req.Object
	}
	if req.Column != "" && req.ObjectType == "column" {
		rootID = rootID + "." + req.Column
	}

	rootNode := ImpactNode{
		ID:           rootID,
		Kind:         req.ObjectType,
		Schema:       req.Schema,
		Name:         req.Object,
		RefKind:      "target",
		Detail:       fmt.Sprintf("Target %s for impact analysis", req.ObjectType),
		DropBehavior: "RESTRICT",
	}
	if req.Column != "" && req.ObjectType == "column" {
		rootNode.Name = req.Column
		rootNode.Detail = fmt.Sprintf("Target column %s on table %s", req.Column, req.Object)
	}

	visited := make(map[string]bool)
	visited[rootNode.ID] = true

	var nodes []ImpactNode
	var edges []ImpactEdge

	type queueItem struct {
		id     string
		kind   string
		schema string
		name   string
		column string
		level  int
	}

	queue := []queueItem{{
		id:     rootNode.ID,
		kind:   rootNode.Kind,
		schema: rootNode.Schema,
		name:   req.Object,
		column: req.Column,
		level:  0,
	}}

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]

		if curr.level >= req.Depth {
			continue
		}

		var foundNodes []ImpactNode
		var foundEdges []ImpactEdge
		var err error

		switch dialect {
		case "sqlite":
			foundNodes, foundEdges, err = resolveSQLiteDependencies(ctx, d, curr.schema, curr.name, curr.column, curr.id)
		case "postgres":
			foundNodes, foundEdges, err = resolvePostgresDependencies(ctx, d, curr.schema, curr.name, curr.column, curr.id)
		case "mysql":
			foundNodes, foundEdges, err = resolveMySQLDependencies(ctx, d, curr.schema, curr.name, curr.column, curr.id)
		default:
			foundNodes, foundEdges, err = resolveSQLiteDependencies(ctx, d, curr.schema, curr.name, curr.column, curr.id)
		}

		if err != nil {
			return nil, err
		}

		for _, fn := range foundNodes {
			if !visited[fn.ID] {
				visited[fn.ID] = true
				nodes = append(nodes, fn)

				// Only recurse on tables and views to find transitive dependents
				if fn.Kind == "table" || fn.Kind == "view" {
					queue = append(queue, queueItem{
						id:     fn.ID,
						kind:   fn.Kind,
						schema: fn.Schema,
						name:   fn.Name,
						column: "",
						level:  curr.level + 1,
					})
				}
			}
		}

		for _, fe := range foundEdges {
			// Avoid duplicate edges
			edgeExists := false
			for _, existing := range edges {
				if existing.Source == fe.Source && existing.Target == fe.Target && existing.Relationship == fe.Relationship {
					edgeExists = true
					break
				}
			}
			if !edgeExists {
				edges = append(edges, fe)
			}
		}
	}

	risk := CalculateRiskScore(nodes, edges, req.ObjectType == "column")

	return &ImpactGraph{
		Root:            rootNode,
		Nodes:           nodes,
		Edges:           edges,
		TotalDependents: len(nodes),
		RiskScore:       risk,
	}, nil
}

// ── SQLite Dependency Resolver ──

func resolveSQLiteDependencies(ctx context.Context, d types.Driver, schema, targetTable, targetCol, targetID string) ([]ImpactNode, []ImpactEdge, error) {
	var nodes []ImpactNode
	var edges []ImpactEdge

	// 1. Triggers attached to target table or referencing target in statement
	trigRes, err := d.ExecuteRaw(ctx, "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL ORDER BY name")
	if err == nil && trigRes != nil {
		colIdx := buildColMap(trigRes.Columns)
		for _, row := range trigRes.Rows {
			tName := getStringVal(row, colIdx, "name")
			tblName := getStringVal(row, colIdx, "tbl_name")
			sqlText := getStringVal(row, colIdx, "sql")

			isDirect := strings.EqualFold(tblName, targetTable)
			isTextual := TextualReferenceMatches(sqlText, targetTable, targetCol)

			if isDirect || isTextual {
				refKind := "trigger_target"
				detail := fmt.Sprintf("Trigger attached to %s", tblName)
				if !isDirect && isTextual {
					refKind = "textual_reference"
					detail = fmt.Sprintf("Trigger statement references %s", targetTable)
				}
				nodeID := "trigger:" + tName
				nodes = append(nodes, ImpactNode{
					ID:           nodeID,
					Kind:         "trigger",
					Schema:       schema,
					Name:         tName,
					RefKind:      refKind,
					Detail:       detail,
					DropBehavior: "RESTRICT",
				})
				edges = append(edges, ImpactEdge{
					Source:       nodeID,
					Target:       targetID,
					Relationship: "triggers_on",
				})
			}
		}
	}

	// 2. Views referencing target
	viewRes, err := d.ExecuteRaw(ctx, "SELECT name, sql FROM sqlite_master WHERE type = 'view' AND sql IS NOT NULL ORDER BY name")
	if err == nil && viewRes != nil {
		colIdx := buildColMap(viewRes.Columns)
		for _, row := range viewRes.Rows {
			vName := getStringVal(row, colIdx, "name")
			sqlText := getStringVal(row, colIdx, "sql")

			if TextualReferenceMatches(sqlText, targetTable, targetCol) {
				nodeID := "view:" + vName
				nodes = append(nodes, ImpactNode{
					ID:           nodeID,
					Kind:         "view",
					Schema:       schema,
					Name:         vName,
					RefKind:      "catalog_view",
					Detail:       fmt.Sprintf("View definition references %s", targetTable),
					DropBehavior: "CASCADE",
				})
				edges = append(edges, ImpactEdge{
					Source:       nodeID,
					Target:       targetID,
					Relationship: "depends_on",
				})
			}
		}
	}

	// 3. Foreign Keys pointing to targetTable
	tableRes, err := d.ExecuteRaw(ctx, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
	if err == nil && tableRes != nil {
		colIdx := buildColMap(tableRes.Columns)
		for _, row := range tableRes.Rows {
			tbl := getStringVal(row, colIdx, "name")
			if strings.EqualFold(tbl, targetTable) && targetCol == "" {
				continue
			}

			fkQuery := fmt.Sprintf("PRAGMA foreign_key_list(%q);", tbl)
			fkRes, fkErr := d.ExecuteRaw(ctx, fkQuery)
			if fkErr != nil || fkRes == nil {
				continue
			}
			fkColIdx := buildColMap(fkRes.Columns)
			for _, fkRow := range fkRes.Rows {
				refTable := getStringVal(fkRow, fkColIdx, "table")
				fromCol := getStringVal(fkRow, fkColIdx, "from")
				toCol := getStringVal(fkRow, fkColIdx, "to")
				onDelete := getStringVal(fkRow, fkColIdx, "on_delete")

				if strings.EqualFold(refTable, targetTable) {
					// Check column match if inspecting column
					if targetCol != "" && toCol != "" && !strings.EqualFold(toCol, targetCol) {
						continue
					}

					fkID := fmt.Sprintf("fk:%s.%s.%s", tbl, fromCol, targetTable)
					nodes = append(nodes, ImpactNode{
						ID:           fkID,
						Kind:         "foreign_key",
						Schema:       schema,
						Name:         fmt.Sprintf("%s(%s) -> %s(%s)", tbl, fromCol, refTable, toCol),
						RefKind:      "catalog_fk",
						Detail:       fmt.Sprintf("Foreign key from table %s references %s(%s)", tbl, refTable, toCol),
						DropBehavior: onDelete,
					})
					edges = append(edges, ImpactEdge{
						Source:       fkID,
						Target:       targetID,
						Relationship: "references",
					})

					// Also record the dependent table itself if different from target
					if !strings.EqualFold(tbl, targetTable) {
						tableNodeID := "table:" + tbl
						nodes = append(nodes, ImpactNode{
							ID:           tableNodeID,
							Kind:         "table",
							Schema:       schema,
							Name:         tbl,
							RefKind:      "catalog_fk",
							Detail:       fmt.Sprintf("Dependent table containing FK pointing to %s", targetTable),
							DropBehavior: "RESTRICT",
						})
						edges = append(edges, ImpactEdge{
							Source:       tableNodeID,
							Target:       targetID,
							Relationship: "depends_on",
						})
					}
				}
			}
		}
	}

	// 4. Indexes (if column analysis)
	if targetCol != "" {
		idxRes, err := d.ExecuteRaw(ctx, fmt.Sprintf("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = %q AND sql IS NOT NULL", targetTable))
		if err == nil && idxRes != nil {
			colIdx := buildColMap(idxRes.Columns)
			for _, row := range idxRes.Rows {
				idxName := getStringVal(row, colIdx, "name")
				idxSQL := getStringVal(row, colIdx, "sql")
				if TextualReferenceMatches(idxSQL, "", targetCol) {
					idxID := "index:" + idxName
					nodes = append(nodes, ImpactNode{
						ID:           idxID,
						Kind:         "index",
						Schema:       schema,
						Name:         idxName,
						RefKind:      "catalog_index",
						Detail:       fmt.Sprintf("Index on column %s", targetCol),
						DropBehavior: "NONE",
					})
					edges = append(edges, ImpactEdge{
						Source:       idxID,
						Target:       targetID,
						Relationship: "indexes",
					})
				}
			}
		}
	}

	return nodes, edges, nil
}

// ── PostgreSQL Dependency Resolver ──

func resolvePostgresDependencies(ctx context.Context, d types.Driver, schema, targetTable, targetCol, targetID string) ([]ImpactNode, []ImpactEdge, error) {
	var nodes []ImpactNode
	var edges []ImpactEdge

	// 1. Foreign keys referencing targetTable
	fkQuery := `
SELECT
    tc.table_schema,
    tc.table_name,
    tc.constraint_name,
    kcu.column_name,
    ccu.table_schema AS foreign_table_schema,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints AS rc
    ON rc.constraint_name = tc.constraint_name
    AND rc.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name = $1`

	args := []interface{}{targetTable}
	if schema != "" {
		fkQuery += " AND ccu.table_schema = $2"
		args = append(args, schema)
	}

	fkRes, err := d.ExecuteRaw(ctx, fkQuery, args...)
	if err == nil && fkRes != nil {
		colIdx := buildColMap(fkRes.Columns)
		for _, row := range fkRes.Rows {
			tblSchema := getStringVal(row, colIdx, "table_schema")
			tblName := getStringVal(row, colIdx, "table_name")
			cName := getStringVal(row, colIdx, "constraint_name")
			fromCol := getStringVal(row, colIdx, "column_name")
			refCol := getStringVal(row, colIdx, "foreign_column_name")
			delRule := getStringVal(row, colIdx, "delete_rule")

			if targetCol != "" && !strings.EqualFold(refCol, targetCol) {
				continue
			}

			fkID := fmt.Sprintf("fk:%s.%s.%s", tblSchema, tblName, cName)
			nodes = append(nodes, ImpactNode{
				ID:           fkID,
				Kind:         "foreign_key",
				Schema:       tblSchema,
				Name:         cName,
				RefKind:      "catalog_fk",
				Detail:       fmt.Sprintf("%s.%s(%s) -> %s(%s)", tblSchema, tblName, fromCol, targetTable, refCol),
				DropBehavior: delRule,
			})
			edges = append(edges, ImpactEdge{
				Source:       fkID,
				Target:       targetID,
				Relationship: "references",
			})

			tableNodeID := fmt.Sprintf("table:%s.%s", tblSchema, tblName)
			nodes = append(nodes, ImpactNode{
				ID:           tableNodeID,
				Kind:         "table",
				Schema:       tblSchema,
				Name:         tblName,
				RefKind:      "catalog_fk",
				Detail:       fmt.Sprintf("Referencing table via FK %s", cName),
				DropBehavior: "RESTRICT",
			})
			edges = append(edges, ImpactEdge{
				Source:       tableNodeID,
				Target:       targetID,
				Relationship: "depends_on",
			})
		}
	}

	// 2. Views referencing targetTable
	viewQuery := `
SELECT
    n.nspname AS view_schema,
    c.relname AS view_name,
    pg_get_viewdef(c.oid, true) AS definition
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind IN ('v', 'm')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')`

	viewRes, err := d.ExecuteRaw(ctx, viewQuery)
	if err == nil && viewRes != nil {
		colIdx := buildColMap(viewRes.Columns)
		for _, row := range viewRes.Rows {
			vSchema := getStringVal(row, colIdx, "view_schema")
			vName := getStringVal(row, colIdx, "view_name")
			def := getStringVal(row, colIdx, "definition")

			if TextualReferenceMatches(def, targetTable, targetCol) {
				nodeID := fmt.Sprintf("view:%s.%s", vSchema, vName)
				nodes = append(nodes, ImpactNode{
					ID:           nodeID,
					Kind:         "view",
					Schema:       vSchema,
					Name:         vName,
					RefKind:      "catalog_view",
					Detail:       fmt.Sprintf("View references %s in definition", targetTable),
					DropBehavior: "CASCADE",
				})
				edges = append(edges, ImpactEdge{
					Source:       nodeID,
					Target:       targetID,
					Relationship: "depends_on",
				})
			}
		}
	}

	// 3. Triggers
	trigQuery := `
SELECT
    n.nspname AS trigger_schema,
    t.tgname AS trigger_name,
    c.relname AS table_name,
    pg_get_triggerdef(t.oid) AS statement
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE NOT t.tgisinternal
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')`

	trigRes, err := d.ExecuteRaw(ctx, trigQuery)
	if err == nil && trigRes != nil {
		colIdx := buildColMap(trigRes.Columns)
		for _, row := range trigRes.Rows {
			tSchema := getStringVal(row, colIdx, "trigger_schema")
			tName := getStringVal(row, colIdx, "trigger_name")
			tblName := getStringVal(row, colIdx, "table_name")
			stmt := getStringVal(row, colIdx, "statement")

			isDirect := strings.EqualFold(tblName, targetTable)
			isTextual := TextualReferenceMatches(stmt, targetTable, targetCol)

			if isDirect || isTextual {
				nodeID := fmt.Sprintf("trigger:%s.%s", tSchema, tName)
				refKind := "trigger_target"
				detail := fmt.Sprintf("Trigger on table %s", tblName)
				if !isDirect {
					refKind = "textual_reference"
					detail = fmt.Sprintf("Trigger mentions %s", targetTable)
				}
				nodes = append(nodes, ImpactNode{
					ID:           nodeID,
					Kind:         "trigger",
					Schema:       tSchema,
					Name:         tName,
					RefKind:      refKind,
					Detail:       detail,
					DropBehavior: "RESTRICT",
				})
				edges = append(edges, ImpactEdge{
					Source:       nodeID,
					Target:       targetID,
					Relationship: "triggers_on",
				})
			}
		}
	}

	// 4. Routines (procedures/functions)
	procQuery := `
SELECT
    n.nspname AS routine_schema,
    p.proname AS routine_name,
    pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')`

	procRes, err := d.ExecuteRaw(ctx, procQuery)
	if err == nil && procRes != nil {
		colIdx := buildColMap(procRes.Columns)
		for _, row := range procRes.Rows {
			rSchema := getStringVal(row, colIdx, "routine_schema")
			rName := getStringVal(row, colIdx, "routine_name")
			def := getStringVal(row, colIdx, "definition")

			if TextualReferenceMatches(def, targetTable, targetCol) {
				nodeID := fmt.Sprintf("routine:%s.%s", rSchema, rName)
				nodes = append(nodes, ImpactNode{
					ID:           nodeID,
					Kind:         "routine",
					Schema:       rSchema,
					Name:         rName,
					RefKind:      "catalog_routine",
					Detail:       fmt.Sprintf("Routine references %s", targetTable),
					DropBehavior: "RESTRICT",
				})
				edges = append(edges, ImpactEdge{
					Source:       nodeID,
					Target:       targetID,
					Relationship: "routine_call",
				})
			}
		}
	}

	return nodes, edges, nil
}

// ── MySQL Dependency Resolver ──

func resolveMySQLDependencies(ctx context.Context, d types.Driver, schema, targetTable, targetCol, targetID string) ([]ImpactNode, []ImpactEdge, error) {
	var nodes []ImpactNode
	var edges []ImpactEdge

	// 1. Foreign keys
	fkQuery := `
SELECT
    kcu.CONSTRAINT_SCHEMA,
    kcu.CONSTRAINT_NAME,
    kcu.TABLE_SCHEMA,
    kcu.TABLE_NAME,
    kcu.COLUMN_NAME,
    kcu.REFERENCED_TABLE_NAME,
    kcu.REFERENCED_COLUMN_NAME,
    COALESCE(rc.DELETE_RULE, 'RESTRICT') AS DELETE_RULE
FROM information_schema.key_column_usage kcu
JOIN information_schema.referential_constraints rc
    ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
    AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
WHERE kcu.REFERENCED_TABLE_NAME = ?`

	fkRes, err := d.ExecuteRaw(ctx, fkQuery, targetTable)
	if err == nil && fkRes != nil {
		colIdx := buildColMap(fkRes.Columns)
		for _, row := range fkRes.Rows {
			tblSchema := getStringVal(row, colIdx, "TABLE_SCHEMA")
			tblName := getStringVal(row, colIdx, "TABLE_NAME")
			cName := getStringVal(row, colIdx, "CONSTRAINT_NAME")
			fromCol := getStringVal(row, colIdx, "COLUMN_NAME")
			refCol := getStringVal(row, colIdx, "REFERENCED_COLUMN_NAME")
			delRule := getStringVal(row, colIdx, "DELETE_RULE")

			if targetCol != "" && !strings.EqualFold(refCol, targetCol) {
				continue
			}

			fkID := fmt.Sprintf("fk:%s.%s.%s", tblSchema, tblName, cName)
			nodes = append(nodes, ImpactNode{
				ID:           fkID,
				Kind:         "foreign_key",
				Schema:       tblSchema,
				Name:         cName,
				RefKind:      "catalog_fk",
				Detail:       fmt.Sprintf("%s.%s(%s) -> %s(%s)", tblSchema, tblName, fromCol, targetTable, refCol),
				DropBehavior: delRule,
			})
			edges = append(edges, ImpactEdge{
				Source:       fkID,
				Target:       targetID,
				Relationship: "references",
			})

			tableNodeID := fmt.Sprintf("table:%s.%s", tblSchema, tblName)
			nodes = append(nodes, ImpactNode{
				ID:           tableNodeID,
				Kind:         "table",
				Schema:       tblSchema,
				Name:         tblName,
				RefKind:      "catalog_fk",
				Detail:       fmt.Sprintf("Referencing table via FK %s", cName),
				DropBehavior: "RESTRICT",
			})
			edges = append(edges, ImpactEdge{
				Source:       tableNodeID,
				Target:       targetID,
				Relationship: "depends_on",
			})
		}
	}

	// 2. Views
	viewQuery := `
SELECT TABLE_SCHEMA, TABLE_NAME, VIEW_DEFINITION
FROM information_schema.views
WHERE TABLE_SCHEMA NOT IN ('sys', 'information_schema', 'mysql', 'performance_schema')`

	viewRes, err := d.ExecuteRaw(ctx, viewQuery)
	if err == nil && viewRes != nil {
		colIdx := buildColMap(viewRes.Columns)
		for _, row := range viewRes.Rows {
			vSchema := getStringVal(row, colIdx, "TABLE_SCHEMA")
			vName := getStringVal(row, colIdx, "TABLE_NAME")
			def := getStringVal(row, colIdx, "VIEW_DEFINITION")

			if TextualReferenceMatches(def, targetTable, targetCol) {
				nodeID := fmt.Sprintf("view:%s.%s", vSchema, vName)
				nodes = append(nodes, ImpactNode{
					ID:           nodeID,
					Kind:         "view",
					Schema:       vSchema,
					Name:         vName,
					RefKind:      "catalog_view",
					Detail:       fmt.Sprintf("View definition references %s", targetTable),
					DropBehavior: "CASCADE",
				})
				edges = append(edges, ImpactEdge{
					Source:       nodeID,
					Target:       targetID,
					Relationship: "depends_on",
				})
			}
		}
	}

	// 3. Triggers
	trigQuery := `
SELECT TRIGGER_SCHEMA, TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_STATEMENT
FROM information_schema.triggers
WHERE TRIGGER_SCHEMA NOT IN ('sys', 'information_schema', 'mysql', 'performance_schema')`

	trigRes, err := d.ExecuteRaw(ctx, trigQuery)
	if err == nil && trigRes != nil {
		colIdx := buildColMap(trigRes.Columns)
		for _, row := range trigRes.Rows {
			tSchema := getStringVal(row, colIdx, "TRIGGER_SCHEMA")
			tName := getStringVal(row, colIdx, "TRIGGER_NAME")
			tblName := getStringVal(row, colIdx, "EVENT_OBJECT_TABLE")
			stmt := getStringVal(row, colIdx, "ACTION_STATEMENT")

			isDirect := strings.EqualFold(tblName, targetTable)
			isTextual := TextualReferenceMatches(stmt, targetTable, targetCol)

			if isDirect || isTextual {
				nodeID := fmt.Sprintf("trigger:%s.%s", tSchema, tName)
				refKind := "trigger_target"
				detail := fmt.Sprintf("Trigger on table %s", tblName)
				if !isDirect {
					refKind = "textual_reference"
					detail = fmt.Sprintf("Trigger statement references %s", targetTable)
				}
				nodes = append(nodes, ImpactNode{
					ID:           nodeID,
					Kind:         "trigger",
					Schema:       tSchema,
					Name:         tName,
					RefKind:      refKind,
					Detail:       detail,
					DropBehavior: "RESTRICT",
				})
				edges = append(edges, ImpactEdge{
					Source:       nodeID,
					Target:       targetID,
					Relationship: "triggers_on",
				})
			}
		}
	}

	// 4. Routines
	routineQuery := `
SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_DEFINITION
FROM information_schema.routines
WHERE ROUTINE_SCHEMA NOT IN ('sys', 'information_schema', 'mysql', 'performance_schema')`

	routineRes, err := d.ExecuteRaw(ctx, routineQuery)
	if err == nil && routineRes != nil {
		colIdx := buildColMap(routineRes.Columns)
		for _, row := range routineRes.Rows {
			rSchema := getStringVal(row, colIdx, "ROUTINE_SCHEMA")
			rName := getStringVal(row, colIdx, "ROUTINE_NAME")
			def := getStringVal(row, colIdx, "ROUTINE_DEFINITION")

			if TextualReferenceMatches(def, targetTable, targetCol) {
				nodeID := fmt.Sprintf("routine:%s.%s", rSchema, rName)
				nodes = append(nodes, ImpactNode{
					ID:           nodeID,
					Kind:         "routine",
					Schema:       rSchema,
					Name:         rName,
					RefKind:      "catalog_routine",
					Detail:       fmt.Sprintf("Routine definition references %s", targetTable),
					DropBehavior: "RESTRICT",
				})
				edges = append(edges, ImpactEdge{
					Source:       nodeID,
					Target:       targetID,
					Relationship: "routine_call",
				})
			}
		}
	}

	return nodes, edges, nil
}

// ── Helpers ──

func buildColMap(cols []string) map[string]int {
	m := make(map[string]int, len(cols))
	for i, c := range cols {
		m[strings.ToLower(c)] = i
	}
	return m
}

func getStringVal(row []interface{}, colMap map[string]int, colName string) string {
	idx, ok := colMap[strings.ToLower(colName)]
	if !ok || idx >= len(row) || row[idx] == nil {
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

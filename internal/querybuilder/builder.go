package querybuilder

import (
	"fmt"
	"strings"
)

// GenerateSQL converts a QueryCanvasState into an executable SQL string for a given dialect.
func GenerateSQL(state QueryCanvasState, dialectName string) (*BuildSQLResponse, error) {
	warnings, err := Validate(&state)
	if err != nil {
		return &BuildSQLResponse{
			SQL:      "",
			Dialect:  NormalizeDialect(dialectName),
			Warnings: warnings,
			Error:    err.Error(),
		}, err
	}

	normDialect := NormalizeDialect(dialectName)
	d := GetDialect(normDialect)

	// Build table alias mapping
	tableMap := make(map[string]CanvasTable)
	tableAlias := make(map[string]string)
	aliasCounts := make(map[string]int)

	for _, t := range state.Tables {
		tableMap[t.ID] = t
		alias := strings.TrimSpace(t.Alias)
		if alias == "" {
			alias = strings.TrimSpace(t.Name)
		}
		if alias == "" {
			alias = "t"
		}
		aliasCounts[alias]++
		if aliasCounts[alias] > 1 {
			alias = fmt.Sprintf("%s_%d", alias, aliasCounts[alias])
		}
		tableAlias[t.ID] = alias
	}

	// 1. SELECT clause
	var selectCols []string
	var nonAggCols []string
	hasAgg := false

	for _, t := range state.Tables {
		tAlias := tableAlias[t.ID]
		for _, c := range t.Columns {
			if !c.Selected {
				continue
			}
			colRef := d.QuoteIdentifier(tAlias) + "." + d.QuoteIdentifier(c.Name)
			agg := strings.ToUpper(strings.TrimSpace(c.Aggregate))

			var expr string
			if agg != "" && agg != "NONE" {
				hasAgg = true
				expr = formatAggExpr(agg, colRef)
			} else {
				expr = colRef
				nonAggCols = append(nonAggCols, colRef)
			}

			if strings.TrimSpace(c.Alias) != "" {
				expr += " AS " + d.QuoteIdentifier(c.Alias)
			}
			selectCols = append(selectCols, expr)
		}
	}

	if len(selectCols) == 0 {
		// Default to all columns from all tables
		for _, t := range state.Tables {
			tAlias := tableAlias[t.ID]
			selectCols = append(selectCols, d.QuoteIdentifier(tAlias)+".*")
		}
	}

	var sb strings.Builder
	sb.WriteString("SELECT")
	if state.Distinct {
		sb.WriteString(" DISTINCT")
	}
	sb.WriteString("\n  ")
	sb.WriteString(strings.Join(selectCols, ",\n  "))

	// 2. FROM and JOIN clauses
	// Determine root table (first table or table not targeted in joins)
	targetTableIDs := make(map[string]bool)
	for _, j := range state.Joins {
		targetTableIDs[j.TargetTableID] = true
	}

	var rootTable CanvasTable
	rootFound := false
	for _, t := range state.Tables {
		if !targetTableIDs[t.ID] {
			rootTable = t
			rootFound = true
			break
		}
	}
	if !rootFound {
		rootTable = state.Tables[0]
	}

	rootAlias := tableAlias[rootTable.ID]
	rootTableRef := d.QuoteTableRef(rootTable.Schema, rootTable.Name)
	sb.WriteString("\nFROM ")
	sb.WriteString(rootTableRef)
	if rootAlias != rootTable.Name {
		sb.WriteString(" AS ")
		sb.WriteString(d.QuoteIdentifier(rootAlias))
	}

	joinedTableIDs := map[string]bool{rootTable.ID: true}

	// Process joins
	for _, j := range state.Joins {
		tgtT, okTgt := tableMap[j.TargetTableID]
		if !okTgt {
			continue
		}
		tgtAlias := tableAlias[tgtT.ID]
		srcAlias := tableAlias[j.SourceTableID]

		jt := strings.ToUpper(strings.TrimSpace(j.JoinType))
		switch jt {
		case "LEFT", "LEFT JOIN":
			jt = "LEFT JOIN"
		case "RIGHT", "RIGHT JOIN":
			jt = "RIGHT JOIN"
		case "FULL", "FULL JOIN", "FULL OUTER JOIN":
			jt = "FULL OUTER JOIN"
		case "CROSS", "CROSS JOIN":
			jt = "CROSS JOIN"
		default:
			jt = "INNER JOIN"
		}

		tgtRef := d.QuoteTableRef(tgtT.Schema, tgtT.Name)
		if jt == "CROSS JOIN" {
			sb.WriteString("\n")
			sb.WriteString(jt)
			sb.WriteString(" ")
			sb.WriteString(tgtRef)
			if tgtAlias != tgtT.Name {
				sb.WriteString(" AS ")
				sb.WriteString(d.QuoteIdentifier(tgtAlias))
			}
		} else {
			sb.WriteString("\n")
			sb.WriteString(jt)
			sb.WriteString(" ")
			sb.WriteString(tgtRef)
			if tgtAlias != tgtT.Name {
				sb.WriteString(" AS ")
				sb.WriteString(d.QuoteIdentifier(tgtAlias))
			}
			sb.WriteString(" ON ")
			sb.WriteString(d.QuoteIdentifier(srcAlias))
			sb.WriteString(".")
			sb.WriteString(d.QuoteIdentifier(j.SourceColumn))
			sb.WriteString(" = ")
			sb.WriteString(d.QuoteIdentifier(tgtAlias))
			sb.WriteString(".")
			sb.WriteString(d.QuoteIdentifier(j.TargetColumn))
		}
		joinedTableIDs[tgtT.ID] = true
	}

	// Add any disconnected tables as CROSS JOIN
	for _, t := range state.Tables {
		if !joinedTableIDs[t.ID] {
			tAlias := tableAlias[t.ID]
			tRef := d.QuoteTableRef(t.Schema, t.Name)
			sb.WriteString("\nCROSS JOIN ")
			sb.WriteString(tRef)
			if tAlias != t.Name {
				sb.WriteString(" AS ")
				sb.WriteString(d.QuoteIdentifier(tAlias))
			}
			joinedTableIDs[t.ID] = true
		}
	}

	// 3. WHERE clause
	if len(state.Filters) > 0 {
		sb.WriteString("\nWHERE ")
		for i, f := range state.Filters {
			tAlias := tableAlias[f.TableID]
			cond := d.FormatFilter(tAlias, f.Column, f.Operator, f.Value, f.Value2)
			if i == 0 {
				sb.WriteString(cond)
			} else {
				logic := strings.ToUpper(strings.TrimSpace(f.Logic))
				if logic != "OR" {
					logic = "AND"
				}
				sb.WriteString("\n  ")
				sb.WriteString(logic)
				sb.WriteString(" ")
				sb.WriteString(cond)
			}
		}
	}

	// 4. GROUP BY clause
	// If aggregates used, automatically group by non-aggregated selected columns
	var groupByParts []string
	seenGroupBy := make(map[string]bool)

	if hasAgg && len(nonAggCols) > 0 {
		for _, col := range nonAggCols {
			if !seenGroupBy[col] {
				seenGroupBy[col] = true
				groupByParts = append(groupByParts, col)
			}
		}
	}

	for _, g := range state.GroupBy {
		trimmed := strings.TrimSpace(g)
		if trimmed != "" && !seenGroupBy[trimmed] {
			seenGroupBy[trimmed] = true
			groupByParts = append(groupByParts, trimmed)
		}
	}

	if len(groupByParts) > 0 {
		sb.WriteString("\nGROUP BY ")
		sb.WriteString(strings.Join(groupByParts, ", "))
	}

	// 5. HAVING clause
	if len(state.Havings) > 0 {
		sb.WriteString("\nHAVING ")
		for i, h := range state.Havings {
			tAlias := tableAlias[h.TableID]
			cond := d.FormatHaving(h.Aggregate, tAlias, h.Column, h.Operator, h.Value)
			if i == 0 {
				sb.WriteString(cond)
			} else {
				logic := strings.ToUpper(strings.TrimSpace(h.Logic))
				if logic != "OR" {
					logic = "AND"
				}
				sb.WriteString("\n  ")
				sb.WriteString(logic)
				sb.WriteString(" ")
				sb.WriteString(cond)
			}
		}
	}

	// 6. ORDER BY clause
	if len(state.OrderBy) > 0 {
		var orderParts []string
		for _, ob := range state.OrderBy {
			tAlias := tableAlias[ob.TableID]
			part := d.FormatOrderBy(tAlias, ob.Column, ob.Direction, ob.Nulls)
			orderParts = append(orderParts, part)
		}
		sb.WriteString("\nORDER BY ")
		sb.WriteString(strings.Join(orderParts, ", "))
	}

	// 7. LIMIT / OFFSET clause
	limitOffset := d.FormatLimitOffset(state.Limit, state.Offset)
	if limitOffset != "" {
		sb.WriteString("\n")
		sb.WriteString(limitOffset)
	}

	sb.WriteString(";")

	return &BuildSQLResponse{
		SQL:      sb.String(),
		Dialect:  normDialect,
		Warnings: warnings,
	}, nil
}

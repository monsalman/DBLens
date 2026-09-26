package analyzer

import (
	"fmt"
	"strings"
)

type Severity string

const (
	SeverityError   Severity = "error"
	SeverityWarning Severity = "warning"
	SeverityInfo    Severity = "info"
)

func (s Severity) IsValid() bool {
	return s == SeverityError || s == SeverityWarning || s == SeverityInfo
}

type QuickFix struct {
	Title       string `json:"title"`
	Replacement string `json:"replacement"`
	StartOffset int    `json:"start_offset"`
	EndOffset   int    `json:"end_offset"`
}

type Diagnostic struct {
	RuleID      string    `json:"rule_id"`
	Message     string    `json:"message"`
	Severity    Severity  `json:"severity"`
	Line        int       `json:"line"`
	Col         int       `json:"col"`
	StartOffset int       `json:"start_offset"`
	EndOffset   int       `json:"end_offset"`
	QuickFix    *QuickFix `json:"quick_fix,omitempty"`
}

type RuleSetting struct {
	Enabled  bool     `json:"enabled"`
	Severity Severity `json:"severity,omitempty"`
}

type RuleMeta struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	DefaultSev  Severity `json:"default_severity"`
	Enabled     bool     `json:"enabled"`
	Severity    Severity `json:"severity"`
}

type RuleContext struct {
	SQL         string
	Dialect     string
	Schema      string
	Tokens      []Token // all tokens including comments
	CodeTokens  []Token // tokens without comments
	KnownTables []string
	KnownCols   map[string][]string
}

type Rule interface {
	Meta() RuleMeta
	Check(ctx *RuleContext) []Diagnostic
}

// AllRules registry
var AllRules = []Rule{
	&SelectStarRule{},
	&UpdateDeleteWithoutWhereRule{},
	&ImplicitCommaJoinRule{},
	&NotInNullableRule{},
	&LeadingWildcardLikeRule{},
	&MissingLimitOnLargeSortRule{},
	&UnusedCteRule{},
	&UnresolvedTableRule{},
	&UnresolvedColumnRule{},
	&UnqualifiedColumnInJoinRule{},
}

// ── Rule 1: select-star ──────────────────────────────────────────────────

type SelectStarRule struct{}

func (r *SelectStarRule) Meta() RuleMeta {
	return RuleMeta{
		ID:          "select-star",
		Name:        "SELECT * Usage",
		Description: "Avoid SELECT *; specify explicit columns to reduce I/O and prevent breaking schema changes.",
		Category:    "performance",
		DefaultSev:  SeverityWarning,
		Enabled:     true,
		Severity:    SeverityWarning,
	}
}

func (r *SelectStarRule) Check(ctx *RuleContext) []Diagnostic {
	var diags []Diagnostic
	tokens := ctx.CodeTokens

	// Track parenthesized subqueries and whether they are preceded by EXISTS
	type parenState struct {
		isExists bool
	}
	var parenStack []parenState

	inSelectClause := false

	for i := 0; i < len(tokens); i++ {
		tok := tokens[i]

		if tok.Type == TokenPunctuation && tok.Value == "(" {
			isExists := false
			if i > 0 && tokens[i-1].IsKeyword("EXISTS") {
				isExists = true
			} else if i > 1 && tokens[i-2].IsKeyword("EXISTS") {
				isExists = true
			}
			parenStack = append(parenStack, parenState{isExists: isExists})
			continue
		}

		if tok.Type == TokenPunctuation && tok.Value == ")" {
			if len(parenStack) > 0 {
				parenStack = parenStack[:len(parenStack)-1]
			}
			continue
		}

		if tok.IsKeyword("SELECT") {
			inSelectClause = true
			continue
		}

		if inSelectClause && (tok.IsKeyword("FROM") || tok.IsKeyword("WHERE") || tok.IsKeyword("UNION") || tok.IsPunctuation(";")) {
			inSelectClause = false
			continue
		}

		if inSelectClause {
			// Ignore if inside EXISTS (...)
			inExists := false
			for _, p := range parenStack {
				if p.isExists {
					inExists = true
					break
				}
			}
			if inExists {
				continue
			}

			// Check if token is *
			if tok.Type == TokenOperator && tok.Value == "*" {
				// Check if this is COUNT(*)
				if i >= 2 && tokens[i-1].IsPunctuation("(") && strings.EqualFold(tokens[i-2].Value, "COUNT") {
					continue
				}

				// Find table columns if known
				var fix *QuickFix
				fromTable := findFirstFromTable(tokens, i)
				if fromTable != "" && ctx.KnownCols != nil {
					cols := lookupColumns(ctx.KnownCols, fromTable)
					if len(cols) > 0 {
						fix = &QuickFix{
							Title:       fmt.Sprintf("Replace with explicit columns (%s)", strings.Join(cols, ", ")),
							Replacement: strings.Join(cols, ", "),
							StartOffset: tok.StartOffset,
							EndOffset:   tok.EndOffset,
						}
					}
				}
				if fix == nil {
					fix = &QuickFix{
						Title:       "Replace with specific column names",
						Replacement: "id, name",
						StartOffset: tok.StartOffset,
						EndOffset:   tok.EndOffset,
					}
				}

				diags = append(diags, Diagnostic{
					RuleID:      "select-star",
					Message:     "Avoid 'SELECT *'. Specify explicit column names for better query performance and schema resilience.",
					Severity:    r.Meta().DefaultSev,
					Line:        tok.Line,
					Col:         tok.Col,
					StartOffset: tok.StartOffset,
					EndOffset:   tok.EndOffset,
					QuickFix:    fix,
				})
			}
		}
	}

	return diags
}

// ── Rule 2: update-delete-without-where ───────────────────────────────────

type UpdateDeleteWithoutWhereRule struct{}

func (r *UpdateDeleteWithoutWhereRule) Meta() RuleMeta {
	return RuleMeta{
		ID:          "update-delete-without-where",
		Name:        "UPDATE/DELETE Without WHERE",
		Description: "Prohibit UPDATE or DELETE statements without a WHERE clause to prevent accidental mass modification.",
		Category:    "safety",
		DefaultSev:  SeverityError,
		Enabled:     true,
		Severity:    SeverityError,
	}
}

func (r *UpdateDeleteWithoutWhereRule) Check(ctx *RuleContext) []Diagnostic {
	var diags []Diagnostic
	tokens := ctx.CodeTokens

	parenDepth := 0
	type stmtInfo struct {
		isDML    bool
		dmlTok   Token
		hasWhere bool
		endTok   Token
	}

	var cur *stmtInfo

	for i, tok := range tokens {
		if tok.IsPunctuation("(") {
			parenDepth++
			continue
		}
		if tok.IsPunctuation(")") {
			if parenDepth > 0 {
				parenDepth--
			}
			continue
		}

		if parenDepth == 0 {
			if tok.IsKeyword("UPDATE") || tok.IsKeyword("DELETE") {
				// Don't start if inside ON CONFLICT DO UPDATE or similar
				if i > 0 && (tokens[i-1].IsKeyword("DO") || tokens[i-1].IsKeyword("ON")) {
					continue
				}
				if cur != nil && cur.isDML && !cur.hasWhere {
					diags = append(diags, makeWhereMissingDiag(cur.dmlTok, cur.endTok))
				}
				cur = &stmtInfo{
					isDML:    true,
					dmlTok:   tok,
					hasWhere: false,
					endTok:   tok,
				}
				continue
			}

			if cur != nil && cur.isDML {
				if tok.IsKeyword("WHERE") {
					cur.hasWhere = true
				}
				cur.endTok = tok
				if tok.IsPunctuation(";") {
					if !cur.hasWhere {
						diags = append(diags, makeWhereMissingDiag(cur.dmlTok, cur.endTok))
					}
					cur = nil
				}
			}
		}
	}

	if cur != nil && cur.isDML && !cur.hasWhere {
		diags = append(diags, makeWhereMissingDiag(cur.dmlTok, cur.endTok))
	}

	return diags
}

func makeWhereMissingDiag(dmlTok Token, endTok Token) Diagnostic {
	action := strings.ToUpper(dmlTok.Value)
	fixOffset := endTok.EndOffset
	if endTok.IsPunctuation(";") {
		fixOffset = endTok.StartOffset
	}

	return Diagnostic{
		RuleID:      "update-delete-without-where",
		Message:     fmt.Sprintf("%s statement without a WHERE clause will modify or delete all rows in the table.", action),
		Severity:    SeverityError,
		Line:        dmlTok.Line,
		Col:         dmlTok.Col,
		StartOffset: dmlTok.StartOffset,
		EndOffset:   dmlTok.EndOffset,
		QuickFix: &QuickFix{
			Title:       "Add safety WHERE clause",
			Replacement: " WHERE 1 = 0",
			StartOffset: fixOffset,
			EndOffset:   fixOffset,
		},
	}
}

// ── Rule 3: implicit-comma-join ──────────────────────────────────────────

type ImplicitCommaJoinRule struct{}

func (r *ImplicitCommaJoinRule) Meta() RuleMeta {
	return RuleMeta{
		ID:          "implicit-comma-join",
		Name:        "Implicit Comma Join",
		Description: "Avoid old-style comma joins ('FROM a, b'). Use explicit JOIN ... ON syntax instead.",
		Category:    "correctness",
		DefaultSev:  SeverityWarning,
		Enabled:     true,
		Severity:    SeverityWarning,
	}
}

func (r *ImplicitCommaJoinRule) Check(ctx *RuleContext) []Diagnostic {
	var diags []Diagnostic
	tokens := ctx.CodeTokens

	inFromClause := false
	parenDepth := 0

	for i := 0; i < len(tokens); i++ {
		tok := tokens[i]

		if tok.IsPunctuation("(") {
			parenDepth++
			continue
		}
		if tok.IsPunctuation(")") {
			if parenDepth > 0 {
				parenDepth--
			}
			continue
		}

		if parenDepth == 0 {
			if tok.IsKeyword("FROM") {
				inFromClause = true
				continue
			}

			if inFromClause {
				// Check clause terminators
				if tok.IsKeyword("WHERE") || tok.IsKeyword("GROUP") || tok.IsKeyword("HAVING") ||
					tok.IsKeyword("ORDER") || tok.IsKeyword("LIMIT") || tok.IsKeyword("UNION") ||
					tok.IsKeyword("JOIN") || tok.IsKeyword("LEFT") || tok.IsKeyword("RIGHT") ||
					tok.IsKeyword("INNER") || tok.IsKeyword("CROSS") || tok.IsPunctuation(";") {
					inFromClause = false
					continue
				}

				if tok.IsPunctuation(",") {
					// Check if next token looks like a table reference
					nextTable := ""
					if i+1 < len(tokens) && (tokens[i+1].Type == TokenIdent || tokens[i+1].Type == TokenKeyword) {
						nextTable = tokens[i+1].Raw
					}

					var fix *QuickFix
					if nextTable != "" {
						fix = &QuickFix{
							Title:       fmt.Sprintf("Convert to JOIN %s ON ...", nextTable),
							Replacement: fmt.Sprintf(" JOIN %s ON /* condition */", nextTable),
							StartOffset: tok.StartOffset,
							EndOffset:   tokens[i+1].EndOffset,
						}
					} else {
						fix = &QuickFix{
							Title:       "Convert comma to JOIN ... ON",
							Replacement: " JOIN",
							StartOffset: tok.StartOffset,
							EndOffset:   tok.EndOffset,
						}
					}

					diags = append(diags, Diagnostic{
						RuleID:      "implicit-comma-join",
						Message:     "Implicit comma join ('FROM a, b') is deprecated and error-prone. Use explicit 'JOIN ... ON' syntax.",
						Severity:    r.Meta().DefaultSev,
						Line:        tok.Line,
						Col:         tok.Col,
						StartOffset: tok.StartOffset,
						EndOffset:   tok.EndOffset,
						QuickFix:    fix,
					})
				}
			}
		}
	}

	return diags
}

// ── Rule 4: not-in-nullable ──────────────────────────────────────────────

type NotInNullableRule struct{}

func (r *NotInNullableRule) Meta() RuleMeta {
	return RuleMeta{
		ID:          "not-in-nullable",
		Name:        "NOT IN Subquery Null Hazard",
		Description: "NOT IN (SELECT ...) evaluates to UNKNOWN if any row contains NULL. Use NOT EXISTS instead.",
		Category:    "correctness",
		DefaultSev:  SeverityWarning,
		Enabled:     true,
		Severity:    SeverityWarning,
	}
}

func (r *NotInNullableRule) Check(ctx *RuleContext) []Diagnostic {
	var diags []Diagnostic
	tokens := ctx.CodeTokens

	for i := 0; i < len(tokens)-2; i++ {
		if tokens[i].IsKeyword("NOT") && tokens[i+1].IsKeyword("IN") && tokens[i+2].IsPunctuation("(") {
			// Look ahead inside parentheses for SELECT
			if i+3 < len(tokens) && tokens[i+3].IsKeyword("SELECT") {
				notTok := tokens[i]
				inTok := tokens[i+1]
				diags = append(diags, Diagnostic{
					RuleID:      "not-in-nullable",
					Message:     "'NOT IN (SELECT ...)' produces empty results if subquery returns NULL. Use 'NOT EXISTS' or add 'WHERE col IS NOT NULL'.",
					Severity:    r.Meta().DefaultSev,
					Line:        notTok.Line,
					Col:         notTok.Col,
					StartOffset: notTok.StartOffset,
					EndOffset:   inTok.EndOffset,
					QuickFix: &QuickFix{
						Title:       "Replace 'NOT IN' with 'NOT EXISTS'",
						Replacement: "NOT EXISTS",
						StartOffset: notTok.StartOffset,
						EndOffset:   inTok.EndOffset,
					},
				})
			}
		}
	}

	return diags
}

// ── Rule 5: leading-wildcard-like ────────────────────────────────────────

type LeadingWildcardLikeRule struct{}

func (r *LeadingWildcardLikeRule) Meta() RuleMeta {
	return RuleMeta{
		ID:          "leading-wildcard-like",
		Name:        "Leading Wildcard in LIKE",
		Description: "LIKE pattern starting with '%' or '_' prevents B-Tree index scans, forcing a full table scan.",
		Category:    "performance",
		DefaultSev:  SeverityWarning,
		Enabled:     true,
		Severity:    SeverityWarning,
	}
}

func (r *LeadingWildcardLikeRule) Check(ctx *RuleContext) []Diagnostic {
	var diags []Diagnostic
	tokens := ctx.CodeTokens

	for i := 0; i < len(tokens)-1; i++ {
		tok := tokens[i]
		if tok.IsKeyword("LIKE") || tok.IsKeyword("ILIKE") {
			next := tokens[i+1]
			if next.Type == TokenString && len(next.Value) > 0 {
				firstChar := next.Value[0]
				if firstChar == '%' || firstChar == '_' {
					trimmedVal := strings.TrimLeft(next.Value, "%_")
					fixReplacement := fmt.Sprintf("'%s'", trimmedVal)
					diags = append(diags, Diagnostic{
						RuleID:      "leading-wildcard-like",
						Message:     fmt.Sprintf("LIKE pattern %s begins with a wildcard ('%c'), preventing index usage and forcing a full table scan.", next.Raw, firstChar),
						Severity:    r.Meta().DefaultSev,
						Line:        next.Line,
						Col:         next.Col,
						StartOffset: next.StartOffset,
						EndOffset:   next.EndOffset,
						QuickFix: &QuickFix{
							Title:       "Remove leading wildcard for prefix search",
							Replacement: fixReplacement,
							StartOffset: next.StartOffset,
							EndOffset:   next.EndOffset,
						},
					})
				}
			}
		}
	}

	return diags
}

// ── Rule 6: missing-limit-on-large-sort ───────────────────────────────────

type MissingLimitOnLargeSortRule struct{}

func (r *MissingLimitOnLargeSortRule) Meta() RuleMeta {
	return RuleMeta{
		ID:          "missing-limit-on-large-sort",
		Name:        "ORDER BY Without LIMIT",
		Description: "ORDER BY without LIMIT or FETCH FIRST can cause high memory and CPU consumption on large result sets.",
		Category:    "performance",
		DefaultSev:  SeverityWarning,
		Enabled:     true,
		Severity:    SeverityWarning,
	}
}

func (r *MissingLimitOnLargeSortRule) Check(ctx *RuleContext) []Diagnostic {
	var diags []Diagnostic
	tokens := ctx.CodeTokens

	parenDepth := 0
	isSelect := false
	hasOrderBy := false
	var orderTok Token
	var endTok Token
	hasLimit := false

	for i, tok := range tokens {
		if tok.IsPunctuation("(") {
			parenDepth++
			continue
		}
		if tok.IsPunctuation(")") {
			if parenDepth > 0 {
				parenDepth--
			}
			continue
		}

		if parenDepth == 0 {
			if tok.IsKeyword("SELECT") {
				isSelect = true
			}

			if isSelect && tok.IsKeyword("ORDER") && i+1 < len(tokens) && tokens[i+1].IsKeyword("BY") {
				hasOrderBy = true
				orderTok = tok
			}

			if hasOrderBy && (tok.IsKeyword("LIMIT") || tok.IsKeyword("FETCH")) {
				hasLimit = true
			}

			endTok = tok

			if tok.IsPunctuation(";") || tok.IsKeyword("UNION") {
				if isSelect && hasOrderBy && !hasLimit {
					diags = append(diags, makeLimitMissingDiag(orderTok, endTok))
				}
				// reset for next statement
				isSelect = false
				hasOrderBy = false
				hasLimit = false
			}
		}
	}

	if isSelect && hasOrderBy && !hasLimit {
		diags = append(diags, makeLimitMissingDiag(orderTok, endTok))
	}

	return diags
}

func makeLimitMissingDiag(orderTok Token, endTok Token) Diagnostic {
	fixOffset := endTok.EndOffset
	if endTok.IsPunctuation(";") {
		fixOffset = endTok.StartOffset
	}

	return Diagnostic{
		RuleID:      "missing-limit-on-large-sort",
		Message:     "'ORDER BY' without 'LIMIT' or 'FETCH FIRST' forces full sorting of entire dataset. Add a LIMIT clause to bound execution cost.",
		Severity:    SeverityWarning,
		Line:        orderTok.Line,
		Col:         orderTok.Col,
		StartOffset: orderTok.StartOffset,
		EndOffset:   orderTok.EndOffset,
		QuickFix: &QuickFix{
			Title:       "Add LIMIT 100",
			Replacement: " LIMIT 100",
			StartOffset: fixOffset,
			EndOffset:   fixOffset,
		},
	}
}

// ── Rule 7: unused-cte ───────────────────────────────────────────────────

type UnusedCteRule struct{}

func (r *UnusedCteRule) Meta() RuleMeta {
	return RuleMeta{
		ID:          "unused-cte",
		Name:        "Unused CTE Definition",
		Description: "Detects Common Table Expressions (WITH cte AS ...) that are defined but never referenced in queries.",
		Category:    "style",
		DefaultSev:  SeverityWarning,
		Enabled:     true,
		Severity:    SeverityWarning,
	}
}

type cteDefinition struct {
	name        string
	nameTok     Token
	defStart    int
	defEnd      int
	subqueryEnd int
}

func (r *UnusedCteRule) Check(ctx *RuleContext) []Diagnostic {
	var diags []Diagnostic
	tokens := ctx.CodeTokens

	// Find WITH clause
	for i := 0; i < len(tokens); i++ {
		if tokens[i].IsKeyword("WITH") {
			// Collect CTE definitions
			i++
			if i < len(tokens) && tokens[i].IsKeyword("RECURSIVE") {
				i++
			}

			var ctes []cteDefinition

			for i < len(tokens) {
				if tokens[i].Type != TokenIdent && tokens[i].Type != TokenKeyword {
					break
				}
				cteNameTok := tokens[i]
				i++

				// Optional column list: cte(c1, c2)
				if i < len(tokens) && tokens[i].IsPunctuation("(") {
					depth := 1
					i++
					for i < len(tokens) && depth > 0 {
						if tokens[i].IsPunctuation("(") {
							depth++
						} else if tokens[i].IsPunctuation(")") {
							depth--
						}
						i++
					}
				}

				if i >= len(tokens) || !tokens[i].IsKeyword("AS") {
					break
				}
				i++ // skip AS

				if i >= len(tokens) || !tokens[i].IsPunctuation("(") {
					break
				}
				// Skip CTE body
				depth := 1
				i++
				for i < len(tokens) && depth > 0 {
					if tokens[i].IsPunctuation("(") {
						depth++
					} else if tokens[i].IsPunctuation(")") {
						depth--
					}
					i++
				}
				bodyEnd := i

				ctes = append(ctes, cteDefinition{
					name:        cteNameTok.Raw,
					nameTok:     cteNameTok,
					defStart:    cteNameTok.StartOffset,
					defEnd:      tokens[bodyEnd-1].EndOffset,
					subqueryEnd: bodyEnd,
				})

				if i < len(tokens) && tokens[i].IsPunctuation(",") {
					i++ // next CTE
				} else {
					break // main query begins
				}
			}

			// For each CTE, check if referenced in tokens after its body
			for _, cte := range ctes {
				used := false
				for j := cte.subqueryEnd; j < len(tokens); j++ {
					if strings.EqualFold(tokens[j].Raw, cte.name) {
						used = true
						break
					}
				}

				if !used {
					diags = append(diags, Diagnostic{
						RuleID:      "unused-cte",
						Message:     fmt.Sprintf("CTE '%s' is defined in WITH clause but never referenced in subsequent queries.", cte.name),
						Severity:    r.Meta().DefaultSev,
						Line:        cte.nameTok.Line,
						Col:         cte.nameTok.Col,
						StartOffset: cte.nameTok.StartOffset,
						EndOffset:   cte.nameTok.EndOffset,
						QuickFix: &QuickFix{
							Title:       fmt.Sprintf("Remove unused CTE '%s'", cte.name),
							Replacement: "",
							StartOffset: cte.defStart,
							EndOffset:   cte.defEnd,
						},
					})
				}
			}
		}
	}

	return diags
}

// ── Rule 8: unresolved-table ─────────────────────────────────────────────

type UnresolvedTableRule struct{}

func (r *UnresolvedTableRule) Meta() RuleMeta {
	return RuleMeta{
		ID:          "unresolved-table",
		Name:        "Unresolved Table Reference",
		Description: "Flag table references that cannot be found in schema metadata or defined CTEs.",
		Category:    "correctness",
		DefaultSev:  SeverityError,
		Enabled:     true,
		Severity:    SeverityError,
	}
}

func (r *UnresolvedTableRule) Check(ctx *RuleContext) []Diagnostic {
	if len(ctx.KnownTables) == 0 {
		return nil
	}

	var diags []Diagnostic
	tokens := ctx.CodeTokens

	// Collect local CTE names defined in query so they are not flagged
	ctes := extractCteNames(tokens)

	for i := 0; i < len(tokens)-1; i++ {
		tok := tokens[i]
		if tok.IsKeyword("FROM") || tok.IsKeyword("JOIN") || tok.IsKeyword("INTO") || (tok.IsKeyword("UPDATE") && (i == 0 || !tokens[i-1].IsKeyword("DO"))) {
			next := tokens[i+1]
			// Skip subqueries: FROM (SELECT ...)
			if next.IsPunctuation("(") {
				continue
			}

			if next.Type == TokenIdent || next.Type == TokenKeyword {
				tableRef := next.Raw
				targetTok := next

				// Check for schema.table
				if i+3 < len(tokens) && tokens[i+2].IsPunctuation(".") && (tokens[i+3].Type == TokenIdent || tokens[i+3].Type == TokenKeyword) {
					tableRef = tokens[i+3].Raw
					targetTok = tokens[i+3]
				}

				// Check if matches CTE
				if ctes[strings.ToLower(tableRef)] {
					continue
				}

				// Check against known tables
				if !isKnownTable(tableRef, ctx.KnownTables) {
					closest := findClosestMatch(tableRef, ctx.KnownTables)
					var fix *QuickFix
					if closest != "" {
						fix = &QuickFix{
							Title:       fmt.Sprintf("Change to '%s'", closest),
							Replacement: closest,
							StartOffset: targetTok.StartOffset,
							EndOffset:   targetTok.EndOffset,
						}
					}

					diags = append(diags, Diagnostic{
						RuleID:      "unresolved-table",
						Message:     fmt.Sprintf("Table '%s' does not exist in schema metadata.", tableRef),
						Severity:    r.Meta().DefaultSev,
						Line:        targetTok.Line,
						Col:         targetTok.Col,
						StartOffset: targetTok.StartOffset,
						EndOffset:   targetTok.EndOffset,
						QuickFix:    fix,
					})
				}
			}
		}
	}

	return diags
}

// ── Rule 9: unresolved-column ────────────────────────────────────────────

type UnresolvedColumnRule struct{}

func (r *UnresolvedColumnRule) Meta() RuleMeta {
	return RuleMeta{
		ID:          "unresolved-column",
		Name:        "Unresolved Column Reference",
		Description: "Flag column references that do not exist in the referenced table's known schema.",
		Category:    "correctness",
		DefaultSev:  SeverityWarning,
		Enabled:     true,
		Severity:    SeverityWarning,
	}
}

func (r *UnresolvedColumnRule) Check(ctx *RuleContext) []Diagnostic {
	if len(ctx.KnownCols) == 0 {
		return nil
	}

	var diags []Diagnostic
	tokens := ctx.CodeTokens

	// Extract table aliases: alias -> tableName
	aliasMap := extractTableAliases(tokens)

	for i := 0; i < len(tokens)-2; i++ {
		// Look for pattern: <alias/table> . <column>
		if (tokens[i].Type == TokenIdent || tokens[i].Type == TokenKeyword) &&
			tokens[i+1].IsPunctuation(".") &&
			(tokens[i+2].Type == TokenIdent || tokens[i+2].Type == TokenKeyword) {

			prefix := tokens[i].Raw
			colTok := tokens[i+2]
			colName := colTok.Raw

			// If column is *, handled by select-star rule
			if colName == "*" {
				continue
			}

			// Map alias to table name
			realTable := prefix
			if mapped, ok := aliasMap[strings.ToLower(prefix)]; ok {
				realTable = mapped
			}

			cols := lookupColumns(ctx.KnownCols, realTable)
			if len(cols) > 0 {
				found := false
				for _, c := range cols {
					if strings.EqualFold(c, colName) {
						found = true
						break
					}
				}

				if !found {
					closest := findClosestMatch(colName, cols)
					var fix *QuickFix
					if closest != "" {
						fix = &QuickFix{
							Title:       fmt.Sprintf("Change to '%s'", closest),
							Replacement: closest,
							StartOffset: colTok.StartOffset,
							EndOffset:   colTok.EndOffset,
						}
					}

					diags = append(diags, Diagnostic{
						RuleID:      "unresolved-column",
						Message:     fmt.Sprintf("Column '%s' not found on table '%s'.", colName, realTable),
						Severity:    r.Meta().DefaultSev,
						Line:        colTok.Line,
						Col:         colTok.Col,
						StartOffset: colTok.StartOffset,
						EndOffset:   colTok.EndOffset,
						QuickFix:    fix,
					})
				}
			}
		}
	}

	return diags
}

// ── Rule 10: unqualified-column-in-join ───────────────────────────────────

type UnqualifiedColumnInJoinRule struct{}

func (r *UnqualifiedColumnInJoinRule) Meta() RuleMeta {
	return RuleMeta{
		ID:          "unqualified-column-in-join",
		Name:        "Unqualified Column in Multi-Table Query",
		Description: "Multi-table queries should qualify columns with table name or alias to avoid ambiguity.",
		Category:    "style",
		DefaultSev:  SeverityInfo,
		Enabled:     true,
		Severity:    SeverityInfo,
	}
}

func (r *UnqualifiedColumnInJoinRule) Check(ctx *RuleContext) []Diagnostic {
	var diags []Diagnostic
	tokens := ctx.CodeTokens

	// Count number of table sources in query
	tableSources := countTableSources(tokens)
	if tableSources < 2 {
		return nil
	}

	aliases := extractTableAliases(tokens)
	var firstAlias string
	for a := range aliases {
		firstAlias = a
		break
	}

	inProjection := false
	parenDepth := 0

	for i := 0; i < len(tokens); i++ {
		tok := tokens[i]

		if tok.IsPunctuation("(") {
			parenDepth++
			continue
		}
		if tok.IsPunctuation(")") {
			if parenDepth > 0 {
				parenDepth--
			}
			continue
		}

		if parenDepth == 0 {
			if tok.IsKeyword("SELECT") {
				inProjection = true
				continue
			}
			if inProjection && (tok.IsKeyword("FROM") || tok.IsPunctuation(";")) {
				inProjection = false
				continue
			}

			if inProjection {
				// Column in projection: identifier not preceded by '.' and not followed by '.' or '('
				if tok.Type == TokenIdent {
					isPrecededByDot := i > 0 && tokens[i-1].IsPunctuation(".")
					isFollowedByDot := i+1 < len(tokens) && tokens[i+1].IsPunctuation(".")
					isFunctionCall := i+1 < len(tokens) && tokens[i+1].IsPunctuation("(")
					isKeywordOrAlias := isQueryAliasOrTable(tok.Raw, aliases)

					// If preceded by AS, it's an output alias, not a column
					isAsAlias := i > 0 && tokens[i-1].IsKeyword("AS")

					if !isPrecededByDot && !isFollowedByDot && !isFunctionCall && !isKeywordOrAlias && !isAsAlias {
						var fix *QuickFix
						if firstAlias != "" {
							fix = &QuickFix{
								Title:       fmt.Sprintf("Qualify as '%s.%s'", firstAlias, tok.Raw),
								Replacement: fmt.Sprintf("%s.%s", firstAlias, tok.Raw),
								StartOffset: tok.StartOffset,
								EndOffset:   tok.EndOffset,
							}
						}

						diags = append(diags, Diagnostic{
							RuleID:      "unqualified-column-in-join",
							Message:     fmt.Sprintf("Column '%s' in multi-table query should be qualified with a table alias to avoid ambiguity.", tok.Raw),
							Severity:    r.Meta().DefaultSev,
							Line:        tok.Line,
							Col:         tok.Col,
							StartOffset: tok.StartOffset,
							EndOffset:   tok.EndOffset,
							QuickFix:    fix,
						})
					}
				}
			}
		}
	}

	return diags
}

// ── Helpers ──────────────────────────────────────────────────────────────

func extractCteNames(tokens []Token) map[string]bool {
	ctes := make(map[string]bool)
	for i := 0; i < len(tokens); i++ {
		if tokens[i].IsKeyword("WITH") {
			i++
			if i < len(tokens) && tokens[i].IsKeyword("RECURSIVE") {
				i++
			}
			for i < len(tokens) {
				if tokens[i].Type == TokenIdent || tokens[i].Type == TokenKeyword {
					ctes[strings.ToLower(tokens[i].Raw)] = true
				}
				// advance to AS (
				for i < len(tokens) && !tokens[i].IsKeyword("AS") {
					i++
				}
				if i < len(tokens) && tokens[i].IsKeyword("AS") {
					i++
					if i < len(tokens) && tokens[i].IsPunctuation("(") {
						depth := 1
						i++
						for i < len(tokens) && depth > 0 {
							if tokens[i].IsPunctuation("(") {
								depth++
							} else if tokens[i].IsPunctuation(")") {
								depth--
							}
							i++
						}
					}
				}
				if i < len(tokens) && tokens[i].IsPunctuation(",") {
					i++
				} else {
					break
				}
			}
		}
	}
	return ctes
}

func extractTableAliases(tokens []Token) map[string]string {
	aliases := make(map[string]string)
	for i := 0; i < len(tokens)-1; i++ {
		if tokens[i].IsKeyword("FROM") || tokens[i].IsKeyword("JOIN") {
			next := tokens[i+1]
			if next.IsPunctuation("(") {
				continue
			}
			tableName := next.Raw
			alias := tableName

			idx := i + 2
			if idx < len(tokens) && tokens[idx].IsPunctuation(".") && idx+1 < len(tokens) {
				tableName = tokens[idx+1].Raw
				alias = tableName
				idx += 2
			}

			if idx < len(tokens) && tokens[idx].IsKeyword("AS") && idx+1 < len(tokens) {
				alias = tokens[idx+1].Raw
			} else if idx < len(tokens) && (tokens[idx].Type == TokenIdent) && !tokens[idx].IsKeyword("ON") && !tokens[idx].IsKeyword("WHERE") && !tokens[idx].IsKeyword("JOIN") {
				alias = tokens[idx].Raw
			}

			aliases[strings.ToLower(alias)] = tableName
			aliases[strings.ToLower(tableName)] = tableName
		}
	}
	return aliases
}

func isQueryAliasOrTable(name string, aliases map[string]string) bool {
	lower := strings.ToLower(name)
	for a, t := range aliases {
		if a == lower || strings.ToLower(t) == lower {
			return true
		}
	}
	return false
}

func countTableSources(tokens []Token) int {
	count := 0
	inFrom := false
	parenDepth := 0
	for _, tok := range tokens {
		if tok.IsPunctuation("(") {
			parenDepth++
			continue
		}
		if tok.IsPunctuation(")") {
			if parenDepth > 0 {
				parenDepth--
			}
			continue
		}
		if parenDepth == 0 {
			if tok.IsKeyword("FROM") {
				count++
				inFrom = true
			} else if tok.IsKeyword("JOIN") {
				count++
			} else if inFrom && tok.IsPunctuation(",") {
				count++
			} else if tok.IsKeyword("WHERE") || tok.IsPunctuation(";") {
				inFrom = false
			}
		}
	}
	return count
}

func findFirstFromTable(tokens []Token, startIdx int) string {
	for i := startIdx; i < len(tokens)-1; i++ {
		if tokens[i].IsKeyword("FROM") {
			next := tokens[i+1]
			if next.IsPunctuation("(") {
				return ""
			}
			if i+3 < len(tokens) && tokens[i+2].IsPunctuation(".") {
				return tokens[i+3].Raw
			}
			return next.Raw
		}
	}
	return ""
}

func lookupColumns(knownCols map[string][]string, table string) []string {
	lower := strings.ToLower(table)
	for k, cols := range knownCols {
		if strings.ToLower(k) == lower || strings.HasSuffix(strings.ToLower(k), "."+lower) {
			return cols
		}
	}
	return nil
}

func isKnownTable(table string, knownTables []string) bool {
	lower := strings.ToLower(table)
	for _, t := range knownTables {
		tLower := strings.ToLower(t)
		if tLower == lower || strings.HasSuffix(tLower, "."+lower) || strings.HasPrefix(lower, tLower+".") {
			return true
		}
	}
	return false
}

func findClosestMatch(target string, candidates []string) string {
	target = strings.ToLower(target)
	bestDist := 999
	bestMatch := ""
	for _, c := range candidates {
		// Strip schema if candidates have schema.table
		cleanC := c
		if dot := strings.LastIndex(cleanC, "."); dot >= 0 {
			cleanC = cleanC[dot+1:]
		}
		d := levenshtein(target, strings.ToLower(cleanC))
		if d < bestDist && d <= 3 {
			bestDist = d
			bestMatch = cleanC
		}
	}
	return bestMatch
}

func levenshtein(s1, s2 string) int {
	r1, r2 := []rune(s1), []rune(s2)
	n1, n2 := len(r1), len(r2)
	if n1 == 0 {
		return n2
	}
	if n2 == 0 {
		return n1
	}

	dp := make([][]int, n1+1)
	for i := range dp {
		dp[i] = make([]int, n2+1)
		dp[i][0] = i
	}
	for j := 0; j <= n2; j++ {
		dp[0][j] = j
	}

	for i := 1; i <= n1; i++ {
		for j := 1; j <= n2; j++ {
			cost := 0
			if r1[i-1] != r2[j-1] {
				cost = 1
			}
			dp[i][j] = min3(
				dp[i-1][j]+1,
				dp[i][j-1]+1,
				dp[i-1][j-1]+cost,
			)
		}
	}
	return dp[n1][n2]
}

func min3(a, b, c int) int {
	if a < b {
		if a < c {
			return a
		}
		return c
	}
	if b < c {
		return b
	}
	return c
}

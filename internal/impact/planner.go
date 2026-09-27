package impact

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/dblens/dblens/internal/driver/types"
)

var reValidIdentifier = regexp.MustCompile(`^[a-zA-Z0-9_]+$`)

func stripControlChars(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r >= 32 && r != 127 {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func quoteIdent(dialect, ident string) string {
	switch normalizeDialect(dialect) {
	case "mysql":
		return "`" + strings.ReplaceAll(ident, "`", "``") + "`"
	default:
		return `"` + strings.ReplaceAll(ident, `"`, `""`) + `"`
	}
}

func qualifyName(dialect, schema, name string) string {
	d := normalizeDialect(dialect)
	if d == "sqlite" || schema == "" || schema == "main" {
		return quoteIdent(d, name)
	}
	return quoteIdent(d, schema) + "." + quoteIdent(d, name)
}

// BuildRemediationPlan generates an ordered safe drop plan with reversible UP/DOWN scripts.
func BuildRemediationPlan(ctx context.Context, d types.Driver, graph *ImpactGraph, cascade bool) (*RemediationPlan, error) {
	if d == nil {
		return nil, errors.New("driver is required")
	}
	if graph == nil {
		return nil, fmt.Errorf("impact graph is nil")
	}

	dialect := normalizeDialect(d.Dialect())
	target := graph.Root

	var steps []PlanStep
	stepOrder := 1

	var triggerNodes []ImpactNode
	var viewNodes []ImpactNode
	var fkNodes []ImpactNode
	var indexNodes []ImpactNode

	for _, n := range graph.Nodes {
		switch n.Kind {
		case "trigger":
			triggerNodes = append(triggerNodes, n)
		case "view":
			viewNodes = append(viewNodes, n)
		case "foreign_key":
			fkNodes = append(fkNodes, n)
		case "index":
			indexNodes = append(indexNodes, n)
		}
	}

	// 1. Drop Triggers
	for _, tr := range triggerNodes {
		dropSQL := ""
		switch dialect {
		case "postgres":
			dropSQL = fmt.Sprintf("DROP TRIGGER IF EXISTS %s ON %s;", quoteIdent(dialect, tr.Name), qualifyName(dialect, tr.Schema, target.Name))
		case "mysql":
			dropSQL = fmt.Sprintf("DROP TRIGGER IF EXISTS %s;", qualifyName(dialect, tr.Schema, tr.Name))
		case "sqlite":
			dropSQL = fmt.Sprintf("DROP TRIGGER IF EXISTS %s;", quoteIdent(dialect, tr.Name))
		default:
			dropSQL = fmt.Sprintf("DROP TRIGGER IF EXISTS %s;", quoteIdent(dialect, tr.Name))
		}

		steps = append(steps, PlanStep{
			Order:        stepOrder,
			Action:       "DROP",
			ObjectKind:   "trigger",
			ObjectName:   tr.Name,
			SQL:          dropSQL,
			Description:  fmt.Sprintf("Drop dependent trigger %s before modifying target", tr.Name),
			Irreversible: false,
		})
		stepOrder++
	}

	// 2. Drop Views
	for _, vw := range viewNodes {
		cascadeSuffix := ""
		if cascade && dialect == "postgres" {
			cascadeSuffix = " CASCADE"
		}
		dropSQL := fmt.Sprintf("DROP VIEW IF EXISTS %s%s;", qualifyName(dialect, vw.Schema, vw.Name), cascadeSuffix)

		steps = append(steps, PlanStep{
			Order:        stepOrder,
			Action:       "DROP",
			ObjectKind:   "view",
			ObjectName:   vw.Name,
			SQL:          dropSQL,
			Description:  fmt.Sprintf("Drop dependent view %s referencing target", vw.Name),
			Irreversible: false,
		})
		stepOrder++
	}

	// 3. Drop Foreign Keys
	for _, fk := range fkNodes {
		dropSQL := ""
		parts := strings.Split(fk.ID, ".")
		childTable := ""
		fkName := fk.Name
		if len(parts) >= 2 {
			childTable = parts[1]
		}
		if childTable == "" {
			childTable = fk.Schema
		}

		switch dialect {
		case "postgres":
			dropSQL = fmt.Sprintf("ALTER TABLE %s DROP CONSTRAINT IF EXISTS %s;", qualifyName(dialect, fk.Schema, childTable), quoteIdent(dialect, fkName))
		case "mysql":
			dropSQL = fmt.Sprintf("ALTER TABLE %s DROP FOREIGN KEY %s;", qualifyName(dialect, fk.Schema, childTable), quoteIdent(dialect, fkName))
		case "sqlite":
			dropSQL = fmt.Sprintf("-- SQLite: Disable FK checks with PRAGMA foreign_keys = OFF; for FK %s", fk.Name)
		default:
			dropSQL = fmt.Sprintf("ALTER TABLE %s DROP CONSTRAINT %s;", qualifyName(dialect, fk.Schema, childTable), quoteIdent(dialect, fkName))
		}

		steps = append(steps, PlanStep{
			Order:        stepOrder,
			Action:       "ALTER",
			ObjectKind:   "foreign_key",
			ObjectName:   fk.Name,
			SQL:          dropSQL,
			Description:  fmt.Sprintf("Remove foreign key constraint referencing %s", target.Name),
			Irreversible: false,
		})
		stepOrder++
	}

	// 4. Drop Indexes (if target is column)
	for _, idx := range indexNodes {
		dropSQL := ""
		switch dialect {
		case "mysql":
			dropSQL = fmt.Sprintf("DROP INDEX %s ON %s;", quoteIdent(dialect, idx.Name), qualifyName(dialect, target.Schema, target.Name))
		default:
			dropSQL = fmt.Sprintf("DROP INDEX IF EXISTS %s;", qualifyName(dialect, idx.Schema, idx.Name))
		}

		steps = append(steps, PlanStep{
			Order:        stepOrder,
			Action:       "DROP",
			ObjectKind:   "index",
			ObjectName:   idx.Name,
			SQL:          dropSQL,
			Description:  fmt.Sprintf("Drop index %s on target column", idx.Name),
			Irreversible: false,
		})
		stepOrder++
	}

	// 5. Target Object Drop
	targetSQL := ""
	targetDesc := ""
	isIrreversible := false

	switch target.Kind {
	case "column":
		tableName := target.TableName
		colName := target.ColumnName
		if tableName == "" && colName == "" {
			parts := strings.Split(target.ID, ".")
			if len(parts) == 3 {
				tableName = parts[1]
				colName = parts[2]
			} else if len(parts) == 2 {
				tableName = parts[0]
				colName = parts[1]
			} else {
				tableName = target.Name
				colName = target.Detail
			}
		} else if tableName == "" {
			tableName = target.Name
		} else if colName == "" {
			colName = target.Name
		}

		targetSQL = fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s;", qualifyName(dialect, target.Schema, tableName), quoteIdent(dialect, colName))
		targetDesc = fmt.Sprintf("Permanently drop column %s and destroy stored column values", colName)
		isIrreversible = true

	case "table":
		cascadeSuffix := ""
		if cascade && dialect == "postgres" {
			cascadeSuffix = " CASCADE"
		}
		targetSQL = fmt.Sprintf("DROP TABLE IF EXISTS %s%s;", qualifyName(dialect, target.Schema, target.Name), cascadeSuffix)
		targetDesc = fmt.Sprintf("Permanently drop table %s and all contained rows and indexes", target.Name)
		isIrreversible = true

	case "view":
		cascadeSuffix := ""
		if cascade && dialect == "postgres" {
			cascadeSuffix = " CASCADE"
		}
		targetSQL = fmt.Sprintf("DROP VIEW IF EXISTS %s%s;", qualifyName(dialect, target.Schema, target.Name), cascadeSuffix)
		targetDesc = fmt.Sprintf("Drop view %s", target.Name)
		isIrreversible = false

	case "routine":
		targetSQL = fmt.Sprintf("DROP FUNCTION IF EXISTS %s;", qualifyName(dialect, target.Schema, target.Name))
		targetDesc = fmt.Sprintf("Drop routine %s", target.Name)
		isIrreversible = false

	default:
		targetSQL = fmt.Sprintf("DROP TABLE IF EXISTS %s;", qualifyName(dialect, target.Schema, target.Name))
		targetDesc = fmt.Sprintf("Drop object %s", target.Name)
		isIrreversible = true
	}

	steps = append(steps, PlanStep{
		Order:        stepOrder,
		Action:       "DROP",
		ObjectKind:   target.Kind,
		ObjectName:   target.Name,
		SQL:          targetSQL,
		Description:  targetDesc,
		Irreversible: isIrreversible,
	})

	// Build UP SQL
	var upLines []string
	if dialect == "postgres" || dialect == "sqlite" {
		upLines = append(upLines, "BEGIN;")
	}

	for _, s := range steps {
		upLines = append(upLines, fmt.Sprintf("-- Step %d: %s (%s)", s.Order, stripControlChars(s.Description), stripControlChars(s.ObjectKind)))
		upLines = append(upLines, s.SQL)
	}

	if dialect == "postgres" || dialect == "sqlite" {
		upLines = append(upLines, "COMMIT;")
	}

	// Build DOWN SQL (Rollback in reverse order)
	var downLines []string
	if dialect == "postgres" || dialect == "sqlite" {
		downLines = append(downLines, "BEGIN;")
	}

	downLines = append(downLines, "-- REVERT TARGET OBJECT (Recreate from backup or schema definition)")
	if target.Kind == "column" {
		tableName := target.TableName
		colName := target.ColumnName
		if tableName == "" && colName == "" {
			parts := strings.Split(target.ID, ".")
			if len(parts) == 3 {
				tableName = parts[1]
				colName = parts[2]
			} else if len(parts) == 2 {
				tableName = parts[0]
				colName = parts[1]
			} else {
				tableName = target.Name
				colName = target.Detail
			}
		} else if tableName == "" {
			tableName = target.Name
		} else if colName == "" {
			colName = target.Name
		}
		downLines = append(downLines, fmt.Sprintf("-- ALTER TABLE %s ADD COLUMN %s <DATA_TYPE>;", qualifyName(dialect, target.Schema, tableName), quoteIdent(dialect, colName)))
	} else if target.Kind == "table" {
		downLines = append(downLines, fmt.Sprintf("-- Recreate table %s and restore data from backup before proceeding.", qualifyName(dialect, target.Schema, target.Name)))
	}

	// Recreate FKs
	for i := len(fkNodes) - 1; i >= 0; i-- {
		fk := fkNodes[i]
		downLines = append(downLines, fmt.Sprintf("-- Recreate foreign key: %s (%s)", stripControlChars(fk.Name), stripControlChars(fk.Detail)))
	}

	// Recreate Views
	for i := len(viewNodes) - 1; i >= 0; i-- {
		vw := viewNodes[i]
		downLines = append(downLines, fmt.Sprintf("-- CREATE OR REPLACE VIEW %s AS ...;", qualifyName(dialect, vw.Schema, vw.Name)))
	}

	// Recreate Triggers
	for i := len(triggerNodes) - 1; i >= 0; i-- {
		tr := triggerNodes[i]
		downLines = append(downLines, fmt.Sprintf("-- Recreate trigger: %s", stripControlChars(tr.Name)))
	}

	if dialect == "postgres" || dialect == "sqlite" {
		downLines = append(downLines, "COMMIT;")
	}

	requiresCascade := len(viewNodes) > 0 || len(fkNodes) > 0 || cascade

	return &RemediationPlan{
		Target:          target,
		Steps:           steps,
		EstimatedRisk:   graph.RiskScore,
		RequiresCascade: requiresCascade,
		UpSQL:           strings.Join(upLines, "\n"),
		DownSQL:         strings.Join(downLines, "\n"),
	}, nil
}

// BuildRenamePlan builds DDL and steps to rename an object or column and update dependents.
func BuildRenamePlan(ctx context.Context, d types.Driver, graph *ImpactGraph, req RenameRequest) (*RenamePlan, error) {
	if d == nil {
		return nil, errors.New("driver is required")
	}
	if graph == nil {
		return nil, fmt.Errorf("impact graph is nil")
	}
	if strings.ContainsAny(req.NewName, "\r\n") || !reValidIdentifier.MatchString(req.NewName) {
		return nil, errors.New("new_name must only contain alphanumeric characters and underscores, and cannot contain newlines")
	}

	dialect := normalizeDialect(d.Dialect())
	target := graph.Root

	var steps []PlanStep
	stepOrder := 1

	var upLines []string
	var downLines []string

	if dialect == "postgres" || dialect == "sqlite" {
		upLines = append(upLines, "BEGIN;")
		downLines = append(downLines, "BEGIN;")
	}

	if req.ObjectType == "column" || req.Column != "" {
		colName := req.Column
		if colName == "" {
			colName = target.ColumnName
			if colName == "" {
				colName = target.Name
			}
		}
		tableName := req.Object
		if tableName == "" {
			tableName = target.TableName
		}

		renameSQL := ""
		revertSQL := ""

		switch dialect {
		case "postgres":
			renameSQL = fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s;",
				qualifyName(dialect, req.Schema, tableName), quoteIdent(dialect, colName), quoteIdent(dialect, req.NewName))
			revertSQL = fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s;",
				qualifyName(dialect, req.Schema, tableName), quoteIdent(dialect, req.NewName), quoteIdent(dialect, colName))
		case "mysql":
			renameSQL = fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s;",
				qualifyName(dialect, req.Schema, tableName), quoteIdent(dialect, colName), quoteIdent(dialect, req.NewName))
			revertSQL = fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s;",
				qualifyName(dialect, req.Schema, tableName), quoteIdent(dialect, req.NewName), quoteIdent(dialect, colName))
		case "sqlite":
			renameSQL = fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s;",
				quoteIdent(dialect, tableName), quoteIdent(dialect, colName), quoteIdent(dialect, req.NewName))
			revertSQL = fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s;",
				quoteIdent(dialect, tableName), quoteIdent(dialect, req.NewName), quoteIdent(dialect, colName))
		default:
			renameSQL = fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s;",
				qualifyName(dialect, req.Schema, tableName), quoteIdent(dialect, colName), quoteIdent(dialect, req.NewName))
			revertSQL = fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s;",
				qualifyName(dialect, req.Schema, tableName), quoteIdent(dialect, req.NewName), quoteIdent(dialect, colName))
		}

		steps = append(steps, PlanStep{
			Order:        stepOrder,
			Action:       "ALTER",
			ObjectKind:   "column",
			ObjectName:   colName,
			SQL:          renameSQL,
			Description:  fmt.Sprintf("Rename column %s to %s on table %s", colName, req.NewName, tableName),
			Irreversible: false,
		})
		stepOrder++
		upLines = append(upLines, renameSQL)
		downLines = append(downLines, revertSQL)

		// Note dependent views that need column definition update
		for _, n := range graph.Nodes {
			if n.Kind == "view" {
				steps = append(steps, PlanStep{
					Order:        stepOrder,
					Action:       "ALTER",
					ObjectKind:   "view",
					ObjectName:   n.Name,
					SQL:          fmt.Sprintf("-- Recreate view %s with new column reference %s", stripControlChars(n.Name), stripControlChars(req.NewName)),
					Description:  fmt.Sprintf("Update view %s referencing renamed column", stripControlChars(n.Name)),
					Irreversible: false,
				})
				stepOrder++
			}
		}

	} else {
		// Table / View rename
		renameSQL := ""
		revertSQL := ""

		switch dialect {
		case "postgres":
			renameSQL = fmt.Sprintf("ALTER TABLE %s RENAME TO %s;",
				qualifyName(dialect, req.Schema, req.Object), quoteIdent(dialect, req.NewName))
			revertSQL = fmt.Sprintf("ALTER TABLE %s RENAME TO %s;",
				qualifyName(dialect, req.Schema, req.NewName), quoteIdent(dialect, req.Object))
		case "mysql":
			renameSQL = fmt.Sprintf("RENAME TABLE %s TO %s;",
				qualifyName(dialect, req.Schema, req.Object), qualifyName(dialect, req.Schema, req.NewName))
			revertSQL = fmt.Sprintf("RENAME TABLE %s TO %s;",
				qualifyName(dialect, req.Schema, req.NewName), qualifyName(dialect, req.Schema, req.Object))
		case "sqlite":
			renameSQL = fmt.Sprintf("ALTER TABLE %s RENAME TO %s;",
				quoteIdent(dialect, req.Object), quoteIdent(dialect, req.NewName))
			revertSQL = fmt.Sprintf("ALTER TABLE %s RENAME TO %s;",
				quoteIdent(dialect, req.NewName), quoteIdent(dialect, req.Object))
		default:
			renameSQL = fmt.Sprintf("ALTER TABLE %s RENAME TO %s;",
				qualifyName(dialect, req.Schema, req.Object), quoteIdent(dialect, req.NewName))
			revertSQL = fmt.Sprintf("ALTER TABLE %s RENAME TO %s;",
				qualifyName(dialect, req.Schema, req.NewName), quoteIdent(dialect, req.Object))
		}

		steps = append(steps, PlanStep{
			Order:        stepOrder,
			Action:       "ALTER",
			ObjectKind:   target.Kind,
			ObjectName:   req.Object,
			SQL:          renameSQL,
			Description:  fmt.Sprintf("Rename %s from %s to %s", target.Kind, req.Object, req.NewName),
			Irreversible: false,
		})
		stepOrder++
		upLines = append(upLines, renameSQL)
		downLines = append(downLines, revertSQL)

		for _, n := range graph.Nodes {
			if n.Kind == "view" {
				steps = append(steps, PlanStep{
					Order:        stepOrder,
					Action:       "ALTER",
					ObjectKind:   "view",
					ObjectName:   n.Name,
					SQL:          fmt.Sprintf("-- Recreate view %s with updated reference to %s", stripControlChars(n.Name), stripControlChars(req.NewName)),
					Description:  fmt.Sprintf("Update view %s referencing renamed table", stripControlChars(n.Name)),
					Irreversible: false,
				})
				stepOrder++
			}
		}
	}

	if dialect == "postgres" || dialect == "sqlite" {
		upLines = append(upLines, "COMMIT;")
		downLines = append(downLines, "COMMIT;")
	}

	return &RenamePlan{
		Target:  target,
		NewName: req.NewName,
		Steps:   steps,
		UpSQL:   strings.Join(upLines, "\n"),
		DownSQL: strings.Join(downLines, "\n"),
	}, nil
}

// ExportMarkdown produces a structured Markdown impact analysis report.
func ExportMarkdown(graph *ImpactGraph, plan *RemediationPlan) string {
	if graph == nil {
		return "# Impact Report\n\nNo impact data available.\n"
	}

	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("# Schema Object Impact Report: `%s`\n\n", graph.Root.Name))
	sb.WriteString(fmt.Sprintf("- **Target Kind:** `%s`\n", graph.Root.Kind))
	if graph.Root.Schema != "" {
		sb.WriteString(fmt.Sprintf("- **Schema:** `%s`\n", graph.Root.Schema))
	}
	sb.WriteString(fmt.Sprintf("- **Total Dependents:** `%d`\n", graph.TotalDependents))
	sb.WriteString(fmt.Sprintf("- **Estimated Risk:** `%s`\n\n", graph.RiskScore))

	// Dependents table
	sb.WriteString("## Dependent Objects\n\n")
	if len(graph.Nodes) == 0 {
		sb.WriteString("_No dependent views, triggers, foreign keys, or routines found._\n\n")
	} else {
		sb.WriteString("| Kind | Name | Schema | Dependency Type | Drop Behavior | Detail |\n")
		sb.WriteString("| :--- | :--- | :--- | :--- | :--- | :--- |\n")
		for _, n := range graph.Nodes {
			sb.WriteString(fmt.Sprintf("| `%s` | `%s` | `%s` | `%s` | `%s` | %s |\n",
				n.Kind, n.Name, n.Schema, n.RefKind, n.DropBehavior, n.Detail))
		}
		sb.WriteString("\n")
	}

	// Safe Drop Remediation Plan
	if plan != nil && len(plan.Steps) > 0 {
		sb.WriteString("## Safe Drop Remediation Plan\n\n")
		sb.WriteString(fmt.Sprintf("- **Requires Cascade:** `%v`\n", plan.RequiresCascade))
		sb.WriteString(fmt.Sprintf("- **Execution Steps:** `%d`\n\n", len(plan.Steps)))

		sb.WriteString("| Step | Action | Object Kind | Object Name | Irreversible | Description |\n")
		sb.WriteString("| :--- | :--- | :--- | :--- | :--- | :--- |\n")
		for _, s := range plan.Steps {
			irrev := "No"
			if s.Irreversible {
				irrev = "⚠️ YES (Data Loss)"
			}
			sb.WriteString(fmt.Sprintf("| %d | `%s` | `%s` | `%s` | %s | %s |\n",
				s.Order, s.Action, s.ObjectKind, s.ObjectName, irrev, s.Description))
		}
		sb.WriteString("\n")

		if plan.UpSQL != "" {
			sb.WriteString("### Forward Migration (UP SQL)\n\n")
			sb.WriteString("```sql\n")
			sb.WriteString(plan.UpSQL)
			sb.WriteString("\n```\n\n")
		}

		if plan.DownSQL != "" {
			sb.WriteString("### Rollback Script (DOWN SQL)\n\n")
			sb.WriteString("```sql\n")
			sb.WriteString(plan.DownSQL)
			sb.WriteString("\n```\n")
		}
	}

	return sb.String()
}

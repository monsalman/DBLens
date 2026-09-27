package snapshot

import (
	"fmt"
	"strings"

	"github.com/dblens/dblens/internal/alter"
)

// GenerateRollbackPlan generates forward (UP) and reverse rollback (DOWN) migration DDL scripts.
func GenerateRollbackPlan(diff *SnapshotDiff) *RollbackPlan {
	if diff == nil {
		return &RollbackPlan{
			Warnings: []string{},
		}
	}

	dialect := alter.NormalizeDialect(diff.Dialect)
	plan := &RollbackPlan{
		BaseSnapshotID:   diff.BaseSnapshotID,
		TargetSnapshotID: diff.TargetSnapshotID,
		Dialect:          dialect,
		Warnings:         []string{},
		Destructive:      false,
	}

	var upStatements []string
	var downStatements []string

	// --- 1. UP MIGRATION (Transform Base -> Target) ---
	// 1a. Added Tables
	for _, tbl := range diff.AddedTables {
		if strings.TrimSpace(tbl.DDL) != "" {
			upStatements = append(upStatements, strings.TrimRight(strings.TrimSpace(tbl.DDL), ";")+";")
		} else {
			createStmt := buildCreateTableSQL(tbl, dialect)
			if createStmt != "" {
				upStatements = append(upStatements, createStmt)
			}
		}
		// Any indexes on added table
		for _, idx := range tbl.Indexes {
			if !idx.IsPrimary {
				idxStmt := buildCreateIndexSQL(tbl.Schema, tbl.Name, idx, dialect)
				if idxStmt != "" {
					upStatements = append(upStatements, idxStmt)
				}
			}
		}
	}

	// 1b. Dropped Tables
	for _, tbl := range diff.DroppedTables {
		tblRef := quoteTableRef(tbl.Schema, tbl.Name, dialect)
		upStatements = append(upStatements, fmt.Sprintf("DROP TABLE %s;", tblRef))
		plan.Warnings = append(plan.Warnings, fmt.Sprintf("Dropping table '%s' will permanently destroy all stored data.", tbl.Name))
		plan.Destructive = true
	}

	// 1c. Altered Tables
	for _, at := range diff.AlteredTables {
		tblRef := quoteTableRef(at.Schema, at.TableName, dialect)

		// Added Columns
		for _, col := range at.AddedColumns {
			colDef := buildColumnDef(col, dialect)
			upStatements = append(upStatements, fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s;", tblRef, colDef))
		}

		// Dropped Columns
		for _, col := range at.DroppedColumns {
			colName := quoteIdent(col.Name, dialect)
			upStatements = append(upStatements, fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s;", tblRef, colName))
			plan.Warnings = append(plan.Warnings, fmt.Sprintf("Dropping column '%s' on table '%s' causes irreversible data loss.", col.Name, at.TableName))
			plan.Destructive = true
		}

		// Altered Columns
		for _, cd := range at.AlteredColumns {
			alterStmts := buildAlterColumnSQL(at.Schema, at.TableName, cd.OldColumn, cd.NewColumn, dialect)
			upStatements = append(upStatements, alterStmts...)
			plan.Warnings = append(plan.Warnings, fmt.Sprintf("Altering column '%s' on table '%s' may cause type conversion errors or data truncation.", cd.ColumnName, at.TableName))
			plan.Destructive = true
		}

		// Added Indexes
		for _, idx := range at.AddedIndexes {
			if !idx.IsPrimary {
				idxStmt := buildCreateIndexSQL(at.Schema, at.TableName, idx, dialect)
				if idxStmt != "" {
					upStatements = append(upStatements, idxStmt)
				}
			}
		}

		// Dropped Indexes
		for _, idx := range at.DroppedIndexes {
			dropIdx := buildDropIndexSQL(at.Schema, at.TableName, idx.Name, dialect)
			if dropIdx != "" {
				upStatements = append(upStatements, dropIdx)
			}
		}

		// Added Foreign Keys
		for _, fk := range at.AddedForeignKeys {
			fkStmt := buildAddForeignKeySQL(at.Schema, at.TableName, fk, dialect)
			if fkStmt != "" {
				upStatements = append(upStatements, fkStmt)
			}
		}

		// Dropped Foreign Keys
		for _, fk := range at.DroppedForeignKeys {
			dropFK := buildDropForeignKeySQL(at.Schema, at.TableName, fk, dialect)
			if dropFK != "" {
				upStatements = append(upStatements, dropFK)
			}
		}
	}

	// --- 2. DOWN MIGRATION (Reverse Rollback Target -> Base) ---
	// 2a. Re-create Dropped Tables
	for _, tbl := range diff.DroppedTables {
		if strings.TrimSpace(tbl.DDL) != "" {
			downStatements = append(downStatements, strings.TrimRight(strings.TrimSpace(tbl.DDL), ";")+";")
		} else {
			createStmt := buildCreateTableSQL(tbl, dialect)
			if createStmt != "" {
				downStatements = append(downStatements, createStmt)
			}
		}
		for _, idx := range tbl.Indexes {
			if !idx.IsPrimary {
				idxStmt := buildCreateIndexSQL(tbl.Schema, tbl.Name, idx, dialect)
				if idxStmt != "" {
					downStatements = append(downStatements, idxStmt)
				}
			}
		}
	}

	// 2b. Drop Added Tables
	for _, tbl := range diff.AddedTables {
		tblRef := quoteTableRef(tbl.Schema, tbl.Name, dialect)
		downStatements = append(downStatements, fmt.Sprintf("DROP TABLE %s;", tblRef))
	}

	// 2c. Reverse Altered Tables
	for _, at := range diff.AlteredTables {
		tblRef := quoteTableRef(at.Schema, at.TableName, dialect)

		// Drop added columns
		for _, col := range at.AddedColumns {
			colName := quoteIdent(col.Name, dialect)
			downStatements = append(downStatements, fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s;", tblRef, colName))
		}

		// Re-add dropped columns
		for _, col := range at.DroppedColumns {
			colDef := buildColumnDef(col, dialect)
			downStatements = append(downStatements, fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s;", tblRef, colDef))
		}

		// Revert altered columns (old -> new reversed)
		for _, cd := range at.AlteredColumns {
			revertStmts := buildAlterColumnSQL(at.Schema, at.TableName, cd.NewColumn, cd.OldColumn, dialect)
			downStatements = append(downStatements, revertStmts...)
		}

		// Re-create dropped indexes
		for _, idx := range at.DroppedIndexes {
			if !idx.IsPrimary {
				idxStmt := buildCreateIndexSQL(at.Schema, at.TableName, idx, dialect)
				if idxStmt != "" {
					downStatements = append(downStatements, idxStmt)
				}
			}
		}

		// Drop added indexes
		for _, idx := range at.AddedIndexes {
			dropIdx := buildDropIndexSQL(at.Schema, at.TableName, idx.Name, dialect)
			if dropIdx != "" {
				downStatements = append(downStatements, dropIdx)
			}
		}

		// Re-add dropped FKs
		for _, fk := range at.DroppedForeignKeys {
			fkStmt := buildAddForeignKeySQL(at.Schema, at.TableName, fk, dialect)
			if fkStmt != "" {
				downStatements = append(downStatements, fkStmt)
			}
		}

		// Drop added FKs
		for _, fk := range at.AddedForeignKeys {
			dropFK := buildDropForeignKeySQL(at.Schema, at.TableName, fk, dialect)
			if dropFK != "" {
				downStatements = append(downStatements, dropFK)
			}
		}
	}

	plan.UpSQL = strings.Join(upStatements, "\n")
	plan.DownSQL = strings.Join(downStatements, "\n")

	return plan
}

func quoteIdent(name string, dialect string) string {
	switch dialect {
	case "mysql":
		return "`" + strings.ReplaceAll(name, "`", "``") + "`"
	default:
		return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
	}
}

func quoteTableRef(schema, table, dialect string) string {
	schema = strings.TrimSpace(schema)
	table = strings.TrimSpace(table)
	if dialect == "sqlite" || schema == "" || schema == "public" || schema == "main" || schema == "default" {
		return quoteIdent(table, dialect)
	}
	return quoteIdent(schema, dialect) + "." + quoteIdent(table, dialect)
}

func buildColumnDef(col ColumnNode, dialect string) string {
	var parts []string
	parts = append(parts, quoteIdent(col.Name, dialect))
	parts = append(parts, col.Type)

	if !col.IsNullable {
		parts = append(parts, "NOT NULL")
	}
	if col.DefaultValue != nil && strings.TrimSpace(*col.DefaultValue) != "" {
		parts = append(parts, "DEFAULT "+strings.TrimSpace(*col.DefaultValue))
	}
	if col.IsPrimary {
		parts = append(parts, "PRIMARY KEY")
	}

	return strings.Join(parts, " ")
}

func buildCreateTableSQL(tbl TableNode, dialect string) string {
	tblRef := quoteTableRef(tbl.Schema, tbl.Name, dialect)
	var colDefs []string
	var pkCols []string

	for _, col := range tbl.Columns {
		if col.IsPrimary {
			pkCols = append(pkCols, quoteIdent(col.Name, dialect))
		}
		// Build def without inline primary key if multiple PKs exist
		var parts []string
		parts = append(parts, quoteIdent(col.Name, dialect))
		parts = append(parts, col.Type)
		if !col.IsNullable {
			parts = append(parts, "NOT NULL")
		}
		if col.DefaultValue != nil && strings.TrimSpace(*col.DefaultValue) != "" {
			parts = append(parts, "DEFAULT "+strings.TrimSpace(*col.DefaultValue))
		}
		colDefs = append(colDefs, strings.Join(parts, " "))
	}

	if len(pkCols) > 0 {
		colDefs = append(colDefs, fmt.Sprintf("PRIMARY KEY (%s)", strings.Join(pkCols, ", ")))
	}

	return fmt.Sprintf("CREATE TABLE %s (\n  %s\n);", tblRef, strings.Join(colDefs, ",\n  "))
}

func buildCreateIndexSQL(schema, table string, idx IndexNode, dialect string) string {
	tblRef := quoteTableRef(schema, table, dialect)
	idxName := quoteIdent(idx.Name, dialect)

	quotedCols := make([]string, len(idx.Columns))
	for i, c := range idx.Columns {
		quotedCols[i] = quoteIdent(c, dialect)
	}

	unique := ""
	if idx.IsUnique {
		unique = "UNIQUE "
	}

	return fmt.Sprintf("CREATE %sINDEX %s ON %s (%s);", unique, idxName, tblRef, strings.Join(quotedCols, ", "))
}

func buildDropIndexSQL(schema, table, indexName string, dialect string) string {
	switch dialect {
	case "mysql":
		tblRef := quoteTableRef(schema, table, dialect)
		return fmt.Sprintf("DROP INDEX %s ON %s;", quoteIdent(indexName, dialect), tblRef)
	default:
		return fmt.Sprintf("DROP INDEX %s;", quoteIdent(indexName, dialect))
	}
}

func buildAlterColumnSQL(schema, table string, oldCol, newCol ColumnNode, dialect string) []string {
	var stmts []string
	tblRef := quoteTableRef(schema, table, dialect)
	colName := quoteIdent(newCol.Name, dialect)

	switch dialect {
	case "mysql":
		def := buildColumnDef(newCol, dialect)
		stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s MODIFY COLUMN %s;", tblRef, def))
	case "sqlite":
		// SQLite has limited ALTER COLUMN; comment notice
		stmts = append(stmts, fmt.Sprintf("-- SQLite: ALTER TABLE %s column %s changed to %s (requires table rebuild if strictly enforced)", tblRef, colName, newCol.Type))
	default: // postgres
		if strings.ToLower(oldCol.Type) != strings.ToLower(newCol.Type) {
			stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s TYPE %s;", tblRef, colName, newCol.Type))
		}
		if oldCol.IsNullable != newCol.IsNullable {
			if newCol.IsNullable {
				stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s DROP NOT NULL;", tblRef, colName))
			} else {
				stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s SET NOT NULL;", tblRef, colName))
			}
		}
		oldDef := derefStr(oldCol.DefaultValue)
		newDef := derefStr(newCol.DefaultValue)
		if oldDef != newDef {
			if newDef == "" {
				stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s DROP DEFAULT;", tblRef, colName))
			} else {
				stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s SET DEFAULT %s;", tblRef, colName, newDef))
			}
		}
	}

	return stmts
}

func isValidFKAction(action string) bool {
	switch strings.ToUpper(strings.TrimSpace(action)) {
	case "CASCADE", "RESTRICT", "SET NULL", "SET DEFAULT", "NO ACTION":
		return true
	default:
		return false
	}
}

func buildAddForeignKeySQL(schema, table string, fk ForeignKeyNode, dialect string) string {
	tblRef := quoteTableRef(schema, table, dialect)
	refTblRef := quoteTableRef(schema, fk.RefTable, dialect)

	var fkName string
	if fk.Name != "" {
		fkName = "CONSTRAINT " + quoteIdent(fk.Name, dialect) + " "
	}

	actions := ""
	if fk.OnDelete != "" && isValidFKAction(fk.OnDelete) {
		actions += " ON DELETE " + strings.ToUpper(strings.TrimSpace(fk.OnDelete))
	}
	if fk.OnUpdate != "" && isValidFKAction(fk.OnUpdate) {
		actions += " ON UPDATE " + strings.ToUpper(strings.TrimSpace(fk.OnUpdate))
	}

	return fmt.Sprintf("ALTER TABLE %s ADD %sFOREIGN KEY (%s) REFERENCES %s (%s)%s;",
		tblRef, fkName, quoteIdent(fk.Column, dialect), refTblRef, quoteIdent(fk.RefColumn, dialect), actions)
}

func buildDropForeignKeySQL(schema, table string, fk ForeignKeyNode, dialect string) string {
	tblRef := quoteTableRef(schema, table, dialect)
	fkName := fk.Name
	if fkName == "" {
		fkName = fmt.Sprintf("fk_%s_%s", table, fk.Column)
	}

	switch dialect {
	case "mysql":
		return fmt.Sprintf("ALTER TABLE %s DROP FOREIGN KEY %s;", tblRef, quoteIdent(fkName, dialect))
	case "sqlite":
		return fmt.Sprintf("-- SQLite: Dropping FK %s on table %s (requires table rebuild)", fkName, tblRef)
	default: // postgres
		return fmt.Sprintf("ALTER TABLE %s DROP CONSTRAINT %s;", tblRef, quoteIdent(fkName, dialect))
	}
}

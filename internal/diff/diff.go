package diff

import (
	"fmt"
	"sort"
	"strings"

	"github.com/dblens/dblens/internal/alter"
	"github.com/dblens/dblens/internal/driver/types"
)

type DiffStatus string

const (
	DiffAdded     DiffStatus = "ADDED"
	DiffRemoved   DiffStatus = "REMOVED"
	DiffModified  DiffStatus = "MODIFIED"
	DiffIdentical DiffStatus = "IDENTICAL"
)

type ColumnDiff struct {
	Name           string     `json:"name"`
	Status         DiffStatus `json:"status"`
	SourceType     string     `json:"sourceType,omitempty"`
	TargetType     string     `json:"targetType,omitempty"`
	SourceNullable *bool      `json:"sourceNullable,omitempty"`
	TargetNullable *bool      `json:"targetNullable,omitempty"`
	SourceDefault  *string    `json:"sourceDefault,omitempty"`
	TargetDefault  *string    `json:"targetDefault,omitempty"`
	SourcePrimary  bool       `json:"sourcePrimary,omitempty"`
	TargetPrimary  bool       `json:"targetPrimary,omitempty"`
	Changes        []string   `json:"changes,omitempty"`
}

type IndexDiff struct {
	Name        string           `json:"name"`
	Status      DiffStatus       `json:"status"`
	Columns     []string         `json:"columns"`
	IsUnique    bool             `json:"isUnique"`
	Type        string           `json:"type,omitempty"`
	SourceIndex *types.IndexMeta `json:"sourceIndex,omitempty"`
	TargetIndex *types.IndexMeta `json:"targetIndex,omitempty"`
}

type FKDiff struct {
	Name      string            `json:"name"`
	Status    DiffStatus        `json:"status"`
	Column    string            `json:"column"`
	RefTable  string            `json:"refTable"`
	RefColumn string            `json:"refColumn"`
	OnUpdate  string            `json:"onUpdate,omitempty"`
	OnDelete  string            `json:"onDelete,omitempty"`
	SourceFK  *types.ForeignKey `json:"sourceFK,omitempty"`
	TargetFK  *types.ForeignKey `json:"targetFK,omitempty"`
}

type TableDiff struct {
	Name         string       `json:"name"`
	Schema       string       `json:"schema,omitempty"`
	Status       DiffStatus   `json:"status"`
	Columns      []ColumnDiff `json:"columns"`
	Indexes      []IndexDiff  `json:"indexes"`
	ForeignKeys  []FKDiff     `json:"foreignKeys"`
	MigrationSQL []string     `json:"migrationSql"`
	SQL          string       `json:"sql,omitempty"`
}

type SchemaDiffResult struct {
	SourceSchema   string      `json:"sourceSchema"`
	TargetSchema   string      `json:"targetSchema"`
	SourceDialect  string      `json:"sourceDialect,omitempty"`
	TargetDialect  string      `json:"targetDialect"`
	TotalTables    int         `json:"totalTables"`
	AddedCount     int         `json:"addedCount"`
	RemovedCount   int         `json:"removedCount"`
	ModifiedCount  int         `json:"modifiedCount"`
	IdenticalCount int         `json:"identicalCount"`
	Tables         []TableDiff `json:"tables"`
	MigrationSQL   []string    `json:"migrationSql"`
	SQL            string      `json:"sql"`
}

func QuoteIdent(name string, dialect string) string {
	d := alter.NormalizeDialect(dialect)
	switch d {
	case "mysql":
		return "`" + strings.ReplaceAll(name, "`", "``") + "`"
	default: // postgres, sqlite
		return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
	}
}

func QuoteTableRef(schema, table, dialect string) string {
	d := alter.NormalizeDialect(dialect)
	schema = strings.TrimSpace(schema)
	table = strings.TrimSpace(table)
	if d == "sqlite" || schema == "" || schema == "main" {
		return QuoteIdent(table, d)
	}
	return QuoteIdent(schema, d) + "." + QuoteIdent(table, d)
}

func normalizeType(t1, t2 string) string {
	t := strings.TrimSpace(t1)
	if t == "" {
		t = strings.TrimSpace(t2)
	}
	return strings.ToLower(t)
}

func typesEquivalent(t1, t2 string) bool {
	if strings.EqualFold(t1, t2) {
		return true
	}
	stripParams := func(s string) string {
		s = strings.ToLower(strings.TrimSpace(s))
		if idx := strings.Index(s, "("); idx != -1 {
			return strings.TrimSpace(s[:idx])
		}
		return s
	}
	b1 := stripParams(t1)
	b2 := stripParams(t2)

	synonyms := map[string]string{
		"int":                         "integer",
		"int4":                        "integer",
		"int8":                        "bigint",
		"int2":                        "smallint",
		"bool":                        "boolean",
		"character varying":           "varchar",
		"timestamp without time zone": "timestamp",
		"timestamp with time zone":    "timestamptz",
		"double precision":            "float8",
		"float":                       "real",
		"text":                        "text",
	}
	s1 := b1
	if syn, ok := synonyms[b1]; ok {
		s1 = syn
	}
	s2 := b2
	if syn, ok := synonyms[b2]; ok {
		s2 = syn
	}
	if s1 == s2 {
		if strings.Contains(t1, "(") && strings.Contains(t2, "(") {
			return strings.EqualFold(t1, t2)
		}
		return true
	}
	return false
}

func defaultsEqual(d1, d2 *string) bool {
	if d1 == nil && d2 == nil {
		return true
	}
	if d1 == nil || d2 == nil {
		if d1 != nil && strings.TrimSpace(*d1) == "" {
			return true
		}
		if d2 != nil && strings.TrimSpace(*d2) == "" {
			return true
		}
		return false
	}
	v1 := strings.TrimSpace(*d1)
	v2 := strings.TrimSpace(*d2)
	if strings.EqualFold(v1, v2) {
		return true
	}
	clean := func(s string) string {
		s = strings.TrimSpace(s)
		s = strings.TrimPrefix(s, "(")
		s = strings.TrimSuffix(s, ")")
		if idx := strings.Index(s, "::"); idx != -1 {
			s = s[:idx]
		}
		s = strings.Trim(s, "'\"")
		return strings.ToLower(s)
	}
	return clean(v1) == clean(v2)
}

func formatDefaultVal(d *string) string {
	if d == nil {
		return "NULL"
	}
	return *d
}

// CompareTables compares a source and target TableDetail, producing a TableDiff targeting targetDialect.
func CompareTables(source, target *types.TableDetail, targetDialect string) TableDiff {
	targetDialect = alter.NormalizeDialect(targetDialect)

	// Case 1: Both nil
	if source == nil && target == nil {
		return TableDiff{
			Status: DiffIdentical,
		}
	}

	// Case 2: Target is nil -> Table is ADDED in source
	if target == nil {
		diff := TableDiff{
			Name:   source.Name,
			Schema: source.Schema,
			Status: DiffAdded,
		}
		for _, col := range source.Columns {
			c := col
			diff.Columns = append(diff.Columns, ColumnDiff{
				Name:           c.Name,
				Status:         DiffAdded,
				SourceType:     c.Type,
				SourceNullable: &c.IsNullable,
				SourceDefault:  c.Default,
				SourcePrimary:  c.IsPrimary,
			})
		}
		for _, idx := range source.Indexes {
			i := idx
			diff.Indexes = append(diff.Indexes, IndexDiff{
				Name:        i.Name,
				Status:      DiffAdded,
				Columns:     i.Columns,
				IsUnique:    i.IsUnique,
				Type:        i.Type,
				SourceIndex: &i,
			})
		}
		for _, fk := range source.FKs {
			f := fk
			diff.ForeignKeys = append(diff.ForeignKeys, FKDiff{
				Name:      f.Name,
				Status:    DiffAdded,
				Column:    f.Column,
				RefTable:  f.RefTable,
				RefColumn: f.RefColumn,
				OnUpdate:  f.OnUpdate,
				OnDelete:  f.OnDelete,
				SourceFK:  &f,
			})
		}
		stmts, sql, err := GenerateCreateTableSQL(source, targetDialect, source.Schema)
		if err != nil {
			diff.SQL = fmt.Sprintf("-- %s: %s", source.Name, err.Error())
			diff.MigrationSQL = []string{diff.SQL}
			return diff
		}
		diff.MigrationSQL = stmts
		diff.SQL = sql
		return diff
	}

	// Case 3: Source is nil -> Table is REMOVED in source (exists in target)
	if source == nil {
		diff := TableDiff{
			Name:   target.Name,
			Schema: target.Schema,
			Status: DiffRemoved,
		}
		for _, col := range target.Columns {
			c := col
			diff.Columns = append(diff.Columns, ColumnDiff{
				Name:           c.Name,
				Status:         DiffRemoved,
				TargetType:     c.Type,
				TargetNullable: &c.IsNullable,
				TargetDefault:  c.Default,
				TargetPrimary:  c.IsPrimary,
			})
		}
		for _, idx := range target.Indexes {
			i := idx
			diff.Indexes = append(diff.Indexes, IndexDiff{
				Name:        i.Name,
				Status:      DiffRemoved,
				Columns:     i.Columns,
				IsUnique:    i.IsUnique,
				Type:        i.Type,
				TargetIndex: &i,
			})
		}
		for _, fk := range target.FKs {
			f := fk
			diff.ForeignKeys = append(diff.ForeignKeys, FKDiff{
				Name:      f.Name,
				Status:    DiffRemoved,
				Column:    f.Column,
				RefTable:  f.RefTable,
				RefColumn: f.RefColumn,
				OnUpdate:  f.OnUpdate,
				OnDelete:  f.OnDelete,
				TargetFK:  &f,
			})
		}
		dropStmt := GenerateDropTableSQL(target.Name, target.Schema, targetDialect)
		diff.MigrationSQL = []string{dropStmt}
		diff.SQL = dropStmt
		return diff
	}

	// Case 4: Both exist -> Compare columns, indexes, FKs
	diff := TableDiff{
		Name:   target.Name,
		Schema: target.Schema,
		Status: DiffIdentical,
	}

	var alterReq types.AlterTableRequest
	alterReq.Table = target.Name
	alterReq.Schema = target.Schema

	// Index target columns by lowercase name
	targetColMap := make(map[string]types.ColumnMeta, len(target.Columns))
	for _, c := range target.Columns {
		targetColMap[strings.ToLower(strings.TrimSpace(c.Name))] = c
	}

	sourceColMap := make(map[string]types.ColumnMeta, len(source.Columns))
	for _, c := range source.Columns {
		sourceColMap[strings.ToLower(strings.TrimSpace(c.Name))] = c
	}

	// 1. Check source columns against target (Added & Modified)
	hasChanges := false
	for _, srcCol := range source.Columns {
		srcKey := strings.ToLower(strings.TrimSpace(srcCol.Name))
		tgtCol, exists := targetColMap[srcKey]
		if !exists {
			hasChanges = true
			c := srcCol
			diff.Columns = append(diff.Columns, ColumnDiff{
				Name:           srcCol.Name,
				Status:         DiffAdded,
				SourceType:     srcCol.Type,
				SourceNullable: &c.IsNullable,
				SourceDefault:  c.Default,
				SourcePrimary:  c.IsPrimary,
			})
			alterReq.AddedColumns = append(alterReq.AddedColumns, srcCol)
			continue
		}

		// Check for modifications
		var changes []string
		srcType := normalizeType(srcCol.Type, srcCol.DataType)
		tgtType := normalizeType(tgtCol.Type, tgtCol.DataType)
		if !typesEquivalent(srcType, tgtType) {
			changes = append(changes, fmt.Sprintf("type: %s -> %s", tgtCol.Type, srcCol.Type))
		}
		if srcCol.IsNullable != tgtCol.IsNullable {
			changes = append(changes, fmt.Sprintf("nullable: %v -> %v", tgtCol.IsNullable, srcCol.IsNullable))
		}
		if !defaultsEqual(srcCol.Default, tgtCol.Default) {
			changes = append(changes, fmt.Sprintf("default: %s -> %s", formatDefaultVal(tgtCol.Default), formatDefaultVal(srcCol.Default)))
		}
		if srcCol.IsPrimary != tgtCol.IsPrimary {
			changes = append(changes, fmt.Sprintf("primary: %v -> %v", tgtCol.IsPrimary, srcCol.IsPrimary))
		}

		sNull := srcCol.IsNullable
		tNull := tgtCol.IsNullable

		if len(changes) > 0 {
			hasChanges = true
			diff.Columns = append(diff.Columns, ColumnDiff{
				Name:           srcCol.Name,
				Status:         DiffModified,
				SourceType:     srcCol.Type,
				TargetType:     tgtCol.Type,
				SourceNullable: &sNull,
				TargetNullable: &tNull,
				SourceDefault:  srcCol.Default,
				TargetDefault:  tgtCol.Default,
				SourcePrimary:  srcCol.IsPrimary,
				TargetPrimary:  tgtCol.IsPrimary,
				Changes:        changes,
			})
			alterReq.AlteredColumns = append(alterReq.AlteredColumns, types.AlterColumnSpec{
				Name:     srcCol.Name,
				Type:     srcCol.Type,
				DataType: srcCol.DataType,
				Nullable: &sNull,
				Default:  srcCol.Default,
			})
		} else {
			diff.Columns = append(diff.Columns, ColumnDiff{
				Name:           srcCol.Name,
				Status:         DiffIdentical,
				SourceType:     srcCol.Type,
				TargetType:     tgtCol.Type,
				SourceNullable: &sNull,
				TargetNullable: &tNull,
				SourceDefault:  srcCol.Default,
				TargetDefault:  tgtCol.Default,
				SourcePrimary:  srcCol.IsPrimary,
				TargetPrimary:  tgtCol.IsPrimary,
			})
		}
	}

	// 2. Check target columns missing in source (Removed)
	for _, tgtCol := range target.Columns {
		tgtKey := strings.ToLower(strings.TrimSpace(tgtCol.Name))
		if _, exists := sourceColMap[tgtKey]; !exists {
			hasChanges = true
			t := tgtCol
			diff.Columns = append(diff.Columns, ColumnDiff{
				Name:           tgtCol.Name,
				Status:         DiffRemoved,
				TargetType:     tgtCol.Type,
				TargetNullable: &t.IsNullable,
				TargetDefault:  t.Default,
				TargetPrimary:  t.IsPrimary,
			})
			alterReq.DroppedColumns = append(alterReq.DroppedColumns, tgtCol.Name)
		}
	}

	// 3. Indexes comparison
	targetIdxMap := make(map[string]types.IndexMeta, len(target.Indexes))
	for _, idx := range target.Indexes {
		targetIdxMap[strings.ToLower(strings.TrimSpace(idx.Name))] = idx
	}
	sourceIdxMap := make(map[string]types.IndexMeta, len(source.Indexes))
	for _, idx := range source.Indexes {
		sourceIdxMap[strings.ToLower(strings.TrimSpace(idx.Name))] = idx
	}

	for _, sIdx := range source.Indexes {
		if sIdx.IsPrimary {
			continue // Primary key index handled via column constraints
		}
		key := strings.ToLower(strings.TrimSpace(sIdx.Name))
		tIdx, exists := targetIdxMap[key]
		if !exists {
			hasChanges = true
			si := sIdx
			diff.Indexes = append(diff.Indexes, IndexDiff{
				Name:        sIdx.Name,
				Status:      DiffAdded,
				Columns:     sIdx.Columns,
				IsUnique:    sIdx.IsUnique,
				Type:        sIdx.Type,
				SourceIndex: &si,
			})
			alterReq.AddedIndexes = append(alterReq.AddedIndexes, sIdx)
		} else {
			si := sIdx
			ti := tIdx
			diff.Indexes = append(diff.Indexes, IndexDiff{
				Name:        sIdx.Name,
				Status:      DiffIdentical,
				Columns:     sIdx.Columns,
				IsUnique:    sIdx.IsUnique,
				Type:        sIdx.Type,
				SourceIndex: &si,
				TargetIndex: &ti,
			})
		}
	}

	for _, tIdx := range target.Indexes {
		if tIdx.IsPrimary {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(tIdx.Name))
		if _, exists := sourceIdxMap[key]; !exists {
			hasChanges = true
			ti := tIdx
			diff.Indexes = append(diff.Indexes, IndexDiff{
				Name:        tIdx.Name,
				Status:      DiffRemoved,
				Columns:     tIdx.Columns,
				IsUnique:    tIdx.IsUnique,
				Type:        tIdx.Type,
				TargetIndex: &ti,
			})
			alterReq.DroppedIndexes = append(alterReq.DroppedIndexes, tIdx.Name)
		}
	}

	// 4. Foreign Keys comparison
	fkKey := func(fk types.ForeignKey) string {
		return strings.ToLower(fmt.Sprintf("%s->%s(%s)", fk.Column, fk.RefTable, fk.RefColumn))
	}

	targetFKMap := make(map[string]types.ForeignKey, len(target.FKs))
	for _, fk := range target.FKs {
		targetFKMap[fkKey(fk)] = fk
	}
	sourceFKMap := make(map[string]types.ForeignKey, len(source.FKs))
	for _, fk := range source.FKs {
		sourceFKMap[fkKey(fk)] = fk
	}

	for _, sFK := range source.FKs {
		key := fkKey(sFK)
		tFK, exists := targetFKMap[key]
		if !exists {
			hasChanges = true
			sf := sFK
			diff.ForeignKeys = append(diff.ForeignKeys, FKDiff{
				Name:      sFK.Name,
				Status:    DiffAdded,
				Column:    sFK.Column,
				RefTable:  sFK.RefTable,
				RefColumn: sFK.RefColumn,
				OnUpdate:  sFK.OnUpdate,
				OnDelete:  sFK.OnDelete,
				SourceFK:  &sf,
			})
			alterReq.AddedForeignKeys = append(alterReq.AddedForeignKeys, sFK)
		} else {
			sf := sFK
			tf := tFK
			diff.ForeignKeys = append(diff.ForeignKeys, FKDiff{
				Name:      sFK.Name,
				Status:    DiffIdentical,
				Column:    sFK.Column,
				RefTable:  sFK.RefTable,
				RefColumn: sFK.RefColumn,
				OnUpdate:  sFK.OnUpdate,
				OnDelete:  sFK.OnDelete,
				SourceFK:  &sf,
				TargetFK:  &tf,
			})
		}
	}

	for _, tFK := range target.FKs {
		key := fkKey(tFK)
		if _, exists := sourceFKMap[key]; !exists {
			hasChanges = true
			tf := tFK
			diff.ForeignKeys = append(diff.ForeignKeys, FKDiff{
				Name:      tFK.Name,
				Status:    DiffRemoved,
				Column:    tFK.Column,
				RefTable:  tFK.RefTable,
				RefColumn: tFK.RefColumn,
				OnUpdate:  tFK.OnUpdate,
				OnDelete:  tFK.OnDelete,
				TargetFK:  &tf,
			})
			dropName := tFK.Name
			if dropName == "" {
				dropName = tFK.Column
			}
			alterReq.DroppedForeignKeys = append(alterReq.DroppedForeignKeys, dropName)
		}
	}

	if hasChanges {
		diff.Status = DiffModified

		// Validate added/modified columns and foreign keys across all dialects
		for _, col := range alterReq.AddedColumns {
			cType := strings.TrimSpace(col.Type)
			if cType == "" {
				cType = strings.TrimSpace(col.DataType)
			}
			if cType == "" {
				cType = "TEXT"
			}
			if err := alter.ValidateDataType(cType); err != nil {
				errMsg := fmt.Sprintf("-- %s: %s", target.Name, err.Error())
				diff.SQL = errMsg
				diff.MigrationSQL = []string{errMsg}
				return diff
			}
			if col.Default != nil && strings.TrimSpace(*col.Default) != "" {
				if _, err := alter.FormatDefaultValue(*col.Default); err != nil {
					errMsg := fmt.Sprintf("-- %s: %s", target.Name, err.Error())
					diff.SQL = errMsg
					diff.MigrationSQL = []string{errMsg}
					return diff
				}
			}
		}

		for _, alt := range alterReq.AlteredColumns {
			if cType := strings.TrimSpace(alt.Type); cType != "" {
				if err := alter.ValidateDataType(cType); err != nil {
					errMsg := fmt.Sprintf("-- %s: %s", target.Name, err.Error())
					diff.SQL = errMsg
					diff.MigrationSQL = []string{errMsg}
					return diff
				}
			}
			if alt.Default != nil && strings.TrimSpace(*alt.Default) != "" {
				if _, err := alter.FormatDefaultValue(*alt.Default); err != nil {
					errMsg := fmt.Sprintf("-- %s: %s", target.Name, err.Error())
					diff.SQL = errMsg
					diff.MigrationSQL = []string{errMsg}
					return diff
				}
			}
		}

		for _, fk := range alterReq.AddedForeignKeys {
			if _, err := alter.ValidateFKAction(fk.OnUpdate); err != nil {
				errMsg := fmt.Sprintf("-- %s: %s", target.Name, err.Error())
				diff.SQL = errMsg
				diff.MigrationSQL = []string{errMsg}
				return diff
			}
			if _, err := alter.ValidateFKAction(fk.OnDelete); err != nil {
				errMsg := fmt.Sprintf("-- %s: %s", target.Name, err.Error())
				diff.SQL = errMsg
				diff.MigrationSQL = []string{errMsg}
				return diff
			}
		}

		stmts, combined, err := alter.GenerateAlterDDL(targetDialect, alterReq)
		if err != nil && targetDialect == "sqlite" {
			stmts, combined = generateSQLiteTableRecreation(target, source)
		} else if err != nil {
			combined = fmt.Sprintf("-- %s: %s", target.Name, err.Error())
			stmts = []string{combined}
		}
		diff.MigrationSQL = stmts
		diff.SQL = combined
	}

	return diff
}

// generateSQLiteTableRecreation produces table copy statements when SQLite ALTER is limited.
func generateSQLiteTableRecreation(target, source *types.TableDetail) ([]string, string) {
	origTbl := QuoteIdent(target.Name, "sqlite")
	tmpName := target.Name + "_dblens_tmp"
	tmpTbl := QuoteIdent(tmpName, "sqlite")

	tempDetail := *source
	tempDetail.Name = tmpName

	createStmts, _, err := GenerateCreateTableSQL(&tempDetail, "sqlite", "")
	if err != nil {
		errComment := fmt.Sprintf("-- %s: %s", target.Name, err.Error())
		return []string{errComment}, errComment
	}
	var stmts []string
	stmts = append(stmts, createStmts...)

	// Common columns between old target and new source
	sourceColNames := make(map[string]bool)
	for _, c := range source.Columns {
		sourceColNames[strings.ToLower(c.Name)] = true
	}

	var commonCols []string
	for _, c := range target.Columns {
		if sourceColNames[strings.ToLower(c.Name)] {
			commonCols = append(commonCols, QuoteIdent(c.Name, "sqlite"))
		}
	}

	if len(commonCols) > 0 {
		colList := strings.Join(commonCols, ", ")
		stmts = append(stmts, fmt.Sprintf("INSERT INTO %s (%s) SELECT %s FROM %s;", tmpTbl, colList, colList, origTbl))
	}
	stmts = append(stmts, fmt.Sprintf("DROP TABLE %s;", origTbl))
	stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s RENAME TO %s;", tmpTbl, origTbl))

	combined := strings.Join(stmts, "\n\n")
	return stmts, combined
}

// GenerateCreateTableSQL produces DDL to create a table and its indexes targeting dialect.
func GenerateCreateTableSQL(detail *types.TableDetail, dialect string, targetSchema string) ([]string, string, error) {
	normDialect := alter.NormalizeDialect(dialect)
	tbl := QuoteTableRef(targetSchema, detail.Name, normDialect)

	var lines []string
	var pkCols []string
	for _, col := range detail.Columns {
		colName := QuoteIdent(col.Name, normDialect)
		colType := col.Type
		if colType == "" {
			colType = col.DataType
		}
		if colType == "" {
			colType = "TEXT"
		}
		if err := alter.ValidateDataType(colType); err != nil {
			return nil, "", fmt.Errorf("invalid data type for column %q: %w", col.Name, err)
		}
		line := fmt.Sprintf("  %s %s", colName, colType)
		if col.Default != nil && strings.TrimSpace(*col.Default) != "" {
			formattedDef, err := alter.FormatDefaultValue(*col.Default)
			if err != nil {
				return nil, "", fmt.Errorf("invalid default value for column %q: %w", col.Name, err)
			}
			if formattedDef != "" {
				line += " DEFAULT " + formattedDef
			}
		}
		if !col.IsNullable {
			line += " NOT NULL"
		}
		if col.IsPrimary {
			pkCols = append(pkCols, QuoteIdent(col.Name, normDialect))
		}
		lines = append(lines, line)
	}

	if len(pkCols) > 0 {
		lines = append(lines, fmt.Sprintf("  PRIMARY KEY (%s)", strings.Join(pkCols, ", ")))
	}

	for _, fk := range detail.FKs {
		if fk.Column != "" && fk.RefTable != "" && fk.RefColumn != "" {
			onDelete, err := alter.ValidateFKAction(fk.OnDelete)
			if err != nil {
				return nil, "", fmt.Errorf("invalid foreign key ON DELETE action %q: %w", fk.OnDelete, err)
			}
			onUpdate, err := alter.ValidateFKAction(fk.OnUpdate)
			if err != nil {
				return nil, "", fmt.Errorf("invalid foreign key ON UPDATE action %q: %w", fk.OnUpdate, err)
			}
			fkLine := fmt.Sprintf("  FOREIGN KEY (%s) REFERENCES %s (%s)",
				QuoteIdent(fk.Column, normDialect),
				QuoteTableRef(targetSchema, fk.RefTable, normDialect),
				QuoteIdent(fk.RefColumn, normDialect),
			)
			if onDelete != "" {
				fkLine += " ON DELETE " + onDelete
			}
			if onUpdate != "" {
				fkLine += " ON UPDATE " + onUpdate
			}
			lines = append(lines, fkLine)
		}
	}

	createStmt := fmt.Sprintf("CREATE TABLE %s (\n%s\n);", tbl, strings.Join(lines, ",\n"))
	stmts := []string{createStmt}

	for _, idx := range detail.Indexes {
		if idx.IsPrimary || len(idx.Columns) == 0 {
			continue
		}
		idxName := idx.Name
		if idxName == "" {
			idxName = fmt.Sprintf("idx_%s_%s", detail.Name, strings.Join(idx.Columns, "_"))
		}
		uniq := ""
		if idx.IsUnique {
			uniq = "UNIQUE "
		}
		quotedCols := make([]string, len(idx.Columns))
		for i, c := range idx.Columns {
			quotedCols[i] = QuoteIdent(c, normDialect)
		}
		var idxStmt string
		if normDialect == "mysql" {
			idxStmt = fmt.Sprintf("CREATE %sINDEX %s ON %s (%s);",
				uniq,
				QuoteIdent(idxName, normDialect),
				tbl,
				strings.Join(quotedCols, ", "),
			)
		} else {
			idxStmt = fmt.Sprintf("CREATE %sINDEX IF NOT EXISTS %s ON %s (%s);",
				uniq,
				QuoteIdent(idxName, normDialect),
				tbl,
				strings.Join(quotedCols, ", "),
			)
		}
		stmts = append(stmts, idxStmt)
	}

	combined := strings.Join(stmts, "\n\n")
	return stmts, combined, nil
}

// GenerateDropTableSQL produces a DROP TABLE statement targeting dialect.
func GenerateDropTableSQL(name string, schema string, dialect string) string {
	normDialect := alter.NormalizeDialect(dialect)
	tbl := QuoteTableRef(schema, name, normDialect)
	if normDialect == "postgres" {
		return fmt.Sprintf("DROP TABLE IF EXISTS %s CASCADE;", tbl)
	}
	return fmt.Sprintf("DROP TABLE IF EXISTS %s;", tbl)
}

// CompareSchemas compares two maps of TableDetails and returns a complete SchemaDiffResult.
func CompareSchemas(sourceTables, targetTables map[string]*types.TableDetail, targetDialect string, sourceSchema, targetSchema string) SchemaDiffResult {
	targetDialect = alter.NormalizeDialect(targetDialect)

	allTableNames := make(map[string]bool)
	for name := range sourceTables {
		allTableNames[name] = true
	}
	for name := range targetTables {
		allTableNames[name] = true
	}

	sortedNames := make([]string, 0, len(allTableNames))
	for name := range allTableNames {
		sortedNames = append(sortedNames, name)
	}
	sort.Strings(sortedNames)

	result := SchemaDiffResult{
		SourceSchema:  sourceSchema,
		TargetSchema:  targetSchema,
		TargetDialect: targetDialect,
		TotalTables:   len(sortedNames),
		Tables:        make([]TableDiff, 0, len(sortedNames)),
	}

	var addedStmts []string
	var modifiedStmts []string
	var droppedStmts []string

	for _, name := range sortedNames {
		srcTable := sourceTables[name]
		tgtTable := targetTables[name]

		tableDiff := CompareTables(srcTable, tgtTable, targetDialect)
		tableDiff.Name = name

		switch tableDiff.Status {
		case DiffAdded:
			result.AddedCount++
			addedStmts = append(addedStmts, tableDiff.MigrationSQL...)
		case DiffRemoved:
			result.RemovedCount++
			droppedStmts = append(droppedStmts, tableDiff.MigrationSQL...)
		case DiffModified:
			result.ModifiedCount++
			modifiedStmts = append(modifiedStmts, tableDiff.MigrationSQL...)
		case DiffIdentical:
			result.IdenticalCount++
		}

		result.Tables = append(result.Tables, tableDiff)
	}

	// Execution order: Added tables first, then Modified tables, then Dropped tables
	var allStmts []string
	allStmts = append(allStmts, addedStmts...)
	allStmts = append(allStmts, modifiedStmts...)
	allStmts = append(allStmts, droppedStmts...)

	result.MigrationSQL = allStmts
	if len(allStmts) > 0 {
		result.SQL = strings.Join(allStmts, "\n\n")
	}

	return result
}

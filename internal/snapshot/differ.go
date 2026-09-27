package snapshot

import (
	"fmt"
	"sort"
	"strings"
)

// Diff calculates structural schema differences between base and target snapshots.
func Diff(base, target *SchemaSnapshot) *SnapshotDiff {
	diff := &SnapshotDiff{
		AddedTables:   []TableNode{},
		DroppedTables: []TableNode{},
		AlteredTables: []TableDrift{},
	}

	if base != nil {
		diff.BaseSnapshotID = base.ID
		diff.BaseLabel = base.Label
		diff.Dialect = base.Dialect
	}
	if target != nil {
		diff.TargetSnapshotID = target.ID
		diff.TargetLabel = target.Label
		if diff.Dialect == "" {
			diff.Dialect = target.Dialect
		}
	}

	baseTables := collectTables(base)
	targetTables := collectTables(target)

	// Detect added tables
	for key, tgtTbl := range targetTables {
		if _, exists := baseTables[key]; !exists {
			diff.AddedTables = append(diff.AddedTables, tgtTbl)
		}
	}

	// Detect dropped tables
	for key, baseTbl := range baseTables {
		if _, exists := targetTables[key]; !exists {
			diff.DroppedTables = append(diff.DroppedTables, baseTbl)
		}
	}

	// Detect altered tables
	for key, baseTbl := range baseTables {
		tgtTbl, exists := targetTables[key]
		if !exists {
			continue
		}

		drift := diffTable(baseTbl, tgtTbl)
		if drift != nil {
			diff.AlteredTables = append(diff.AlteredTables, *drift)
		}
	}

	// Sort results for deterministic output
	sort.Slice(diff.AddedTables, func(i, j int) bool {
		return diff.AddedTables[i].Name < diff.AddedTables[j].Name
	})
	sort.Slice(diff.DroppedTables, func(i, j int) bool {
		return diff.DroppedTables[i].Name < diff.DroppedTables[j].Name
	})
	sort.Slice(diff.AlteredTables, func(i, j int) bool {
		return diff.AlteredTables[i].TableName < diff.AlteredTables[j].TableName
	})

	// Calculate summary and total drifts
	diff.Summary.AddedTables = len(diff.AddedTables)
	diff.Summary.DroppedTables = len(diff.DroppedTables)
	diff.Summary.AlteredTables = len(diff.AlteredTables)

	total := diff.Summary.AddedTables + diff.Summary.DroppedTables
	for _, at := range diff.AlteredTables {
		diff.Summary.AddedColumns += len(at.AddedColumns)
		diff.Summary.DroppedColumns += len(at.DroppedColumns)
		diff.Summary.AlteredColumns += len(at.AlteredColumns)
		diff.Summary.AddedIndexes += len(at.AddedIndexes)
		diff.Summary.DroppedIndexes += len(at.DroppedIndexes)
		diff.Summary.AddedForeignKeys += len(at.AddedForeignKeys)
		diff.Summary.DroppedForeignKeys += len(at.DroppedForeignKeys)
	}

	total += diff.Summary.AddedColumns + diff.Summary.DroppedColumns + diff.Summary.AlteredColumns
	total += diff.Summary.AddedIndexes + diff.Summary.DroppedIndexes
	total += diff.Summary.AddedForeignKeys + diff.Summary.DroppedForeignKeys

	diff.TotalDrifts = total

	return diff
}

func collectTables(snap *SchemaSnapshot) map[string]TableNode {
	result := make(map[string]TableNode)
	if snap == nil {
		return result
	}
	for _, schema := range snap.Schemas {
		sName := strings.TrimSpace(schema.Name)
		for _, tbl := range schema.Tables {
			key := tableKey(sName, tbl.Name)
			result[key] = tbl
		}
	}
	return result
}

func tableKey(schema, table string) string {
	s := strings.ToLower(strings.TrimSpace(schema))
	t := strings.ToLower(strings.TrimSpace(table))
	if s == "" || s == "public" || s == "main" || s == "default" {
		return t
	}
	return s + "." + t
}

func diffTable(base, target TableNode) *TableDrift {
	drift := &TableDrift{
		TableName:          target.Name,
		Schema:             target.Schema,
		AddedColumns:       []ColumnNode{},
		DroppedColumns:     []ColumnNode{},
		AlteredColumns:     []ColumnDrift{},
		AddedIndexes:       []IndexNode{},
		DroppedIndexes:     []IndexNode{},
		AddedForeignKeys:   []ForeignKeyNode{},
		DroppedForeignKeys: []ForeignKeyNode{},
	}

	// Columns diff
	baseCols := make(map[string]ColumnNode)
	for _, col := range base.Columns {
		baseCols[strings.ToLower(col.Name)] = col
	}

	targetCols := make(map[string]ColumnNode)
	for _, col := range target.Columns {
		targetCols[strings.ToLower(col.Name)] = col
	}

	for _, col := range target.Columns {
		bCol, exists := baseCols[strings.ToLower(col.Name)]
		if !exists {
			drift.AddedColumns = append(drift.AddedColumns, col)
		} else {
			changes := compareColumn(bCol, col)
			if len(changes) > 0 {
				drift.AlteredColumns = append(drift.AlteredColumns, ColumnDrift{
					ColumnName: col.Name,
					OldColumn:  bCol,
					NewColumn:  col,
					Changes:    changes,
				})
			}
		}
	}

	for _, col := range base.Columns {
		if _, exists := targetCols[strings.ToLower(col.Name)]; !exists {
			drift.DroppedColumns = append(drift.DroppedColumns, col)
		}
	}

	// Indexes diff
	baseIdxs := make(map[string]IndexNode)
	for _, idx := range base.Indexes {
		key := indexKey(idx)
		baseIdxs[key] = idx
	}

	targetIdxs := make(map[string]IndexNode)
	for _, idx := range target.Indexes {
		key := indexKey(idx)
		targetIdxs[key] = idx
		if _, exists := baseIdxs[key]; !exists {
			drift.AddedIndexes = append(drift.AddedIndexes, idx)
		}
	}

	for key, idx := range baseIdxs {
		if _, exists := targetIdxs[key]; !exists {
			drift.DroppedIndexes = append(drift.DroppedIndexes, idx)
		}
	}

	// Foreign keys diff
	baseFKs := make(map[string]ForeignKeyNode)
	for _, fk := range base.ForeignKeys {
		key := fkKey(fk)
		baseFKs[key] = fk
	}

	targetFKs := make(map[string]ForeignKeyNode)
	for _, fk := range target.ForeignKeys {
		key := fkKey(fk)
		targetFKs[key] = fk
		if _, exists := baseFKs[key]; !exists {
			drift.AddedForeignKeys = append(drift.AddedForeignKeys, fk)
		}
	}

	for key, fk := range baseFKs {
		if _, exists := targetFKs[key]; !exists {
			drift.DroppedForeignKeys = append(drift.DroppedForeignKeys, fk)
		}
	}

	if len(drift.AddedColumns) == 0 &&
		len(drift.DroppedColumns) == 0 &&
		len(drift.AlteredColumns) == 0 &&
		len(drift.AddedIndexes) == 0 &&
		len(drift.DroppedIndexes) == 0 &&
		len(drift.AddedForeignKeys) == 0 &&
		len(drift.DroppedForeignKeys) == 0 {
		return nil
	}

	return drift
}

func compareColumn(oldCol, newCol ColumnNode) []string {
	var changes []string

	oldType := normalizeType(oldCol.Type)
	newType := normalizeType(newCol.Type)
	if oldType != newType {
		changes = append(changes, fmt.Sprintf("type changed from %s to %s", oldCol.Type, newCol.Type))
	}

	if oldCol.IsNullable != newCol.IsNullable {
		if newCol.IsNullable {
			changes = append(changes, "became nullable")
		} else {
			changes = append(changes, "became NOT NULL")
		}
	}

	oldDef := derefStr(oldCol.DefaultValue)
	newDef := derefStr(newCol.DefaultValue)
	if oldDef != newDef {
		if oldDef == "" {
			changes = append(changes, fmt.Sprintf("default set to %s", newDef))
		} else if newDef == "" {
			changes = append(changes, "default dropped")
		} else {
			changes = append(changes, fmt.Sprintf("default changed from %s to %s", oldDef, newDef))
		}
	}

	return changes
}

func normalizeType(t string) string {
	return strings.ToLower(strings.TrimSpace(t))
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return strings.TrimSpace(*s)
}

func indexKey(idx IndexNode) string {
	cols := make([]string, len(idx.Columns))
	for i, c := range idx.Columns {
		cols[i] = strings.ToLower(strings.TrimSpace(c))
	}
	return fmt.Sprintf("%s(%s)", strings.ToLower(idx.Name), strings.Join(cols, ","))
}

func fkKey(fk ForeignKeyNode) string {
	return fmt.Sprintf("%s->%s.%s", strings.ToLower(fk.Column), strings.ToLower(fk.RefTable), strings.ToLower(fk.RefColumn))
}

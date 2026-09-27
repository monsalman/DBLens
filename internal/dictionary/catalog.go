package dictionary

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/annotations"
	"github.com/dblens/dblens/internal/driver/types"
	"github.com/dblens/dblens/internal/masker"
)

// AnnotationsProvider abstracts annotation lookup for table and column notes.
type AnnotationsProvider interface {
	ListByTarget(connID, schema, table string) []*annotations.Annotation
}

func isNilAnnStore(a AnnotationsProvider) bool {
	if a == nil {
		return true
	}
	if s, ok := a.(*annotations.Store); ok && s == nil {
		return true
	}
	return false
}

// ExtractCatalog inspects schemas, tables, columns, constraints, storage statistics,
// and documentation comments across PostgreSQL, MySQL, and SQLite.
func ExtractCatalog(
	ctx context.Context,
	drv types.Driver,
	connID string,
	targetSchema string,
	annStore AnnotationsProvider,
) (*DataDictionary, error) {
	if drv == nil {
		return nil, fmt.Errorf("database driver is required")
	}

	dialect := strings.ToLower(drv.Dialect())
	dict := &DataDictionary{
		ConnectionID: connID,
		Dialect:      dialect,
		GeneratedAt:  time.Now().UTC(),
		Schemas:      []DictionarySchema{},
	}

	schemas, err := drv.InspectSchemas(ctx)
	if err != nil || len(schemas) == 0 {
		switch dialect {
		case "postgres":
			schemas = []string{"public"}
		case "mysql":
			schemas = []string{"default"}
		default:
			schemas = []string{"main"}
		}
	}

	if targetSchema != "" {
		filtered := make([]string, 0, 1)
		for _, s := range schemas {
			if strings.EqualFold(s, targetSchema) {
				filtered = append(filtered, s)
				break
			}
		}
		if len(filtered) > 0 {
			schemas = filtered
		}
	}

	for _, sName := range schemas {
		schemaObj, err := extractSchemaCatalog(ctx, drv, connID, sName, dialect, annStore)
		if err != nil {
			// If a schema fails to inspect (e.g. permission error), keep processing other schemas
			continue
		}
		if len(schemaObj.Tables) > 0 || targetSchema != "" {
			dict.Schemas = append(dict.Schemas, *schemaObj)
		}
	}

	dict.Summary = computeSummary(dict.Schemas)
	return dict, nil
}

func extractSchemaCatalog(
	ctx context.Context,
	drv types.Driver,
	connID string,
	schemaName string,
	dialect string,
	annStore AnnotationsProvider,
) (*DictionarySchema, error) {
	tables, err := drv.InspectTables(ctx, schemaName)
	if err != nil {
		return nil, err
	}

	schema := &DictionarySchema{
		Name:   schemaName,
		Tables: make([]DictionaryTable, 0, len(tables)),
	}

	// Fetch native comments & stats maps
	tableComments := make(map[string]string)
	tableRows := make(map[string]int64)
	tableSizes := make(map[string]int64)
	colComments := make(map[string]string) // key: "table.column"

	switch dialect {
	case "postgres":
		fetchPostgresCatalog(ctx, drv, schemaName, tableComments, tableRows, tableSizes, colComments)
	case "mysql":
		fetchMySQLCatalog(ctx, drv, schemaName, tableComments, tableRows, tableSizes, colComments)
	}

	// Fetch annotations store fallbacks if available
	annMap := make(map[string]string)
	if !isNilAnnStore(annStore) {
		allNotes := annStore.ListByTarget(connID, schemaName, "")
		for _, note := range allNotes {
			if note.Column == "" {
				annMap[note.Table] = note.Note
			} else {
				annMap[note.Table+"."+note.Column] = note.Note
			}
		}
	}

	totalCols := 0

	for _, t := range tables {
		details, err := drv.InspectTableDetails(ctx, schemaName, t.Name)
		if err != nil {
			continue
		}

		tableComment := tableComments[t.Name]
		if tableComment == "" {
			tableComment = annMap[t.Name]
		}

		rowCount := tableRows[t.Name]
		sizeBytes := tableSizes[t.Name]

		// For SQLite row count fallback if 0
		if dialect == "sqlite" && rowCount == 0 && t.Type != "view" {
			countCtx, cancel := context.WithTimeout(ctx, 1*time.Second)
			query := fmt.Sprintf(`SELECT COUNT(*) FROM %q`, t.Name)
			res, err := drv.ExecuteRaw(countCtx, query)
			cancel()
			if err == nil && len(res.Rows) > 0 && len(res.Rows[0]) > 0 {
				if n, ok := toInt64(res.Rows[0][0]); ok {
					rowCount = n
				}
			}
		}

		dictTable := DictionaryTable{
			Name:          t.Name,
			Schema:        schemaName,
			Type:          t.Type,
			Comment:       tableComment,
			RowCount:      rowCount,
			SizeBytes:     sizeBytes,
			SizeFormatted: FormatBytes(sizeBytes),
			Columns:       make([]DictionaryColumn, 0, len(details.Columns)),
			Indexes:       make([]DictionaryIndex, 0, len(details.Indexes)),
			ForeignKeys:   make([]DictionaryForeignKey, 0, len(details.FKs)),
		}
		if dictTable.Type == "" {
			dictTable.Type = "table"
		}

		piiCount := 0
		for idx, col := range details.Columns {
			cComment := colComments[t.Name+"."+col.Name]
			if cComment == "" {
				cComment = annMap[t.Name+"."+col.Name]
			}

			piiType := masker.DetectPIIType(col.Name, "")
			if piiType != "" {
				piiCount++
			}

			dictCol := DictionaryColumn{
				Name:         col.Name,
				Type:         col.Type,
				DataType:     col.DataType,
				IsNullable:   col.IsNullable,
				IsPrimary:    col.IsPrimary,
				IsForeignKey: col.IsForeignKey,
				Default:      col.Default,
				Comment:      cComment,
				PIIType:      piiType,
				Ordinal:      idx + 1,
			}
			dictTable.Columns = append(dictTable.Columns, dictCol)
		}
		dictTable.PIICount = piiCount
		totalCols += len(dictTable.Columns)

		for _, idxMeta := range details.Indexes {
			dictTable.Indexes = append(dictTable.Indexes, DictionaryIndex{
				Name:      idxMeta.Name,
				Columns:   idxMeta.Columns,
				IsUnique:  idxMeta.IsUnique,
				IsPrimary: idxMeta.IsPrimary,
				Type:      idxMeta.Type,
			})
		}

		for _, fk := range details.FKs {
			dictTable.ForeignKeys = append(dictTable.ForeignKeys, DictionaryForeignKey{
				Name:      fk.Name,
				Column:    fk.Column,
				RefTable:  fk.RefTable,
				RefColumn: fk.RefColumn,
				OnUpdate:  fk.OnUpdate,
				OnDelete:  fk.OnDelete,
			})
		}

		schema.Tables = append(schema.Tables, dictTable)
	}

	schema.TableCount = len(schema.Tables)
	schema.ColumnCount = totalCols
	return schema, nil
}

func fetchPostgresCatalog(
	ctx context.Context,
	drv types.Driver,
	schema string,
	tableComments map[string]string,
	tableRows map[string]int64,
	tableSizes map[string]int64,
	colComments map[string]string,
) {
	// Table comments & stats
	tableQuery := `
		SELECT c.relname,
		       COALESCE(pg_catalog.obj_description(c.oid, 'pg_class'), '') AS description,
		       COALESCE(c.reltuples::bigint, 0) AS row_estimate,
		       COALESCE(pg_total_relation_size(c.oid), 0) AS size_bytes
		FROM pg_catalog.pg_class c
		JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1 AND c.relkind IN ('r', 'v', 'm', 'p');
	`
	if res, err := drv.ExecuteRaw(ctx, tableQuery, schema); err == nil && res != nil {
		for _, row := range res.Rows {
			if len(row) >= 4 {
				name := fmt.Sprintf("%v", row[0])
				comment := fmt.Sprintf("%v", row[1])
				if comment != "<nil>" {
					tableComments[name] = comment
				}
				if r, ok := toInt64(row[2]); ok && r >= 0 {
					tableRows[name] = r
				}
				if s, ok := toInt64(row[3]); ok && s >= 0 {
					tableSizes[name] = s
				}
			}
		}
	}

	// Column comments
	colQuery := `
		SELECT c.relname, a.attname,
		       COALESCE(pg_catalog.col_description(c.oid, a.attnum), '') AS col_comment
		FROM pg_catalog.pg_class c
		JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
		WHERE n.nspname = $1 AND a.attnum > 0 AND NOT a.attisdropped;
	`
	if res, err := drv.ExecuteRaw(ctx, colQuery, schema); err == nil && res != nil {
		for _, row := range res.Rows {
			if len(row) >= 3 {
				tName := fmt.Sprintf("%v", row[0])
				cName := fmt.Sprintf("%v", row[1])
				comment := fmt.Sprintf("%v", row[2])
				if comment != "<nil>" && comment != "" {
					colComments[tName+"."+cName] = comment
				}
			}
		}
	}
}

func fetchMySQLCatalog(
	ctx context.Context,
	drv types.Driver,
	schema string,
	tableComments map[string]string,
	tableRows map[string]int64,
	tableSizes map[string]int64,
	colComments map[string]string,
) {
	// Table comments & stats
	tableQuery := `
		SELECT TABLE_NAME,
		       COALESCE(TABLE_COMMENT, ''),
		       COALESCE(TABLE_ROWS, 0),
		       COALESCE(DATA_LENGTH + INDEX_LENGTH, 0)
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = ?;
	`
	if res, err := drv.ExecuteRaw(ctx, tableQuery, schema); err == nil && res != nil {
		for _, row := range res.Rows {
			if len(row) >= 4 {
				name := fmt.Sprintf("%v", row[0])
				comment := fmt.Sprintf("%v", row[1])
				if comment != "<nil>" {
					tableComments[name] = comment
				}
				if r, ok := toInt64(row[2]); ok && r >= 0 {
					tableRows[name] = r
				}
				if s, ok := toInt64(row[3]); ok && s >= 0 {
					tableSizes[name] = s
				}
			}
		}
	}

	// Column comments
	colQuery := `
		SELECT TABLE_NAME, COLUMN_NAME,
		       COALESCE(COLUMN_COMMENT, '')
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = ?;
	`
	if res, err := drv.ExecuteRaw(ctx, colQuery, schema); err == nil && res != nil {
		for _, row := range res.Rows {
			if len(row) >= 3 {
				tName := fmt.Sprintf("%v", row[0])
				cName := fmt.Sprintf("%v", row[1])
				comment := fmt.Sprintf("%v", row[2])
				if comment != "<nil>" && comment != "" {
					colComments[tName+"."+cName] = comment
				}
			}
		}
	}
}

func computeSummary(schemas []DictionarySchema) DictionarySummary {
	var summary DictionarySummary
	summary.TotalSchemas = len(schemas)

	for _, s := range schemas {
		for _, t := range s.Tables {
			if strings.EqualFold(t.Type, "view") {
				summary.TotalViews++
			} else {
				summary.TotalTables++
			}
			summary.TotalIndexes += len(t.Indexes)
			summary.TotalForeignKeys += len(t.ForeignKeys)

			for _, c := range t.Columns {
				summary.TotalColumns++
				if c.PIIType != "" {
					summary.TotalPIIColumns++
				}
				if strings.TrimSpace(c.Comment) != "" {
					summary.DocumentedColumns++
				}
			}
		}
	}

	if summary.TotalColumns > 0 {
		pct := (float64(summary.DocumentedColumns) / float64(summary.TotalColumns)) * 100.0
		summary.DocumentationCoverage = math.Round(pct*10) / 10
	}

	return summary
}

// FormatBytes formats byte counts to human-readable strings (B, KB, MB, GB).
func FormatBytes(b int64) string {
	if b <= 0 {
		return "0 B"
	}
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	units := []string{"KB", "MB", "GB", "TB"}
	if exp >= len(units) {
		exp = len(units) - 1
	}
	return fmt.Sprintf("%.1f %s", float64(b)/float64(div), units[exp])
}

func toInt64(val interface{}) (int64, bool) {
	switch v := val.(type) {
	case int64:
		return v, true
	case int:
		return int64(v), true
	case int32:
		return int64(v), true
	case float64:
		return int64(v), true
	case []byte:
		var n int64
		if _, err := fmt.Sscanf(string(v), "%d", &n); err == nil {
			return n, true
		}
	case string:
		var n int64
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil {
			return n, true
		}
	}
	return 0, false
}

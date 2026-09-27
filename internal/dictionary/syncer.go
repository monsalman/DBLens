package dictionary

import (
	"context"
	"fmt"
	"strings"

	"github.com/dblens/dblens/internal/annotations"
	"github.com/dblens/dblens/internal/driver/types"
)

// SyncComment executes native DDL to update comments on PostgreSQL and MySQL,
// or persists documentation notes into the annotations store for SQLite and local docs.
func SyncComment(
	ctx context.Context,
	drv types.Driver,
	connID string,
	req CommentUpdateRequest,
	annStore *annotations.Store,
) error {
	req.Table = strings.TrimSpace(req.Table)
	req.Schema = strings.TrimSpace(req.Schema)
	req.Column = strings.TrimSpace(req.Column)
	req.Comment = strings.TrimSpace(req.Comment)

	if req.Table == "" {
		return fmt.Errorf("table name is required")
	}

	var dialect string
	if drv != nil {
		dialect = strings.ToLower(drv.Dialect())
	}

	// 1. If SyncToDB requested and driver available, execute native DDL
	if req.SyncToDB && drv != nil {
		switch dialect {
		case "postgres":
			if err := syncPostgresComment(ctx, drv, req); err != nil {
				return err
			}
		case "mysql":
			if err := syncMySQLComment(ctx, drv, req); err != nil {
				return err
			}
		case "sqlite":
			// SQLite does not support native COMMENT ON / COMMENT syntax in DDL.
			// Handled via annotations store below.
		}
	}

	// 2. Persist in annotations store (for SQLite, or when SyncToDB is false, or as collaborative store mirror)
	if annStore != nil {
		persistInAnnotationStore(annStore, connID, req)
	}

	return nil
}

func syncPostgresComment(ctx context.Context, drv types.Driver, req CommentUpdateRequest) error {
	schema := req.Schema
	if schema == "" {
		schema = "public"
	}

	escaped := strings.ReplaceAll(req.Comment, "'", "''")
	var ddl string

	if req.Column == "" {
		if req.Comment == "" {
			ddl = fmt.Sprintf(`COMMENT ON TABLE %q.%q IS NULL;`, schema, req.Table)
		} else {
			ddl = fmt.Sprintf(`COMMENT ON TABLE %q.%q IS '%s';`, schema, req.Table, escaped)
		}
	} else {
		if req.Comment == "" {
			ddl = fmt.Sprintf(`COMMENT ON COLUMN %q.%q.%q IS NULL;`, schema, req.Table, req.Column)
		} else {
			ddl = fmt.Sprintf(`COMMENT ON COLUMN %q.%q.%q IS '%s';`, schema, req.Table, req.Column, escaped)
		}
	}

	_, err := drv.ExecuteRaw(ctx, ddl)
	if err != nil {
		return fmt.Errorf("failed to sync comment to PostgreSQL: %w", err)
	}
	return nil
}

func escapeMySQLString(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	return strings.ReplaceAll(s, "'", "''")
}

func quoteMySQLIdent(s string) string {
	return "`" + strings.ReplaceAll(s, "`", "``") + "`"
}

func syncMySQLComment(ctx context.Context, drv types.Driver, req CommentUpdateRequest) error {
	escaped := escapeMySQLString(req.Comment)

	tableRef := quoteMySQLIdent(req.Table)
	if req.Schema != "" {
		tableRef = fmt.Sprintf("%s.%s", quoteMySQLIdent(req.Schema), quoteMySQLIdent(req.Table))
	}

	if req.Column == "" {
		ddl := fmt.Sprintf("ALTER TABLE %s COMMENT = '%s';", tableRef, escaped)
		_, err := drv.ExecuteRaw(ctx, ddl)
		if err != nil {
			return fmt.Errorf("failed to sync table comment to MySQL: %w", err)
		}
		return nil
	}

	// For column comments in MySQL, ALTER TABLE ... MODIFY COLUMN requires full column definition
	details, err := drv.InspectTableDetails(ctx, req.Schema, req.Table)
	if err != nil {
		return fmt.Errorf("failed to inspect MySQL table details: %w", err)
	}

	var targetCol *types.ColumnMeta
	for _, c := range details.Columns {
		if strings.EqualFold(c.Name, req.Column) {
			targetCol = &c
			break
		}
	}
	if targetCol == nil {
		return fmt.Errorf("column %q not found in table %q", req.Column, req.Table)
	}

	colType := targetCol.Type
	if colType == "" {
		colType = targetCol.DataType
	}
	if colType == "" {
		colType = "VARCHAR(255)"
	}

	nullability := "NULL"
	if !targetCol.IsNullable {
		nullability = "NOT NULL"
	}

	defClause := ""
	if targetCol.Default != nil && *targetCol.Default != "" {
		defClause = " DEFAULT " + *targetCol.Default
	}

	ddl := fmt.Sprintf("ALTER TABLE %s MODIFY COLUMN %s %s %s%s COMMENT '%s';",
		tableRef, quoteMySQLIdent(targetCol.Name), colType, nullability, defClause, escaped)

	_, err = drv.ExecuteRaw(ctx, ddl)
	if err != nil {
		return fmt.Errorf("failed to sync column comment to MySQL: %w", err)
	}
	return nil
}

func persistInAnnotationStore(store *annotations.Store, connID string, req CommentUpdateRequest) {
	existingNotes := store.ListByTarget(connID, req.Schema, req.Table)

	var found *annotations.Annotation
	for _, a := range existingNotes {
		if req.Column == "" {
			if a.TargetType == annotations.TargetTable && a.Column == "" {
				found = a
				break
			}
		} else {
			if a.TargetType == annotations.TargetColumn && a.Column == req.Column {
				found = a
				break
			}
		}
	}

	if found != nil {
		if req.Comment == "" {
			_ = store.Delete(found.ID)
		} else {
			_, _ = store.Update(found.ID, &annotations.UpdatePatch{
				Note: req.Comment,
			})
		}
	} else if req.Comment != "" {
		targetType := annotations.TargetTable
		if req.Column != "" {
			targetType = annotations.TargetColumn
		}
		_ = store.Create(&annotations.Annotation{
			TargetType:   targetType,
			ConnectionID: connID,
			Schema:       req.Schema,
			Table:        req.Table,
			Column:       req.Column,
			Note:         req.Comment,
			Author:       "Data Dictionary",
		})
	}
}

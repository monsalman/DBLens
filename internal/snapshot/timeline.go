package snapshot

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/alter"
	"github.com/dblens/dblens/internal/driver/types"
	"github.com/dblens/dblens/internal/routine"
)

// CaptureSnapshot inspects the live database connection and builds an immutable SchemaSnapshot.
func CaptureSnapshot(
	ctx context.Context,
	drv types.Driver,
	connID string,
	label string,
	tag string,
	description string,
	targetSchema string,
) (*SchemaSnapshot, error) {
	if drv == nil {
		return nil, fmt.Errorf("database driver is required")
	}

	dialect := alter.NormalizeDialect(drv.Dialect())
	now := time.Now().UTC()

	if strings.TrimSpace(label) == "" {
		label = fmt.Sprintf("Snapshot %s", now.Format("2006-01-02 15:04:05"))
	}
	tag = strings.TrimSpace(strings.ToLower(tag))
	if tag == "" {
		tag = "manual"
	}

	snap := &SchemaSnapshot{
		ID:          fmt.Sprintf("snap_%d", now.UnixNano()),
		ConnID:      connID,
		Label:       label,
		Description: strings.TrimSpace(description),
		Dialect:     dialect,
		CreatedAt:   now,
		Tag:         tag,
		Schemas:     []SchemaNode{},
		Metadata: SnapshotMetadata{
			Environment: "default",
			Tags:        []string{tag},
		},
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

	sort.Strings(schemas)

	totalTables := 0
	totalViews := 0
	totalRoutines := 0

	for _, sName := range schemas {
		schemaNode := SchemaNode{
			Name:     sName,
			Tables:   []TableNode{},
			Views:    []TableNode{},
			Routines: []RoutineNode{},
		}

		// Inspect tables and views
		tblMetas, err := drv.InspectTables(ctx, sName)
		if err == nil {
			for _, tm := range tblMetas {
				tNode := TableNode{
					Name:        tm.Name,
					Schema:      sName,
					Type:        tm.Type,
					Columns:     []ColumnNode{},
					Indexes:     []IndexNode{},
					ForeignKeys: []ForeignKeyNode{},
					Triggers:    []TriggerNode{},
				}
				if tNode.Type == "" {
					tNode.Type = "table"
				}

				detail, err := drv.InspectTableDetails(ctx, sName, tm.Name)
				if err == nil && detail != nil {
					for _, col := range detail.Columns {
						tNode.Columns = append(tNode.Columns, ColumnNode{
							Name:         col.Name,
							Type:         col.Type,
							DataType:     col.DataType,
							IsNullable:   col.IsNullable,
							IsPrimary:    col.IsPrimary,
							DefaultValue: col.Default,
						})
					}
					for _, idx := range detail.Indexes {
						tNode.Indexes = append(tNode.Indexes, IndexNode{
							Name:      idx.Name,
							Columns:   idx.Columns,
							IsUnique:  idx.IsUnique,
							IsPrimary: idx.IsPrimary,
							Type:      idx.Type,
						})
					}
					for _, fk := range detail.FKs {
						tNode.ForeignKeys = append(tNode.ForeignKeys, ForeignKeyNode{
							Name:      fk.Name,
							Column:    fk.Column,
							RefTable:  fk.RefTable,
							RefColumn: fk.RefColumn,
							OnUpdate:  fk.OnUpdate,
							OnDelete:  fk.OnDelete,
						})
					}
				}

				if ddl, err := drv.GenerateTableDDL(ctx, sName, tm.Name); err == nil {
					tNode.DDL = ddl
				}

				// Sort table components deterministically
				sort.Slice(tNode.Columns, func(i, j int) bool {
					return tNode.Columns[i].Name < tNode.Columns[j].Name
				})
				sort.Slice(tNode.Indexes, func(i, j int) bool {
					return tNode.Indexes[i].Name < tNode.Indexes[j].Name
				})
				sort.Slice(tNode.ForeignKeys, func(i, j int) bool {
					return tNode.ForeignKeys[i].Column < tNode.ForeignKeys[j].Column
				})

				tNode.Checksum = computeTableChecksum(tNode)

				if strings.EqualFold(tNode.Type, "view") {
					schemaNode.Views = append(schemaNode.Views, tNode)
					totalViews++
				} else {
					schemaNode.Tables = append(schemaNode.Tables, tNode)
					totalTables++
				}
			}
		}

		// Try inspecting triggers if supported
		if trigItems, err := routine.InspectTriggers(ctx, drv, sName, ""); err == nil {
			trigMap := make(map[string][]TriggerNode)
			for _, ti := range trigItems {
				tn := TriggerNode{
					Name:       ti.Name,
					Table:      ti.TableName,
					Events:     []string{ti.Event},
					Timing:     ti.Timing,
					Definition: ti.Statement,
				}
				trigMap[ti.TableName] = append(trigMap[ti.TableName], tn)
			}
			for i := range schemaNode.Tables {
				tName := schemaNode.Tables[i].Name
				if trigs, ok := trigMap[tName]; ok {
					schemaNode.Tables[i].Triggers = trigs
				}
			}
		}

		// Try inspecting routines
		if rItems, err := routine.InspectRoutines(ctx, drv, sName); err == nil {
			for _, ri := range rItems {
				schemaNode.Routines = append(schemaNode.Routines, RoutineNode{
					Name:       ri.Name,
					Schema:     ri.Schema,
					Type:       strings.ToLower(ri.RoutineType),
					ReturnType: ri.ReturnType,
					Definition: ri.Definition,
				})
				totalRoutines++
			}
		}

		sort.Slice(schemaNode.Tables, func(i, j int) bool {
			return schemaNode.Tables[i].Name < schemaNode.Tables[j].Name
		})
		sort.Slice(schemaNode.Views, func(i, j int) bool {
			return schemaNode.Views[i].Name < schemaNode.Views[j].Name
		})
		sort.Slice(schemaNode.Routines, func(i, j int) bool {
			return schemaNode.Routines[i].Name < schemaNode.Routines[j].Name
		})

		snap.Schemas = append(snap.Schemas, schemaNode)
	}

	snap.TablesCount = totalTables
	snap.ViewsCount = totalViews
	snap.RoutinesCount = totalRoutines
	snap.Checksum = ComputeChecksum(snap)

	return snap, nil
}

func computeTableChecksum(t TableNode) string {
	h := sha256.New()
	fmt.Fprintf(h, "table:%s:%s\n", t.Schema, t.Name)
	for _, col := range t.Columns {
		defVal := ""
		if col.DefaultValue != nil {
			defVal = *col.DefaultValue
		}
		fmt.Fprintf(h, "col:%s:%s:%t:%t:%s\n", col.Name, col.Type, col.IsNullable, col.IsPrimary, defVal)
	}
	for _, idx := range t.Indexes {
		fmt.Fprintf(h, "idx:%s:%t:%s\n", idx.Name, idx.IsUnique, strings.Join(idx.Columns, ","))
	}
	for _, fk := range t.ForeignKeys {
		fmt.Fprintf(h, "fk:%s:%s:%s:%s\n", fk.Column, fk.RefTable, fk.RefColumn, fk.OnDelete)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// ComputeChecksum computes a deterministic SHA256 fingerprint for the entire snapshot schema.
func ComputeChecksum(snap *SchemaSnapshot) string {
	if snap == nil {
		return ""
	}

	h := sha256.New()
	fmt.Fprintf(h, "dialect:%s\n", snap.Dialect)

	for _, s := range snap.Schemas {
		fmt.Fprintf(h, "schema:%s\n", s.Name)
		for _, t := range s.Tables {
			fmt.Fprintf(h, "tbl:%s:%s\n", t.Name, t.Checksum)
		}
		for _, v := range s.Views {
			fmt.Fprintf(h, "view:%s:%s\n", v.Name, v.Checksum)
		}
		for _, r := range s.Routines {
			fmt.Fprintf(h, "routine:%s:%s:%s\n", r.Name, r.Type, r.ReturnType)
		}
	}

	return hex.EncodeToString(h.Sum(nil))
}

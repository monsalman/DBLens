package seeder

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
)

// SeederOptions specifies parameters for constructing a seed plan.
type SeederOptions struct {
	Schema           string                            `json:"schema"`
	Tables           []string                          `json:"tables"`
	RowCount         map[string]int                    `json:"rowCount,omitempty"`
	DefaultRowCount  int                               `json:"defaultRowCount,omitempty"`
	Seed             int64                             `json:"seed,omitempty"`
	CustomGenerators map[string]map[string]GeneratorConfig `json:"customGenerators,omitempty"` // table -> col -> cfg
	BatchSize        int                               `json:"batchSize,omitempty"`
	Cascade          bool                              `json:"cascade,omitempty"`
}

// ColumnPlan describes how a single column will be generated.
type ColumnPlan struct {
	Name         string          `json:"name"`
	DataType     string          `json:"dataType"`
	IsPrimary    bool            `json:"isPrimary"`
	IsForeignKey bool            `json:"isForeignKey"`
	RefTable     string          `json:"refTable,omitempty"`
	RefColumn    string          `json:"refColumn,omitempty"`
	Generator    GeneratorType   `json:"generator"`
	Config       GeneratorConfig `json:"config"`
}

// TableSeedPlan describes the seeding configuration and preview for a single table.
type TableSeedPlan struct {
	Table        string                   `json:"table"`
	RowCount     int                      `json:"rowCount"`
	Level        int                      `json:"level"`
	PKColumn     string                   `json:"pkColumn,omitempty"`
	Dependencies []string                 `json:"dependencies"`
	Columns      []ColumnPlan             `json:"columns"`
	SampleRows   []map[string]interface{} `json:"sampleRows"`
	SelfFKs      []types.ForeignKey       `json:"selfFks,omitempty"`
	DeferredFKs  []types.ForeignKey       `json:"deferredFks,omitempty"`
}

// SeedPlan contains the full DAG execution plan across all targeted tables.
type SeedPlan struct {
	Seed           int64              `json:"seed"`
	Schema         string             `json:"schema"`
	Tables         []TableSeedPlan    `json:"tables"`
	DAGOrder       []string           `json:"dagOrder"`
	CyclesDetected bool               `json:"cyclesDetected"`
	CycleEdges     []types.ForeignKey `json:"cycleEdges,omitempty"`
	TotalRows      int                `json:"totalRows"`
}

// SeedProgress reports real-time execution statistics during a seed run.
type SeedProgress struct {
	Table         string  `json:"table"`
	RowsInserted  int     `json:"rowsInserted"`
	TotalRows     int     `json:"totalRows"`
	Percentage    float64 `json:"percentage"`
	RowsPerSec    float64 `json:"rowsPerSec"`
	Status        string  `json:"status"` // "planning", "seeding", "updating_fks", "completed", "failed"
	Error         string  `json:"error,omitempty"`
}

// SeedResult summarizes completed execution.
type SeedResult struct {
	TotalInserted  int64          `json:"totalInserted"`
	TablesInserted map[string]int `json:"tablesInserted"`
	DurationMs     int64          `json:"durationMs"`
	Errors         []string       `json:"errors,omitempty"`
}

// BuildPlan introspects schema metadata, computes DAG execution order, infers generator
// mappings, and generates 3-row preview samples per table.
func BuildPlan(ctx context.Context, drv types.Driver, opts SeederOptions) (*SeedPlan, error) {
	if opts.DefaultRowCount <= 0 {
		opts.DefaultRowCount = 20
	}
	if opts.Seed == 0 {
		opts.Seed = time.Now().UnixNano()
	}
	if opts.BatchSize <= 0 {
		opts.BatchSize = 500
	}

	selectedTables := opts.Tables
	if len(selectedTables) == 0 {
		tableMetas, err := drv.InspectTables(ctx, opts.Schema)
		if err != nil {
			return nil, fmt.Errorf("failed to inspect tables: %w", err)
		}
		for _, tm := range tableMetas {
			if tm.Type == "table" || tm.Type == "" {
				selectedTables = append(selectedTables, tm.Name)
			}
		}
	}

	// Introspect table details and foreign keys
	tableDetails := make(map[string]*types.TableDetail, len(selectedTables))
	var allFKs []types.ForeignKey

	for _, tbl := range selectedTables {
		td, err := drv.InspectTableDetails(ctx, opts.Schema, tbl)
		if err != nil {
			return nil, fmt.Errorf("failed to inspect table details for %s: %w", tbl, err)
		}
		for i := range td.FKs {
			if td.FKs[i].Table == "" {
				td.FKs[i].Table = tbl
			}
		}
		tableDetails[tbl] = td
		allFKs = append(allFKs, td.FKs...)
	}

	// Handle Cascade: include unselected parent tables referenced by selected tables
	if opts.Cascade {
		tableSet := make(map[string]bool, len(selectedTables))
		for _, t := range selectedTables {
			tableSet[t] = true
		}
		changed := true
		for changed {
			changed = false
			for _, fk := range allFKs {
				if tableSet[fk.Table] && fk.RefTable != "" && !tableSet[fk.RefTable] {
					td, err := drv.InspectTableDetails(ctx, opts.Schema, fk.RefTable)
					if err == nil && td != nil {
						for i := range td.FKs {
							if td.FKs[i].Table == "" {
								td.FKs[i].Table = fk.RefTable
							}
						}
						tableSet[fk.RefTable] = true
						selectedTables = append(selectedTables, fk.RefTable)
						tableDetails[fk.RefTable] = td
						allFKs = append(allFKs, td.FKs...)
						changed = true
					}
				}
			}
		}
	}

	// Build DAG
	dag := BuildDAG(selectedTables, allFKs)

	// Build map of table orders
	orderMap := make(map[string]TableOrder, len(dag.SortedTables))
	for _, to := range dag.SortedTables {
		orderMap[to.Table] = to
	}

	// Preview generator & key pool
	previewGen := NewDataGenerator(opts.Seed)
	previewPool := NewKeyPool()

	var tablePlans []TableSeedPlan
	totalRows := 0

	for _, tbl := range dag.DAGOrder {
		td := tableDetails[tbl]
		to := orderMap[tbl]

		// Row count
		rc := opts.DefaultRowCount
		if custom, ok := opts.RowCount[tbl]; ok && custom > 0 {
			rc = custom
		}
		totalRows += rc

		// Build column plans
		var colPlans []ColumnPlan
		var pkCol string

		// FK lookup map by column name
		fkMap := make(map[string]types.ForeignKey)
		for _, fk := range td.FKs {
			fkMap[fk.Column] = fk
		}

		for _, col := range td.Columns {
			if col.IsPrimary && pkCol == "" {
				pkCol = col.Name
			}

			if _, isFK := fkMap[col.Name]; isFK {
				col.IsForeignKey = true
			}

			cfg := InferGenerator(col)
			if customTable, ok := opts.CustomGenerators[tbl]; ok {
				if customCol, ok := customTable[col.Name]; ok {
					cfg = customCol
				}
			}

			cp := ColumnPlan{
				Name:         col.Name,
				DataType:     col.DataType,
				IsPrimary:    col.IsPrimary,
				IsForeignKey: col.IsForeignKey,
				Generator:    cfg.Type,
				Config:       cfg,
			}

			if fk, ok := fkMap[col.Name]; ok {
				cp.IsForeignKey = true
				cp.RefTable = fk.RefTable
				cp.RefColumn = fk.RefColumn
				if _, hasCustom := opts.CustomGenerators[tbl][col.Name]; !hasCustom {
					cp.Generator = GenFK
					cp.Config.Type = GenFK
				}
			}

			colPlans = append(colPlans, cp)
		}

		// Generate 3 sample preview rows
		sampleRows := generatePreviewRows(tbl, colPlans, pkCol, to.SelfFKs, to.DeferredFKs, previewGen, previewPool)

		tp := TableSeedPlan{
			Table:        tbl,
			RowCount:     rc,
			Level:        to.Level,
			PKColumn:     pkCol,
			Dependencies: to.Dependencies,
			Columns:      colPlans,
			SampleRows:   sampleRows,
			SelfFKs:      to.SelfFKs,
			DeferredFKs:  to.DeferredFKs,
		}
		tablePlans = append(tablePlans, tp)
	}

	return &SeedPlan{
		Seed:           opts.Seed,
		Schema:         opts.Schema,
		Tables:         tablePlans,
		DAGOrder:       dag.DAGOrder,
		CyclesDetected: dag.CyclesDetected,
		CycleEdges:     dag.CycleEdges,
		TotalRows:      totalRows,
	}, nil
}

func generatePreviewRows(
	table string,
	cols []ColumnPlan,
	pkCol string,
	selfFKs, deferredFKs []types.ForeignKey,
	gen *DataGenerator,
	pool *KeyPool,
) []map[string]interface{} {
	const sampleCount = 3
	rows := make([]map[string]interface{}, sampleCount)

	selfFKCols := make(map[string]bool)
	for _, fk := range selfFKs {
		selfFKCols[fk.Column] = true
	}
	for _, fk := range deferredFKs {
		selfFKCols[fk.Column] = true
	}

	var generatedPKs []interface{}

	for r := 0; r < sampleCount; r++ {
		row := make(map[string]interface{}, len(cols))
		for _, c := range cols {
			if selfFKCols[c.Name] {
				// Pass 1: nil for self/deferred FK
				row[c.Name] = nil
				continue
			}

			if c.IsForeignKey || c.Generator == GenFK {
				if val, ok := pool.SampleSequential(c.RefTable, c.RefColumn, r); ok {
					row[c.Name] = val
				} else {
					row[c.Name] = r + 1 // realistic fallback ID
				}
				continue
			}

			val := gen.GenerateValue(c.Config)
			row[c.Name] = val
			if c.Name == pkCol {
				generatedPKs = append(generatedPKs, val)
			}
		}
		rows[r] = row
	}

	if pkCol != "" {
		pool.AddKeys(table, pkCol, generatedPKs)
	}

	// Pass 2 preview for self FKs
	for r := 0; r < sampleCount; r++ {
		for _, c := range cols {
			if selfFKCols[c.Name] {
				if val, ok := pool.SampleSequential(table, pkCol, r); ok {
					rows[r][c.Name] = val
				} else {
					rows[r][c.Name] = 1
				}
			}
		}
	}

	return rows
}

// Run executes the seed plan against the database with progress reporting.
func Run(ctx context.Context, drv types.Driver, plan *SeedPlan, progressCb func(SeedProgress)) (*SeedResult, error) {
	startTime := time.Now()
	gen := NewDataGenerator(plan.Seed)
	pool := NewKeyPool()

	planMap := make(map[string]TableSeedPlan, len(plan.Tables))
	for _, tp := range plan.Tables {
		planMap[tp.Table] = tp
	}

	tablesInserted := make(map[string]int)
	var totalInserted int64
	var errors []string

	totalRowsToSeed := plan.TotalRows
	currentProcessed := 0

	emitProgress := func(tbl string, status string, errStr string) {
		if progressCb == nil {
			return
		}
		elapsedSec := time.Since(startTime).Seconds()
		rowsPerSec := 0.0
		if elapsedSec > 0 {
			rowsPerSec = float64(totalInserted) / elapsedSec
		}
		pct := 0.0
		if totalRowsToSeed > 0 {
			pct = (float64(currentProcessed) / float64(totalRowsToSeed)) * 100.0
		}
		if pct > 100.0 {
			pct = 100.0
		}
		progressCb(SeedProgress{
			Table:        tbl,
			RowsInserted: int(totalInserted),
			TotalRows:    totalRowsToSeed,
			Percentage:   pct,
			RowsPerSec:   rowsPerSec,
			Status:       status,
			Error:        errStr,
		})
	}

	emitProgress("", "planning", "")

	// 1. First-pass insertion for each table in DAG order
	type deferredTask struct {
		table    string
		pkCol    string
		updates  []DeferredUpdate
	}
	var deferredTasks []deferredTask

	for _, tbl := range plan.DAGOrder {
		tp, ok := planMap[tbl]
		if !ok || tp.RowCount <= 0 {
			continue
		}

		emitProgress(tbl, "seeding", "")

		selfFKCols := make(map[string]bool)
		for _, fk := range tp.SelfFKs {
			selfFKCols[fk.Column] = true
		}
		for _, fk := range tp.DeferredFKs {
			selfFKCols[fk.Column] = true
		}

		// Generate rows
		rows := make([]map[string]interface{}, tp.RowCount)
		var generatedPKs []interface{}
		var tableUpdates []DeferredUpdate

		for r := 0; r < tp.RowCount; r++ {
			row := make(map[string]interface{}, len(tp.Columns))
			var rowPK interface{}

			for _, c := range tp.Columns {
				if selfFKCols[c.Name] {
					row[c.Name] = nil
					continue
				}

				if c.IsForeignKey || c.Generator == GenFK {
					if val, ok := pool.Sample(c.RefTable, c.RefColumn, gen.rng); ok {
						row[c.Name] = val
					} else {
						// Attempt loading from DB if parent pool empty
						_ = pool.LoadExistingKeys(ctx, drv, plan.Schema, c.RefTable, c.RefColumn, 50)
						if val, ok := pool.Sample(c.RefTable, c.RefColumn, gen.rng); ok {
							row[c.Name] = val
						} else {
							row[c.Name] = 1
						}
					}
					continue
				}

				val := gen.GenerateValue(c.Config)
				row[c.Name] = val
				if c.Name == tp.PKColumn {
					rowPK = val
					generatedPKs = append(generatedPKs, val)
				}
			}
			rows[r] = row

			// Prepare deferred update for this row
			for _, fk := range append(tp.SelfFKs, tp.DeferredFKs...) {
				tableUpdates = append(tableUpdates, DeferredUpdate{
					PKValue: rowPK,
					FKCol:   fk.Column,
				})
			}
		}

		// Insert batch into DB
		inserted, err := WriteBatch(ctx, drv, plan.Schema, tbl, rows, 500)
		if err != nil {
			errStr := fmt.Sprintf("table %s insert error: %v", tbl, err)
			errors = append(errors, errStr)
			emitProgress(tbl, "failed", errStr)
			return &SeedResult{
				TotalInserted:  totalInserted,
				TablesInserted: tablesInserted,
				DurationMs:     time.Since(startTime).Milliseconds(),
				Errors:         errors,
			}, err
		}

		totalInserted += inserted
		tablesInserted[tbl] = int(inserted)
		currentProcessed += tp.RowCount

		// Record generated PKs into pool for child tables
		if tp.PKColumn != "" {
			pool.AddKeys(tbl, tp.PKColumn, generatedPKs)
		}

		if len(tableUpdates) > 0 && tp.PKColumn != "" {
			deferredTasks = append(deferredTasks, deferredTask{
				table:   tbl,
				pkCol:   tp.PKColumn,
				updates: tableUpdates,
			})
		}
	}

	// 2. Second-pass deferred foreign key updates
	if len(deferredTasks) > 0 {
		emitProgress("", "updating_fks", "")
		for _, task := range deferredTasks {
			for i := range task.updates {
				if val, ok := pool.Sample(task.table, task.pkCol, gen.rng); ok {
					task.updates[i].FKValue = val
				} else {
					task.updates[i].FKValue = task.updates[i].PKValue
				}
			}
			if err := ApplyDeferredUpdates(ctx, drv, plan.Schema, task.table, task.pkCol, task.updates); err != nil {
				errors = append(errors, err.Error())
			}
		}
	}

	emitProgress("", "completed", "")

	return &SeedResult{
		TotalInserted:  totalInserted,
		TablesInserted: tablesInserted,
		DurationMs:     time.Since(startTime).Milliseconds(),
		Errors:         errors,
	}, nil
}

// Export produces standalone SQL or JSON fixture without modifying the database.
func Export(ctx context.Context, drv types.Driver, plan *SeedPlan, format string) ([]byte, error) {
	gen := NewDataGenerator(plan.Seed)
	pool := NewKeyPool()

	planMap := make(map[string]TableSeedPlan, len(plan.Tables))
	for _, tp := range plan.Tables {
		planMap[tp.Table] = tp
	}

	var tableDataList []TableData

	for _, tbl := range plan.DAGOrder {
		tp, ok := planMap[tbl]
		if !ok || tp.RowCount <= 0 {
			continue
		}

		selfFKCols := make(map[string]bool)
		for _, fk := range tp.SelfFKs {
			selfFKCols[fk.Column] = true
		}
		for _, fk := range tp.DeferredFKs {
			selfFKCols[fk.Column] = true
		}

		rows := make([]map[string]interface{}, tp.RowCount)
		var generatedPKs []interface{}
		var deferredUpdates []DeferredUpdate

		for r := 0; r < tp.RowCount; r++ {
			row := make(map[string]interface{}, len(tp.Columns))
			var rowPK interface{}

			for _, c := range tp.Columns {
				if selfFKCols[c.Name] {
					row[c.Name] = nil
					continue
				}

				if c.IsForeignKey || c.Generator == GenFK {
					if val, ok := pool.Sample(c.RefTable, c.RefColumn, gen.rng); ok {
						row[c.Name] = val
					} else {
						row[c.Name] = 1
					}
					continue
				}

				val := gen.GenerateValue(c.Config)
				row[c.Name] = val
				if c.Name == tp.PKColumn {
					rowPK = val
					generatedPKs = append(generatedPKs, val)
				}
			}
			rows[r] = row

			for _, fk := range append(tp.SelfFKs, tp.DeferredFKs...) {
				deferredUpdates = append(deferredUpdates, DeferredUpdate{
					PKValue: rowPK,
					FKCol:   fk.Column,
				})
			}
		}

		if tp.PKColumn != "" {
			pool.AddKeys(tbl, tp.PKColumn, generatedPKs)
		}

		// Assign sampled values to deferred updates
		for i := range deferredUpdates {
			if val, ok := pool.Sample(tbl, tp.PKColumn, gen.rng); ok {
				deferredUpdates[i].FKValue = val
			} else {
				deferredUpdates[i].FKValue = 1
			}
		}

		tableDataList = append(tableDataList, TableData{
			Table:       tbl,
			Schema:      plan.Schema,
			PKColumn:    tp.PKColumn,
			Rows:        rows,
			DeferredFKs: deferredUpdates,
		})
	}

	if strings.ToLower(format) == "json" {
		return ExportJSON(plan.Seed, tableDataList)
	}

	dialect := "sqlite"
	if drv != nil {
		dialect = drv.Dialect()
	}
	sqlScript, err := ExportSQL(dialect, plan.Schema, tableDataList)
	if err != nil {
		return nil, err
	}
	return []byte(sqlScript), nil
}

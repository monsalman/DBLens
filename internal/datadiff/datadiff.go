package datadiff

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/alter"
	"github.com/dblens/dblens/internal/driver/types"
)

type RowStatus string

const (
	StatusAdded     RowStatus = "added"
	StatusDeleted   RowStatus = "deleted"
	StatusModified  RowStatus = "modified"
	StatusIdentical RowStatus = "identical"
)

type SyncConflictStrategy string

const (
	StrategySourceWins        SyncConflictStrategy = "source_wins"
	StrategyTargetWins        SyncConflictStrategy = "target_wins"
	StrategyInsertMissingOnly SyncConflictStrategy = "insert_missing_only"
)

type DataDiffRequest struct {
	SourceConnID string   `json:"sourceConnId"`
	SourceDSN    string   `json:"sourceDsn,omitempty"`
	SourceSchema string   `json:"sourceSchema,omitempty"`
	SourceTable  string   `json:"sourceTable"`
	TargetConnID string   `json:"targetConnId"`
	TargetDSN    string   `json:"targetDsn,omitempty"`
	TargetSchema string   `json:"targetSchema,omitempty"`
	TargetTable  string   `json:"targetTable"`
	Columns      []string `json:"columns,omitempty"`
	PrimaryKeys  []string `json:"primaryKeys,omitempty"`
	WhereClause  string   `json:"whereClause,omitempty"`
	PageSize     int      `json:"pageSize,omitempty"`
	Offset       int      `json:"offset,omitempty"`
	FilterStatus string   `json:"filterStatus,omitempty"` // "all", "added", "deleted", "modified", "identical"
}

type RowDiffItem struct {
	PKValues       map[string]any `json:"pkValues"`
	Status         RowStatus      `json:"status"`
	SourceValues   map[string]any `json:"sourceValues,omitempty"`
	TargetValues   map[string]any `json:"targetValues,omitempty"`
	ChangedColumns []string       `json:"changedColumns,omitempty"`
	SourceHash     string         `json:"sourceHash,omitempty"`
	TargetHash     string         `json:"targetHash,omitempty"`
}

type DataDiffSummary struct {
	TotalSourceRows int   `json:"totalSourceRows"`
	TotalTargetRows int   `json:"totalTargetRows"`
	AddedCount      int   `json:"addedCount"`
	DeletedCount    int   `json:"deletedCount"`
	ModifiedCount   int   `json:"modifiedCount"`
	IdenticalCount  int   `json:"identicalCount"`
	DurationMs      int64 `json:"durationMs"`
}

type DataDiffResult struct {
	SourceTable     string          `json:"sourceTable"`
	TargetTable     string          `json:"targetTable"`
	SourceSchema    string          `json:"sourceSchema,omitempty"`
	TargetSchema    string          `json:"targetSchema,omitempty"`
	PrimaryKeys     []string        `json:"primaryKeys"`
	ComparedColumns []string        `json:"comparedColumns"`
	Summary         DataDiffSummary `json:"summary"`
	Rows            []RowDiffItem   `json:"rows"`
	SourceDialect   string          `json:"sourceDialect,omitempty"`
	TargetDialect   string          `json:"targetDialect,omitempty"`
}

type SyncScriptRequest struct {
	SourceConnID  string               `json:"sourceConnId,omitempty"`
	SourceDSN     string               `json:"sourceDsn,omitempty"`
	SourceSchema  string               `json:"sourceSchema,omitempty"`
	SourceTable   string               `json:"sourceTable,omitempty"`
	TargetConnID  string               `json:"targetConnId,omitempty"`
	TargetDSN     string               `json:"targetDsn,omitempty"`
	TargetSchema  string               `json:"targetSchema,omitempty"`
	TargetTable   string               `json:"targetTable,omitempty"`
	Strategy      SyncConflictStrategy `json:"strategy"`
	PrimaryKeys   []string             `json:"primaryKeys"`
	Columns       []string             `json:"columns"`
	Rows          []RowDiffItem        `json:"rows"`
	DeleteExcess  bool                 `json:"deleteExcess,omitempty"`
	TargetDialect string               `json:"targetDialect,omitempty"`
}

type SyncScriptResponse struct {
	SQL           string               `json:"sql"`
	Statements    []string             `json:"statements"`
	InsertCount   int                  `json:"insertCount"`
	UpdateCount   int                  `json:"updateCount"`
	DeleteCount   int                  `json:"deleteCount"`
	Strategy      SyncConflictStrategy `json:"strategy"`
	TargetDialect string               `json:"targetDialect"`
}

type ApplySyncRequest struct {
	TargetConnID string   `json:"targetConnId"`
	TargetDSN    string   `json:"targetDsn,omitempty"`
	Statements   []string `json:"statements"`
	SQL          string   `json:"sql,omitempty"`
	ReadOnly     bool     `json:"readOnly,omitempty"`
	Confirmed    bool     `json:"confirmed,omitempty"`
}

type ApplySyncResponse struct {
	Success            bool   `json:"success"`
	StatementsExecuted int    `json:"statementsExecuted"`
	AffectedRows       int64  `json:"affectedRows"`
	DurationMs         int64  `json:"durationMs"`
	Message            string `json:"message"`
}

// CompareData compares source and target tables row by row.
func CompareData(ctx context.Context, req DataDiffRequest, srcDriver, tgtDriver types.Driver) (*DataDiffResult, error) {
	start := time.Now()

	if strings.TrimSpace(req.SourceTable) == "" {
		return nil, fmt.Errorf("sourceTable is required")
	}
	if strings.TrimSpace(req.TargetTable) == "" {
		return nil, fmt.Errorf("targetTable is required")
	}

	if !IsValidIdentifier(req.SourceTable) {
		return nil, fmt.Errorf("invalid sourceTable identifier: %q", req.SourceTable)
	}
	if !IsValidIdentifier(req.TargetTable) {
		return nil, fmt.Errorf("invalid targetTable identifier: %q", req.TargetTable)
	}
	if req.SourceSchema != "" && !IsValidIdentifier(req.SourceSchema) {
		return nil, fmt.Errorf("invalid sourceSchema identifier: %q", req.SourceSchema)
	}
	if req.TargetSchema != "" && !IsValidIdentifier(req.TargetSchema) {
		return nil, fmt.Errorf("invalid targetSchema identifier: %q", req.TargetSchema)
	}

	srcDialect := alter.NormalizeDialect(srcDriver.Dialect())
	tgtDialect := alter.NormalizeDialect(tgtDriver.Dialect())

	// 1. Resolve Primary Keys if omitted
	pks := req.PrimaryKeys
	if len(pks) == 0 {
		if detail, err := srcDriver.InspectTableDetails(ctx, req.SourceSchema, req.SourceTable); err == nil && detail != nil {
			for _, c := range detail.Columns {
				if c.IsPrimary {
					pks = append(pks, c.Name)
				}
			}
		}
	}
	if len(pks) == 0 {
		if detail, err := tgtDriver.InspectTableDetails(ctx, req.TargetSchema, req.TargetTable); err == nil && detail != nil {
			for _, c := range detail.Columns {
				if c.IsPrimary {
					pks = append(pks, c.Name)
				}
			}
		}
	}
	if len(pks) == 0 {
		return nil, fmt.Errorf("table %q has no primary key defined; row-level diff requires at least one primary key", req.SourceTable)
	}

	for _, pk := range pks {
		if !IsValidIdentifier(pk) {
			return nil, fmt.Errorf("invalid primary key identifier: %q", pk)
		}
	}

	// 2. Resolve Columns if omitted
	cols := req.Columns
	if len(cols) == 0 {
		srcCols := getTableColumns(ctx, srcDriver, req.SourceSchema, req.SourceTable)
		tgtCols := getTableColumns(ctx, tgtDriver, req.TargetSchema, req.TargetTable)

		if len(srcCols) > 0 && len(tgtCols) > 0 {
			tgtSet := make(map[string]bool)
			for _, c := range tgtCols {
				tgtSet[strings.ToLower(c)] = true
			}
			for _, c := range srcCols {
				if tgtSet[strings.ToLower(c)] {
					cols = append(cols, c)
				}
			}
		} else if len(srcCols) > 0 {
			cols = srcCols
		} else if len(tgtCols) > 0 {
			cols = tgtCols
		}
	}

	if len(cols) == 0 {
		return nil, fmt.Errorf("could not determine columns to compare for table %q", req.SourceTable)
	}

	// Ensure all PKs are in columns list
	colSet := make(map[string]bool)
	for _, c := range cols {
		if !IsValidIdentifier(c) {
			return nil, fmt.Errorf("invalid column identifier: %q", c)
		}
		colSet[c] = true
	}
	for _, pk := range pks {
		if !colSet[pk] {
			cols = append(cols, pk)
			colSet[pk] = true
		}
	}

	pageSize := req.PageSize
	if pageSize <= 0 {
		pageSize = 500
	}
	if pageSize > 5000 {
		pageSize = 5000
	}
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}

	// 3. Query source and target
	srcRows, err := queryTableRows(ctx, srcDriver, srcDialect, req.SourceSchema, req.SourceTable, cols, pks, req.WhereClause, pageSize, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to query source table: %w", err)
	}

	tgtRows, err := queryTableRows(ctx, tgtDriver, tgtDialect, req.TargetSchema, req.TargetTable, cols, pks, req.WhereClause, pageSize, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to query target table: %w", err)
	}

	// 4. Index rows by primary key
	sourceMap := make(map[string]map[string]any)
	var pkOrder []string
	seenPKs := make(map[string]bool)

	for _, row := range srcRows {
		key := buildPKKey(pks, row)
		sourceMap[key] = row
		if !seenPKs[key] {
			seenPKs[key] = true
			pkOrder = append(pkOrder, key)
		}
	}

	targetMap := make(map[string]map[string]any)
	for _, row := range tgtRows {
		key := buildPKKey(pks, row)
		targetMap[key] = row
		if !seenPKs[key] {
			seenPKs[key] = true
			pkOrder = append(pkOrder, key)
		}
	}

	// 5. Compare rows
	var diffRows []RowDiffItem
	var addedCount, deletedCount, modifiedCount, identicalCount int

	for _, key := range pkOrder {
		srcRow, inSrc := sourceMap[key]
		tgtRow, inTgt := targetMap[key]

		var item RowDiffItem

		if inSrc && !inTgt {
			addedCount++
			item = RowDiffItem{
				PKValues:     extractPKValues(pks, srcRow),
				Status:       StatusAdded,
				SourceValues: srcRow,
				SourceHash:   ComputeRowHash(cols, srcRow),
			}
		} else if !inSrc && inTgt {
			deletedCount++
			item = RowDiffItem{
				PKValues:     extractPKValues(pks, tgtRow),
				Status:       StatusDeleted,
				TargetValues: tgtRow,
				TargetHash:   ComputeRowHash(cols, tgtRow),
			}
		} else {
			srcHash := ComputeRowHash(cols, srcRow)
			tgtHash := ComputeRowHash(cols, tgtRow)
			pkVals := extractPKValues(pks, srcRow)

			if srcHash == tgtHash {
				identicalCount++
				item = RowDiffItem{
					PKValues:     pkVals,
					Status:       StatusIdentical,
					SourceValues: srcRow,
					TargetValues: tgtRow,
					SourceHash:   srcHash,
					TargetHash:   tgtHash,
				}
			} else {
				modifiedCount++
				changed := DetectChangedColumns(cols, srcRow, tgtRow)
				item = RowDiffItem{
					PKValues:       pkVals,
					Status:         StatusModified,
					SourceValues:   srcRow,
					TargetValues:   tgtRow,
					ChangedColumns: changed,
					SourceHash:     srcHash,
					TargetHash:     tgtHash,
				}
			}
		}

		// Apply filterStatus if specified
		if req.FilterStatus == "" || req.FilterStatus == "all" || string(item.Status) == req.FilterStatus {
			diffRows = append(diffRows, item)
		}
	}

	summary := DataDiffSummary{
		TotalSourceRows: len(srcRows),
		TotalTargetRows: len(tgtRows),
		AddedCount:      addedCount,
		DeletedCount:    deletedCount,
		ModifiedCount:   modifiedCount,
		IdenticalCount:  identicalCount,
		DurationMs:      time.Since(start).Milliseconds(),
	}

	return &DataDiffResult{
		SourceTable:     req.SourceTable,
		TargetTable:     req.TargetTable,
		SourceSchema:    req.SourceSchema,
		TargetSchema:    req.TargetSchema,
		PrimaryKeys:     pks,
		ComparedColumns: cols,
		Summary:         summary,
		Rows:            diffRows,
		SourceDialect:   srcDialect,
		TargetDialect:   tgtDialect,
	}, nil
}

func getTableColumns(ctx context.Context, driver types.Driver, schema, table string) []string {
	if detail, err := driver.InspectTableDetails(ctx, schema, table); err == nil && detail != nil {
		var cols []string
		for _, c := range detail.Columns {
			cols = append(cols, c.Name)
		}
		if len(cols) > 0 {
			return cols
		}
	}

	d := alter.NormalizeDialect(driver.Dialect())
	tRef := QuoteTableRef(schema, table, d)
	q := fmt.Sprintf("SELECT * FROM %s WHERE 1=0", tRef)
	if res, err := driver.ExecuteQuery(ctx, q); err == nil && res != nil {
		return res.Columns
	}
	return nil
}

func queryTableRows(ctx context.Context, driver types.Driver, dialect, schema, table string, columns, pks []string, whereClause string, limit, offset int) ([]map[string]any, error) {
	var quotedCols []string
	for _, c := range columns {
		quotedCols = append(quotedCols, QuoteIdent(c, dialect))
	}
	colSQL := strings.Join(quotedCols, ", ")
	tableRef := QuoteTableRef(schema, table, dialect)

	var whereSQL string
	trimmedWhere := strings.TrimSpace(whereClause)
	if trimmedWhere != "" {
		if strings.HasPrefix(strings.ToUpper(trimmedWhere), "WHERE ") {
			whereSQL = " " + trimmedWhere
		} else {
			whereSQL = " WHERE " + trimmedWhere
		}
	}

	var orderSQL string
	if len(pks) > 0 {
		var quotedPKs []string
		for _, pk := range pks {
			quotedPKs = append(quotedPKs, QuoteIdent(pk, dialect))
		}
		orderSQL = " ORDER BY " + strings.Join(quotedPKs, ", ")
	}

	query := fmt.Sprintf("SELECT %s FROM %s%s%s LIMIT %d OFFSET %d",
		colSQL, tableRef, whereSQL, orderSQL, limit, offset)

	res, err := driver.ExecuteQuery(ctx, query)
	if err != nil {
		return nil, err
	}

	var rows []map[string]any
	for _, rawRow := range res.Rows {
		rowMap := make(map[string]any)
		for i, colName := range res.Columns {
			if i < len(rawRow) {
				rowMap[colName] = rawRow[i]
			}
		}
		rows = append(rows, rowMap)
	}

	return rows, nil
}

func buildPKKey(pks []string, row map[string]any) string {
	var parts []string
	for _, pk := range pks {
		val := row[pk]
		parts = append(parts, fmt.Sprintf("%s=%s", pk, NormalizeValue(val)))
	}
	return strings.Join(parts, ";")
}

func extractPKValues(pks []string, row map[string]any) map[string]any {
	res := make(map[string]any)
	for _, pk := range pks {
		res[pk] = row[pk]
	}
	return res
}

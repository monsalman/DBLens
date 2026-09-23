package materialize

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
)

var defaultScratchStore = NewInMemoryScratchStore()

// SetDefaultScratchStore sets the package default scratch store.
func SetDefaultScratchStore(s *ScratchStore) {
	if s != nil {
		defaultScratchStore = s
	}
}

// GetDefaultScratchStore retrieves the package default scratch store.
func GetDefaultScratchStore() *ScratchStore {
	return defaultScratchStore
}

// MaterializeRequest specifies the parameters for result materialization.
type MaterializeRequest struct {
	SourceConnID       string   `json:"sourceConnId"`
	SourceDSN          string   `json:"sourceDsn,omitempty"`
	TargetConnID       string   `json:"targetConnId"`
	TargetDSN          string   `json:"targetDsn,omitempty"`
	SourceQuery        string   `json:"sourceQuery"`
	TargetSchema       string   `json:"targetSchema"`
	TargetTable        string   `json:"targetTable"`
	Mode               string   `json:"mode"` // "create", "replace", "append", "temp", "view", "materialized_view"
	Columns            []string `json:"columns,omitempty"`
	EstimatedRows      int64    `json:"estimatedRows,omitempty"`
	TTLMinutes         int      `json:"ttlMinutes,omitempty"`
	OverrideProduction bool     `json:"overrideProduction,omitempty"`
	IsProduction       bool     `json:"isProduction,omitempty"`
}

// MaterializePreview holds the dry-run inspection details before execution.
type MaterializePreview struct {
	DDL           string   `json:"ddl"`
	Mode          string   `json:"mode"`
	TargetTable   string   `json:"targetTable"`
	TargetSchema  string   `json:"targetSchema"`
	Dialect       string   `json:"dialect"`
	EstimatedRows int64    `json:"estimatedRows"`
	IsSameConn    bool     `json:"isSameConn"`
	Warnings      []string `json:"warnings,omitempty"`
}

// MaterializeResult encapsulates the metrics and outcome of materialization.
type MaterializeResult struct {
	Success      bool          `json:"success"`
	RowsAffected int64         `json:"rowsAffected"`
	ElapsedMs    int64         `json:"elapsedMs"`
	TargetTable  string        `json:"targetTable"`
	TargetSchema string        `json:"targetSchema"`
	Mode         string        `json:"mode"`
	Message      string        `json:"message"`
	Scratch      *ScratchTable `json:"scratch,omitempty"`
}

// ScratchTable represents a managed ephemeral or scratchpad table.
type ScratchTable struct {
	ConnID      string    `json:"connId"`
	Schema      string    `json:"schema"`
	Table       string    `json:"table"`
	Query       string    `json:"query"`
	RowCount    int64     `json:"rowCount"`
	CreatedAt   time.Time `json:"createdAt"`
	ExpiresAt   time.Time `json:"expiresAt"`
	IsTemporary bool      `json:"isTemporary"`
}

func isSameConnection(req MaterializeRequest) bool {
	if req.TargetConnID == "" || req.SourceConnID == "" {
		return true
	}
	if req.SourceConnID == req.TargetConnID {
		return true
	}
	if req.SourceDSN != "" && req.SourceDSN == req.TargetDSN {
		return true
	}
	return false
}

// Preview inspects the request and generates the DDL statements and warnings without executing.
func Preview(ctx context.Context, drv types.Driver, req MaterializeRequest) (*MaterializePreview, error) {
	if drv == nil {
		return nil, fmt.Errorf("database driver is required for preview")
	}

	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = ModeCreate
	}
	req.Mode = mode

	ddl, err := BuildDDL(drv.Dialect(), req)
	if err != nil {
		return nil, err
	}

	var warnings []string
	isSameConn := isSameConnection(req)

	if !isSameConn && (mode == ModeView || mode == ModeMaterializedView) {
		return nil, fmt.Errorf("views and materialized views cannot be created across different database connections")
	}

	if req.IsProduction && mode == ModeReplace && !req.OverrideProduction {
		warnings = append(warnings, "Target connection is in PRODUCTION mode. Destructive REPLACE mode will DROP the existing table. Explicit override required.")
	}

	if !isSameConn {
		warnings = append(warnings, "Cross-database materialization will stream rows over the network.")
	}

	return &MaterializePreview{
		DDL:           ddl,
		Mode:          mode,
		TargetTable:   strings.TrimSpace(req.TargetTable),
		TargetSchema:  strings.TrimSpace(req.TargetSchema),
		Dialect:       drv.Dialect(),
		EstimatedRows: req.EstimatedRows,
		IsSameConn:    isSameConn,
		Warnings:      warnings,
	}, nil
}

// Execute executes materialization, delegating to the package default scratch store.
func Execute(ctx context.Context, srcDrv, tgtDrv types.Driver, req MaterializeRequest) (*MaterializeResult, error) {
	return ExecuteWithStore(ctx, srcDrv, tgtDrv, req, defaultScratchStore)
}

// ExecuteWithStore executes materialization with an explicit ScratchStore instance.
func ExecuteWithStore(ctx context.Context, srcDrv, tgtDrv types.Driver, req MaterializeRequest, store *ScratchStore) (*MaterializeResult, error) {
	if srcDrv == nil {
		return nil, fmt.Errorf("source driver is required")
	}
	if tgtDrv == nil {
		tgtDrv = srcDrv
	}

	cleanTable := strings.TrimSpace(req.TargetTable)
	if cleanTable == "" {
		return nil, fmt.Errorf("target table name is required")
	}

	cleanQuery := CleanQuery(req.SourceQuery)
	if cleanQuery == "" {
		return nil, fmt.Errorf("source query is required")
	}

	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = ModeCreate
	}
	req.Mode = mode

	// Production Safe Mode check
	if req.IsProduction && mode == ModeReplace && !req.OverrideProduction {
		return nil, fmt.Errorf("destructive REPLACE mode blocked on production connection without explicit override")
	}

	if mode == ModeMaterializedView && NormalizeDialect(tgtDrv.Dialect()) != "postgres" {
		return nil, fmt.Errorf("materialized views are only supported in PostgreSQL (got dialect: %s)", tgtDrv.Dialect())
	}

	isSameConn := (srcDrv == tgtDrv) || isSameConnection(req)
	if !isSameConn && (mode == ModeView || mode == ModeMaterializedView) {
		return nil, fmt.Errorf("views and materialized views cannot be created across different database connections")
	}

	start := time.Now()
	var rowsAffected int64

	if isSameConn {
		// Server-side CTAS / Insert execution (Zero row transfer)
		stmts, err := BuildStatements(tgtDrv.Dialect(), req)
		if err != nil {
			return nil, err
		}

		for _, stmt := range stmts {
			res, err := tgtDrv.ExecuteQuery(ctx, stmt)
			if err != nil {
				return nil, fmt.Errorf("materialize query execution failed: %w", err)
			}
			if res != nil && res.AffectedRows > 0 {
				rowsAffected = res.AffectedRows
			}
		}

		// Inspect table row count if table creation mode didn't return affected rows
		if mode == ModeCreate || mode == ModeReplace || mode == ModeTemp {
			countSQL := fmt.Sprintf("SELECT COUNT(*) FROM %s;", QuoteTableRef(req.TargetSchema, cleanTable, tgtDrv.Dialect()))
			if cRes, err := tgtDrv.ExecuteQuery(ctx, countSQL); err == nil && len(cRes.Rows) > 0 && len(cRes.Rows[0]) > 0 {
				rowsAffected = parseCount(cRes.Rows[0][0])
			}
		}
	} else {
		// Cross-connection stream
		qRes, err := srcDrv.ExecuteQuery(ctx, cleanQuery)
		if err != nil {
			return nil, fmt.Errorf("failed executing source query for materialization: %w", err)
		}

		targetRef := QuoteTableRef(req.TargetSchema, cleanTable, tgtDrv.Dialect())
		if mode == ModeReplace {
			dropSQL := fmt.Sprintf("DROP TABLE IF EXISTS %s;", targetRef)
			if _, err := tgtDrv.ExecuteQuery(ctx, dropSQL); err != nil {
				return nil, fmt.Errorf("failed dropping existing target table: %w", err)
			}
		}

		if mode == ModeCreate || mode == ModeReplace || mode == ModeTemp {
			var colsMeta []types.ColumnMeta
			for _, cName := range qRes.Columns {
				colsMeta = append(colsMeta, types.ColumnMeta{
					Name: cName,
					Type: "TEXT",
				})
			}
			createDDL := GenerateCrossConnCreateTableDDL(colsMeta, req.TargetSchema, cleanTable, srcDrv.Dialect(), tgtDrv.Dialect(), mode == ModeTemp)
			if _, err := tgtDrv.ExecuteQuery(ctx, createDDL); err != nil {
				return nil, fmt.Errorf("failed creating target table: %w", err)
			}
		}

		batch := make([]map[string]interface{}, 0, 500)
		for _, row := range qRes.Rows {
			m := make(map[string]interface{}, len(qRes.Columns))
			for i, col := range qRes.Columns {
				if i < len(row) {
					m[col] = row[i]
				}
			}
			batch = append(batch, m)
			if len(batch) >= 500 {
				if _, err := tgtDrv.BatchInsert(ctx, req.TargetSchema, cleanTable, batch); err != nil {
					return nil, fmt.Errorf("batch insert failed during materialization: %w", err)
				}
				rowsAffected += int64(len(batch))
				batch = batch[:0]
			}
		}
		if len(batch) > 0 {
			if _, err := tgtDrv.BatchInsert(ctx, req.TargetSchema, cleanTable, batch); err != nil {
				return nil, fmt.Errorf("final batch insert failed: %w", err)
			}
			rowsAffected += int64(len(batch))
		}
	}

	elapsedMs := time.Since(start).Milliseconds()

	// Manage scratch table registration
	if mode == ModeTemp || req.TTLMinutes > 0 {
		ttl := req.TTLMinutes
		if ttl <= 0 && mode == ModeTemp {
			ttl = 60
		}
		var expiresAt time.Time
		if ttl > 0 {
			expiresAt = time.Now().Add(time.Duration(ttl) * time.Minute)
		}
		connID := req.TargetConnID
		if connID == "" {
			connID = req.SourceConnID
		}
		st := ScratchTable{
			ConnID:      connID,
			Schema:      req.TargetSchema,
			Table:       cleanTable,
			Query:       cleanQuery,
			RowCount:    rowsAffected,
			CreatedAt:   time.Now(),
			ExpiresAt:   expiresAt,
			IsTemporary: mode == ModeTemp,
		}
		if store != nil {
			store.Register(st)
		}
		return &MaterializeResult{
			Success:      true,
			RowsAffected: rowsAffected,
			ElapsedMs:    elapsedMs,
			TargetTable:  cleanTable,
			TargetSchema: req.TargetSchema,
			Mode:         mode,
			Message:      fmt.Sprintf("Successfully materialized %d rows into %s in %d ms (scratchpad tracked)", rowsAffected, cleanTable, elapsedMs),
			Scratch:      &st,
		}, nil
	}

	return &MaterializeResult{
		Success:      true,
		RowsAffected: rowsAffected,
		ElapsedMs:    elapsedMs,
		TargetTable:  cleanTable,
		TargetSchema: req.TargetSchema,
		Mode:         mode,
		Message:      fmt.Sprintf("Successfully materialized %d rows into %s in %d ms", rowsAffected, cleanTable, elapsedMs),
	}, nil
}

func parseCount(v interface{}) int64 {
	switch val := v.(type) {
	case int64:
		return val
	case int:
		return int64(val)
	case float64:
		return int64(val)
	case string:
		n, _ := strconv.ParseInt(val, 10, 64)
		return n
	case []byte:
		n, _ := strconv.ParseInt(string(val), 10, 64)
		return n
	default:
		return 0
	}
}

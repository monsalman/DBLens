package federation

import (
	"context"
	"crypto/sha256"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/alter"
	"github.com/dblens/dblens/internal/driver/types"
)

// ReconcileRequest specifies tables to compare between two connections.
type ReconcileRequest struct {
	SourceConnID string `json:"sourceConnId"`
	TargetConnID string `json:"targetConnId"`
	SourceSchema string `json:"sourceSchema"`
	SourceTable  string `json:"sourceTable"`
	TargetSchema string `json:"targetSchema"`
	TargetTable  string `json:"targetTable"`
	SampleLimit  int    `json:"sampleLimit"`
}

// ColumnComparison captures column schema parity between source and target.
type ColumnComparison struct {
	Name           string `json:"name"`
	SourceType     string `json:"sourceType"`
	TargetType     string `json:"targetType"`
	SourceNullable bool   `json:"sourceNullable"`
	TargetNullable bool   `json:"targetNullable"`
	SourcePrimary  bool   `json:"sourcePrimary"`
	TargetPrimary  bool   `json:"targetPrimary"`
	Match          bool   `json:"match"`
	Status         string `json:"status"` // "MATCH", "TYPE_MISMATCH", "MISSING_IN_TARGET", "MISSING_IN_SOURCE"
}

// RowSampleDiff represents an individual mismatched row in the sample.
type RowSampleDiff struct {
	RowIndex int                    `json:"rowIndex"`
	Source   map[string]interface{} `json:"source"`
	Target   map[string]interface{} `json:"target"`
	DiffCols []string               `json:"diffCols"`
}

// ReconcileResult is the comprehensive parity report.
type ReconcileResult struct {
	Status           string             `json:"status"` // "IDENTICAL", "SCHEMA_MISMATCH", "ROW_COUNT_MISMATCH", "DATA_MISMATCH"
	SourceTable      string             `json:"sourceTable"`
	TargetTable      string             `json:"targetTable"`
	SourceRowCount   int64              `json:"sourceRowCount"`
	TargetRowCount   int64              `json:"targetRowCount"`
	RowCountDiff     int64              `json:"rowCountDiff"`
	SourceChecksum   string             `json:"sourceChecksum"`
	TargetChecksum   string             `json:"targetChecksum"`
	ChecksumMatch    bool               `json:"checksumMatch"`
	ColumnComparison []ColumnComparison `json:"columnComparison"`
	MissingInTarget  []string           `json:"missingInTarget"`
	MissingInSource  []string           `json:"missingInSource"`
	SampleCompared   int                `json:"sampleCompared"`
	SampleMatched    int                `json:"sampleMatched"`
	SampleMismatched int                `json:"sampleMismatched"`
	SampleDiffs      []RowSampleDiff    `json:"sampleDiffs,omitempty"`
	ElapsedMs        int64              `json:"elapsedMs"`
}

// areTypesEquivalent checks if two type strings represent equivalent data types across dialects.
func areTypesEquivalent(t1, t2, d1, d2 string) bool {
	c1 := strings.ToLower(strings.TrimSpace(t1))
	c2 := strings.ToLower(strings.TrimSpace(t2))
	if c1 == c2 {
		return true
	}

	norm1 := alter.NormalizeDialect(d1)
	norm2 := alter.NormalizeDialect(d2)

	m1 := strings.ToLower(MapColumnType(norm1, "sqlite", c1))
	m2 := strings.ToLower(MapColumnType(norm2, "sqlite", c2))
	return m1 == m2
}

func fetchRowCount(ctx context.Context, drv types.Driver, schema, table string) (int64, error) {
	tblRef := quoteTableRef(schema, table, drv.Dialect())
	query := fmt.Sprintf("SELECT COUNT(*) FROM %s", tblRef)
	res, err := drv.ExecuteQuery(ctx, query)
	if err != nil {
		return 0, err
	}
	if len(res.Rows) == 0 || len(res.Rows[0]) == 0 {
		return 0, nil
	}

	val := res.Rows[0][0]
	switch v := val.(type) {
	case int64:
		return v, nil
	case int:
		return int64(v), nil
	case float64:
		return int64(v), nil
	case string:
		var n int64
		_, _ = fmt.Sscanf(v, "%d", &n)
		return n, nil
	default:
		return 0, nil
	}
}

// ExecuteReconcile compares schemas, row counts, and data checksums between two connections.
func ExecuteReconcile(ctx context.Context, req ReconcileRequest, srcDriver, tgtDriver types.Driver) (*ReconcileResult, error) {
	start := time.Now()

	sampleLimit := req.SampleLimit
	if sampleLimit <= 0 {
		sampleLimit = 50
	}
	if sampleLimit > 500 {
		sampleLimit = 500
	}

	srcTable := strings.TrimSpace(req.SourceTable)
	tgtTable := strings.TrimSpace(req.TargetTable)
	if tgtTable == "" {
		tgtTable = srcTable
	}

	if srcTable == "" {
		return nil, fmt.Errorf("source table name is required")
	}

	// 1. Inspect schemas
	srcDetails, err := srcDriver.InspectTableDetails(ctx, req.SourceSchema, srcTable)
	if err != nil {
		return nil, fmt.Errorf("inspect source table %q failed: %w", srcTable, err)
	}

	tgtDetails, err := tgtDriver.InspectTableDetails(ctx, req.TargetSchema, tgtTable)
	if err != nil {
		return nil, fmt.Errorf("inspect target table %q failed: %w", tgtTable, err)
	}

	srcColsMap := make(map[string]types.ColumnMeta)
	for _, c := range srcDetails.Columns {
		srcColsMap[strings.ToLower(c.Name)] = c
	}

	tgtColsMap := make(map[string]types.ColumnMeta)
	for _, c := range tgtDetails.Columns {
		tgtColsMap[strings.ToLower(c.Name)] = c
	}

	var allColNames []string
	seen := make(map[string]bool)
	for _, c := range srcDetails.Columns {
		low := strings.ToLower(c.Name)
		if !seen[low] {
			seen[low] = true
			allColNames = append(allColNames, c.Name)
		}
	}
	for _, c := range tgtDetails.Columns {
		low := strings.ToLower(c.Name)
		if !seen[low] {
			seen[low] = true
			allColNames = append(allColNames, c.Name)
		}
	}

	var comparisons []ColumnComparison
	var missingInTarget []string
	var missingInSource []string
	schemaMatches := true

	for _, name := range allColNames {
		low := strings.ToLower(name)
		sCol, hasSrc := srcColsMap[low]
		tCol, hasTgt := tgtColsMap[low]

		comp := ColumnComparison{Name: name}

		if hasSrc && !hasTgt {
			comp.SourceType = sCol.Type
			comp.SourceNullable = sCol.IsNullable
			comp.SourcePrimary = sCol.IsPrimary
			comp.Status = "MISSING_IN_TARGET"
			comp.Match = false
			missingInTarget = append(missingInTarget, name)
			schemaMatches = false
		} else if !hasSrc && hasTgt {
			comp.TargetType = tCol.Type
			comp.TargetNullable = tCol.IsNullable
			comp.TargetPrimary = tCol.IsPrimary
			comp.Status = "MISSING_IN_SOURCE"
			comp.Match = false
			missingInSource = append(missingInSource, name)
			schemaMatches = false
		} else {
			comp.SourceType = sCol.Type
			comp.TargetType = tCol.Type
			comp.SourceNullable = sCol.IsNullable
			comp.TargetNullable = tCol.IsNullable
			comp.SourcePrimary = sCol.IsPrimary
			comp.TargetPrimary = tCol.IsPrimary

			typeEquiv := areTypesEquivalent(sCol.Type, tCol.Type, srcDriver.Dialect(), tgtDriver.Dialect())
			nullEquiv := sCol.IsNullable == tCol.IsNullable
			pkEquiv := sCol.IsPrimary == tCol.IsPrimary

			if typeEquiv && nullEquiv && pkEquiv {
				comp.Status = "MATCH"
				comp.Match = true
			} else if !typeEquiv {
				comp.Status = "TYPE_MISMATCH"
				comp.Match = false
				schemaMatches = false
			} else {
				comp.Status = "CONSTRAINT_MISMATCH"
				comp.Match = false
				schemaMatches = false
			}
		}
		comparisons = append(comparisons, comp)
	}

	// 2. Fetch Row Counts
	srcRowCount, err := fetchRowCount(ctx, srcDriver, req.SourceSchema, srcTable)
	if err != nil {
		return nil, fmt.Errorf("fetch source row count failed: %w", err)
	}

	tgtRowCount, err := fetchRowCount(ctx, tgtDriver, req.TargetSchema, tgtTable)
	if err != nil {
		return nil, fmt.Errorf("fetch target row count failed: %w", err)
	}

	rowCountDiff := srcRowCount - tgtRowCount

	// 3. Sample comparison & Checksums
	var commonCols []string
	for _, c := range comparisons {
		if c.Status == "MATCH" || c.Status == "TYPE_MISMATCH" || c.Status == "CONSTRAINT_MISMATCH" {
			commonCols = append(commonCols, c.Name)
		}
	}
	sort.Strings(commonCols)

	var sampleDiffs []RowSampleDiff
	sampleCompared := 0
	sampleMatched := 0
	sampleMismatched := 0

	srcHasher := sha256.New()
	tgtHasher := sha256.New()

	if len(commonCols) > 0 && sampleLimit > 0 {
		srcSample, sErr := srcDriver.QueryTableData(ctx, types.QueryOptions{
			Schema: req.SourceSchema,
			Table:  srcTable,
			Limit:  sampleLimit,
		})
		tgtSample, tErr := tgtDriver.QueryTableData(ctx, types.QueryOptions{
			Schema: req.TargetSchema,
			Table:  tgtTable,
			Limit:  sampleLimit,
		})

		if sErr == nil && tErr == nil && srcSample != nil && tgtSample != nil {
			srcRowsMap := make([]map[string]interface{}, len(srcSample.Rows))
			for rIdx, r := range srcSample.Rows {
				m := make(map[string]interface{})
				for cIdx, col := range srcSample.Columns {
					if cIdx < len(r) {
						m[strings.ToLower(col)] = r[cIdx]
					}
				}
				srcRowsMap[rIdx] = m

				// update src hash
				for _, c := range commonCols {
					v := m[strings.ToLower(c)]
					srcHasher.Write([]byte(fmt.Sprintf("%s:%v|", c, v)))
				}
			}

			tgtRowsMap := make([]map[string]interface{}, len(tgtSample.Rows))
			for rIdx, r := range tgtSample.Rows {
				m := make(map[string]interface{})
				for cIdx, col := range tgtSample.Columns {
					if cIdx < len(r) {
						m[strings.ToLower(col)] = r[cIdx]
					}
				}
				tgtRowsMap[rIdx] = m

				// update tgt hash
				for _, c := range commonCols {
					v := m[strings.ToLower(c)]
					tgtHasher.Write([]byte(fmt.Sprintf("%s:%v|", c, v)))
				}
			}

			compareCount := len(srcRowsMap)
			if len(tgtRowsMap) < compareCount {
				compareCount = len(tgtRowsMap)
			}
			sampleCompared = compareCount

			for i := 0; i < compareCount; i++ {
				sRow := srcRowsMap[i]
				tRow := tgtRowsMap[i]

				var diffKeys []string
				for _, c := range commonCols {
					sVal := fmt.Sprintf("%v", sRow[strings.ToLower(c)])
					tVal := fmt.Sprintf("%v", tRow[strings.ToLower(c)])
					if sVal != tVal {
						diffKeys = append(diffKeys, c)
					}
				}

				if len(diffKeys) == 0 {
					sampleMatched++
				} else {
					sampleMismatched++
					if len(sampleDiffs) < 20 {
						sampleDiffs = append(sampleDiffs, RowSampleDiff{
							RowIndex: i,
							Source:   sRow,
							Target:   tRow,
							DiffCols: diffKeys,
						})
					}
				}
			}
		}
	}

	srcChecksum := fmt.Sprintf("%x", srcHasher.Sum(nil))
	tgtChecksum := fmt.Sprintf("%x", tgtHasher.Sum(nil))
	checksumMatch := srcChecksum == tgtChecksum

	// Determine overall status
	var status string
	if !schemaMatches {
		status = "SCHEMA_MISMATCH"
	} else if srcRowCount != tgtRowCount {
		status = "ROW_COUNT_MISMATCH"
	} else if sampleMismatched > 0 || !checksumMatch {
		status = "DATA_MISMATCH"
	} else {
		status = "IDENTICAL"
	}

	elapsed := time.Since(start).Milliseconds()

	return &ReconcileResult{
		Status:           status,
		SourceTable:      srcTable,
		TargetTable:      tgtTable,
		SourceRowCount:   srcRowCount,
		TargetRowCount:   tgtRowCount,
		RowCountDiff:     rowCountDiff,
		SourceChecksum:   srcChecksum,
		TargetChecksum:   tgtChecksum,
		ChecksumMatch:    checksumMatch,
		ColumnComparison: comparisons,
		MissingInTarget:  missingInTarget,
		MissingInSource:  missingInSource,
		SampleCompared:   sampleCompared,
		SampleMatched:    sampleMatched,
		SampleMismatched: sampleMismatched,
		SampleDiffs:      sampleDiffs,
		ElapsedMs:        elapsed,
	}, nil
}

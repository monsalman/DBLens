package profile

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
	"github.com/dblens/dblens/internal/masker"
)

type ProfileRequest struct {
	Schema     string   `json:"schema"`
	Table      string   `json:"table"`
	Columns    []string `json:"columns,omitempty"`
	SampleRows int      `json:"sampleRows,omitempty"`
}

type ValueFreq struct {
	Value      string  `json:"value"`
	Count      int64   `json:"count"`
	Percentage float64 `json:"percentage"`
}

type Bucket struct {
	Min   float64 `json:"min"`
	Max   float64 `json:"max"`
	Count int64   `json:"count"`
}

type ColumnProfile struct {
	ColumnName      string      `json:"columnName"`
	DataType        string      `json:"dataType"`
	TotalRows       int64       `json:"totalRows"`
	NullCount       int64       `json:"nullCount"`
	NullPercentage  float64     `json:"nullPercentage"`
	DistinctCount   int64       `json:"distinctCount"`
	UniquenessRatio float64     `json:"uniquenessRatio"`
	EmptyCount      int64       `json:"emptyCount"`
	MinVal          *float64    `json:"minVal,omitempty"`
	MaxVal          *float64    `json:"maxVal,omitempty"`
	AvgVal          *float64    `json:"avgVal,omitempty"`
	StdDev          *float64    `json:"stdDev,omitempty"`
	TopValues       []ValueFreq `json:"topValues"`
	Histogram       []Bucket    `json:"histogram,omitempty"`
	PIIType         string      `json:"piiType,omitempty"`
	QualityFlags    []string    `json:"qualityFlags"`
}

type Suggestion struct {
	ColumnName  string `json:"columnName,omitempty"`
	Type        string `json:"type"`     // "constraint", "index", "warning", "cleanup"
	Severity    string `json:"severity"` // "high", "medium", "low", "info"
	Title       string `json:"title"`
	Description string `json:"description"`
	Remediation string `json:"remediation,omitempty"`
}

type ColumnDiff struct {
	ColumnName        string   `json:"columnName"`
	BaseNullPct       float64  `json:"baseNullPct"`
	TargetNullPct     float64  `json:"targetNullPct"`
	NullPctDiff       float64  `json:"nullPctDiff"`
	BaseDistinctCount int64    `json:"baseDistinctCount"`
	TargetDistinct    int64    `json:"targetDistinct"`
	DistinctDiff      int64    `json:"distinctDiff"`
	Status            string   `json:"status"` // "changed", "added", "removed", "identical"
	Notes             []string `json:"notes"`
}

type CompareResult struct {
	BaseTable   string       `json:"baseTable"`
	TargetTable string       `json:"targetTable"`
	BaseRows    int64        `json:"baseRows"`
	TargetRows  int64        `json:"targetRows"`
	RowDiff     int64        `json:"rowDiff"`
	ColumnDiffs []ColumnDiff `json:"columnDiffs"`
	Summary     string       `json:"summary"`
}

type ProfileReport struct {
	Schema       string          `json:"schema"`
	Table        string          `json:"table"`
	Dialect      string          `json:"dialect"`
	TotalRows    int64           `json:"totalRows"`
	Columns      []ColumnProfile `json:"columns"`
	Suggestions  []Suggestion    `json:"suggestions"`
	QualityScore float64         `json:"qualityScore"`
	GeneratedAt  string          `json:"generatedAt"`
}

// RunProfile executes comprehensive column profiling against target table.
func RunProfile(ctx context.Context, drv types.Driver, req ProfileRequest) (*ProfileReport, error) {
	if drv == nil {
		return nil, fmt.Errorf("driver cannot be nil")
	}
	if req.Table == "" {
		return nil, fmt.Errorf("table name is required")
	}

	dialect := NormalizeDialect(drv.Dialect())

	detail, err := drv.InspectTableDetails(ctx, req.Schema, req.Table)
	if err != nil {
		return nil, fmt.Errorf("failed to inspect table details: %w", err)
	}
	if detail == nil || len(detail.Columns) == 0 {
		return nil, fmt.Errorf("table %q has no columns or does not exist", req.Table)
	}

	// Filter columns if subset requested
	colsToProfile := detail.Columns
	if len(req.Columns) > 0 {
		colMap := make(map[string]bool, len(req.Columns))
		for _, c := range req.Columns {
			colMap[strings.ToLower(strings.TrimSpace(c))] = true
		}
		var filtered []types.ColumnMeta
		for _, col := range detail.Columns {
			if colMap[strings.ToLower(col.Name)] {
				filtered = append(filtered, col)
			}
		}
		if len(filtered) > 0 {
			colsToProfile = filtered
		}
	}

	tableName := QualifyTable(dialect, req.Schema, req.Table)

	// 1. Get total row count
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM %s", tableName)
	countRes, err := drv.ExecuteQuery(ctx, countQuery)
	if err != nil {
		return nil, fmt.Errorf("failed to count rows in table %s: %w", tableName, err)
	}

	var totalRows int64
	if countRes != nil && len(countRes.Rows) > 0 && len(countRes.Rows[0]) > 0 {
		totalRows = toInt64(countRes.Rows[0][0])
	}

	// Determine effective from clause (support sample rows limit)
	fromClause := tableName
	effectiveRows := totalRows
	if req.SampleRows > 0 && totalRows > int64(req.SampleRows) {
		fromClause = fmt.Sprintf("(SELECT * FROM %s LIMIT %d) AS _sub_sample", tableName, req.SampleRows)
		effectiveRows = int64(req.SampleRows)
	}

	report := &ProfileReport{
		Schema:      req.Schema,
		Table:       req.Table,
		Dialect:     dialect,
		TotalRows:   totalRows,
		Columns:     make([]ColumnProfile, 0, len(colsToProfile)),
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
	}

	// 2. Profile each column
	for _, colMeta := range colsToProfile {
		colProfile := profileColumn(ctx, drv, dialect, fromClause, effectiveRows, colMeta)
		report.Columns = append(report.Columns, colProfile)
	}

	// 3. Evaluate score and suggestions
	report.QualityScore = CalculateQualityScore(report.Columns)
	report.Suggestions = GenerateSuggestions(report)

	return report, nil
}

func profileColumn(ctx context.Context, drv types.Driver, dialect, fromClause string, effectiveRows int64, colMeta types.ColumnMeta) ColumnProfile {
	quotedCol := QuoteIdentifier(dialect, colMeta.Name)
	dataType := colMeta.Type
	if dataType == "" {
		dataType = colMeta.DataType
	}
	isText := IsTextType(dataType)
	isNum := IsNumericType(dataType)

	cp := ColumnProfile{
		ColumnName: colMeta.Name,
		DataType:   dataType,
		TotalRows:  effectiveRows,
		TopValues:  []ValueFreq{},
	}

	if effectiveRows == 0 {
		cp.QualityFlags = EvaluateQualityFlags(&cp)
		return cp
	}

	// Aggregate basic metrics
	metricsQuery := BuildColumnMetricsQuery(dialect, fromClause, quotedCol, isText, isNum)
	res, err := drv.ExecuteQuery(ctx, metricsQuery)
	if err == nil && res != nil && len(res.Rows) > 0 && len(res.Rows[0]) >= 3 {
		row := res.Rows[0]
		// row[0] is COUNT(*), row[1] is COUNT(col), row[2] is COUNT(DISTINCT col)
		nonNull := toInt64(row[1])
		cp.NullCount = effectiveRows - nonNull
		if cp.NullCount < 0 {
			cp.NullCount = 0
		}
		if effectiveRows > 0 {
			cp.NullPercentage = roundFloat((float64(cp.NullCount)/float64(effectiveRows))*100.0, 2)
		}
		cp.DistinctCount = toInt64(row[2])
		if effectiveRows > 0 {
			cp.UniquenessRatio = roundFloat(float64(cp.DistinctCount)/float64(effectiveRows), 4)
		}

		idx := 3
		if isText && len(row) > idx {
			cp.EmptyCount = toInt64(row[idx])
			idx++
		}
		if isNum && len(row) >= idx+3 {
			if row[idx] != nil {
				v := toFloat64(row[idx])
				cp.MinVal = &v
			}
			idx++
			if row[idx] != nil {
				v := toFloat64(row[idx])
				cp.MaxVal = &v
			}
			idx++
			if row[idx] != nil {
				v := roundFloat(toFloat64(row[idx]), 3)
				cp.AvgVal = &v
			}
			idx++
			if len(row) > idx && row[idx] != nil {
				v := roundFloat(toFloat64(row[idx]), 3)
				cp.StdDev = &v
			}
		}
	} else {
		// Fallback simple query
		simpleQuery := fmt.Sprintf("SELECT COUNT(*), COUNT(%s) FROM %s", quotedCol, fromClause)
		if sres, serr := drv.ExecuteQuery(ctx, simpleQuery); serr == nil && sres != nil && len(sres.Rows) > 0 {
			nonNull := toInt64(sres.Rows[0][1])
			cp.NullCount = effectiveRows - nonNull
			if effectiveRows > 0 {
				cp.NullPercentage = roundFloat((float64(cp.NullCount)/float64(effectiveRows))*100.0, 2)
			}
		}
	}

	// Fetch top 10 frequent values
	topQuery := BuildTopValuesQuery(fromClause, quotedCol, 10)
	var sampleStrings []string
	if topRes, topErr := drv.ExecuteQuery(ctx, topQuery); topErr == nil && topRes != nil {
		for _, r := range topRes.Rows {
			if len(r) >= 2 {
				valStr := fmt.Sprintf("%v", r[0])
				if r[0] == nil {
					valStr = "<null>"
				}
				cnt := toInt64(r[1])
				pct := 0.0
				if effectiveRows > 0 {
					pct = roundFloat((float64(cnt)/float64(effectiveRows))*100.0, 2)
				}
				cp.TopValues = append(cp.TopValues, ValueFreq{
					Value:      valStr,
					Count:      cnt,
					Percentage: pct,
				})
				if r[0] != nil {
					sampleStrings = append(sampleStrings, valStr)
				}
			}
		}
	}

	// Generate histogram for numeric columns
	if isNum && cp.MinVal != nil && cp.MaxVal != nil && *cp.MaxVal > *cp.MinVal {
		cp.Histogram = generateHistogram(ctx, drv, fromClause, quotedCol, *cp.MinVal, *cp.MaxVal, 5)
	}

	// Detect PII using column name & collected sample values
	cp.PIIType = detectPII(colMeta.Name, sampleStrings)

	// Quality flags
	cp.QualityFlags = EvaluateQualityFlags(&cp)

	return cp
}

func detectPII(colName string, samples []string) string {
	pii := masker.DetectPIIType(colName, "")
	if pii != "" {
		return pii
	}
	for _, s := range samples {
		if s != "" && s != "<null>" && s != "<nil>" {
			if detected := masker.DetectPIIType(colName, s); detected != "" {
				return detected
			}
		}
	}
	return ""
}

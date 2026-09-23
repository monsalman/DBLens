package pivot

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// PivotRequest defines parameters for in-memory row pivoting.
type PivotRequest struct {
	RowFields  []string `json:"rowFields"`
	ColField   string   `json:"colField"`
	ValueField string   `json:"valueField"`
	Aggregator string   `json:"aggregator"` // sum, count, avg, min, max
	Subtotals  bool     `json:"subtotals"`
	ColLimit   int      `json:"colLimit,omitempty"`
}

// PivotMatrix represents the 2D cross-tabulated result.
type PivotMatrix struct {
	Cells       [][]interface{} `json:"cells"`
	RowHeaders  [][]string      `json:"rowHeaders"`
	ColHeaders  []string        `json:"colHeaders"`
	RowTotals   []interface{}   `json:"rowTotals"`
	ColTotals   []interface{}   `json:"colTotals"`
	GrandTotal  interface{}     `json:"grandTotal"`
	TruncatedAt int             `json:"truncatedAt,omitempty"`
}

// PushdownRequest defines parameters for generating database-pushdown pivot SQL.
type PushdownRequest struct {
	Query      string   `json:"query"`
	Dialect    string   `json:"dialect"`
	RowFields  []string `json:"rowFields"`
	ColField   string   `json:"colField"`
	ValueField string   `json:"valueField"`
	Aggregator string   `json:"aggregator"`
	Subtotals  bool     `json:"subtotals"`
	ColValues  []string `json:"colValues"`
}

// PushdownResult holds the generated SQL query for the requested dialect.
type PushdownResult struct {
	SQL     string `json:"sql"`
	Dialect string `json:"dialect"`
}

// ToNumber attempts to convert any interface value to float64.
func ToNumber(v interface{}) (float64, bool) {
	if v == nil {
		return 0, false
	}
	switch val := v.(type) {
	case int:
		return float64(val), true
	case int8:
		return float64(val), true
	case int16:
		return float64(val), true
	case int32:
		return float64(val), true
	case int64:
		return float64(val), true
	case uint:
		return float64(val), true
	case uint8:
		return float64(val), true
	case uint16:
		return float64(val), true
	case uint32:
		return float64(val), true
	case uint64:
		return float64(val), true
	case float32:
		return float64(val), true
	case float64:
		return val, true
	case string:
		clean := strings.TrimSpace(val)
		if clean == "" {
			return 0, false
		}
		f, err := strconv.ParseFloat(clean, 64)
		return f, err == nil
	case bool:
		if val {
			return 1, true
		}
		return 0, true
	default:
		s := fmt.Sprint(v)
		f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
		return f, err == nil
	}
}

// formatVal formats an interface value to string for headers and grouping.
func formatVal(v interface{}) string {
	if v == nil {
		return "(null)"
	}
	switch val := v.(type) {
	case string:
		return val
	case []byte:
		return string(val)
	default:
		return fmt.Sprint(v)
	}
}

// computeAggregate aggregates a slice of numbers according to the specified aggregator.
func computeAggregate(agg string, nums []float64, rowCount int) interface{} {
	switch agg {
	case "count":
		if rowCount == 0 {
			return nil
		}
		return rowCount
	case "sum":
		if len(nums) == 0 {
			if rowCount > 0 {
				return 0.0
			}
			return nil
		}
		var total float64
		for _, n := range nums {
			total += n
		}
		return roundValue(total)
	case "avg":
		if len(nums) == 0 {
			return nil
		}
		var total float64
		for _, n := range nums {
			total += n
		}
		return roundValue(total / float64(len(nums)))
	case "min":
		if len(nums) == 0 {
			return nil
		}
		min := nums[0]
		for _, n := range nums[1:] {
			if n < min {
				min = n
			}
		}
		return roundValue(min)
	case "max":
		if len(nums) == 0 {
			return nil
		}
		max := nums[0]
		for _, n := range nums[1:] {
			if n > max {
				max = n
			}
		}
		return roundValue(max)
	default:
		return nil
	}
}

func roundValue(val float64) float64 {
	return math.Round(val*10000) / 10000
}

// TransformRows cross-tabulates raw rows into a 2D PivotMatrix.
func TransformRows(rows []map[string]interface{}, req PivotRequest) (*PivotMatrix, error) {
	colField := strings.TrimSpace(req.ColField)
	if colField == "" {
		return nil, errors.New("colField is required")
	}

	agg := strings.ToLower(strings.TrimSpace(req.Aggregator))
	if agg == "" {
		agg = "sum"
	}
	switch agg {
	case "sum", "count", "avg", "min", "max":
		// valid
	default:
		return nil, fmt.Errorf("unsupported aggregator: %s", req.Aggregator)
	}

	if len(rows) == 0 {
		return &PivotMatrix{
			Cells:      [][]interface{}{},
			RowHeaders: [][]string{},
			ColHeaders: []string{},
			RowTotals:  []interface{}{},
			ColTotals:  []interface{}{},
			GrandTotal: nil,
		}, nil
	}

	// 1. Collect distinct column headers
	var colHeaders []string
	seenCols := make(map[string]bool)
	for _, row := range rows {
		cv := formatVal(row[colField])
		if !seenCols[cv] {
			seenCols[cv] = true
			colHeaders = append(colHeaders, cv)
		}
	}

	var truncatedAt int
	if req.ColLimit > 0 && len(colHeaders) > req.ColLimit {
		truncatedAt = req.ColLimit
		colHeaders = colHeaders[:req.ColLimit]
	}

	colIdxMap := make(map[string]int, len(colHeaders))
	for i, c := range colHeaders {
		colIdxMap[c] = i
	}

	// 2. Collect distinct row combinations
	var rowHeaders [][]string
	seenRows := make(map[string]int)

	hasRowFields := len(req.RowFields) > 0
	if !hasRowFields {
		seenRows["__all__"] = 0
		rowHeaders = [][]string{{"Total"}}
	} else {
		for _, row := range rows {
			parts := make([]string, len(req.RowFields))
			for i, rf := range req.RowFields {
				parts[i] = formatVal(row[rf])
			}
			key := strings.Join(parts, "\x1f")
			if _, exists := seenRows[key]; !exists {
				seenRows[key] = len(rowHeaders)
				rowHeaders = append(rowHeaders, parts)
			}
		}
	}

	numRows := len(rowHeaders)
	numCols := len(colHeaders)

	// cellValues[r][c] holds numbers
	cellValues := make([][][]float64, numRows)
	cellCounts := make([][]int, numRows)
	for r := 0; r < numRows; r++ {
		cellValues[r] = make([][]float64, numCols)
		cellCounts[r] = make([]int, numCols)
	}

	rowNums := make([][]float64, numRows)
	rowCount := make([]int, numRows)
	colNums := make([][]float64, numCols)
	colCount := make([]int, numCols)
	var allNums []float64
	var allCount int

	for _, row := range rows {
		cv := formatVal(row[colField])
		cIdx, ok := colIdxMap[cv]
		if !ok {
			// Column beyond ColLimit or unknown
			continue
		}

		var rIdx int
		if hasRowFields {
			parts := make([]string, len(req.RowFields))
			for i, rf := range req.RowFields {
				parts[i] = formatVal(row[rf])
			}
			key := strings.Join(parts, "\x1f")
			rIdx = seenRows[key]
		} else {
			rIdx = 0
		}

		cellCounts[rIdx][cIdx]++
		rowCount[rIdx]++
		colCount[cIdx]++
		allCount++

		val := row[req.ValueField]
		if num, isNum := ToNumber(val); isNum {
			cellValues[rIdx][cIdx] = append(cellValues[rIdx][cIdx], num)
			rowNums[rIdx] = append(rowNums[rIdx], num)
			colNums[cIdx] = append(colNums[cIdx], num)
			allNums = append(allNums, num)
		}
	}

	// 3. Compute cell matrix
	cells := make([][]interface{}, numRows)
	for r := 0; r < numRows; r++ {
		cells[r] = make([]interface{}, numCols)
		for c := 0; c < numCols; c++ {
			cells[r][c] = computeAggregate(agg, cellValues[r][c], cellCounts[r][c])
		}
	}

	var rowTotals []interface{}
	var colTotals []interface{}
	var grandTotal interface{}

	if req.Subtotals {
		rowTotals = make([]interface{}, numRows)
		for r := 0; r < numRows; r++ {
			rowTotals[r] = computeAggregate(agg, rowNums[r], rowCount[r])
		}

		colTotals = make([]interface{}, numCols)
		for c := 0; c < numCols; c++ {
			colTotals[c] = computeAggregate(agg, colNums[c], colCount[c])
		}

		grandTotal = computeAggregate(agg, allNums, allCount)
	}

	return &PivotMatrix{
		Cells:       cells,
		RowHeaders:  rowHeaders,
		ColHeaders:  colHeaders,
		RowTotals:   rowTotals,
		ColTotals:   colTotals,
		GrandTotal:  grandTotal,
		TruncatedAt: truncatedAt,
	}, nil
}

// ExportCSV formats a PivotMatrix into standard RFC 4180 CSV text.
func ExportCSV(matrix *PivotMatrix, rowFieldNames []string) (string, error) {
	if matrix == nil {
		return "", nil
	}

	var buf bytes.Buffer
	w := csv.NewWriter(&buf)

	hasRowTotals := len(matrix.RowTotals) > 0
	hasColTotals := len(matrix.ColTotals) > 0

	numRowFields := 0
	if len(matrix.RowHeaders) > 0 {
		numRowFields = len(matrix.RowHeaders[0])
	} else if len(rowFieldNames) > 0 {
		numRowFields = len(rowFieldNames)
	}

	// Header row
	var header []string
	for i := 0; i < numRowFields; i++ {
		if i < len(rowFieldNames) && rowFieldNames[i] != "" {
			header = append(header, rowFieldNames[i])
		} else {
			header = append(header, fmt.Sprintf("Row_%d", i+1))
		}
	}
	header = append(header, matrix.ColHeaders...)
	if hasRowTotals {
		header = append(header, "Total")
	}
	if err := w.Write(header); err != nil {
		return "", err
	}

	// Data rows
	for r, cells := range matrix.Cells {
		var row []string
		if r < len(matrix.RowHeaders) {
			row = append(row, matrix.RowHeaders[r]...)
		} else {
			for i := 0; i < numRowFields; i++ {
				row = append(row, "")
			}
		}

		for _, cell := range cells {
			if cell == nil {
				row = append(row, "")
			} else {
				row = append(row, fmt.Sprint(cell))
			}
		}

		if hasRowTotals {
			if r < len(matrix.RowTotals) && matrix.RowTotals[r] != nil {
				row = append(row, fmt.Sprint(matrix.RowTotals[r]))
			} else {
				row = append(row, "")
			}
		}

		if err := w.Write(row); err != nil {
			return "", err
		}
	}

	// Subtotal / ColTotals row
	if hasColTotals {
		var totalRow []string
		for i := 0; i < numRowFields; i++ {
			if i == 0 {
				totalRow = append(totalRow, "Total")
			} else {
				totalRow = append(totalRow, "")
			}
		}
		for _, ct := range matrix.ColTotals {
			if ct == nil {
				totalRow = append(totalRow, "")
			} else {
				totalRow = append(totalRow, fmt.Sprint(ct))
			}
		}
		if hasRowTotals {
			if matrix.GrandTotal != nil {
				totalRow = append(totalRow, fmt.Sprint(matrix.GrandTotal))
			} else {
				totalRow = append(totalRow, "")
			}
		}
		if err := w.Write(totalRow); err != nil {
			return "", err
		}
	}

	w.Flush()
	return buf.String(), w.Error()
}

// ExportMarkdown formats a PivotMatrix into clean GitHub-flavored Markdown table text.
func ExportMarkdown(matrix *PivotMatrix, rowFieldNames []string) string {
	if matrix == nil {
		return ""
	}

	var sb strings.Builder
	hasRowTotals := len(matrix.RowTotals) > 0
	hasColTotals := len(matrix.ColTotals) > 0

	numRowFields := 0
	if len(matrix.RowHeaders) > 0 {
		numRowFields = len(matrix.RowHeaders[0])
	} else if len(rowFieldNames) > 0 {
		numRowFields = len(rowFieldNames)
	}

	var headerParts []string
	var sepParts []string

	for i := 0; i < numRowFields; i++ {
		name := fmt.Sprintf("Row %d", i+1)
		if i < len(rowFieldNames) && rowFieldNames[i] != "" {
			name = rowFieldNames[i]
		}
		headerParts = append(headerParts, name)
		sepParts = append(sepParts, ":---")
	}

	for _, ch := range matrix.ColHeaders {
		headerParts = append(headerParts, ch)
		sepParts = append(sepParts, "---:")
	}

	if hasRowTotals {
		headerParts = append(headerParts, "Total")
		sepParts = append(sepParts, "---:")
	}

	sb.WriteString("| " + strings.Join(headerParts, " | ") + " |\n")
	sb.WriteString("| " + strings.Join(sepParts, " | ") + " |\n")

	for r, cells := range matrix.Cells {
		var parts []string
		if r < len(matrix.RowHeaders) {
			parts = append(parts, matrix.RowHeaders[r]...)
		} else {
			for i := 0; i < numRowFields; i++ {
				parts = append(parts, "")
			}
		}

		for _, cell := range cells {
			if cell == nil {
				parts = append(parts, "-")
			} else {
				parts = append(parts, fmt.Sprint(cell))
			}
		}

		if hasRowTotals {
			if r < len(matrix.RowTotals) && matrix.RowTotals[r] != nil {
				parts = append(parts, fmt.Sprint(matrix.RowTotals[r]))
			} else {
				parts = append(parts, "-")
			}
		}

		sb.WriteString("| " + strings.Join(parts, " | ") + " |\n")
	}

	if hasColTotals {
		var totalParts []string
		for i := 0; i < numRowFields; i++ {
			if i == 0 {
				totalParts = append(totalParts, "**Total**")
			} else {
				totalParts = append(totalParts, "")
			}
		}

		for _, ct := range matrix.ColTotals {
			if ct == nil {
				totalParts = append(totalParts, "-")
			} else {
				totalParts = append(totalParts, fmt.Sprintf("**%v**", ct))
			}
		}

		if hasRowTotals {
			if matrix.GrandTotal != nil {
				totalParts = append(totalParts, fmt.Sprintf("**%v**", matrix.GrandTotal))
			} else {
				totalParts = append(totalParts, "-")
			}
		}

		sb.WriteString("| " + strings.Join(totalParts, " | ") + " |\n")
	}

	return sb.String()
}

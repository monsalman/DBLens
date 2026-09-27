package pivot

import (
	"strings"
	"testing"
)

func TestTransformRows_SumAndSubtotals(t *testing.T) {
	rows := []map[string]interface{}{
		{"dept": "Sales", "region": "North", "quarter": "Q1", "revenue": 100},
		{"dept": "Sales", "region": "North", "quarter": "Q2", "revenue": 200},
		{"dept": "Sales", "region": "South", "quarter": "Q1", "revenue": 150},
		{"dept": "Sales", "region": "South", "quarter": "Q2", "revenue": 250},
		{"dept": "Eng", "region": "North", "quarter": "Q1", "revenue": 300},
		{"dept": "Eng", "region": "North", "quarter": "Q2", "revenue": 400},
	}

	req := PivotRequest{
		RowFields:  []string{"dept", "region"},
		ColField:   "quarter",
		ValueField: "revenue",
		Aggregator: "sum",
		Subtotals:  true,
	}

	matrix, err := TransformRows(rows, req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(matrix.ColHeaders) != 2 || matrix.ColHeaders[0] != "Q1" || matrix.ColHeaders[1] != "Q2" {
		t.Errorf("expected col headers [Q1, Q2], got %v", matrix.ColHeaders)
	}

	if len(matrix.RowHeaders) != 3 {
		t.Errorf("expected 3 row groups, got %d", len(matrix.RowHeaders))
	}

	// First row: Sales, North -> Q1: 100, Q2: 200, RowTotal: 300
	if matrix.Cells[0][0] != 100.0 || matrix.Cells[0][1] != 200.0 {
		t.Errorf("unexpected cells for row 0: %v", matrix.Cells[0])
	}
	if matrix.RowTotals[0] != 300.0 {
		t.Errorf("expected row total 300, got %v", matrix.RowTotals[0])
	}

	// ColTotals: Q1 total = 100 + 150 + 300 = 550, Q2 total = 200 + 250 + 400 = 850
	if matrix.ColTotals[0] != 550.0 || matrix.ColTotals[1] != 850.0 {
		t.Errorf("expected col totals [550, 850], got %v", matrix.ColTotals)
	}

	// GrandTotal: 550 + 850 = 1400
	if matrix.GrandTotal != 1400.0 {
		t.Errorf("expected grand total 1400, got %v", matrix.GrandTotal)
	}
}

func TestTransformRows_Aggregators(t *testing.T) {
	rows := []map[string]interface{}{
		{"category": "A", "val": 10},
		{"category": "A", "val": 20},
		{"category": "B", "val": 30},
	}

	// 1. Count
	countReq := PivotRequest{
		ColField:   "category",
		ValueField: "val",
		Aggregator: "count",
		Subtotals:  true,
	}
	mCount, err := TransformRows(rows, countReq)
	if err != nil {
		t.Fatalf("count error: %v", err)
	}
	if mCount.Cells[0][0] != 2 || mCount.Cells[0][1] != 1 {
		t.Errorf("expected counts [2, 1], got %v", mCount.Cells[0])
	}
	if mCount.GrandTotal != 3 {
		t.Errorf("expected grand total count 3, got %v", mCount.GrandTotal)
	}

	// 2. Avg
	avgReq := PivotRequest{
		ColField:   "category",
		ValueField: "val",
		Aggregator: "avg",
		Subtotals:  true,
	}
	mAvg, err := TransformRows(rows, avgReq)
	if err != nil {
		t.Fatalf("avg error: %v", err)
	}
	if mAvg.Cells[0][0] != 15.0 || mAvg.Cells[0][1] != 30.0 {
		t.Errorf("expected avg [15, 30], got %v", mAvg.Cells[0])
	}
	if mAvg.GrandTotal != 20.0 {
		t.Errorf("expected grand total avg 20, got %v", mAvg.GrandTotal)
	}

	// 3. Min & Max
	minReq := PivotRequest{
		ColField:   "category",
		ValueField: "val",
		Aggregator: "min",
	}
	mMin, _ := TransformRows(rows, minReq)
	if mMin.Cells[0][0] != 10.0 {
		t.Errorf("expected min 10, got %v", mMin.Cells[0][0])
	}

	maxReq := PivotRequest{
		ColField:   "category",
		ValueField: "val",
		Aggregator: "max",
	}
	mMax, _ := TransformRows(rows, maxReq)
	if mMax.Cells[0][0] != 20.0 {
		t.Errorf("expected max 20, got %v", mMax.Cells[0][0])
	}
}

func TestTransformRows_ColLimit(t *testing.T) {
	rows := []map[string]interface{}{
		{"tag": "Alpha", "val": 1},
		{"tag": "Beta", "val": 2},
		{"tag": "Gamma", "val": 3},
		{"tag": "Delta", "val": 4},
	}

	req := PivotRequest{
		ColField:   "tag",
		ValueField: "val",
		Aggregator: "sum",
		ColLimit:   2,
	}

	matrix, err := TransformRows(rows, req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(matrix.ColHeaders) != 2 {
		t.Errorf("expected 2 columns, got %d", len(matrix.ColHeaders))
	}
	if matrix.TruncatedAt != 2 {
		t.Errorf("expected TruncatedAt 2, got %d", matrix.TruncatedAt)
	}
}

func TestTransformRows_Validation(t *testing.T) {
	_, err := TransformRows(nil, PivotRequest{})
	if err == nil || !strings.Contains(err.Error(), "colField is required") {
		t.Errorf("expected colField error, got %v", err)
	}

	_, err = TransformRows(nil, PivotRequest{ColField: "test", Aggregator: "invalid"})
	if err == nil || !strings.Contains(err.Error(), "unsupported aggregator") {
		t.Errorf("expected aggregator error, got %v", err)
	}

	// Empty rows
	emptyMatrix, err := TransformRows([]map[string]interface{}{}, PivotRequest{ColField: "x"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(emptyMatrix.Cells) != 0 {
		t.Errorf("expected 0 cells for empty input")
	}
}

func TestExportCSVAndMarkdown(t *testing.T) {
	matrix := &PivotMatrix{
		ColHeaders: []string{"Q1", "Q2"},
		RowHeaders: [][]string{{"North"}, {"South"}},
		Cells: [][]interface{}{
			{100.0, 200.0},
			{150.0, 250.0},
		},
		RowTotals:  []interface{}{300.0, 400.0},
		ColTotals:  []interface{}{250.0, 450.0},
		GrandTotal: 700.0,
	}

	csvOut, err := ExportCSV(matrix, []string{"Region"})
	if err != nil {
		t.Fatalf("export CSV error: %v", err)
	}
	if !strings.Contains(csvOut, "Region,Q1,Q2,Total") {
		t.Errorf("expected CSV header, got:\n%s", csvOut)
	}
	if !strings.Contains(csvOut, "Total,250,450,700") {
		t.Errorf("expected CSV total row, got:\n%s", csvOut)
	}

	mdOut := ExportMarkdown(matrix, []string{"Region"})
	if !strings.Contains(mdOut, "| Region | Q1 | Q2 | Total |") {
		t.Errorf("expected MD header, got:\n%s", mdOut)
	}
	if !strings.Contains(mdOut, "**Total**") || !strings.Contains(mdOut, "**700**") {
		t.Errorf("expected MD totals, got:\n%s", mdOut)
	}
}

func TestExportCSV_FormulaSanitization(t *testing.T) {
	matrix := &PivotMatrix{
		ColHeaders: []string{"=SUM(A1)", "@admin"},
		RowHeaders: [][]string{{"+North"}, {"-South"}},
		Cells: [][]interface{}{
			{"=1+1", "@calc"},
			{"+cmd", "-5"},
		},
		RowTotals:  []interface{}{"=sum1", "-sum2"},
		ColTotals:  []interface{}{"+col1", "@col2"},
		GrandTotal: "=grand",
	}

	csvOut, err := ExportCSV(matrix, []string{"=Region"})
	if err != nil {
		t.Fatalf("export CSV error: %v", err)
	}

	for _, dangerous := range []string{"'=Region", "'=SUM(A1)", "'@admin", "'+North", "'-South", "'=1+1", "'@calc", "'+cmd", "'-5", "'=sum1", "'-sum2", "'+col1", "'@col2", "'=grand"} {
		if !strings.Contains(csvOut, dangerous) {
			t.Errorf("expected sanitized formula token %q in CSV output:\n%s", dangerous, csvOut)
		}
	}
}

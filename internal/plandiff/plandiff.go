package plandiff

import (
	"fmt"
	"math"
	"strings"

	"github.com/dblens/dblens/internal/driver/types"
)

// PlanDiffRequest specifies inputs to compare two execution plans or queries.
type PlanDiffRequest struct {
	BaselineSQL   string               `json:"baselineSql,omitempty"`
	CandidateSQL  string               `json:"candidateSql,omitempty"`
	BaselinePlan  *types.ExplainResult `json:"baselinePlan,omitempty"`
	CandidatePlan *types.ExplainResult `json:"candidatePlan,omitempty"`
	Dialect       string               `json:"dialect,omitempty"`
	Schema        string               `json:"schema,omitempty"`
	ReadOnly      bool                 `json:"readOnly,omitempty"`
}

// AlignedNode represents a paired node between Baseline and Candidate plans.
type AlignedNode struct {
	ID                 string        `json:"id"`
	Operation          string        `json:"operation"`
	Relation           string        `json:"relation,omitempty"`
	CostBefore         float64       `json:"costBefore"`
	CostAfter          float64       `json:"costAfter"`
	CostDeltaPct       float64       `json:"costDeltaPct"`
	TimeBeforeMs       float64       `json:"timeBeforeMs"`
	TimeAfterMs        float64       `json:"timeAfterMs"`
	TimeDeltaPct       float64       `json:"timeDeltaPct"`
	RowsBefore         float64       `json:"rowsBefore"`
	RowsAfter          float64       `json:"rowsAfter"`
	RowsDeltaPct       float64       `json:"rowsDeltaPct"`
	BottleneckSeverity string        `json:"bottleneckSeverity"` // "low"|"medium"|"high"|"critical"
	FilterBefore       string        `json:"filterBefore,omitempty"`
	FilterAfter        string        `json:"filterAfter,omitempty"`
	IndexBefore        string        `json:"indexBefore,omitempty"`
	IndexAfter         string        `json:"indexAfter,omitempty"`
	Children           []AlignedNode `json:"children,omitempty"`
}

// IndexRecommendation represents a heuristic index suggestion to improve query performance.
type IndexRecommendation struct {
	Table                   string   `json:"table"`
	Columns                 []string `json:"columns"`
	IndexType               string   `json:"indexType"` // "btree"|"gin"|"hash"
	Reason                  string   `json:"reason"`
	EstimatedCostSavingsPct float64  `json:"estimatedCostSavingsPct"`
	DDL                     string   `json:"ddl"`
	RollbackDDL             string   `json:"rollbackDdl"`
}

// PlanDiffSummary contains top-level comparative KPI metrics.
type PlanDiffSummary struct {
	BaselineTotalCost    float64 `json:"baselineTotalCost"`
	CandidateTotalCost   float64 `json:"candidateTotalCost"`
	CostDeltaPct         float64 `json:"costDeltaPct"`
	BaselineTimeMs       float64 `json:"baselineTimeMs"`
	CandidateTimeMs      float64 `json:"candidateTimeMs"`
	TimeDeltaPct         float64 `json:"timeDeltaPct"`
	BottleneckCount      int     `json:"bottleneckCount"`
	RecommendationsCount int     `json:"recommendationsCount"`
}

// PlanDiffResult represents the full diff comparison output.
type PlanDiffResult struct {
	BaselinePlan    *types.ExplainResult  `json:"baselinePlan,omitempty"`
	CandidatePlan   *types.ExplainResult  `json:"candidatePlan,omitempty"`
	AlignedTree     *AlignedNode          `json:"alignedTree,omitempty"`
	Summary         PlanDiffSummary       `json:"summary"`
	Recommendations []IndexRecommendation `json:"recommendations"`
	Dialect         string                `json:"dialect"`
}

// ComparePlans aligns two explain plans and calculates comparative statistics and recommendations.
func ComparePlans(baseline, candidate *types.ExplainResult, dialect, schema string) *PlanDiffResult {
	if dialect == "" {
		if candidate != nil && candidate.Dialect != "" {
			dialect = candidate.Dialect
		} else if baseline != nil && baseline.Dialect != "" {
			dialect = baseline.Dialect
		} else {
			dialect = "postgres"
		}
	}

	var baseRoot *types.PlanNode
	var candRoot *types.PlanNode
	if baseline != nil {
		baseRoot = baseline.Root
	}
	if candidate != nil {
		candRoot = candidate.Root
	}

	alignedRoot := AlignTrees(baseRoot, candRoot)

	// Summary calculation
	var baseCost, candCost float64
	var baseTime, candTime float64

	if baseline != nil {
		if baseline.Summary.TotalCost > 0 {
			baseCost = baseline.Summary.TotalCost
		} else if baseRoot != nil {
			baseCost = getNodeCost(baseRoot)
		}
		if baseline.Summary.ExecutionTime > 0 {
			baseTime = baseline.Summary.ExecutionTime
		} else if baseRoot != nil {
			baseTime = getNodeTime(baseRoot)
		}
	}

	if candidate != nil {
		if candidate.Summary.TotalCost > 0 {
			candCost = candidate.Summary.TotalCost
		} else if candRoot != nil {
			candCost = getNodeCost(candRoot)
		}
		if candidate.Summary.ExecutionTime > 0 {
			candTime = candidate.Summary.ExecutionTime
		} else if candRoot != nil {
			candTime = getNodeTime(candRoot)
		}
	}

	costDeltaPct := CalcDeltaPct(baseCost, candCost)
	timeDeltaPct := CalcDeltaPct(baseTime, candTime)

	bottlenecks := countBottlenecks(alignedRoot)
	recommendations := RecommendIndexes(candidate, baseline, dialect, schema)

	return &PlanDiffResult{
		BaselinePlan:  baseline,
		CandidatePlan: candidate,
		AlignedTree:   alignedRoot,
		Summary: PlanDiffSummary{
			BaselineTotalCost:    round2(baseCost),
			CandidateTotalCost:   round2(candCost),
			CostDeltaPct:         round2(costDeltaPct),
			BaselineTimeMs:       round2(baseTime),
			CandidateTimeMs:      round2(candTime),
			TimeDeltaPct:         round2(timeDeltaPct),
			BottleneckCount:      bottlenecks,
			RecommendationsCount: len(recommendations),
		},
		Recommendations: recommendations,
		Dialect:         dialect,
	}
}

func countBottlenecks(node *AlignedNode) int {
	return countBottlenecksDepth(node, 0)
}

func countBottlenecksDepth(node *AlignedNode, depth int) int {
	if node == nil || depth > 100 {
		return 0
	}
	count := 0
	if node.BottleneckSeverity == "high" || node.BottleneckSeverity == "critical" {
		count++
	}
	for i := range node.Children {
		count += countBottlenecksDepth(&node.Children[i], depth+1)
	}
	return count
}

func round2(val float64) float64 {
	return math.Round(val*100) / 100
}

// GenerateMarkdownReport outputs a clean GitHub-flavored markdown diff report.
func GenerateMarkdownReport(diff *PlanDiffResult) string {
	if diff == nil {
		return "# Execution Plan Diff Report\n\nNo diff data available.\n"
	}

	var sb strings.Builder
	sb.WriteString("# Execution Plan Diff Report\n\n")

	sb.WriteString("## Executive Summary\n\n")
	sb.WriteString("| Metric | Baseline | Candidate | Delta |\n")
	sb.WriteString("| :--- | :--- | :--- | :--- |\n")

	costDeltaStr := fmt.Sprintf("%+.1f%%", diff.Summary.CostDeltaPct)
	if diff.Summary.CostDeltaPct < 0 {
		costDeltaStr += " (Improved)"
	} else if diff.Summary.CostDeltaPct > 0 {
		costDeltaStr += " (Regressed)"
	}
	sb.WriteString(fmt.Sprintf("| **Total Cost** | `%.2f` | `%.2f` | **%s** |\n",
		diff.Summary.BaselineTotalCost, diff.Summary.CandidateTotalCost, costDeltaStr))

	timeDeltaStr := fmt.Sprintf("%+.1f%%", diff.Summary.TimeDeltaPct)
	if diff.Summary.TimeDeltaPct < 0 {
		timeDeltaStr += " (Improved)"
	} else if diff.Summary.TimeDeltaPct > 0 {
		timeDeltaStr += " (Regressed)"
	}
	sb.WriteString(fmt.Sprintf("| **Execution Time** | `%.2f ms` | `%.2f ms` | **%s** |\n",
		diff.Summary.BaselineTimeMs, diff.Summary.CandidateTimeMs, timeDeltaStr))

	sb.WriteString(fmt.Sprintf("| **Bottlenecks Detected** | - | - | `%d` |\n", diff.Summary.BottleneckCount))
	sb.WriteString(fmt.Sprintf("| **Index Recommendations** | - | - | `%d` |\n\n", diff.Summary.RecommendationsCount))

	// Node Breakdown Table
	sb.WriteString("## Plan Tree Comparison\n\n")
	sb.WriteString("| Operation | Relation | Cost (Before -> After) | Cost Delta | Time (Before -> After) | Severity |\n")
	sb.WriteString("| :--- | :--- | :--- | :--- | :--- | :--- |\n")

	var rows []string
	collectMarkdownRows(diff.AlignedTree, 0, &rows)
	for _, row := range rows {
		sb.WriteString(row)
		sb.WriteString("\n")
	}
	sb.WriteString("\n")

	// Recommendations
	if len(diff.Recommendations) > 0 {
		sb.WriteString("## Smart Index Recommendations\n\n")
		for i, rec := range diff.Recommendations {
			sb.WriteString(fmt.Sprintf("### %d. Index on `%s` (%s)\n\n", i+1, rec.Table, strings.Join(rec.Columns, ", ")))
			sb.WriteString(fmt.Sprintf("- **Table:** `%s`\n", rec.Table))
			sb.WriteString(fmt.Sprintf("- **Columns:** `%s`\n", strings.Join(rec.Columns, ", ")))
			sb.WriteString(fmt.Sprintf("- **Index Type:** `%s`\n", rec.IndexType))
			sb.WriteString(fmt.Sprintf("- **Estimated Cost Savings:** `%.1f%%`\n", rec.EstimatedCostSavingsPct))
			sb.WriteString(fmt.Sprintf("- **Reason:** %s\n\n", rec.Reason))

			sb.WriteString("```sql\n-- Apply Index\n" + rec.DDL + "\n\n-- Rollback\n" + rec.RollbackDDL + "\n```\n\n")
		}
	} else {
		sb.WriteString("## Smart Index Recommendations\n\n*No index bottlenecks identified.*\n\n")
	}

	return sb.String()
}

func collectMarkdownRows(node *AlignedNode, depth int, rows *[]string) {
	if node == nil || depth > 100 {
		return
	}
	indent := strings.Repeat("&nbsp;&nbsp;", depth)
	op := indent + node.Operation
	rel := node.Relation
	if rel == "" {
		rel = "-"
	}

	costStr := fmt.Sprintf("%.1f -> %.1f", node.CostBefore, node.CostAfter)
	costDelta := fmt.Sprintf("%+.1f%%", node.CostDeltaPct)
	timeStr := fmt.Sprintf("%.2fms -> %.2fms", node.TimeBeforeMs, node.TimeAfterMs)
	sev := strings.ToUpper(node.BottleneckSeverity)

	row := fmt.Sprintf("| %s | %s | %s | %s | %s | %s |", op, rel, costStr, costDelta, timeStr, sev)
	*rows = append(*rows, row)

	for i := range node.Children {
		collectMarkdownRows(&node.Children[i], depth+1, rows)
	}
}

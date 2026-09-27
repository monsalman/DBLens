package benchmark

import (
	"fmt"
	"strings"
)

// GenerateMarkdownReport produces a detailed Markdown benchmark report for a single run.
func GenerateMarkdownReport(res *BenchmarkResult) string {
	if res == nil {
		return "# Benchmark Report\n\nNo benchmark results available.\n"
	}

	var sb strings.Builder
	title := "DBLens Latency Benchmark Report"
	if res.Label != "" {
		title = fmt.Sprintf("DBLens Latency Benchmark Report: %s", res.Label)
	}

	sb.WriteString(fmt.Sprintf("# %s\n\n", title))

	sb.WriteString("## Overview\n")
	sb.WriteString(fmt.Sprintf("- **Benchmark ID**: `%s`\n", res.ID))
	sb.WriteString(fmt.Sprintf("- **Target SQL**:\n```sql\n%s\n```\n", strings.TrimSpace(res.SQL)))
	sb.WriteString(fmt.Sprintf("- **Concurrency**: %d concurrent workers\n", res.Concurrency))
	sb.WriteString(fmt.Sprintf("- **Rollback Mode**: `%t`\n", res.Rollback))
	sb.WriteString(fmt.Sprintf("- **Status**: `%s`\n", res.Status))
	sb.WriteString(fmt.Sprintf("- **Total Queries**: %d\n", res.TotalQueries))

	successRate := 0.0
	failRate := 0.0
	if res.TotalQueries > 0 {
		successRate = (float64(res.SuccessfulQueries) / float64(res.TotalQueries)) * 100.0
		failRate = (float64(res.FailedQueries) / float64(res.TotalQueries)) * 100.0
	}
	sb.WriteString(fmt.Sprintf("- **Successful Queries**: %d (%.1f%%)\n", res.SuccessfulQueries, successRate))
	sb.WriteString(fmt.Sprintf("- **Failed Queries**: %d (%.1f%%)\n", res.FailedQueries, failRate))
	sb.WriteString(fmt.Sprintf("- **Elapsed Wall Time**: %.2f ms (%.2fs)\n", res.DurationMs, res.DurationMs/1000.0))
	sb.WriteString(fmt.Sprintf("- **Throughput (QPS)**: **%.1f queries/sec**\n", res.QPS))

	if res.AssertPassed != nil {
		if *res.AssertPassed {
			sb.WriteString("- **Quality Gate Assertion**: ✅ **PASSED** (P99 within threshold)\n")
		} else {
			sb.WriteString("- **Quality Gate Assertion**: ❌ **FAILED** (P99 violated latency threshold)\n")
		}
	}
	sb.WriteString("\n")

	sb.WriteString("## Latency Statistics\n\n")
	sb.WriteString("| Metric | Latency |\n")
	sb.WriteString("| :--- | :--- |\n")
	sb.WriteString(fmt.Sprintf("| **Min** | %.2f ms |\n", res.MinLatencyMs))
	sb.WriteString(fmt.Sprintf("| **P50 (Median)** | %.2f ms |\n", res.P50LatencyMs))
	sb.WriteString(fmt.Sprintf("| **P90** | %.2f ms |\n", res.P90LatencyMs))
	sb.WriteString(fmt.Sprintf("| **P95** | %.2f ms |\n", res.P95LatencyMs))
	sb.WriteString(fmt.Sprintf("| **P99** | %.2f ms |\n", res.P99LatencyMs))
	sb.WriteString(fmt.Sprintf("| **Max** | %.2f ms |\n", res.MaxLatencyMs))
	sb.WriteString(fmt.Sprintf("| **Mean** | %.2f ms |\n", res.MeanLatencyMs))
	sb.WriteString(fmt.Sprintf("| **Std Dev** | %.2f ms |\n", res.StdDevMs))
	sb.WriteString("\n")

	if len(res.Histogram) > 0 {
		sb.WriteString("## Latency Distribution\n\n")
		sb.WriteString("| Bucket Range (ms) | Query Count | Share |\n")
		sb.WriteString("| :--- | :--- | :--- |\n")
		for _, b := range res.Histogram {
			pct := 0.0
			if res.SuccessfulQueries > 0 {
				pct = (float64(b.Count) / float64(res.SuccessfulQueries)) * 100.0
			}
			sb.WriteString(fmt.Sprintf("| %.2f - %.2f ms | %d | %.1f%% |\n", b.FromMs, b.ToMs, b.Count, pct))
		}
		sb.WriteString("\n")
	}

	if len(res.Errors) > 0 {
		sb.WriteString("## Errors Encountered\n\n")
		sb.WriteString("| Error Message | Count |\n")
		sb.WriteString("| :--- | :--- |\n")
		for _, e := range res.Errors {
			sb.WriteString(fmt.Sprintf("| `%s` | %d |\n", e.Message, e.Count))
		}
		sb.WriteString("\n")
	}

	return sb.String()
}

// GenerateComparisonMarkdown formats an A/B benchmark comparison report in Markdown.
func GenerateComparisonMarkdown(comp BenchmarkComparison) string {
	var sb strings.Builder
	sb.WriteString("# DBLens Benchmark A/B Comparison Report\n\n")

	sb.WriteString("## Executive Summary\n")
	sb.WriteString(fmt.Sprintf("- **Winner**: **%s**\n", strings.ToUpper(comp.Winner)))
	sb.WriteString(fmt.Sprintf("- **Analysis**: %s\n\n", comp.Summary))

	sb.WriteString("## Head-to-Head Comparison\n\n")
	sb.WriteString("| Metric | Baseline | Candidate | Delta | Change |\n")
	sb.WriteString("| :--- | :--- | :--- | :--- | :--- |\n")

	// QPS
	qpsSign := "+"
	if comp.QpsDelta < 0 {
		qpsSign = ""
	}
	sb.WriteString(fmt.Sprintf("| **QPS** | %.1f | %.1f | %s%.1f | %s%.1f%% |\n",
		comp.Baseline.QPS, comp.Candidate.QPS, qpsSign, comp.QpsDelta, qpsSign, comp.QpsDeltaPct))

	// P50
	p50Sign := "+"
	if comp.P50DeltaMs < 0 {
		p50Sign = ""
	}
	sb.WriteString(fmt.Sprintf("| **P50 Latency** | %.2f ms | %.2f ms | %s%.2f ms | %s%.1f%% |\n",
		comp.Baseline.P50LatencyMs, comp.Candidate.P50LatencyMs, p50Sign, comp.P50DeltaMs, p50Sign, comp.P50DeltaPct))

	// P95
	p95Sign := "+"
	if comp.P95DeltaMs < 0 {
		p95Sign = ""
	}
	sb.WriteString(fmt.Sprintf("| **P95 Latency** | %.2f ms | %.2f ms | %s%.2f ms | %s%.1f%% |\n",
		comp.Baseline.P95LatencyMs, comp.Candidate.P95LatencyMs, p95Sign, comp.P95DeltaMs, p95Sign, comp.P95DeltaPct))

	// P99
	p99Sign := "+"
	if comp.P99DeltaMs < 0 {
		p99Sign = ""
	}
	sb.WriteString(fmt.Sprintf("| **P99 Latency** | %.2f ms | %.2f ms | %s%.2f ms | %s%.1f%% |\n",
		comp.Baseline.P99LatencyMs, comp.Candidate.P99LatencyMs, p99Sign, comp.P99DeltaMs, p99Sign, comp.P99DeltaPct))

	// Mean
	meanSign := "+"
	if comp.MeanDeltaMs < 0 {
		meanSign = ""
	}
	sb.WriteString(fmt.Sprintf("| **Mean Latency** | %.2f ms | %.2f ms | %s%.2f ms | %s%.1f%% |\n",
		comp.Baseline.MeanLatencyMs, comp.Candidate.MeanLatencyMs, meanSign, comp.MeanDeltaMs, meanSign, comp.MeanDeltaPct))

	// Total Executed
	sb.WriteString(fmt.Sprintf("| **Total Queries** | %d | %d | %+d | — |\n",
		comp.Baseline.TotalQueries, comp.Candidate.TotalQueries, comp.Candidate.TotalQueries-comp.Baseline.TotalQueries))

	sb.WriteString("\n## Query Comparison\n")
	sb.WriteString(fmt.Sprintf("### Baseline (`%s`)\n```sql\n%s\n```\n\n", comp.Baseline.ID, strings.TrimSpace(comp.Baseline.SQL)))
	sb.WriteString(fmt.Sprintf("### Candidate (`%s`)\n```sql\n%s\n```\n", comp.Candidate.ID, strings.TrimSpace(comp.Candidate.SQL)))

	return sb.String()
}

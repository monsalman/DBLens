package profile

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// EvaluateQualityFlags inspects a ColumnProfile and assigns quality warning flags.
func EvaluateQualityFlags(col *ColumnProfile) []string {
	var flags []string
	if col.NullPercentage >= 30.0 {
		flags = append(flags, "high_nulls")
	}
	if col.TotalRows > 1 && col.DistinctCount == 1 && col.NullCount == 0 {
		flags = append(flags, "constant")
	}
	if col.TotalRows > 1 && col.DistinctCount == col.TotalRows && col.NullCount == 0 {
		flags = append(flags, "unique_candidate")
	}
	if col.EmptyCount > 0 {
		flags = append(flags, "empty_strings")
	}
	if col.TotalRows >= 20 && col.DistinctCount > 1 && col.DistinctCount <= 5 {
		flags = append(flags, "low_cardinality")
	}
	if col.PIIType != "" {
		flags = append(flags, "potential_pii")
	}
	return flags
}

// CalculateQualityScore calculates an overall 0-100 dataset health score.
func CalculateQualityScore(cols []ColumnProfile) float64 {
	if len(cols) == 0 {
		return 100.0
	}
	score := 100.0
	penaltyPerCol := 40.0 / float64(len(cols))

	for _, col := range cols {
		colPenalty := 0.0
		if col.NullPercentage > 50.0 {
			colPenalty += 0.6
		} else if col.NullPercentage > 20.0 {
			colPenalty += 0.3
		}
		if col.EmptyCount > 0 && col.NullCount > 0 {
			colPenalty += 0.3
		}
		for _, f := range col.QualityFlags {
			if f == "constant" {
				colPenalty += 0.5
			}
			if f == "potential_pii" {
				colPenalty += 0.2
			}
		}
		if colPenalty > 1.0 {
			colPenalty = 1.0
		}
		score -= colPenalty * penaltyPerCol
	}

	if score < 0 {
		score = 0
	}
	return roundFloat(score, 1)
}

// GenerateSuggestions produces actionable recommendations based on column profiling metrics.
func GenerateSuggestions(report *ProfileReport) []Suggestion {
	if report == nil {
		return nil
	}

	var suggestions []Suggestion
	tblQuoted := QualifyTable(report.Dialect, report.Schema, report.Table)

	for _, col := range report.Columns {
		colQuoted := QuoteIdentifier(report.Dialect, col.ColumnName)

		// 1. PII Compliance
		if col.PIIType != "" {
			suggestions = append(suggestions, Suggestion{
				ColumnName:  col.ColumnName,
				Type:        "warning",
				Severity:    "high",
				Title:       fmt.Sprintf("Unmasked %s data detected in %s", strings.ToUpper(col.PIIType), col.ColumnName),
				Description: fmt.Sprintf("Column %q contains sensitive %s values. Ensure masking or encryption is enabled in compliance with privacy policies.", col.ColumnName, col.PIIType),
			})
		}

		// 2. High Nulls
		if col.NullPercentage >= 30.0 {
			sev := "medium"
			if col.NullPercentage >= 75.0 {
				sev = "high"
			}
			suggestions = append(suggestions, Suggestion{
				ColumnName:  col.ColumnName,
				Type:        "warning",
				Severity:    sev,
				Title:       fmt.Sprintf("High null ratio on %s (%.1f%%)", col.ColumnName, col.NullPercentage),
				Description: fmt.Sprintf("Column %q has %d nulls (%.1f%% of total rows). Evaluate if column is sparse, obsolete, or should be isolated.", col.ColumnName, col.NullCount, col.NullPercentage),
			})
		}

		// 3. Unique Candidate
		if hasFlag(col.QualityFlags, "unique_candidate") {
			indexName := fmt.Sprintf("idx_%s_%s_uniq", sanitizeName(report.Table), sanitizeName(col.ColumnName))
			remediation := fmt.Sprintf("CREATE UNIQUE INDEX %s ON %s(%s);", indexName, tblQuoted, colQuoted)
			suggestions = append(suggestions, Suggestion{
				ColumnName:  col.ColumnName,
				Type:        "constraint",
				Severity:    "medium",
				Title:       fmt.Sprintf("Candidate for UNIQUE constraint: %s", col.ColumnName),
				Description: fmt.Sprintf("Column %q has 100%% distinct values (%d unique) and zero nulls. Adding a UNIQUE index guarantees integrity.", col.ColumnName, col.DistinctCount),
				Remediation: remediation,
			})
		}

		// 4. Redundant Constant Column
		if hasFlag(col.QualityFlags, "constant") {
			suggestions = append(suggestions, Suggestion{
				ColumnName:  col.ColumnName,
				Type:        "cleanup",
				Severity:    "medium",
				Title:       fmt.Sprintf("Redundant constant column: %s", col.ColumnName),
				Description: fmt.Sprintf("All %d rows in column %q contain the exact same value. Verify if this column is legacy data or redundant.", col.TotalRows, col.ColumnName),
			})
		}

		// 5. Mixed Empty Strings and NULLs
		if col.EmptyCount > 0 && col.NullCount > 0 {
			remediation := fmt.Sprintf("UPDATE %s SET %s = NULL WHERE %s = '';", tblQuoted, colQuoted, colQuoted)
			suggestions = append(suggestions, Suggestion{
				ColumnName:  col.ColumnName,
				Type:        "cleanup",
				Severity:    "low",
				Title:       fmt.Sprintf("Inconsistent empty strings and NULLs in %s", col.ColumnName),
				Description: fmt.Sprintf("Column %q has %d empty strings and %d NULLs. Standardizing empty strings to NULL simplifies queries.", col.ColumnName, col.EmptyCount, col.NullCount),
				Remediation: remediation,
			})
		}

		// 6. NOT NULL Candidate
		if col.NullCount == 0 && col.TotalRows >= 10 && !hasFlag(col.QualityFlags, "unique_candidate") {
			var rem string
			switch report.Dialect {
			case "postgres":
				rem = fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s SET NOT NULL;", tblQuoted, colQuoted)
			case "mysql":
				dataType := col.DataType
				if dataType == "" {
					dataType = "VARCHAR(255)"
				}
				rem = fmt.Sprintf("ALTER TABLE %s MODIFY %s %s NOT NULL;", tblQuoted, colQuoted, dataType)
			}
			suggestions = append(suggestions, Suggestion{
				ColumnName:  col.ColumnName,
				Type:        "constraint",
				Severity:    "info",
				Title:       fmt.Sprintf("Add NOT NULL constraint to %s", col.ColumnName),
				Description: fmt.Sprintf("Column %q contains zero nulls across %d rows. Adding NOT NULL protects integrity and assists the optimizer.", col.ColumnName, col.TotalRows),
				Remediation: rem,
			})
		}

		// 7. Low Cardinality
		if hasFlag(col.QualityFlags, "low_cardinality") && col.TotalRows >= 100 {
			suggestions = append(suggestions, Suggestion{
				ColumnName:  col.ColumnName,
				Type:        "index",
				Severity:    "info",
				Title:       fmt.Sprintf("Low cardinality column: %s", col.ColumnName),
				Description: fmt.Sprintf("Column %q has only %d distinct values across %d rows. If heavily queried, consider ENUM or lookup table.", col.ColumnName, col.DistinctCount, col.TotalRows),
			})
		}
	}

	return suggestions
}

// ExportMarkdown generates a complete GitHub-flavored Markdown profiling report.
func ExportMarkdown(report *ProfileReport) string {
	if report == nil {
		return ""
	}

	var sb strings.Builder
	tbl := report.Table
	if report.Schema != "" {
		tbl = report.Schema + "." + report.Table
	}

	sb.WriteString(fmt.Sprintf("# Data Profile Report: %s\n\n", tbl))
	sb.WriteString(fmt.Sprintf("- **Table**: `%s`\n", tbl))
	sb.WriteString(fmt.Sprintf("- **Dialect**: %s\n", report.Dialect))
	sb.WriteString(fmt.Sprintf("- **Total Rows**: %d\n", report.TotalRows))
	sb.WriteString(fmt.Sprintf("- **Columns Profiled**: %d\n", len(report.Columns)))
	sb.WriteString(fmt.Sprintf("- **Quality Score**: %.1f / 100\n", report.QualityScore))
	sb.WriteString(fmt.Sprintf("- **Generated At**: %s\n\n", report.GeneratedAt))

	// Overview Table
	sb.WriteString("## Column Overview\n\n")
	sb.WriteString("| Column | Type | Null Count | Null % | Distinct | Uniqueness | PII | Flags |\n")
	sb.WriteString("|---|---|---|---|---|---|---|---|\n")

	for _, col := range report.Columns {
		piiBadge := "-"
		if col.PIIType != "" {
			piiBadge = strings.ToUpper(col.PIIType)
		}
		flagsStr := "-"
		if len(col.QualityFlags) > 0 {
			flagsStr = strings.Join(col.QualityFlags, ", ")
		}
		sb.WriteString(fmt.Sprintf(
			"| `%s` | %s | %d | %.1f%% | %d | %.2f%% | %s | %s |\n",
			col.ColumnName, col.DataType, col.NullCount, col.NullPercentage,
			col.DistinctCount, col.UniquenessRatio*100, piiBadge, flagsStr,
		))
	}
	sb.WriteString("\n")

	// Column Details
	sb.WriteString("## Column Metrics & Top Values\n\n")
	for _, col := range report.Columns {
		sb.WriteString(fmt.Sprintf("### Column `%s` (%s)\n\n", col.ColumnName, col.DataType))
		sb.WriteString(fmt.Sprintf("- **Nulls**: %d (%.1f%%)\n", col.NullCount, col.NullPercentage))
		sb.WriteString(fmt.Sprintf("- **Distinct**: %d (%.2f%% unique)\n", col.DistinctCount, col.UniquenessRatio*100))
		if col.EmptyCount > 0 {
			sb.WriteString(fmt.Sprintf("- **Empty Strings**: %d\n", col.EmptyCount))
		}
		if col.MinVal != nil && col.MaxVal != nil {
			avg := 0.0
			if col.AvgVal != nil {
				avg = *col.AvgVal
			}
			sb.WriteString(fmt.Sprintf("- **Range**: min=%.2f, max=%.2f, avg=%.2f\n", *col.MinVal, *col.MaxVal, avg))
		}
		if col.PIIType != "" {
			sb.WriteString(fmt.Sprintf("- **PII Category**: `%s`\n", col.PIIType))
		}
		if len(col.TopValues) > 0 {
			sb.WriteString("\n**Top Frequent Values**:\n")
			for _, tv := range col.TopValues {
				sb.WriteString(fmt.Sprintf("  - `%s`: %d (%.1f%%)\n", tv.Value, tv.Count, tv.Percentage))
			}
		}
		sb.WriteString("\n")
	}

	// Suggestions
	if len(report.Suggestions) > 0 {
		sb.WriteString(fmt.Sprintf("## Quality Suggestions (%d)\n\n", len(report.Suggestions)))
		for _, s := range report.Suggestions {
			sb.WriteString(fmt.Sprintf("### [%s] %s\n\n", strings.ToUpper(s.Severity), s.Title))
			sb.WriteString(s.Description + "\n\n")
			if s.Remediation != "" {
				sb.WriteString("```sql\n" + s.Remediation + "\n```\n\n")
			}
		}
	}

	return sb.String()
}

// CompareReports compares two profile reports and computes schema & statistical drift.
func CompareReports(base, target *ProfileReport) *CompareResult {
	if base == nil && target == nil {
		return &CompareResult{Summary: "Both base and target reports are nil"}
	}
	if base == nil {
		return &CompareResult{
			TargetTable: target.Table,
			TargetRows:  target.TotalRows,
			Summary:     fmt.Sprintf("Base report missing. Target has %d rows and %d columns.", target.TotalRows, len(target.Columns)),
		}
	}
	if target == nil {
		return &CompareResult{
			BaseTable: base.Table,
			BaseRows:  base.TotalRows,
			Summary:   fmt.Sprintf("Target report missing. Base has %d rows and %d columns.", base.TotalRows, len(base.Columns)),
		}
	}

	baseMap := make(map[string]ColumnProfile, len(base.Columns))
	for _, c := range base.Columns {
		baseMap[c.ColumnName] = c
	}

	targetMap := make(map[string]ColumnProfile, len(target.Columns))
	for _, c := range target.Columns {
		targetMap[c.ColumnName] = c
	}

	allCols := make(map[string]bool)
	for k := range baseMap {
		allCols[k] = true
	}
	for k := range targetMap {
		allCols[k] = true
	}

	var sortedColNames []string
	for k := range allCols {
		sortedColNames = append(sortedColNames, k)
	}
	sort.Strings(sortedColNames)

	var colDiffs []ColumnDiff
	changedCount := 0
	addedCount := 0
	removedCount := 0

	for _, colName := range sortedColNames {
		bCol, hasBase := baseMap[colName]
		tCol, hasTarget := targetMap[colName]

		diff := ColumnDiff{ColumnName: colName}

		if hasBase && hasTarget {
			diff.BaseNullPct = bCol.NullPercentage
			diff.TargetNullPct = tCol.NullPercentage
			diff.NullPctDiff = roundFloat(tCol.NullPercentage-bCol.NullPercentage, 2)
			diff.BaseDistinctCount = bCol.DistinctCount
			diff.TargetDistinct = tCol.DistinctCount
			diff.DistinctDiff = tCol.DistinctCount - bCol.DistinctCount

			if math.Abs(diff.NullPctDiff) > 0.01 || diff.DistinctDiff != 0 {
				diff.Status = "changed"
				changedCount++
				if diff.NullPctDiff > 0 {
					diff.Notes = append(diff.Notes, fmt.Sprintf("Nulls increased by %.1f%%", diff.NullPctDiff))
				} else if diff.NullPctDiff < 0 {
					diff.Notes = append(diff.Notes, fmt.Sprintf("Nulls decreased by %.1f%%", -diff.NullPctDiff))
				}
				if diff.DistinctDiff != 0 {
					diff.Notes = append(diff.Notes, fmt.Sprintf("Distinct count delta: %+d", diff.DistinctDiff))
				}
			} else {
				diff.Status = "identical"
			}
		} else if hasTarget {
			diff.Status = "added"
			diff.TargetNullPct = tCol.NullPercentage
			diff.TargetDistinct = tCol.DistinctCount
			diff.Notes = append(diff.Notes, "Column added in target")
			addedCount++
		} else {
			diff.Status = "removed"
			diff.BaseNullPct = bCol.NullPercentage
			diff.BaseDistinctCount = bCol.DistinctCount
			diff.Notes = append(diff.Notes, "Column removed in target")
			removedCount++
		}

		colDiffs = append(colDiffs, diff)
	}

	rowDiff := target.TotalRows - base.TotalRows
	summary := fmt.Sprintf(
		"Row count diff: %+d (base: %d, target: %d). Columns: %d changed, %d added, %d removed, %d identical.",
		rowDiff, base.TotalRows, target.TotalRows,
		changedCount, addedCount, removedCount, len(sortedColNames)-changedCount-addedCount-removedCount,
	)

	return &CompareResult{
		BaseTable:   base.Table,
		TargetTable: target.Table,
		BaseRows:    base.TotalRows,
		TargetRows:  target.TotalRows,
		RowDiff:     rowDiff,
		ColumnDiffs: colDiffs,
		Summary:     summary,
	}
}

func hasFlag(flags []string, flag string) bool {
	for _, f := range flags {
		if f == flag {
			return true
		}
	}
	return false
}

func sanitizeName(s string) string {
	s = strings.ReplaceAll(s, "-", "_")
	s = strings.ReplaceAll(s, " ", "_")
	s = strings.ReplaceAll(s, ".", "_")
	return strings.ToLower(s)
}

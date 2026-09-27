package partition

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
)

var reDate = regexp.MustCompile(`\b\d{4}-\d{2}-\d{2}\b`)
var reYear = regexp.MustCompile(`\b(20\d{2})\b`)

// CalculateSkewIndex computes the coefficient of variation (stddev / mean) across partition sizes.
func CalculateSkewIndex(partitions []PartitionNode) float64 {
	n := len(partitions)
	if n <= 1 {
		return 0.0
	}

	var sum float64
	useRows := true
	for _, p := range partitions {
		if p.Bytes > 0 {
			useRows = false
			break
		}
	}

	for _, p := range partitions {
		if useRows {
			sum += float64(p.Rows)
		} else {
			sum += float64(p.Bytes)
		}
	}

	mean := sum / float64(n)
	if mean <= 0 {
		return 0.0
	}

	var varianceSum float64
	for _, p := range partitions {
		val := float64(p.Bytes)
		if useRows {
			val = float64(p.Rows)
		}
		diff := val - mean
		varianceSum += diff * diff
	}

	stddev := math.Sqrt(varianceSum / float64(n))
	cv := stddev / mean
	return math.Round(cv*100) / 100
}

// AssignPartitionStatus updates status strings for partitions based on size distribution.
func AssignPartitionStatus(partitions []PartitionNode, meanBytes float64) []PartitionNode {
	n := len(partitions)
	res := make([]PartitionNode, len(partitions))
	copy(res, partitions)

	for i := range res {
		p := &res[i]
		if n > 1 && meanBytes > 0 && float64(p.Bytes) >= 3.0*meanBytes {
			p.Status = "hot_skew"
		} else if n > 1 && p.ByteSharePct >= 70.0 {
			p.Status = "approaching_capacity"
		} else if p.Status == "" {
			p.Status = "healthy"
		}
	}
	return res
}

// EvaluatePartitionHealth produces a comprehensive health report.
func EvaluatePartitionHealth(parentTable, strategy string, partitions []PartitionNode, now time.Time) *PartitionHealthReport {
	report := &PartitionHealthReport{
		ParentTable: parentTable,
		Warnings:    []string{},
		Score:       100,
	}

	n := len(partitions)
	if n == 0 {
		report.Score = 100
		return report
	}

	report.SkewIndex = CalculateSkewIndex(partitions)

	var totalBytes int64
	for _, p := range partitions {
		totalBytes += p.Bytes
	}
	meanBytes := float64(totalBytes) / float64(n)

	var hotNodes []string
	for _, p := range partitions {
		if p.Status == "hot_skew" || (n > 1 && meanBytes > 0 && float64(p.Bytes) >= 3.0*meanBytes) {
			hotNodes = append(hotNodes, p.Name)
		}
	}
	if len(hotNodes) > 0 {
		report.HasHotSkew = true
		report.HotNodes = hotNodes
		report.Warnings = append(report.Warnings,
			fmt.Sprintf("Hot storage skew detected: partition(s) [%s] exceed 3x mean storage size", strings.Join(hotNodes, ", ")))
		report.Score -= 30
	}

	// Future partition headroom check for RANGE/date partitions
	stratUpper := strings.ToUpper(strategy)
	if stratUpper == "RANGE" || stratUpper == "" || stratUpper == "CHUNK" {
		var foundDates []time.Time
		for _, p := range partitions {
			bound := p.BoundExpression + " " + p.Name
			dateMatches := reDate.FindAllString(bound, -1)
			for _, m := range dateMatches {
				if t, err := time.Parse("2006-01-02", m); err == nil {
					foundDates = append(foundDates, t)
				}
			}
			if len(dateMatches) == 0 {
				yearMatches := reYear.FindAllString(bound, -1)
				for _, y := range yearMatches {
					if t, err := time.Parse("2006", y); err == nil {
						foundDates = append(foundDates, t)
					}
				}
			}
		}

		if len(foundDates) > 0 {
			sort.Slice(foundDates, func(i, j int) bool {
				return foundDates[i].Before(foundDates[j])
			})
			latestDate := foundDates[len(foundDates)-1]
			cutoff := now.AddDate(0, 0, 30)

			diffDays := int(latestDate.Sub(now).Hours() / 24)
			report.FutureBufferDays = diffDays

			if latestDate.Before(cutoff) {
				report.MissingFuture = true
				if diffDays <= 0 {
					report.Warnings = append(report.Warnings,
						fmt.Sprintf("Missing future partitions: latest partition boundary (%s) is already in the past (%d days ago)",
							latestDate.Format("2006-01-02"), -diffDays))
				} else {
					report.Warnings = append(report.Warnings,
						fmt.Sprintf("Upcoming partition headroom low: latest partition boundary (%s) ends within %d days (threshold: 30 days)",
							latestDate.Format("2006-01-02"), diffDays))
				}
				report.Score -= 35
			}
		}
	}

	if report.SkewIndex > 2.0 && n > 1 {
		report.Warnings = append(report.Warnings,
			fmt.Sprintf("Severe partition size imbalance detected (Skew Index: %.2f)", report.SkewIndex))
		report.Score -= 15
	} else if report.SkewIndex > 1.2 && n > 1 {
		report.Warnings = append(report.Warnings,
			fmt.Sprintf("Moderate partition size imbalance detected (Skew Index: %.2f)", report.SkewIndex))
	}

	if report.Score < 0 {
		report.Score = 0
	}

	return report
}

package benchmark

import (
	"math"
	"slices"
)

// CalculateLatencyStats sorts latencies and computes statistical percentiles, min, max, mean, stddev, and histogram buckets.
func CalculateLatencyStats(latencies []float64, numBuckets int) (
	min, p50, p90, p95, p99, max, mean, stddev float64,
	buckets []HistogramBucket,
) {
	if len(latencies) == 0 {
		return 0, 0, 0, 0, 0, 0, 0, 0, nil
	}

	sorted := make([]float64, len(latencies))
	copy(sorted, latencies)
	slices.Sort(sorted)

	n := len(sorted)
	min = round2(sorted[0])
	max = round2(sorted[n-1])

	var sum float64
	for _, v := range sorted {
		sum += v
	}
	meanVal := sum / float64(n)
	mean = round2(meanVal)

	var varSum float64
	for _, v := range sorted {
		diff := v - meanVal
		varSum += diff * diff
	}
	stddev = round2(math.Sqrt(varSum / float64(n)))

	p50 = round2(CalculatePercentile(sorted, 50))
	p90 = round2(CalculatePercentile(sorted, 90))
	p95 = round2(CalculatePercentile(sorted, 95))
	p99 = round2(CalculatePercentile(sorted, 99))

	buckets = GenerateHistogramBuckets(sorted, min, max, numBuckets)
	return
}

// CalculatePercentile computes a percentile value from a pre-sorted slice using linear interpolation.
func CalculatePercentile(sorted []float64, p float64) float64 {
	n := len(sorted)
	if n == 0 {
		return 0
	}
	if p <= 0 || n == 1 {
		return sorted[0]
	}
	if p >= 100 {
		return sorted[n-1]
	}

	rank := (p / 100.0) * float64(n-1)
	low := int(rank)
	high := low + 1
	if high >= n {
		return sorted[low]
	}
	weight := rank - float64(low)
	return sorted[low]*(1.0-weight) + sorted[high]*weight
}

// GenerateHistogramBuckets divides latency range into numBuckets intervals.
func GenerateHistogramBuckets(sorted []float64, min, max float64, numBuckets int) []HistogramBucket {
	if numBuckets <= 0 {
		numBuckets = 10
	}
	if len(sorted) == 0 {
		return nil
	}
	if min == max {
		return []HistogramBucket{
			{FromMs: min, ToMs: max, Count: int64(len(sorted))},
		}
	}

	bucketWidth := (max - min) / float64(numBuckets)
	buckets := make([]HistogramBucket, numBuckets)
	for i := 0; i < numBuckets; i++ {
		from := round2(min + float64(i)*bucketWidth)
		to := round2(min + float64(i+1)*bucketWidth)
		buckets[i] = HistogramBucket{
			FromMs: from,
			ToMs:   to,
			Count:  0,
		}
	}

	for _, v := range sorted {
		idx := int((v - min) / bucketWidth)
		if idx < 0 {
			idx = 0
		}
		if idx >= numBuckets {
			idx = numBuckets - 1
		}
		buckets[idx].Count++
	}

	return buckets
}

func round2(val float64) float64 {
	return math.Round(val*100) / 100
}

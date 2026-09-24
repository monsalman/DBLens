package datadiff

import (
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

// NormalizeValue normalizes any database column value into a deterministic canonical string.
func NormalizeValue(val any) string {
	if val == nil {
		return "<NULL>"
	}

	switch v := val.(type) {
	case bool:
		if v {
			return "true"
		}
		return "false"

	case int:
		return strconv.FormatInt(int64(v), 10)
	case int8:
		return strconv.FormatInt(int64(v), 10)
	case int16:
		return strconv.FormatInt(int64(v), 10)
	case int32:
		return strconv.FormatInt(int64(v), 10)
	case int64:
		return strconv.FormatInt(v, 10)
	case uint:
		return strconv.FormatUint(uint64(v), 10)
	case uint8:
		return strconv.FormatUint(uint64(v), 10)
	case uint16:
		return strconv.FormatUint(uint64(v), 10)
	case uint32:
		return strconv.FormatUint(uint64(v), 10)
	case uint64:
		return strconv.FormatUint(v, 10)

	case float32:
		f64 := float64(v)
		if math.IsNaN(f64) {
			return "NaN"
		}
		if math.IsInf(f64, 0) {
			return "Inf"
		}
		if f64 == math.Trunc(f64) && math.Abs(f64) < 1e15 {
			return fmt.Sprintf("%.0f", f64)
		}
		return strconv.FormatFloat(f64, 'f', -1, 32)

	case float64:
		if math.IsNaN(v) {
			return "NaN"
		}
		if math.IsInf(v, 0) {
			return "Inf"
		}
		if v == math.Trunc(v) && math.Abs(v) < 1e15 {
			return fmt.Sprintf("%.0f", v)
		}
		return strconv.FormatFloat(v, 'f', -1, 64)

	case time.Time:
		return v.UTC().Format("2006-01-02 15:04:05.999999")

	case []byte:
		// Attempt string conversion first
		str := string(v)
		if isJSON(str) {
			return canonicalizeJSON(str)
		}
		return str

	case string:
		trimmed := strings.TrimSpace(v)
		// Check if it's a JSON object or array
		if isJSON(trimmed) {
			return canonicalizeJSON(trimmed)
		}
		// Attempt timestamp normalization
		if t, ok := tryParseTime(trimmed); ok {
			return t.UTC().Format("2006-01-02 15:04:05.999999")
		}
		return v

	case map[string]any:
		b, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return canonicalizeJSON(string(b))

	case []any:
		b, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return canonicalizeJSON(string(b))

	default:
		str := fmt.Sprintf("%v", v)
		if isJSON(str) {
			return canonicalizeJSON(str)
		}
		return str
	}
}

func isJSON(s string) bool {
	s = strings.TrimSpace(s)
	return (strings.HasPrefix(s, "{") && strings.HasSuffix(s, "}")) ||
		(strings.HasPrefix(s, "[") && strings.HasSuffix(s, "]"))
}

func canonicalizeJSON(raw string) string {
	var val any
	if err := json.Unmarshal([]byte(raw), &val); err != nil {
		return raw
	}
	canon, err := json.Marshal(val)
	if err != nil {
		return raw
	}
	return string(canon)
}

func tryParseTime(s string) (time.Time, bool) {
	formats := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05.999999",
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05",
		"2006-01-02",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// ComputeRowHash calculates a deterministic SHA-256 hash across the given columns for a row.
func ComputeRowHash(columns []string, row map[string]any) string {
	h := sha256.New()
	for _, col := range columns {
		val := row[col]
		norm := NormalizeValue(val)
		h.Write([]byte(col))
		h.Write([]byte("="))
		h.Write([]byte(norm))
		h.Write([]byte("\n"))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// ComputeRowMD5 calculates a deterministic MD5 hash across the given columns for a row.
func ComputeRowMD5(columns []string, row map[string]any) string {
	h := md5.New()
	for _, col := range columns {
		val := row[col]
		norm := NormalizeValue(val)
		h.Write([]byte(col))
		h.Write([]byte("="))
		h.Write([]byte(norm))
		h.Write([]byte("\n"))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// DetectChangedColumns returns the slice of column names whose normalized values differ.
func DetectChangedColumns(columns []string, srcRow, tgtRow map[string]any) []string {
	var changed []string
	for _, col := range columns {
		srcNorm := NormalizeValue(srcRow[col])
		tgtNorm := NormalizeValue(tgtRow[col])
		if srcNorm != tgtNorm {
			changed = append(changed, col)
		}
	}
	return changed
}

// ComputeRangeHash computes a combined hash over a sorted chunk of row hashes.
func ComputeRangeHash(rowHashes []string) string {
	if len(rowHashes) == 0 {
		return ""
	}
	sorted := make([]string, len(rowHashes))
	copy(sorted, rowHashes)
	sort.Strings(sorted)

	h := sha256.New()
	for _, rHash := range sorted {
		h.Write([]byte(rHash))
		h.Write([]byte("\n"))
	}
	return hex.EncodeToString(h.Sum(nil))
}

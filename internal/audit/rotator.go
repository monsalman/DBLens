package audit

import (
	"fmt"
	"os"
	"sort"
	"strings"
)

// pruneOldRotated keeps only the most recent `keep` audit-YYYY-MM-DD.log files in dir.
func pruneOldRotated(dir string, keep int) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	var rotated []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "audit-") && strings.HasSuffix(e.Name(), ".log") {
			rotated = append(rotated, e.Name())
		}
	}
	sort.Strings(rotated) // oldest first
	if len(rotated) <= keep {
		return
	}
	for _, name := range rotated[:len(rotated)-keep] {
		_ = os.Remove(fmt.Sprintf("%s/%s", dir, name))
	}
}

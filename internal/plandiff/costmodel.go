package plandiff

import (
	"math"

	"github.com/dblens/dblens/internal/driver/types"
)

// EstimateCostSavings estimates the percentage cost reduction an index could yield.
func EstimateCostSavings(node *types.PlanNode, cols []string, hasEquality, hasRange bool) float64 {
	savings := 75.0

	if hasEquality {
		if len(cols) > 1 {
			savings += 12.0
		} else {
			savings += 10.0
		}
	} else if hasRange {
		savings -= 12.0
	}

	if node != nil {
		rows := getNodeRows(node)
		cost := getNodeCost(node)

		if rows > 10000 {
			savings += 5.0
		} else if rows > 1000 {
			savings += 3.0
		}

		if cost > 0 && cost < 20 {
			savings -= 15.0
		} else if cost > 1000 {
			savings += 4.0
		}
	}

	if savings < 35.0 {
		savings = 35.0
	} else if savings > 95.0 {
		savings = 95.0
	}

	return math.Round(savings*10) / 10
}

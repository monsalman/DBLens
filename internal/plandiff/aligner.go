package plandiff

import (
	"fmt"
	"sort"
	"strings"

	"github.com/dblens/dblens/internal/driver/types"
)

// CalcDeltaPct computes percentage change: ((after - before) / before) * 100.
func CalcDeltaPct(before, after float64) float64 {
	if before == 0 {
		if after == 0 {
			return 0
		}
		return 100.0
	}
	if after == 0 {
		return -100.0
	}
	return ((after - before) / before) * 100.0
}

func getNodeCost(node *types.PlanNode) float64 {
	if node == nil {
		return 0
	}
	if node.TotalCost > 0 {
		return node.TotalCost
	}
	if node.Cost > 0 {
		return node.Cost
	}
	return 0
}

func getNodeTime(node *types.PlanNode) float64 {
	if node == nil {
		return 0
	}
	if node.ActualTotalTime > 0 {
		return node.ActualTotalTime
	}
	if node.ActualTime > 0 {
		return node.ActualTime
	}
	return 0
}

func getNodeRows(node *types.PlanNode) float64 {
	if node == nil {
		return 0
	}
	if node.ActualRows > 0 {
		return node.ActualRows
	}
	if node.PlanRows > 0 {
		return node.PlanRows
	}
	if node.Rows > 0 {
		return node.Rows
	}
	return 0
}

func isScanNode(node *types.PlanNode) bool {
	if node == nil {
		return false
	}
	t := strings.ToLower(node.NodeType)
	return strings.Contains(t, "scan") ||
		strings.Contains(t, "seq") ||
		strings.Contains(t, "table") ||
		strings.Contains(t, "all")
}

func isSeqScan(node *types.PlanNode) bool {
	return isScanNode(node)
}

func determineSeverity(
	costBefore, costAfter, costDeltaPct float64,
	timeBefore, timeAfter, timeDeltaPct float64,
	rowsBefore, rowsAfter, rowsDeltaPct float64,
	after, before *types.PlanNode,
) string {
	// Critical: >100% cost increase, or severe runtime regression
	if costDeltaPct > 100.0 || (timeDeltaPct > 100.0 && timeAfter > 5.0) {
		return "critical"
	}

	// High: >50% cost regression, or high-cost unindexed filter scan
	if costDeltaPct > 50.0 || (timeDeltaPct > 50.0 && timeAfter > 2.0) {
		return "high"
	}
	if after != nil && isScanNode(after) && after.IndexName == "" && after.Filter != "" && costAfter > 200.0 && costDeltaPct >= 0 {
		return "high"
	}

	// Medium: >20% cost regression or rows spike or table scan with filter
	if costDeltaPct > 20.0 || (rowsDeltaPct > 50.0 && costDeltaPct >= 0) {
		return "medium"
	}
	if after != nil && isScanNode(after) && after.IndexName == "" && after.Filter != "" && costDeltaPct >= 0 {
		return "medium"
	}

	return "low"
}

// AlignTrees aligns baseline and candidate root nodes recursively.
func AlignTrees(baseRoot, candRoot *types.PlanNode) *AlignedNode {
	if baseRoot == nil && candRoot == nil {
		return nil
	}
	return alignNodes(baseRoot, candRoot, "node-0", 0)
}

func alignNodes(before, after *types.PlanNode, id string, depth int) *AlignedNode {
	if (before == nil && after == nil) || depth > 100 {
		return nil
	}

	if before != nil && after != nil {
		op := after.NodeType
		if !strings.EqualFold(before.NodeType, after.NodeType) {
			op = fmt.Sprintf("%s -> %s", before.NodeType, after.NodeType)
		}

		rel := after.RelationName
		if rel == "" {
			rel = before.RelationName
		}

		costBefore := getNodeCost(before)
		costAfter := getNodeCost(after)
		costDelta := CalcDeltaPct(costBefore, costAfter)

		timeBefore := getNodeTime(before)
		timeAfter := getNodeTime(after)
		timeDelta := CalcDeltaPct(timeBefore, timeAfter)

		rowsBefore := getNodeRows(before)
		rowsAfter := getNodeRows(after)
		rowsDelta := CalcDeltaPct(rowsBefore, rowsAfter)

		sev := determineSeverity(
			costBefore, costAfter, costDelta,
			timeBefore, timeAfter, timeDelta,
			rowsBefore, rowsAfter, rowsDelta,
			after, before,
		)

		children := alignChildren(before.Children, after.Children, id, depth+1)

		return &AlignedNode{
			ID:                 id,
			Operation:          op,
			Relation:           rel,
			CostBefore:         round2(costBefore),
			CostAfter:          round2(costAfter),
			CostDeltaPct:       round2(costDelta),
			TimeBeforeMs:       round2(timeBefore),
			TimeAfterMs:        round2(timeAfter),
			TimeDeltaPct:       round2(timeDelta),
			RowsBefore:         round2(rowsBefore),
			RowsAfter:          round2(rowsAfter),
			RowsDeltaPct:       round2(rowsDelta),
			BottleneckSeverity: sev,
			FilterBefore:       before.Filter,
			FilterAfter:        after.Filter,
			IndexBefore:        before.IndexName,
			IndexAfter:         after.IndexName,
			Children:           children,
		}
	}

	if before != nil && after == nil {
		costBefore := getNodeCost(before)
		timeBefore := getNodeTime(before)
		rowsBefore := getNodeRows(before)

		children := alignChildren(before.Children, nil, id, depth+1)

		return &AlignedNode{
			ID:                 id,
			Operation:          before.NodeType + " (Eliminated)",
			Relation:           before.RelationName,
			CostBefore:         round2(costBefore),
			CostAfter:          0,
			CostDeltaPct:       -100.0,
			TimeBeforeMs:       round2(timeBefore),
			TimeAfterMs:        0,
			TimeDeltaPct:       -100.0,
			RowsBefore:         round2(rowsBefore),
			RowsAfter:          0,
			RowsDeltaPct:       -100.0,
			BottleneckSeverity: "low",
			FilterBefore:       before.Filter,
			IndexBefore:        before.IndexName,
			Children:           children,
		}
	}

	// before == nil && after != nil
	costAfter := getNodeCost(after)
	timeAfter := getNodeTime(after)
	rowsAfter := getNodeRows(after)

	sev := determineSeverity(0, costAfter, 100.0, 0, timeAfter, 100.0, 0, rowsAfter, 100.0, after, nil)
	children := alignChildren(nil, after.Children, id, depth+1)

	return &AlignedNode{
		ID:                 id,
		Operation:          after.NodeType + " (Added)",
		Relation:           after.RelationName,
		CostBefore:         0,
		CostAfter:          round2(costAfter),
		CostDeltaPct:       100.0,
		TimeBeforeMs:       0,
		TimeAfterMs:        round2(timeAfter),
		TimeDeltaPct:       100.0,
		RowsBefore:         0,
		RowsAfter:          round2(rowsAfter),
		RowsDeltaPct:       100.0,
		BottleneckSeverity: sev,
		FilterAfter:        after.Filter,
		IndexAfter:         after.IndexName,
		Children:           children,
	}
}

func alignChildren(beforeKids, afterKids []types.PlanNode, parentID string, depth int) []AlignedNode {
	if depth > 100 {
		return nil
	}
	M := len(beforeKids)
	N := len(afterKids)

	if M == 0 && N == 0 {
		return nil
	}

	if M == 0 {
		res := make([]AlignedNode, 0, N)
		for j := 0; j < N; j++ {
			node := alignNodes(nil, &afterKids[j], fmt.Sprintf("%s-%d", parentID, j), depth)
			if node != nil {
				res = append(res, *node)
			}
		}
		return res
	}

	if N == 0 {
		res := make([]AlignedNode, 0, M)
		for i := 0; i < M; i++ {
			node := alignNodes(&beforeKids[i], nil, fmt.Sprintf("%s-%d", parentID, i), depth)
			if node != nil {
				res = append(res, *node)
			}
		}
		return res
	}

	if M == 1 && N == 1 {
		node := alignNodes(&beforeKids[0], &afterKids[0], fmt.Sprintf("%s-0", parentID), depth)
		if node != nil {
			return []AlignedNode{*node}
		}
		return nil
	}

	// Match scoring matrix between beforeKids and afterKids
	usedBefore := make([]bool, M)
	matchedAfter := make([]int, N)
	for j := 0; j < N; j++ {
		matchedAfter[j] = -1
	}

	type matchCandidate struct {
		i, j  int
		score int
	}
	var pairs []matchCandidate

	for i := 0; i < M; i++ {
		for j := 0; j < N; j++ {
			score := 0
			relB := strings.ToLower(beforeKids[i].RelationName)
			relA := strings.ToLower(afterKids[j].RelationName)
			if relB != "" && relA != "" && relB == relA {
				score += 10
			}
			if strings.EqualFold(beforeKids[i].NodeType, afterKids[j].NodeType) {
				score += 5
			}
			if beforeKids[i].IndexName != "" && strings.EqualFold(beforeKids[i].IndexName, afterKids[j].IndexName) {
				score += 5
			}
			if i == j {
				score += 2
			}
			if score >= 5 {
				pairs = append(pairs, matchCandidate{i, j, score})
			}
		}
	}

	// Sort once by score descending and greedily pick in O(P log P)
	sort.Slice(pairs, func(a, b int) bool {
		return pairs[a].score > pairs[b].score
	})

	for _, p := range pairs {
		if !usedBefore[p.i] && matchedAfter[p.j] == -1 {
			usedBefore[p.i] = true
			matchedAfter[p.j] = p.i
		}
	}

	var res []AlignedNode
	for j := 0; j < N; j++ {
		id := fmt.Sprintf("%s-%d", parentID, len(res))
		if matchedAfter[j] >= 0 {
			i := matchedAfter[j]
			node := alignNodes(&beforeKids[i], &afterKids[j], id, depth)
			if node != nil {
				res = append(res, *node)
			}
		} else {
			node := alignNodes(nil, &afterKids[j], id, depth)
			if node != nil {
				res = append(res, *node)
			}
		}
	}

	for i := 0; i < M; i++ {
		if !usedBefore[i] {
			id := fmt.Sprintf("%s-%d", parentID, len(res))
			node := alignNodes(&beforeKids[i], nil, id, depth)
			if node != nil {
				res = append(res, *node)
			}
		}
	}

	return res
}

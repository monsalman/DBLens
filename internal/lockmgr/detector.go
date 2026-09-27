package lockmgr

import (
	"fmt"
	"sort"
	"strings"
)

// DetectDeadlocks inspects the wait-for graph of sessions and returns detected circular deadlock chains.
// In a wait-for graph, a directed edge exists from Waiter -> Blocker (the session waiting on another).
func DetectDeadlocks(nodes map[int64]*LockNode) []DeadlockCycle {
	// Build wait-for adjacency list: waiterPID -> []blockerPID
	adj := make(map[int64][]int64, len(nodes))
	for pid, node := range nodes {
		if node.BlockedByPID != nil && *node.BlockedByPID > 0 {
			blocker := *node.BlockedByPID
			if _, exists := nodes[blocker]; exists && blocker != pid {
				adj[pid] = append(adj[pid], blocker)
			}
		}
	}

	visited := make(map[int64]int) // 0: unvisited, 1: visiting (in stack), 2: visited
	var path []int64
	var foundCycles [][]int64

	var dfs func(curr int64)
	dfs = func(curr int64) {
		visited[curr] = 1
		path = append(path, curr)

		for _, next := range adj[curr] {
			if visited[next] == 1 {
				// Cycle detected: extract from next to curr
				idx := -1
				for i, p := range path {
					if p == next {
						idx = i
						break
					}
				}
				if idx != -1 {
					cycleSlice := make([]int64, len(path)-idx)
					copy(cycleSlice, path[idx:])
					foundCycles = append(foundCycles, cycleSlice)
				}
			} else if visited[next] == 0 {
				dfs(next)
			}
		}

		path = path[:len(path)-1]
		visited[curr] = 2
	}

	// Sort PIDs for deterministic traversal
	pids := make([]int64, 0, len(nodes))
	for pid := range nodes {
		pids = append(pids, pid)
	}
	sort.Slice(pids, func(i, j int) bool { return pids[i] < pids[j] })

	for _, pid := range pids {
		if visited[pid] == 0 {
			dfs(pid)
		}
	}

	if len(foundCycles) == 0 {
		return []DeadlockCycle{}
	}

	// Deduplicate cycles by rotating each cycle to start with its minimum PID
	seen := make(map[string]bool)
	var result []DeadlockCycle

	for _, rawCycle := range foundCycles {
		if len(rawCycle) == 0 {
			continue
		}

		canonical := canonicalizeCycle(rawCycle)
		key := cycleKey(canonical)
		if seen[key] {
			continue
		}
		seen[key] = true

		// Closed loop representation: e.g. [A, B, A]
		closedLoop := make([]int64, len(canonical)+1)
		copy(closedLoop, canonical)
		closedLoop[len(canonical)] = canonical[0]

		cycleNodes := make([]*LockNode, 0, len(canonical))
		descriptions := make([]string, 0, len(canonical))

		for i, pid := range canonical {
			nextPID := canonical[(i+1)%len(canonical)]
			cycleNodes = append(cycleNodes, nodes[pid])
			descriptions = append(descriptions, fmt.Sprintf("Session %d waits on Session %d", pid, nextPID))
		}

		desc := fmt.Sprintf("Deadlock cycle detected: %s (circular wait)", strings.Join(descriptions, " -> "))

		result = append(result, DeadlockCycle{
			PIDs:        closedLoop,
			Nodes:       cycleNodes,
			Description: desc,
		})
	}

	return result
}

// canonicalizeCycle shifts the cycle slice so that the minimum element comes first.
func canonicalizeCycle(cycle []int64) []int64 {
	if len(cycle) <= 1 {
		return cycle
	}
	minIdx := 0
	minVal := cycle[0]
	for i := 1; i < len(cycle); i++ {
		if cycle[i] < minVal {
			minVal = cycle[i]
			minIdx = i
		}
	}

	normalized := make([]int64, len(cycle))
	for i := 0; i < len(cycle); i++ {
		normalized[i] = cycle[(minIdx+i)%len(cycle)]
	}
	return normalized
}

func cycleKey(cycle []int64) string {
	var sb strings.Builder
	for i, v := range cycle {
		if i > 0 {
			sb.WriteByte('-')
		}
		sb.WriteString(fmt.Sprintf("%d", v))
	}
	return sb.String()
}

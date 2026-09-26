package lockmgr

import (
	"sort"
	"time"
)

// BuildLockGraph constructs the hierarchical lock dependency tree and populates deadlock cycles.
func BuildLockGraph(rawInfos []*RawLockInfo, dialect string) *LockTreeResponse {
	nodeMap := make(map[int64]*LockNode, len(rawInfos))

	// 1. Populate node map, merging multiple lock entries for the same PID if present
	for _, raw := range rawInfos {
		if raw == nil || raw.PID <= 0 {
			continue
		}

		existing, exists := nodeMap[raw.PID]
		if !exists {
			node := &LockNode{
				PID:                 raw.PID,
				User:                raw.User,
				Database:            raw.Database,
				Query:               raw.Query,
				QueryAgeSeconds:     raw.QueryAgeSeconds,
				WaitDurationSeconds: raw.WaitDurationSeconds,
				LockType:            raw.LockType,
				LockMode:            raw.LockMode,
				Granted:             raw.Granted,
				BlockedByPID:        raw.BlockedByPID,
				ClientAddr:          raw.ClientAddr,
				ApplicationName:     raw.ApplicationName,
				TransactionState:    raw.TransactionState,
				IsRootBlocker:       false,
				Children:            make([]*LockNode, 0),
			}
			nodeMap[raw.PID] = node
		} else {
			// Merge attributes: prefer ungranted lock or higher wait duration
			if !raw.Granted && existing.Granted {
				existing.Granted = false
				existing.LockType = raw.LockType
				existing.LockMode = raw.LockMode
				existing.BlockedByPID = raw.BlockedByPID
			}
			if raw.WaitDurationSeconds > existing.WaitDurationSeconds {
				existing.WaitDurationSeconds = raw.WaitDurationSeconds
			}
			if raw.QueryAgeSeconds > existing.QueryAgeSeconds {
				existing.QueryAgeSeconds = raw.QueryAgeSeconds
			}
			if existing.Query == "" && raw.Query != "" {
				existing.Query = raw.Query
			}
			if existing.TransactionState == "" && raw.TransactionState != "" {
				existing.TransactionState = raw.TransactionState
			}
		}
	}

	// 2. Detect deadlocks before mutating tree structure
	deadlocks := DetectDeadlocks(nodeMap)

	// Collect all nodes in deterministic order
	allNodes := make([]*LockNode, 0, len(nodeMap))
	for _, node := range nodeMap {
		allNodes = append(allNodes, node)
	}
	sort.Slice(allNodes, func(i, j int) bool {
		return allNodes[i].PID < allNodes[j].PID
	})

	// 3. Link child nodes to parent blockers
	// Parent = blocker (blocking_pid), Child = waiter (blocked_pid)
	cycleMemberPIDs := make(map[int64]bool)
	for _, dl := range deadlocks {
		for _, pid := range dl.PIDs {
			cycleMemberPIDs[pid] = true
		}
	}

	for _, node := range allNodes {
		if node.BlockedByPID != nil && *node.BlockedByPID > 0 {
			parentPID := *node.BlockedByPID
			parent := nodeMap[parentPID]
			if parent != nil && parent.PID != node.PID {
				// Prevent cycles in the tree hierarchy
				if !isAncestor(node, parent) {
					isChildAlready := false
					for _, ch := range parent.Children {
						if ch.PID == node.PID {
							isChildAlready = true
							break
						}
					}
					if !isChildAlready {
						parent.Children = append(parent.Children, node)
					}
				}
			}
		}
	}

	// 4. Identify Root Blockers
	// A node is a root blocker if:
	// - It has children, AND
	// - It is NOT blocked by any active node in the graph (BlockedByPID is nil, 0, or points to missing PID)
	var rootBlockers []*LockNode
	rootSeen := make(map[int64]bool)
	blockedCount := 0

	for _, node := range allNodes {
		if node.BlockedByPID != nil && *node.BlockedByPID > 0 {
			blockedCount++
		}

		isNotBlocked := node.BlockedByPID == nil || *node.BlockedByPID == 0 || nodeMap[*node.BlockedByPID] == nil

		if len(node.Children) > 0 && isNotBlocked {
			node.IsRootBlocker = true
			rootBlockers = append(rootBlockers, node)
			rootSeen[node.PID] = true
		}
	}

	// 5. Handle deadlock cycles that have no external root blocker
	// In pure cycles (e.g. A blocks B and B blocks A), neither is an unblocked root.
	// We select the cycle nodes as root blockers so the deadlocked sessions are prominent.
	for _, dl := range deadlocks {
		cycleHasRoot := false
		for _, pid := range dl.PIDs {
			if rootSeen[pid] {
				cycleHasRoot = true
				break
			}
		}
		if !cycleHasRoot && len(dl.PIDs) > 0 {
			entryPID := dl.PIDs[0]
			if node, ok := nodeMap[entryPID]; ok && !rootSeen[entryPID] {
				node.IsRootBlocker = true
				rootBlockers = append(rootBlockers, node)
				rootSeen[entryPID] = true
			}
		}
	}

	// If no root blockers were identified but there are active lock nodes (e.g. single lock holder in SQLite),
	// include top-level nodes as roots so tree view displays them
	if len(rootBlockers) == 0 && len(allNodes) > 0 {
		for _, node := range allNodes {
			if node.BlockedByPID == nil || *node.BlockedByPID == 0 {
				rootBlockers = append(rootBlockers, node)
			}
		}
	}

	// Sort root blockers by wait duration or query age descending
	sort.Slice(rootBlockers, func(i, j int) bool {
		if rootBlockers[i].WaitDurationSeconds != rootBlockers[j].WaitDurationSeconds {
			return rootBlockers[i].WaitDurationSeconds > rootBlockers[j].WaitDurationSeconds
		}
		return rootBlockers[i].QueryAgeSeconds > rootBlockers[j].QueryAgeSeconds
	})

	// Sort children within each root
	visitedRoots := make(map[int64]bool)
	for _, root := range rootBlockers {
		sortChildrenRecursive(root, visitedRoots)
	}

	return &LockTreeResponse{
		Timestamp:       time.Now().UTC(),
		TotalLocks:      len(allNodes),
		BlockedSessions: blockedCount,
		RootBlockers:    rootBlockers,
		AllNodes:        allNodes,
		Deadlocks:       deadlocks,
		Dialect:         dialect,
	}
}

// isAncestor checks if potentialAncestor is already reachable above target in the tree.
func isAncestor(potentialAncestor, target *LockNode) bool {
	if potentialAncestor == nil || target == nil {
		return false
	}
	visited := make(map[int64]bool)
	var q []*LockNode
	q = append(q, potentialAncestor)
	visited[potentialAncestor.PID] = true

	for len(q) > 0 {
		curr := q[0]
		q = q[1:]
		for _, ch := range curr.Children {
			if ch.PID == target.PID {
				return true
			}
			if !visited[ch.PID] {
				visited[ch.PID] = true
				q = append(q, ch)
			}
		}
	}
	return false
}

func sortChildrenRecursive(node *LockNode, visited map[int64]bool) {
	if node == nil || visited[node.PID] {
		return
	}
	visited[node.PID] = true

	if len(node.Children) == 0 {
		return
	}
	sort.Slice(node.Children, func(i, j int) bool {
		return node.Children[i].WaitDurationSeconds > node.Children[j].WaitDurationSeconds
	})
	for _, ch := range node.Children {
		sortChildrenRecursive(ch, visited)
	}
}

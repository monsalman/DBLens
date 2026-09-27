package seeder

import (
	"sort"

	"github.com/dblens/dblens/internal/driver/types"
)

// TableOrder represents a table's position, hierarchy level, and dependency edges in the DAG.
type TableOrder struct {
	Table        string             `json:"table"`
	Level        int                `json:"level"`
	Dependencies []string           `json:"dependencies"`
	SelfFKs      []types.ForeignKey `json:"selfFks,omitempty"`
	DeferredFKs  []types.ForeignKey `json:"deferredFks,omitempty"`
}

// DAGResult contains the topologically sorted tables and any detected/resolved cycle details.
type DAGResult struct {
	SortedTables   []TableOrder       `json:"sortedTables"`
	DAGOrder       []string           `json:"dagOrder"`
	CyclesDetected bool               `json:"cyclesDetected"`
	CycleEdges     []types.ForeignKey `json:"cycleEdges,omitempty"`
}

// BuildDAG builds a dependency graph from tables and foreign keys, detects and resolves
// cycles (self-referencing and circular FKs), and computes topological execution order with levels.
func BuildDAG(tables []string, foreignKeys []types.ForeignKey) *DAGResult {
	if len(tables) == 0 {
		return &DAGResult{
			SortedTables: []TableOrder{},
			DAGOrder:     []string{},
		}
	}

	// 1. Deduplicate tables preserving first appearance order
	tableSet := make(map[string]bool, len(tables))
	uniqueTables := make([]string, 0, len(tables))
	for _, t := range tables {
		if !tableSet[t] {
			tableSet[t] = true
			uniqueTables = append(uniqueTables, t)
		}
	}

	// 2. Separate self-referencing FKs and filter external dependencies
	selfFKs := make(map[string][]types.ForeignKey)
	validFKs := make([]types.ForeignKey, 0, len(foreignKeys))

	for _, fk := range foreignKeys {
		child := fk.Table
		parent := fk.RefTable
		if !tableSet[child] {
			continue
		}
		if child == parent {
			// Self-referencing FK (e.g. employee.manager_id -> employee.id)
			selfFKs[child] = append(selfFKs[child], fk)
			continue
		}
		if tableSet[parent] {
			validFKs = append(validFKs, fk)
		}
	}

	// 3. Dependency graph construction:
	// Parent (RefTable) must be seeded before Child (Table).
	// Directed edge: Parent -> Child.
	// inDegree counts required parents for Child.
	inDegree := make(map[string]int, len(uniqueTables))
	dependents := make(map[string][]string, len(uniqueTables))
	dependencies := make(map[string][]string, len(uniqueTables))

	for _, t := range uniqueTables {
		inDegree[t] = 0
		dependents[t] = []string{}
		dependencies[t] = []string{}
	}

	type edgeKey struct {
		from, to string
	}
	seenEdges := make(map[edgeKey]bool)
	edgeFKs := make(map[edgeKey]types.ForeignKey)

	for _, fk := range validFKs {
		child := fk.Table
		parent := fk.RefTable
		e := edgeKey{from: parent, to: child}
		if !seenEdges[e] {
			seenEdges[e] = true
			edgeFKs[e] = fk
			dependents[parent] = append(dependents[parent], child)
			dependencies[child] = append(dependencies[child], parent)
			inDegree[child]++
		}
	}

	// 4. Cycle detection & resolution via Kahn's algorithm
	deferredFKs := make(map[string][]types.ForeignKey)
	var cycleEdges []types.ForeignKey
	cyclesDetected := false

	// Working copies of graph for cycle-breaking
	workInDegree := make(map[string]int, len(uniqueTables))
	for k, v := range inDegree {
		workInDegree[k] = v
	}

	visited := make(map[string]bool, len(uniqueTables))
	var sorted []string

	for len(sorted) < len(uniqueTables) {
		// Find all nodes with inDegree == 0
		var ready []string
		for _, t := range uniqueTables {
			if !visited[t] && workInDegree[t] == 0 {
				ready = append(ready, t)
			}
		}
		sort.Strings(ready)

		if len(ready) > 0 {
			// Process ready nodes
			for _, curr := range ready {
				visited[curr] = true
				sorted = append(sorted, curr)
				for _, dep := range dependents[curr] {
					if !visited[dep] {
						workInDegree[dep]--
					}
				}
			}
			continue
		}

		// Cycle detected! Unvisited nodes exist but none have inDegree == 0
		cyclesDetected = true

		// Find the best unvisited node to break a cycle:
		// Pick unvisited node with lowest inDegree > 0 to minimize broken constraints
		var bestNode string
		minDeg := 999999
		for _, t := range uniqueTables {
			if !visited[t] {
				deg := workInDegree[t]
				if deg < minDeg || (deg == minDeg && t < bestNode) {
					minDeg = deg
					bestNode = t
				}
			}
		}

		if bestNode == "" {
			break
		}

		// Find an incoming edge to bestNode from an unvisited parent and defer it
		var brokenParent string
		for _, p := range dependencies[bestNode] {
			if !visited[p] {
				brokenParent = p
				break
			}
		}

		if brokenParent != "" {
			e := edgeKey{from: brokenParent, to: bestNode}
			if fk, ok := edgeFKs[e]; ok {
				deferredFKs[bestNode] = append(deferredFKs[bestNode], fk)
				cycleEdges = append(cycleEdges, fk)
			}
			// Remove edge from graph
			workInDegree[bestNode]--

			// Filter out brokenParent from dependencies
			newDeps := make([]string, 0, len(dependencies[bestNode]))
			for _, p := range dependencies[bestNode] {
				if p != brokenParent {
					newDeps = append(newDeps, p)
				}
			}
			dependencies[bestNode] = newDeps

			// Filter out bestNode from brokenParent's dependents
			newChilds := make([]string, 0, len(dependents[brokenParent]))
			for _, c := range dependents[brokenParent] {
				if c != bestNode {
					newChilds = append(newChilds, c)
				}
			}
			dependents[brokenParent] = newChilds
		} else {
			// Fallback: forcefully mark node ready
			workInDegree[bestNode] = 0
		}
	}

	// 5. Compute hierarchy levels
	levels := make(map[string]int, len(uniqueTables))
	for _, t := range sorted {
		maxParentLevel := -1
		for _, parent := range dependencies[t] {
			if pLvl, ok := levels[parent]; ok && pLvl > maxParentLevel {
				maxParentLevel = pLvl
			}
		}
		levels[t] = maxParentLevel + 1
	}

	// 6. Assemble TableOrder results
	result := make([]TableOrder, len(sorted))
	dagOrder := make([]string, len(sorted))
	for i, t := range sorted {
		dagOrder[i] = t
		deps := dependencies[t]
		sort.Strings(deps)
		result[i] = TableOrder{
			Table:        t,
			Level:        levels[t],
			Dependencies: deps,
			SelfFKs:      selfFKs[t],
			DeferredFKs:  deferredFKs[t],
		}
	}

	return &DAGResult{
		SortedTables:   result,
		DAGOrder:       dagOrder,
		CyclesDetected: cyclesDetected,
		CycleEdges:     cycleEdges,
	}
}

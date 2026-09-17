package types

type ExplainOptions struct {
	Analyze bool   `json:"analyze"`
	Schema  string `json:"schema,omitempty"`
}

type PlanNode struct {
	NodeType          string                 `json:"nodeType"`
	RelationName      string                 `json:"relationName,omitempty"`
	Schema            string                 `json:"schema,omitempty"`
	Alias             string                 `json:"alias,omitempty"`
	IndexName         string                 `json:"indexName,omitempty"`
	Cost              float64                `json:"cost,omitempty"`
	StartupCost       float64                `json:"startupCost,omitempty"`
	TotalCost         float64                `json:"totalCost,omitempty"`
	Rows              float64                `json:"rows,omitempty"`
	PlanRows          float64                `json:"planRows,omitempty"`
	PlanWidth         int64                  `json:"planWidth,omitempty"`
	ActualStartupTime float64                `json:"actualStartupTime,omitempty"`
	ActualTotalTime   float64                `json:"actualTotalTime,omitempty"`
	ActualTime        float64                `json:"actualTime,omitempty"`
	ActualRows        float64                `json:"actualRows,omitempty"`
	ActualLoops       int64                  `json:"actualLoops,omitempty"`
	Filter            string                 `json:"filter,omitempty"`
	IndexCond         string                 `json:"indexCond,omitempty"`
	HashCond          string                 `json:"hashCond,omitempty"`
	JoinType          string                 `json:"joinType,omitempty"`
	IsExpensive       bool                   `json:"isExpensive"`
	Warnings          []string               `json:"warnings,omitempty"`
	Children          []PlanNode             `json:"children,omitempty"`
	Extra             map[string]interface{} `json:"extra,omitempty"`
}

type ExplainSummary struct {
	TotalCost     float64 `json:"totalCost,omitempty"`
	PlanningTime  float64 `json:"planningTime,omitempty"`
	ExecutionTime float64 `json:"executionTime,omitempty"`
}

type ExplainResult struct {
	Dialect string         `json:"dialect"`
	Root    *PlanNode      `json:"root"`
	Summary ExplainSummary `json:"summary"`
	Raw     string         `json:"raw"`
	Format  string         `json:"format"`
}

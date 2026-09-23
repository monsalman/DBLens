package impact

// ImpactRequest specifies the object and scope to inspect.
type ImpactRequest struct {
	Schema     string `json:"schema"`
	Object     string `json:"object"`
	ObjectType string `json:"object_type"` // "table", "column", "view", "routine"
	Depth      int    `json:"depth"`       // recursion depth, default 5
	Column     string `json:"column,omitempty"`
}

// ImpactNode represents an entity in the dependency graph.
type ImpactNode struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"` // "table", "column", "view", "routine", "trigger", "foreign_key", "index"
	Schema       string `json:"schema"`
	Name         string `json:"name"`
	RefKind      string `json:"ref_kind"`      // "catalog_fk", "catalog_view", "catalog_routine", "trigger_target", "textual_reference"
	Detail       string `json:"detail"`        // e.g. "references users(id)"
	DropBehavior string `json:"drop_behavior"` // "RESTRICT", "CASCADE", "NONE"
}

// ImpactEdge represents a directed dependency link.
type ImpactEdge struct {
	Source       string `json:"source"`
	Target       string `json:"target"`
	Relationship string `json:"relationship"` // "depends_on", "references", "triggers_on", "text_match"
}

// ImpactGraph aggregates the full dependency graph and risk assessment.
type ImpactGraph struct {
	Root            ImpactNode   `json:"root"`
	Nodes           []ImpactNode `json:"nodes"`
	Edges           []ImpactEdge `json:"edges"`
	TotalDependents int          `json:"total_dependents"`
	RiskScore       string       `json:"risk_score"` // "LOW", "MEDIUM", "HIGH", "CRITICAL"
}

// PlanStep represents an ordered step in a safe drop or remediation plan.
type PlanStep struct {
	Order        int    `json:"order"`
	Action       string `json:"action"` // "DROP", "ALTER", "CREATE"
	ObjectKind   string `json:"object_kind"`
	ObjectName   string `json:"object_name"`
	SQL          string `json:"sql"`
	Description  string `json:"description"`
	Irreversible bool   `json:"irreversible"`
}

// RemediationPlan holds the ordered steps and executable UP/DOWN SQL scripts.
type RemediationPlan struct {
	Target          ImpactNode `json:"target"`
	Steps           []PlanStep `json:"steps"`
	EstimatedRisk   string     `json:"estimated_risk"` // "LOW", "MEDIUM", "HIGH", "CRITICAL"
	RequiresCascade bool       `json:"requires_cascade"`
	UpSQL           string     `json:"up_sql"`
	DownSQL         string     `json:"down_sql"`
}

// RenameRequest specifies parameters for renaming a table, view, or column.
type RenameRequest struct {
	Schema     string `json:"schema"`
	Object     string `json:"object"`
	ObjectType string `json:"object_type"` // "table", "column", "view"
	Column     string `json:"column,omitempty"`
	NewName    string `json:"new_name"`
}

// RenamePlan holds the ordered steps and executable DDL for renaming an object and updating dependents.
type RenamePlan struct {
	Target  ImpactNode `json:"target"`
	NewName string     `json:"new_name"`
	Steps   []PlanStep `json:"steps"`
	UpSQL   string     `json:"up_sql"`
	DownSQL string     `json:"down_sql"`
}

// CalculateRiskScore evaluates the risk score based on dependents and kinds.
func CalculateRiskScore(nodes []ImpactNode, edges []ImpactEdge, isColumn bool) string {
	if len(nodes) == 0 {
		return "LOW"
	}

	hasFK := false
	hasTrigger := false
	viewCount := 0
	tableCount := 0

	for _, n := range nodes {
		switch n.Kind {
		case "foreign_key":
			hasFK = true
		case "trigger":
			hasTrigger = true
		case "view":
			viewCount++
		case "table":
			tableCount++
		}
	}

	if tableCount > 0 || hasFK || viewCount >= 4 || len(nodes) >= 6 {
		return "CRITICAL"
	}
	if hasTrigger || viewCount >= 2 || len(nodes) >= 3 {
		return "HIGH"
	}
	if len(nodes) >= 1 {
		return "MEDIUM"
	}
	return "LOW"
}

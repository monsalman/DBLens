package querybuilder

// NodePosition represents a node's coordinates on the visual canvas.
type NodePosition struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// CanvasColumn represents a table column in the visual query builder.
type CanvasColumn struct {
	Name      string `json:"name"`
	Type      string `json:"type,omitempty"`
	Selected  bool   `json:"selected"`
	Alias     string `json:"alias,omitempty"`
	Aggregate string `json:"aggregate,omitempty"` // COUNT, SUM, AVG, MIN, MAX, COUNT_DISTINCT, ""
}

// CanvasTable represents a table node on the visual canvas.
type CanvasTable struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	Schema   string         `json:"schema,omitempty"`
	Alias    string         `json:"alias,omitempty"`
	Position NodePosition   `json:"position,omitempty"`
	Columns  []CanvasColumn `json:"columns"`
}

// CanvasJoin represents a join relationship between two table nodes on canvas.
type CanvasJoin struct {
	ID            string `json:"id"`
	SourceTableID string `json:"sourceTableId"`
	SourceColumn  string `json:"sourceColumn"`
	TargetTableID string `json:"targetTableId"`
	TargetColumn  string `json:"targetColumn"`
	JoinType      string `json:"joinType"` // INNER, LEFT, RIGHT, FULL, CROSS
}

// CanvasFilter represents a WHERE condition.
type CanvasFilter struct {
	ID       string `json:"id"`
	TableID  string `json:"tableId"`
	Column   string `json:"column"`
	Operator string `json:"operator"` // =, !=, <>, >, >=, <, <=, LIKE, ILIKE, IN, NOT IN, IS NULL, IS NOT NULL, BETWEEN
	Value    string `json:"value"`
	Value2   string `json:"value2,omitempty"` // used for BETWEEN
	Logic    string `json:"logic,omitempty"`  // AND, OR (defaults to AND)
}

// CanvasHaving represents a HAVING filter over an aggregate expression.
type CanvasHaving struct {
	ID        string `json:"id"`
	Aggregate string `json:"aggregate"` // COUNT, SUM, AVG, MIN, MAX
	TableID   string `json:"tableId"`
	Column    string `json:"column"`
	Operator  string `json:"operator"` // =, !=, >, >=, <, <=
	Value     string `json:"value"`
	Logic     string `json:"logic,omitempty"` // AND, OR
}

// CanvasOrderBy represents an ORDER BY item.
type CanvasOrderBy struct {
	ID        string `json:"id"`
	TableID   string `json:"tableId"`
	Column    string `json:"column"`
	Direction string `json:"direction"`       // ASC, DESC
	Nulls     string `json:"nulls,omitempty"` // FIRST, LAST, ""
}

// QueryCanvasState represents the full state of the visual query designer.
type QueryCanvasState struct {
	ID          string          `json:"id,omitempty"`
	Name        string          `json:"name,omitempty"`
	Description string          `json:"description,omitempty"`
	Tables      []CanvasTable   `json:"tables"`
	Joins       []CanvasJoin    `json:"joins"`
	Filters     []CanvasFilter  `json:"filters,omitempty"`
	Havings     []CanvasHaving  `json:"havings,omitempty"`
	OrderBy     []CanvasOrderBy `json:"orderBy,omitempty"`
	GroupBy     []string        `json:"groupBy,omitempty"`
	Distinct    bool            `json:"distinct,omitempty"`
	Limit       *int            `json:"limit,omitempty"`
	Offset      *int            `json:"offset,omitempty"`
	CreatedAt   string          `json:"createdAt,omitempty"`
	UpdatedAt   string          `json:"updatedAt,omitempty"`
}

// BuildSQLResponse encapsulates the output of generating SQL from canvas state.
type BuildSQLResponse struct {
	SQL      string   `json:"sql"`
	Dialect  string   `json:"dialect"`
	Warnings []string `json:"warnings,omitempty"`
	Error    string   `json:"error,omitempty"`
}

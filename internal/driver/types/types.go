package types

import "context"

type ColumnMeta struct {
	Name       string  `json:"name"`
	DataType   string  `json:"dataType"`
	IsNullable bool    `json:"isNullable"`
	IsPrimary  bool    `json:"isPrimary"`
	Default    *string `json:"default"`
}

type ForeignKey struct {
	Column    string `json:"column"`
	RefTable  string `json:"refTable"`
	RefColumn string `json:"refColumn"`
}

type TableMeta struct {
	Name   string `json:"name"`
	Schema string `json:"schema"`
	Type   string `json:"type"` // "table" or "view"
}

type TableDetail struct {
	Name    string       `json:"name"`
	Schema  string       `json:"schema"`
	Columns []ColumnMeta `json:"columns"`
	FKs     []ForeignKey `json:"fks"`
	Indexes []string     `json:"indexes"`
}

type QueryOptions struct {
	Schema   string   `json:"schema"`
	Table    string   `json:"table"`
	Limit    int      `json:"limit"`
	Offset   int      `json:"offset"`
	OrderBy  string   `json:"orderBy"`
	OrderDir string   `json:"orderDir"`
	Filters  []Filter `json:"filters"`
}

type Filter struct {
	Column   string `json:"column"`
	Operator string `json:"operator"`
	Value    string `json:"value"`
}

type QueryResult struct {
	Columns      []string        `json:"columns"`
	Rows         [][]interface{} `json:"rows"`
	Elapsed      int64           `json:"elapsed"` // milliseconds
	AffectedRows int64           `json:"affectedRows"`
}

type MutationType string

const (
	MutationInsert MutationType = "INSERT"
	MutationUpdate MutationType = "UPDATE"
	MutationDelete MutationType = "DELETE"
)

type Mutation struct {
	Type   MutationType           `json:"type"`
	Schema string                 `json:"schema"`
	Table  string                 `json:"table"`
	Data   map[string]interface{} `json:"data"`  // for INSERT / UPDATE new values
	Where  map[string]interface{} `json:"where"` // for UPDATE / DELETE condition (PK columns)
}

type MutationResult struct {
	AffectedRows int64  `json:"affectedRows"`
	GeneratedSQL string `json:"generatedSQL"`
}

type ERDTable struct {
	Name    string       `json:"name"`
	Schema  string       `json:"schema"`
	Columns []ColumnMeta `json:"columns"`
	FKs     []ForeignKey `json:"fks"`
}

type Driver interface {
	Dialect() string
	InspectSchemas(ctx context.Context) ([]string, error)
	InspectTables(ctx context.Context, schema string) ([]TableMeta, error)
	InspectTableDetails(ctx context.Context, schema, table string) (*TableDetail, error)
	QueryTableData(ctx context.Context, opts QueryOptions) (*QueryResult, error)
	ExecuteQuery(ctx context.Context, sql string) (*QueryResult, error)
	MutateRow(ctx context.Context, m Mutation) (*MutationResult, error)
	GetERDData(ctx context.Context) ([]ERDTable, error)
	Ping(ctx context.Context) error
	Close() error
}

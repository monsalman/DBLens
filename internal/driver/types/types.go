package types

import (
	"context"
	"database/sql"
)

type ColumnMeta struct {
	Name         string  `json:"name"`
	Type         string  `json:"type"`
	DataType     string  `json:"dataType"`
	IsNullable   bool    `json:"isNullable"`
	IsPrimary    bool    `json:"isPrimary"`
	IsForeignKey bool    `json:"isForeignKey"`
	Default      *string `json:"default"`
}

type ForeignKey struct {
	Name      string `json:"name,omitempty"`
	Column    string `json:"column"`
	RefTable  string `json:"refTable"`
	RefColumn string `json:"refColumn"`
	OnUpdate  string `json:"onUpdate,omitempty"`
	OnDelete  string `json:"onDelete,omitempty"`
}

type IndexMeta struct {
	Name      string   `json:"name"`
	Columns   []string `json:"columns"`
	IsUnique  bool     `json:"isUnique"`
	IsPrimary bool     `json:"isPrimary"`
	Type      string   `json:"type"`
}

type TableMeta struct {
	Name   string `json:"name"`
	Schema string `json:"schema"`
	Type   string `json:"type"` // "table" or "view"
}

type TableDetail struct {
	Name    string       `json:"name"`
	Schema  string       `json:"schema"`
	Dialect string       `json:"dialect,omitempty"`
	Columns []ColumnMeta `json:"columns"`
	FKs     []ForeignKey `json:"fks"`
	Indexes []IndexMeta  `json:"indexes"`
	DDL     string       `json:"ddl,omitempty"`
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

type BatchInsertRequest struct {
	Schema string                   `json:"schema"`
	Table  string                   `json:"table"`
	Rows   []map[string]interface{} `json:"rows"`
}

type ERDTable struct {
	Name    string       `json:"name"`
	Schema  string       `json:"schema"`
	Columns []ColumnMeta `json:"columns"`
	FKs     []ForeignKey `json:"fks"`
}

type Driver interface {
	Dialect() string
	InspectDatabases(ctx context.Context) ([]string, error)
	SelectDatabase(ctx context.Context, dbName string) error
	InspectSchemas(ctx context.Context) ([]string, error)
	InspectTables(ctx context.Context, schema string) ([]TableMeta, error)
	InspectTableDetails(ctx context.Context, schema, table string) (*TableDetail, error)
	GenerateTableDDL(ctx context.Context, schema, table string) (string, error)
	QueryTableData(ctx context.Context, opts QueryOptions) (*QueryResult, error)
	QueryTableStream(ctx context.Context, schema, table string) (*sql.Rows, error)
	ExecuteQuery(ctx context.Context, sql string) (*QueryResult, error)
	MutateRow(ctx context.Context, m Mutation) (*MutationResult, error)
	BatchInsert(ctx context.Context, schema, table string, rows []map[string]interface{}) (*MutationResult, error)
	GetERDData(ctx context.Context) ([]ERDTable, error)
	ExplainQuery(ctx context.Context, sql string, opts ExplainOptions) (*ExplainResult, error)
	Ping(ctx context.Context) error
	Close() error
}

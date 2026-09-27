package snapshot

import "time"

// SchemaSnapshot represents an immutable point-in-time capture of a database schema.
type SchemaSnapshot struct {
	ID            string           `json:"id"`
	ConnID        string           `json:"connId"`
	Label         string           `json:"label"`
	Description   string           `json:"description,omitempty"`
	Dialect       string           `json:"dialect"`
	Database      string           `json:"database,omitempty"`
	CreatedAt     time.Time        `json:"createdAt"`
	Checksum      string           `json:"checksum"` // SHA256 canonical checksum
	TablesCount   int              `json:"tablesCount"`
	ViewsCount    int              `json:"viewsCount"`
	RoutinesCount int              `json:"routinesCount"`
	Tag           string           `json:"tag,omitempty"` // "manual", "pre-migration", "auto"
	Schemas       []SchemaNode     `json:"schemas"`
	Metadata      SnapshotMetadata `json:"metadata,omitempty"`
}

// SnapshotMetadata holds extra contextual metadata for a snapshot.
type SnapshotMetadata struct {
	CapturedBy  string   `json:"capturedBy,omitempty"`
	Host        string   `json:"host,omitempty"`
	GitCommit   string   `json:"gitCommit,omitempty"`
	Environment string   `json:"environment,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

// SchemaNode represents a database schema namespace with its tables and routines.
type SchemaNode struct {
	Name     string        `json:"name"`
	Tables   []TableNode   `json:"tables"`
	Views    []TableNode   `json:"views,omitempty"`
	Routines []RoutineNode `json:"routines,omitempty"`
}

// TableNode represents a relational table or view schema definition.
type TableNode struct {
	Name        string           `json:"name"`
	Schema      string           `json:"schema,omitempty"`
	Type        string           `json:"type,omitempty"` // "table", "view"
	Columns     []ColumnNode     `json:"columns"`
	Indexes     []IndexNode      `json:"indexes,omitempty"`
	ForeignKeys []ForeignKeyNode `json:"foreignKeys,omitempty"`
	Triggers    []TriggerNode    `json:"triggers,omitempty"`
	DDL         string           `json:"ddl,omitempty"`
	Checksum    string           `json:"checksum,omitempty"`
}

// ColumnNode represents a table column definition.
type ColumnNode struct {
	Name         string  `json:"name"`
	Type         string  `json:"type"`
	DataType     string  `json:"dataType,omitempty"`
	IsNullable   bool    `json:"isNullable"`
	IsPrimary    bool    `json:"isPrimary"`
	DefaultValue *string `json:"defaultValue,omitempty"`
	Comment      string  `json:"comment,omitempty"`
}

// IndexNode represents an index on a table.
type IndexNode struct {
	Name      string   `json:"name"`
	Columns   []string `json:"columns"`
	IsUnique  bool     `json:"isUnique"`
	IsPrimary bool     `json:"isPrimary,omitempty"`
	Type      string   `json:"type,omitempty"`
}

// ForeignKeyNode represents a foreign key constraint.
type ForeignKeyNode struct {
	Name      string `json:"name,omitempty"`
	Column    string `json:"column"`
	RefTable  string `json:"refTable"`
	RefColumn string `json:"refColumn"`
	OnUpdate  string `json:"onUpdate,omitempty"`
	OnDelete  string `json:"onDelete,omitempty"`
}

// TriggerNode represents an event trigger on a table.
type TriggerNode struct {
	Name       string   `json:"name"`
	Table      string   `json:"table,omitempty"`
	Events     []string `json:"events,omitempty"`
	Timing     string   `json:"timing,omitempty"`
	Definition string   `json:"definition,omitempty"`
}

// RoutineNode represents a stored procedure or function.
type RoutineNode struct {
	Name       string `json:"name"`
	Schema     string `json:"schema,omitempty"`
	Type       string `json:"type"` // "procedure", "function"
	ReturnType string `json:"returnType,omitempty"`
	Definition string `json:"definition,omitempty"`
}

// DiffSummary provides aggregate counts of changes between two snapshots.
type DiffSummary struct {
	AddedTables        int `json:"addedTables"`
	DroppedTables      int `json:"droppedTables"`
	AlteredTables      int `json:"alteredTables"`
	AddedColumns       int `json:"addedColumns"`
	DroppedColumns     int `json:"droppedColumns"`
	AlteredColumns     int `json:"alteredColumns"`
	AddedIndexes       int `json:"addedIndexes"`
	DroppedIndexes     int `json:"droppedIndexes"`
	AddedForeignKeys   int `json:"addedForeignKeys"`
	DroppedForeignKeys int `json:"droppedForeignKeys"`
}

// SnapshotDiff represents structural differences between two snapshots.
type SnapshotDiff struct {
	BaseSnapshotID   string       `json:"baseSnapshotId,omitempty"`
	TargetSnapshotID string       `json:"targetSnapshotId,omitempty"`
	BaseLabel        string       `json:"baseLabel,omitempty"`
	TargetLabel      string       `json:"targetLabel,omitempty"`
	Dialect          string       `json:"dialect"`
	TotalDrifts      int          `json:"totalDrifts"`
	AddedTables      []TableNode  `json:"addedTables"`
	DroppedTables    []TableNode  `json:"droppedTables"`
	AlteredTables    []TableDrift `json:"alteredTables"`
	Summary          DiffSummary  `json:"summary"`
}

// TableDrift captures structural changes on a single table.
type TableDrift struct {
	TableName          string           `json:"tableName"`
	Schema             string           `json:"schema,omitempty"`
	AddedColumns       []ColumnNode     `json:"addedColumns,omitempty"`
	DroppedColumns     []ColumnNode     `json:"droppedColumns,omitempty"`
	AlteredColumns     []ColumnDrift    `json:"alteredColumns,omitempty"`
	AddedIndexes       []IndexNode      `json:"addedIndexes,omitempty"`
	DroppedIndexes     []IndexNode      `json:"droppedIndexes,omitempty"`
	AddedForeignKeys   []ForeignKeyNode `json:"addedForeignKeys,omitempty"`
	DroppedForeignKeys []ForeignKeyNode `json:"droppedForeignKeys,omitempty"`
}

// ColumnDrift captures changes between two versions of a column.
type ColumnDrift struct {
	ColumnName string     `json:"columnName"`
	OldColumn  ColumnNode `json:"oldColumn"`
	NewColumn  ColumnNode `json:"newColumn"`
	Changes    []string   `json:"changes"`
}

// RollbackPlan contains forward (UP) and reverse (DOWN) migration SQL statements.
type RollbackPlan struct {
	BaseSnapshotID   string   `json:"baseSnapshotId"`
	TargetSnapshotID string   `json:"targetSnapshotId"`
	Dialect          string   `json:"dialect"`
	UpSQL            string   `json:"upSql"`
	DownSQL          string   `json:"downSql"`
	Warnings         []string `json:"warnings"`
	Destructive      bool     `json:"destructive"`
}

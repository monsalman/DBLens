package dictionary

import "time"

// DataDictionary represents a complete database catalog with rich metadata,
// documentation comments, PII classifications, and schema statistics.
type DataDictionary struct {
	ConnectionID string             `json:"connectionId"`
	Dialect      string             `json:"dialect"`
	Database     string             `json:"database,omitempty"`
	GeneratedAt  time.Time          `json:"generatedAt"`
	Schemas      []DictionarySchema `json:"schemas"`
	Summary      DictionarySummary  `json:"summary"`
}

// DictionarySchema groups tables within a database namespace/schema.
type DictionarySchema struct {
	Name        string            `json:"name"`
	Tables      []DictionaryTable `json:"tables"`
	TableCount  int               `json:"tableCount"`
	ColumnCount int               `json:"columnCount"`
}

// DictionaryTable holds detailed metadata, storage metrics, and column details for a table or view.
type DictionaryTable struct {
	Name          string                 `json:"name"`
	Schema        string                 `json:"schema"`
	Type          string                 `json:"type"` // "table" or "view"
	Comment       string                 `json:"comment"`
	RowCount      int64                  `json:"rowCount"`
	SizeBytes     int64                  `json:"sizeBytes"`
	SizeFormatted string                 `json:"sizeFormatted"`
	Columns       []DictionaryColumn     `json:"columns"`
	Indexes       []DictionaryIndex      `json:"indexes"`
	ForeignKeys   []DictionaryForeignKey `json:"foreignKeys"`
	PIICount      int                    `json:"piiCount"`
}

// DictionaryColumn represents one column with data type, constraints, PII tags, and description.
type DictionaryColumn struct {
	Name         string  `json:"name"`
	Type         string  `json:"type"`
	DataType     string  `json:"dataType"`
	IsNullable   bool    `json:"isNullable"`
	IsPrimary    bool    `json:"isPrimary"`
	IsForeignKey bool    `json:"isForeignKey"`
	Default      *string `json:"default"`
	Comment      string  `json:"comment"`
	PIIType      string  `json:"piiType,omitempty"`
	Ordinal      int     `json:"ordinal"`
}

// DictionaryIndex captures index metadata.
type DictionaryIndex struct {
	Name      string   `json:"name"`
	Columns   []string `json:"columns"`
	IsUnique  bool     `json:"isUnique"`
	IsPrimary bool     `json:"isPrimary"`
	Type      string   `json:"type"`
}

// DictionaryForeignKey captures relationship constraints.
type DictionaryForeignKey struct {
	Name      string `json:"name,omitempty"`
	Column    string `json:"column"`
	RefTable  string `json:"refTable"`
	RefColumn string `json:"refColumn"`
	OnUpdate  string `json:"onUpdate,omitempty"`
	OnDelete  string `json:"onDelete,omitempty"`
}

// DictionarySummary computes high-level documentation metrics and compliance coverage.
type DictionarySummary struct {
	TotalSchemas          int     `json:"totalSchemas"`
	TotalTables           int     `json:"totalTables"`
	TotalViews            int     `json:"totalViews"`
	TotalColumns          int     `json:"totalColumns"`
	TotalIndexes          int     `json:"totalIndexes"`
	TotalForeignKeys      int     `json:"totalForeignKeys"`
	TotalPIIColumns       int     `json:"totalPIIColumns"`
	DocumentedColumns     int     `json:"documentedColumns"`
	DocumentationCoverage float64 `json:"documentationCoverage"` // percentage (0.0 - 100.0)
}

// CommentUpdateRequest specifies a comment modification for a table or column.
type CommentUpdateRequest struct {
	Schema   string `json:"schema"`
	Table    string `json:"table"`
	Column   string `json:"column,omitempty"` // empty if table-level comment
	Comment  string `json:"comment"`
	SyncToDB bool   `json:"syncToDB"`
}

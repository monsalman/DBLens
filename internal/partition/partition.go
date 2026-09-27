package partition

// PartitionTopology represents the complete partitioning hierarchy and stats for a parent table.
type PartitionTopology struct {
	ParentTable  string                 `json:"parentTable"`
	Schema       string                 `json:"schema"`
	Dialect      string                 `json:"dialect"`
	Strategy     string                 `json:"strategy"` // RANGE, LIST, HASH, NONE, CHUNK
	PartitionKey string                 `json:"partitionKey,omitempty"`
	TotalRows    int64                  `json:"totalRows"`
	TotalBytes   int64                  `json:"totalBytes"`
	SkewIndex    float64                `json:"skewIndex"` // CV: stddev / mean
	Partitions   []PartitionNode        `json:"partitions"`
	HealthReport *PartitionHealthReport `json:"healthReport,omitempty"`
}

// PartitionNode represents an individual partition/shard slice.
type PartitionNode struct {
	Name            string                 `json:"name"`
	Schema          string                 `json:"schema"`
	ParentTable     string                 `json:"parentTable"`
	BoundExpression string                 `json:"boundExpression"` // e.g. "FOR VALUES FROM ('2026-01-01') TO ('2026-02-01')"
	PartitionType   string                 `json:"partitionType"`   // range, list, hash, chunk
	Rows            int64                  `json:"rows"`
	Bytes           int64                  `json:"bytes"`
	RowSharePct     float64                `json:"rowSharePct"`
	ByteSharePct    float64                `json:"byteSharePct"`
	Status          string                 `json:"status"` // healthy, hot_skew, approaching_capacity, missing_future
	Subpartitions   []PartitionNode        `json:"subpartitions,omitempty"`
	IsDetached      bool                   `json:"isDetached,omitempty"`
	Metadata        map[string]interface{} `json:"metadata,omitempty"`
}

// GeneratePartitionDDLRequest defines parameters for generating upcoming partition DDL.
type GeneratePartitionDDLRequest struct {
	ParentTable  string `json:"parentTable"`
	Schema       string `json:"schema"`
	Dialect      string `json:"dialect"`
	Strategy     string `json:"strategy"` // range, list, hash
	PartitionKey string `json:"partitionKey"`
	Interval     string `json:"interval"` // day, month, year
	Count        int    `json:"count"`    // e.g. 3, 6, 12
	StartDate    string `json:"startDate,omitempty"`
}

// MaintenancePlan provides generated DDL and guidance for partition operations.
type MaintenancePlan struct {
	ParentTable    string   `json:"parentTable"`
	Schema         string   `json:"schema"`
	GeneratedDDL   []string `json:"generatedDDL"`
	DetachDDL      []string `json:"detachDDL,omitempty"`
	Recommendation string   `json:"recommendation"`
}

// PartitionHealthReport holds skew and maintenance alerts.
type PartitionHealthReport struct {
	ParentTable      string   `json:"parentTable"`
	SkewIndex        float64  `json:"skewIndex"`
	HasHotSkew       bool     `json:"hasHotSkew"`
	HotNodes         []string `json:"hotNodes,omitempty"`
	MissingFuture    bool     `json:"missingFuture"`
	FutureBufferDays int      `json:"futureBufferDays,omitempty"`
	Warnings         []string `json:"warnings"`
	Score            int      `json:"score"` // 0-100
}

// DetachPartitionRequest defines parameters to detach a partition.
type DetachPartitionRequest struct {
	ParentTable   string `json:"parentTable"`
	Schema        string `json:"schema"`
	PartitionName string `json:"partitionName"`
	Concurrently  bool   `json:"concurrently"`
}

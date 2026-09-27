package partition

import (
	"fmt"
	"strings"
	"time"
)

func validateIdent(ident string) error {
	ident = strings.TrimSpace(ident)
	if ident == "" {
		return fmt.Errorf("identifier cannot be empty")
	}
	for _, r := range ident {
		if r == ';' || r == 0 || r == '\r' || r == '\n' || r < 32 {
			return fmt.Errorf("identifier contains illegal or control characters")
		}
	}
	return nil
}

func quoteIdent(name, dialect string) string {
	d := strings.ToLower(strings.TrimSpace(dialect))
	switch d {
	case "mysql", "mariadb":
		return "`" + strings.ReplaceAll(name, "`", "``") + "`"
	default: // postgres, sqlite, sqlite3
		return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
	}
}

// GenerateUpcomingDDL generates DDL to create upcoming partition slices.
func GenerateUpcomingDDL(req GeneratePartitionDDLRequest) (*MaintenancePlan, error) {
	parentName := strings.TrimSpace(req.ParentTable)
	if parentName == "" {
		return nil, fmt.Errorf("parent table is required")
	}
	if err := validateIdent(parentName); err != nil {
		return nil, fmt.Errorf("invalid parent table: %w", err)
	}

	schema := strings.TrimSpace(req.Schema)
	if schema != "" {
		if err := validateIdent(schema); err != nil {
			return nil, fmt.Errorf("invalid schema: %w", err)
		}
	}

	count := req.Count
	if count <= 0 {
		count = 3
	}
	if count > 60 {
		count = 60
	}

	interval := strings.ToLower(strings.TrimSpace(req.Interval))
	if interval != "day" && interval != "year" {
		interval = "month"
	}

	dialect := strings.ToLower(strings.TrimSpace(req.Dialect))
	if dialect == "" {
		dialect = "postgres"
	}

	var curDate time.Time
	if strings.TrimSpace(req.StartDate) != "" {
		if t, err := time.Parse("2006-01-02", req.StartDate); err == nil {
			curDate = t
		} else if t, err := time.Parse("2006-01", req.StartDate); err == nil {
			curDate = t
		} else if t, err := time.Parse("2006", req.StartDate); err == nil {
			curDate = t
		}
	}
	if curDate.IsZero() {
		now := time.Now().UTC()
		switch interval {
		case "day":
			curDate = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, 1)
		case "year":
			curDate = time.Date(now.Year()+1, 1, 1, 0, 0, 0, 0, time.UTC)
		default: // month
			curDate = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, 1, 0)
		}
	}

	var ddlList []string

	for i := 0; i < count; i++ {
		var nextDate time.Time
		var suffix string
		var startStr, endStr string

		switch interval {
		case "day":
			nextDate = curDate.AddDate(0, 0, 1)
			suffix = curDate.Format("2006_01_02")
			startStr = curDate.Format("2006-01-02")
			endStr = nextDate.Format("2006-01-02")
		case "year":
			nextDate = curDate.AddDate(1, 0, 0)
			suffix = curDate.Format("2006")
			startStr = curDate.Format("2006-01-02")
			endStr = nextDate.Format("2006-01-02")
		default: // month
			nextDate = curDate.AddDate(0, 1, 0)
			suffix = curDate.Format("2006_01")
			startStr = curDate.Format("2006-01-02")
			endStr = nextDate.Format("2006-01-02")
		}

		partName := fmt.Sprintf("%s_%s", parentName, suffix)

		switch dialect {
		case "mysql", "mariadb":
			mysqlPartName := fmt.Sprintf("p%s", strings.ReplaceAll(suffix, "_", ""))
			parentRef := quoteIdent(parentName, dialect)
			if schema != "" {
				parentRef = fmt.Sprintf("%s.%s", quoteIdent(schema, dialect), quoteIdent(parentName, dialect))
			}
			stmt := fmt.Sprintf("ALTER TABLE %s ADD PARTITION (PARTITION %s VALUES LESS THAN ('%s'));",
				parentRef, quoteIdent(mysqlPartName, dialect), endStr)
			ddlList = append(ddlList, stmt)
		case "sqlite", "sqlite3":
			parentRef := quoteIdent(parentName, dialect)
			partRef := quoteIdent(partName, dialect)
			if schema != "" {
				parentRef = fmt.Sprintf("%s.%s", quoteIdent(schema, dialect), quoteIdent(parentName, dialect))
				partRef = fmt.Sprintf("%s.%s", quoteIdent(schema, dialect), quoteIdent(partName, dialect))
			}
			stmt := fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s AS SELECT * FROM %s WHERE 0;",
				partRef, parentRef)
			ddlList = append(ddlList, stmt)
		default: // postgres
			parentRef := quoteIdent(parentName, dialect)
			partRef := quoteIdent(partName, dialect)
			if schema != "" {
				parentRef = fmt.Sprintf("%s.%s", quoteIdent(schema, dialect), quoteIdent(parentName, dialect))
				partRef = fmt.Sprintf("%s.%s", quoteIdent(schema, dialect), quoteIdent(partName, dialect))
			}
			stmt := fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s PARTITION OF %s FOR VALUES FROM ('%s') TO ('%s');",
				partRef, parentRef, startStr, endStr)
			ddlList = append(ddlList, stmt)
		}

		curDate = nextDate
	}

	plan := &MaintenancePlan{
		ParentTable:    parentName,
		Schema:         schema,
		GeneratedDDL:   ddlList,
		Recommendation: fmt.Sprintf("Execute during low-traffic maintenance window. Created %d upcoming partition slices ahead of time to prevent ingestion failures.", count),
	}

	return plan, nil
}

// GenerateDetachDDL formats safe partition detach / drop statements.
func GenerateDetachDDL(req DetachPartitionRequest, dialect string) (string, error) {
	parent := strings.TrimSpace(req.ParentTable)
	part := strings.TrimSpace(req.PartitionName)
	if parent == "" || part == "" {
		return "", fmt.Errorf("parentTable and partitionName are required")
	}
	if err := validateIdent(parent); err != nil {
		return "", fmt.Errorf("invalid parent table: %w", err)
	}
	if err := validateIdent(part); err != nil {
		return "", fmt.Errorf("invalid partition name: %w", err)
	}

	schema := strings.TrimSpace(req.Schema)
	if schema != "" {
		if err := validateIdent(schema); err != nil {
			return "", fmt.Errorf("invalid schema: %w", err)
		}
	}

	d := strings.ToLower(strings.TrimSpace(dialect))

	switch d {
	case "mysql", "mariadb":
		parentRef := quoteIdent(parent, d)
		if schema != "" {
			parentRef = fmt.Sprintf("%s.%s", quoteIdent(schema, d), quoteIdent(parent, d))
		}
		return fmt.Sprintf("ALTER TABLE %s DROP PARTITION %s;", parentRef, quoteIdent(part, d)), nil
	case "sqlite", "sqlite3":
		partRef := quoteIdent(part, d)
		if schema != "" {
			partRef = fmt.Sprintf("%s.%s", quoteIdent(schema, d), quoteIdent(part, d))
		}
		return fmt.Sprintf("DROP TABLE IF EXISTS %s;", partRef), nil
	default: // postgres
		parentRef := quoteIdent(parent, d)
		partRef := quoteIdent(part, d)
		if schema != "" {
			parentRef = fmt.Sprintf("%s.%s", quoteIdent(schema, d), quoteIdent(parent, d))
			partRef = fmt.Sprintf("%s.%s", quoteIdent(schema, d), quoteIdent(part, d))
		}
		if req.Concurrently {
			return fmt.Sprintf("ALTER TABLE %s DETACH PARTITION %s CONCURRENTLY;", parentRef, partRef), nil
		}
		return fmt.Sprintf("ALTER TABLE %s DETACH PARTITION %s;", parentRef, partRef), nil
	}
}

// RenderMarkdown builds a complete Markdown report of partition topology and health.
func RenderMarkdown(topo *PartitionTopology) string {
	if topo == nil {
		return "# Partition Topology\n\nNo topology data available.\n"
	}

	var sb strings.Builder
	title := topo.ParentTable
	if topo.Schema != "" {
		title = topo.Schema + "." + topo.ParentTable
	}

	sb.WriteString(fmt.Sprintf("# Partition & Shard Topology: %s\n\n", title))
	sb.WriteString("## Overview\n\n")
	sb.WriteString(fmt.Sprintf("- **Dialect:** `%s`\n", topo.Dialect))
	sb.WriteString(fmt.Sprintf("- **Strategy:** `%s`\n", topo.Strategy))
	if topo.PartitionKey != "" {
		sb.WriteString(fmt.Sprintf("- **Partition Key:** `%s`\n", topo.PartitionKey))
	}
	sb.WriteString(fmt.Sprintf("- **Partitions Count:** %d\n", len(topo.Partitions)))
	sb.WriteString(fmt.Sprintf("- **Total Rows:** %d\n", topo.TotalRows))
	sb.WriteString(fmt.Sprintf("- **Total Storage:** %s\n", formatBytes(topo.TotalBytes)))
	sb.WriteString(fmt.Sprintf("- **Skew Index (CV):** `%.2f`\n", topo.SkewIndex))

	if topo.HealthReport != nil {
		sb.WriteString(fmt.Sprintf("- **Health Score:** %d / 100\n", topo.HealthReport.Score))
		if len(topo.HealthReport.Warnings) > 0 {
			sb.WriteString("\n### ⚠️ Health & Skew Warnings\n\n")
			for _, w := range topo.HealthReport.Warnings {
				sb.WriteString(fmt.Sprintf("- %s\n", w))
			}
		}
	}

	sb.WriteString("\n## Partition Slices\n\n")
	if len(topo.Partitions) == 0 {
		sb.WriteString("_No partition nodes detected for this table._\n")
	} else {
		sb.WriteString("| Partition Name | Bound Expression | Rows | Row Share | Storage | Byte Share | Status |\n")
		sb.WriteString("|:---|:---|---:|---:|---:|---:|:---|\n")
		for _, p := range topo.Partitions {
			bound := p.BoundExpression
			if bound == "" {
				bound = "-"
			}
			statusBadge := p.Status
			switch p.Status {
			case "hot_skew":
				statusBadge = "🔥 HOT SKEW"
			case "approaching_capacity":
				statusBadge = "⚠️ APPROACHING CAPACITY"
			case "healthy":
				statusBadge = "✅ HEALTHY"
			}
			sb.WriteString(fmt.Sprintf("| `%s` | `%s` | %d | %.1f%% | %s | %.1f%% | %s |\n",
				p.Name, bound, p.Rows, p.RowSharePct, formatBytes(p.Bytes), p.ByteSharePct, statusBadge))
		}
	}

	sb.WriteString("\n---\n_Generated by DBLens Partition & Shard Visualizer_\n")
	return sb.String()
}

func formatBytes(b int64) string {
	if b <= 0 {
		return "0 B"
	}
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

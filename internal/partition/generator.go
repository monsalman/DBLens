package partition

import (
	"fmt"
	"strings"
	"time"
)

// GenerateUpcomingDDL generates DDL to create upcoming partition slices.
func GenerateUpcomingDDL(req GeneratePartitionDDLRequest) (*MaintenancePlan, error) {
	if strings.TrimSpace(req.ParentTable) == "" {
		return nil, fmt.Errorf("parent table is required")
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
	parentName := strings.TrimSpace(req.ParentTable)
	schema := strings.TrimSpace(req.Schema)

	schemaPrefix := ""
	if schema != "" && dialect == "postgres" {
		schemaPrefix = fmt.Sprintf(`"%s".`, schema)
	}

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
			stmt := fmt.Sprintf("ALTER TABLE `%s` ADD PARTITION (PARTITION `%s` VALUES LESS THAN ('%s'));",
				parentName, mysqlPartName, endStr)
			ddlList = append(ddlList, stmt)
		case "sqlite", "sqlite3":
			stmt := fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s%s AS SELECT * FROM %s%s WHERE 0;",
				schemaPrefix, partName, schemaPrefix, parentName)
			ddlList = append(ddlList, stmt)
		default: // postgres
			stmt := fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s%s PARTITION OF %s%s FOR VALUES FROM ('%s') TO ('%s');",
				schemaPrefix, partName, schemaPrefix, parentName, startStr, endStr)
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

	schema := strings.TrimSpace(req.Schema)
	d := strings.ToLower(strings.TrimSpace(dialect))

	switch d {
	case "mysql", "mariadb":
		return fmt.Sprintf("ALTER TABLE `%s` DROP PARTITION `%s`;", parent, part), nil
	case "sqlite", "sqlite3":
		return fmt.Sprintf("DROP TABLE IF EXISTS `%s`;", part), nil
	default: // postgres
		parentRef := parent
		partRef := part
		if schema != "" {
			parentRef = fmt.Sprintf(`"%s"."%s"`, schema, parent)
			partRef = fmt.Sprintf(`"%s"."%s"`, schema, part)
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

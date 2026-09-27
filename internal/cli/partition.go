package cli

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/dblens/dblens/internal/partition"
)

const PartitionUsage = `Usage:
  dblens partition [command] [flags]

Commands:
  inspect    Inspect physical partition & shard topology for a table
  health     Audit skew index, hot partitions, and headroom alerts

Use "dblens partition [command] --help" for more information about a command.
`

func runPartition(ctx context.Context, args []string) int {
	if len(args) == 0 {
		fmt.Print(PartitionUsage)
		return 0
	}

	sub := args[0]
	subArgs := args[1:]

	switch sub {
	case "inspect":
		return runPartitionInspect(ctx, subArgs)
	case "health":
		return runPartitionHealth(ctx, subArgs)
	case "--help", "-h", "help":
		fmt.Print(PartitionUsage)
		return 0
	default:
		fmt.Fprintf(os.Stderr, "Error: unknown partition subcommand %q\n\n%s", sub, PartitionUsage)
		return 1
	}
}

func runPartitionInspect(ctx context.Context, args []string) int {
	fsCmd := flag.NewFlagSet("partition inspect", flag.ContinueOnError)
	fsCmd.SetOutput(os.Stderr)

	var (
		connID  string
		conn    string
		table   string
		schema  string
		format  string
		dataDir string
	)

	fsCmd.StringVar(&connID, "conn-id", "", "Database DSN or connection ID")
	fsCmd.StringVar(&conn, "conn", "", "Database DSN or connection ID (alias for --conn-id)")
	fsCmd.StringVar(&table, "table", "", "Table name to inspect")
	fsCmd.StringVar(&schema, "schema", "", "Schema name (optional)")
	fsCmd.StringVar(&format, "format", "table", "Output format: table, json, or md")
	fsCmd.StringVar(&dataDir, "data", "", "Data directory for saved connection profiles")

	if err := fsCmd.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 1
	}

	targetConn := connID
	if targetConn == "" {
		targetConn = conn
	}
	if targetConn == "" {
		fmt.Fprintln(os.Stderr, "Error: --conn-id (or --conn) is required")
		return 1
	}

	if strings.TrimSpace(table) == "" {
		fmt.Fprintln(os.Stderr, "Error: --table is required")
		return 1
	}

	drv, cleanup, err := resolveDriver(targetConn, dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		return 1
	}
	defer cleanup()

	topo, err := partition.InspectTopology(ctx, drv, schema, table)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error inspecting partition topology: %v\n", err)
		return 1
	}

	switch strings.ToLower(format) {
	case "json":
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(topo)
	case "md", "markdown":
		fmt.Print(partition.RenderMarkdown(topo))
	default:
		fmt.Printf("Partition Topology: %s.%s (%s)\n", topo.Schema, topo.ParentTable, topo.Dialect)
		fmt.Printf("Strategy: %s | Key: %s | Partitions: %d | Total Rows: %d | Total Storage: %s | Skew Index: %.2f\n",
			topo.Strategy, topo.PartitionKey, len(topo.Partitions), topo.TotalRows, formatBytes(topo.TotalBytes), topo.SkewIndex)
		if topo.HealthReport != nil {
			fmt.Printf("Health Score: %d / 100\n", topo.HealthReport.Score)
			for _, w := range topo.HealthReport.Warnings {
				fmt.Printf("  ⚠️  %s\n", w)
			}
		}
		fmt.Println("\nPartitions:")
		if len(topo.Partitions) == 0 {
			fmt.Println("  (no partition slices found)")
		} else {
			fmt.Printf("  %-30s %-12s %-12s %-8s %-10s %-8s %-15s\n", "NAME", "BOUND", "ROWS", "ROW%", "BYTES", "BYTE%", "STATUS")
			for _, p := range topo.Partitions {
				bound := p.BoundExpression
				if len(bound) > 25 {
					bound = bound[:22] + "..."
				}
				if bound == "" {
					bound = "-"
				}
				fmt.Printf("  %-30s %-12s %-12d %-8.1f%% %-10s %-8.1f%% %-15s\n",
					p.Name, bound, p.Rows, p.RowSharePct, formatBytes(p.Bytes), p.ByteSharePct, p.Status)
			}
		}
	}

	return 0
}

func runPartitionHealth(ctx context.Context, args []string) int {
	fsCmd := flag.NewFlagSet("partition health", flag.ContinueOnError)
	fsCmd.SetOutput(os.Stderr)

	var (
		connID  string
		conn    string
		table   string
		schema  string
		format  string
		dataDir string
	)

	fsCmd.StringVar(&connID, "conn-id", "", "Database DSN or connection ID")
	fsCmd.StringVar(&conn, "conn", "", "Database DSN or connection ID (alias for --conn-id)")
	fsCmd.StringVar(&table, "table", "", "Table name (optional)")
	fsCmd.StringVar(&schema, "schema", "", "Schema name (optional)")
	fsCmd.StringVar(&format, "format", "table", "Output format: table or json")
	fsCmd.StringVar(&dataDir, "data", "", "Data directory for saved connection profiles")

	if err := fsCmd.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 1
	}

	targetConn := connID
	if targetConn == "" {
		targetConn = conn
	}
	if targetConn == "" {
		fmt.Fprintln(os.Stderr, "Error: --conn-id (or --conn) is required")
		return 1
	}

	drv, cleanup, err := resolveDriver(targetConn, dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		return 1
	}
	defer cleanup()

	if strings.TrimSpace(table) != "" {
		topo, err := partition.InspectTopology(ctx, drv, schema, table)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error inspecting partition health: %v\n", err)
			return 1
		}
		if strings.ToLower(format) == "json" {
			enc := json.NewEncoder(os.Stdout)
			enc.SetIndent("", "  ")
			_ = enc.Encode(topo.HealthReport)
		} else {
			fmt.Printf("Health Report: %s (Score: %d/100, Skew Index: %.2f)\n", table, topo.HealthReport.Score, topo.HealthReport.SkewIndex)
			if len(topo.HealthReport.Warnings) == 0 {
				fmt.Println("  ✅ All partition health checks passed.")
			} else {
				for _, w := range topo.HealthReport.Warnings {
					fmt.Printf("  ⚠️  %s\n", w)
				}
			}
		}
		return 0
	}

	// Multiple table inspection
	tables, err := drv.InspectTables(ctx, schema)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error listing tables: %v\n", err)
		return 1
	}

	var reports []*partition.PartitionHealthReport
	for _, tMeta := range tables {
		if tMeta.Type == "view" {
			continue
		}
		topo, err := partition.InspectTopology(ctx, drv, tMeta.Schema, tMeta.Name)
		if err == nil && topo != nil && len(topo.Partitions) > 0 {
			reports = append(reports, topo.HealthReport)
		}
	}

	if strings.ToLower(format) == "json" {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(reports)
	} else {
		fmt.Printf("Partition Health Audit: %d partitioned tables inspected\n", len(reports))
		if len(reports) == 0 {
			fmt.Println("  (no partitioned tables detected)")
		} else {
			fmt.Printf("  %-25s %-10s %-12s %-10s %s\n", "TABLE", "SCORE", "SKEW INDEX", "HOT SKEW", "WARNINGS")
			for _, r := range reports {
				hotStr := "No"
				if r.HasHotSkew {
					hotStr = "YES"
				}
				wStr := "-"
				if len(r.Warnings) > 0 {
					wStr = fmt.Sprintf("%d alert(s)", len(r.Warnings))
				}
				fmt.Printf("  %-25s %-10d %-12.2f %-10s %s\n", r.ParentTable, r.Score, r.SkewIndex, hotStr, wStr)
			}
		}
	}

	return 0
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

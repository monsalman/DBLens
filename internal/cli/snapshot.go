package cli

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/snapshot"
)

const SnapshotUsage = `Usage:
  dblens snapshot [command] [flags]

Commands:
  capture    Capture current live schema state and save to snapshot vault
  list       List all saved schema snapshots for a connection
  rollback   Generate UP/DOWN rollback SQL script between snapshots

Use "dblens snapshot [command] --help" for more information about a command.
`

func runSnapshot(ctx context.Context, args []string) int {
	if len(args) == 0 {
		fmt.Print(SnapshotUsage)
		return 0
	}

	sub := args[0]
	subArgs := args[1:]

	switch sub {
	case "capture":
		return runSnapshotCapture(ctx, subArgs)
	case "list":
		return runSnapshotList(ctx, subArgs)
	case "rollback":
		return runSnapshotRollback(ctx, subArgs)
	case "--help", "-h", "help":
		fmt.Print(SnapshotUsage)
		return 0
	default:
		fmt.Fprintf(os.Stderr, "Error: unknown snapshot subcommand %q\n\n%s", sub, SnapshotUsage)
		return 1
	}
}

func getSnapshotStore(dataDir string) *snapshot.Store {
	if strings.TrimSpace(dataDir) != "" {
		return snapshot.NewStore(filepath.Join(dataDir, "snapshots"))
	}
	return snapshot.NewStore("")
}

func runSnapshotCapture(ctx context.Context, args []string) int {
	fsCmd := flag.NewFlagSet("snapshot capture", flag.ContinueOnError)
	fsCmd.SetOutput(os.Stderr)

	var (
		connID      string
		label       string
		tag         string
		description string
		targetSchema string
		dataDir     string
		format      string
	)

	fsCmd.StringVar(&connID, "conn-id", "", "Database connection string or profile ID")
	fsCmd.StringVar(&connID, "conn", "", "Alias for --conn-id")
	fsCmd.StringVar(&label, "label", "", "Label or title for this snapshot")
	fsCmd.StringVar(&tag, "tag", "manual", "Tag: manual, pre-migration, auto")
	fsCmd.StringVar(&description, "desc", "", "Description for this snapshot")
	fsCmd.StringVar(&targetSchema, "schema", "", "Filter to specific schema namespace")
	fsCmd.StringVar(&dataDir, "data", "", "DBLens data directory")
	fsCmd.StringVar(&format, "format", "text", "Output format (text|json)")

	if err := fsCmd.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 1
	}

	if connID == "" {
		fmt.Fprintln(os.Stderr, "Error: --conn-id is required")
		return 1
	}

	drv, cleanup, err := resolveDriver(connID, dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		return 1
	}
	defer cleanup()

	snap, err := snapshot.CaptureSnapshot(ctx, drv, connID, label, tag, description, targetSchema)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to capture snapshot: %v\n", err)
		return 1
	}

	store := getSnapshotStore(dataDir)
	if err := store.Save(snap); err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to persist snapshot: %v\n", err)
		return 1
	}

	if strings.EqualFold(format, "json") {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(snap)
		return 0
	}

	fmt.Printf("Schema snapshot captured successfully!\n")
	fmt.Printf("  ID:           %s\n", snap.ID)
	fmt.Printf("  Label:        %s\n", snap.Label)
	fmt.Printf("  Tag:          %s\n", snap.Tag)
	fmt.Printf("  Dialect:      %s\n", snap.Dialect)
	fmt.Printf("  Tables:       %d\n", snap.TablesCount)
	fmt.Printf("  Views:        %d\n", snap.ViewsCount)
	fmt.Printf("  Checksum:     %s\n", snap.Checksum)
	fmt.Printf("  Captured At:  %s\n", snap.CreatedAt.Format(time.RFC3339))

	return 0
}

func runSnapshotList(ctx context.Context, args []string) int {
	fsCmd := flag.NewFlagSet("snapshot list", flag.ContinueOnError)
	fsCmd.SetOutput(os.Stderr)

	var (
		connID  string
		dataDir string
		format  string
	)

	fsCmd.StringVar(&connID, "conn-id", "", "Database connection string or profile ID")
	fsCmd.StringVar(&connID, "conn", "", "Alias for --conn-id")
	fsCmd.StringVar(&dataDir, "data", "", "DBLens data directory")
	fsCmd.StringVar(&format, "format", "text", "Output format (text|json)")

	if err := fsCmd.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 1
	}

	if connID == "" {
		fmt.Fprintln(os.Stderr, "Error: --conn-id is required")
		return 1
	}

	store := getSnapshotStore(dataDir)
	snapshots, err := store.List(connID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to list snapshots: %v\n", err)
		return 1
	}

	if strings.EqualFold(format, "json") {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(snapshots)
		return 0
	}

	if len(snapshots) == 0 {
		fmt.Printf("No snapshots found for connection %q\n", connID)
		return 0
	}

	fmt.Printf("%-24s  %-20s  %-12s  %-8s  %-19s\n", "SNAPSHOT ID", "LABEL", "TAG", "TABLES", "CREATED AT")
	fmt.Println(strings.Repeat("-", 90))
	for _, s := range snapshots {
		fmt.Printf("%-24s  %-20s  %-12s  %-8d  %-19s\n",
			s.ID,
			truncateStr(s.Label, 20),
			s.Tag,
			s.TablesCount,
			s.CreatedAt.Format("2006-01-02 15:04:05"),
		)
	}

	return 0
}

func runSnapshotRollback(ctx context.Context, args []string) int {
	fsCmd := flag.NewFlagSet("snapshot rollback", flag.ContinueOnError)
	fsCmd.SetOutput(os.Stderr)

	var (
		connID    string
		baseID    string
		targetID  string
		direction string
		dataDir   string
		format    string
	)

	fsCmd.StringVar(&connID, "conn-id", "", "Database connection string or profile ID")
	fsCmd.StringVar(&connID, "conn", "", "Alias for --conn-id")
	fsCmd.StringVar(&baseID, "base", "", "Base snapshot ID")
	fsCmd.StringVar(&targetID, "target", "", "Target snapshot ID")
	fsCmd.StringVar(&direction, "direction", "down", "Direction: 'down' (rollback to base) or 'up' (migrate to target)")
	fsCmd.StringVar(&dataDir, "data", "", "DBLens data directory")
	fsCmd.StringVar(&format, "format", "sql", "Output format (sql|json)")

	if err := fsCmd.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 1
	}

	if connID == "" || baseID == "" || targetID == "" {
		fmt.Fprintln(os.Stderr, "Error: --conn-id, --base, and --target are required")
		return 1
	}

	store := getSnapshotStore(dataDir)
	baseSnap, err := store.Get(connID, baseID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: base snapshot not found: %v\n", err)
		return 1
	}

	targetSnap, err := store.Get(connID, targetID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: target snapshot not found: %v\n", err)
		return 1
	}

	diffResult := snapshot.Diff(baseSnap, targetSnap)
	plan := snapshot.GenerateRollbackPlan(diffResult)

	if strings.EqualFold(format, "json") {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(plan)
		return 0
	}

	if strings.EqualFold(direction, "up") {
		if plan.UpSQL == "" {
			fmt.Println("-- Schemas are identical. No forward migration needed.")
		} else {
			fmt.Println(plan.UpSQL)
		}
	} else {
		if plan.DownSQL == "" {
			fmt.Println("-- Schemas are identical. No rollback needed.")
		} else {
			fmt.Println(plan.DownSQL)
		}
	}

	return 0
}

func truncateStr(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}

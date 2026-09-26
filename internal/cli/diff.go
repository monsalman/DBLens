package cli

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/dblens/dblens/internal/datadiff"
	"github.com/dblens/dblens/internal/diff"
	"github.com/dblens/dblens/internal/driver"
	"github.com/dblens/dblens/internal/driver/types"
)

const DiffUsage = `Usage:
  dblens diff schema [flags]
  dblens diff data [flags]

Commands:
  schema     Compare DDL structure between source and target databases
  data       Compare row-level data and generate synchronization DML scripts

Use "dblens diff [command] --help" for more information about a command.
`

func runDiff(ctx context.Context, args []string) int {
	if len(args) == 0 {
		fmt.Print(DiffUsage)
		return 0
	}

	sub := args[0]
	subArgs := args[1:]

	switch sub {
	case "schema":
		return runDiffSchema(ctx, subArgs)
	case "data":
		return runDiffData(ctx, subArgs)
	case "--help", "-h", "help":
		fmt.Print(DiffUsage)
		return 0
	default:
		fmt.Fprintf(os.Stderr, "Error: unknown diff subcommand %q\n\n%s", sub, DiffUsage)
		return 1
	}
}

func runDiffSchema(ctx context.Context, args []string) int {
	fsCmd := flag.NewFlagSet("diff schema", flag.ContinueOnError)
	fsCmd.SetOutput(os.Stderr)

	var (
		source       string
		target       string
		format       string
		failOnDrift  bool
		sourceSchema string
		targetSchema string
		dataDir      string
	)

	fsCmd.StringVar(&source, "source", "", "Source database DSN or connection ID")
	fsCmd.StringVar(&target, "target", "", "Target database DSN or connection ID")
	fsCmd.StringVar(&format, "format", "text", "Output format (text|json|sql)")
	fsCmd.BoolVar(&failOnDrift, "fail-on-drift", true, "Exit with code 1 if schema drift is detected")
	fsCmd.StringVar(&sourceSchema, "source-schema", "", "Schema in source database")
	fsCmd.StringVar(&targetSchema, "target-schema", "", "Schema in target database")
	fsCmd.StringVar(&dataDir, "data", "", "DBLens data directory for saved connections")

	if err := fsCmd.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 1
	}

	if source == "" || target == "" {
		fmt.Fprintln(os.Stderr, "Error: both --source and --target must be provided")
		return 1
	}

	srcDrv, srcClean, err := resolveDriver(source, dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error connecting to source (%s): %v\n", driver.MaskDSN(source), err)
		return 1
	}
	defer srcClean()

	tgtDrv, tgtClean, err := resolveDriver(target, dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error connecting to target (%s): %v\n", driver.MaskDSN(target), err)
		return 1
	}
	defer tgtClean()

	// Inspect source tables
	srcMetaList, err := srcDrv.InspectTables(ctx, sourceSchema)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error inspecting source tables: %v\n", err)
		return 1
	}
	srcTables := make(map[string]*types.TableDetail, len(srcMetaList))
	for _, meta := range srcMetaList {
		if meta.Type == "view" {
			continue
		}
		detail, err := srcDrv.InspectTableDetails(ctx, sourceSchema, meta.Name)
		if err == nil && detail != nil {
			srcTables[meta.Name] = detail
		}
	}

	// Inspect target tables
	tgtMetaList, err := tgtDrv.InspectTables(ctx, targetSchema)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error inspecting target tables: %v\n", err)
		return 1
	}
	tgtTables := make(map[string]*types.TableDetail, len(tgtMetaList))
	for _, meta := range tgtMetaList {
		if meta.Type == "view" {
			continue
		}
		detail, err := tgtDrv.InspectTableDetails(ctx, targetSchema, meta.Name)
		if err == nil && detail != nil {
			tgtTables[meta.Name] = detail
		}
	}

	result := diff.CompareSchemas(srcTables, tgtTables, tgtDrv.Dialect(), sourceSchema, targetSchema)
	result.SourceDialect = srcDrv.Dialect()

	driftCount := result.AddedCount + result.RemovedCount + result.ModifiedCount

	outFmt := NormalizeFormat(format)
	switch outFmt {
	case FormatJSON:
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(result); err != nil {
			fmt.Fprintf(os.Stderr, "Error formatting JSON: %v\n", err)
			return 1
		}
	case FormatSQL:
		if len(result.MigrationSQL) > 0 {
			fmt.Println(strings.Join(result.MigrationSQL, "\n\n"))
		} else if result.SQL != "" {
			fmt.Println(result.SQL)
		} else {
			fmt.Println("-- No migration required (schemas are identical)")
		}
	default: // FormatText
		fmt.Printf("Schema Diff Summary: %s -> %s\n", driver.MaskDSN(source), driver.MaskDSN(target))
		fmt.Printf("Total Tables: %d | Added: %d | Removed: %d | Modified: %d | Identical: %d\n",
			result.TotalTables, result.AddedCount, result.RemovedCount, result.ModifiedCount, result.IdenticalCount)

		if driftCount > 0 {
			fmt.Println("\nDetected Drifts:")
			for _, tbl := range result.Tables {
				if tbl.Status == diff.DiffIdentical {
					continue
				}
				fmt.Printf("  • Table %s: [%s]\n", tbl.Name, tbl.Status)
				for _, col := range tbl.Columns {
					if col.Status != diff.DiffIdentical {
						fmt.Printf("      - Column %s: %s\n", col.Name, col.Status)
					}
				}
			}
		} else {
			fmt.Println("\nSchemas are identical. No drift detected.")
		}
	}

	if failOnDrift && driftCount > 0 {
		return 1
	}
	return 0
}

func runDiffData(ctx context.Context, args []string) int {
	fsCmd := flag.NewFlagSet("diff data", flag.ContinueOnError)
	fsCmd.SetOutput(os.Stderr)

	var (
		source       string
		target       string
		table        string
		schema       string
		pk           string
		assertSynced bool
		out          string
		format       string
		dataDir      string
	)

	fsCmd.StringVar(&source, "source", "", "Source database DSN or connection ID")
	fsCmd.StringVar(&target, "target", "", "Target database DSN or connection ID")
	fsCmd.StringVar(&table, "table", "", "Target table to compare")
	fsCmd.StringVar(&schema, "schema", "", "Schema name (optional)")
	fsCmd.StringVar(&pk, "pk", "", "Primary key column names (comma-separated)")
	fsCmd.BoolVar(&assertSynced, "assert-synced", true, "Exit with code 1 if data drift is detected")
	fsCmd.StringVar(&out, "out", "", "Output file path to write sync SQL script")
	fsCmd.StringVar(&format, "format", "text", "Output format (text|json)")
	fsCmd.StringVar(&dataDir, "data", "", "DBLens data directory for saved connections")

	if err := fsCmd.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 1
	}

	if source == "" || target == "" || table == "" {
		fmt.Fprintln(os.Stderr, "Error: --source, --target, and --table are required")
		return 1
	}

	var pks []string
	if pk != "" {
		for _, p := range strings.Split(pk, ",") {
			p = strings.TrimSpace(p)
			if p != "" {
				pks = append(pks, p)
			}
		}
	}

	srcDrv, srcClean, err := resolveDriver(source, dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error connecting to source (%s): %v\n", driver.MaskDSN(source), err)
		return 1
	}
	defer srcClean()

	tgtDrv, tgtClean, err := resolveDriver(target, dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error connecting to target (%s): %v\n", driver.MaskDSN(target), err)
		return 1
	}
	defer tgtClean()

	// If no PK specified, attempt to detect from source table details
	if len(pks) == 0 {
		detail, err := srcDrv.InspectTableDetails(ctx, schema, table)
		if err == nil && detail != nil {
			for _, col := range detail.Columns {
				if col.IsPrimary {
					pks = append(pks, col.Name)
				}
			}
		}
	}
	if len(pks) == 0 {
		fmt.Fprintln(os.Stderr, "Error: no primary key found. Specify primary keys with --pk")
		return 1
	}

	req := datadiff.DataDiffRequest{
		SourceTable:  table,
		SourceSchema: schema,
		TargetTable:  table,
		TargetSchema: schema,
		PrimaryKeys:  pks,
		PageSize:     5000,
	}

	result, err := datadiff.CompareData(ctx, req, srcDrv, tgtDrv)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error comparing data: %v\n", err)
		return 1
	}

	if result.Summary.TotalSourceRows >= 5000 || result.Summary.TotalTargetRows >= 5000 {
		fmt.Fprintln(os.Stderr, "Warning: dataset reached maximum sample window (5,000 rows); drift beyond offset 5,000 may not be reflected.")
	}

	hasDrift := result.Summary.AddedCount > 0 || result.Summary.DeletedCount > 0 || result.Summary.ModifiedCount > 0

	// If output file requested, generate sync SQL script
	if out != "" {
		syncReq := datadiff.SyncScriptRequest{
			SourceSchema:  schema,
			SourceTable:   table,
			SourceDialect: srcDrv.Dialect(),
			TargetSchema:  schema,
			TargetTable:   table,
			TargetDialect: tgtDrv.Dialect(),
			Strategy:      datadiff.StrategySourceWins,
			PrimaryKeys:   result.PrimaryKeys,
			Columns:       result.ComparedColumns,
			Rows:          result.Rows,
			DeleteExcess:  true,
		}
		syncResp, err := datadiff.GenerateSyncScript(syncReq)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error generating sync script: %v\n", err)
			return 1
		}
		if err := os.WriteFile(out, []byte(syncResp.SQL), 0644); err != nil {
			fmt.Fprintf(os.Stderr, "Error writing sync script to %q: %v\n", out, err)
			return 1
		}
		fmt.Fprintf(os.Stderr, "Wrote sync script (%d statements) to %s\n", len(syncResp.Statements), out)
	}

	outFmt := NormalizeFormat(format)
	if outFmt == FormatJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(result); err != nil {
			fmt.Fprintf(os.Stderr, "Error formatting JSON: %v\n", err)
			return 1
		}
	} else {
		fmt.Printf("Data Diff Summary for Table %q:\n", table)
		fmt.Printf("Source Rows: %d | Target Rows: %d\n", result.Summary.TotalSourceRows, result.Summary.TotalTargetRows)
		fmt.Printf("Added: %d | Deleted: %d | Modified: %d | Identical: %d (in %dms)\n",
			result.Summary.AddedCount, result.Summary.DeletedCount, result.Summary.ModifiedCount, result.Summary.IdenticalCount, result.Summary.DurationMs)

		if hasDrift {
			fmt.Println("Status: DRIFT DETECTED")
		} else {
			fmt.Println("Status: IN SYNC")
		}
	}

	if assertSynced && hasDrift {
		return 1
	}
	return 0
}

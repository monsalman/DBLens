package cli

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/dblens/dblens/internal/seeder"
)

func runSeed(args []string) int {
	fsCmd := flag.NewFlagSet("seed", flag.ContinueOnError)
	fsCmd.SetOutput(os.Stderr)

	var (
		conn    string
		schema  string
		tables  string
		rows    int
		format  string
		out     string
		seedVal int64
		dataDir string
	)

	fsCmd.StringVar(&conn, "conn", "", "Database DSN or connection ID")
	fsCmd.StringVar(&schema, "schema", "", "Schema name (optional)")
	fsCmd.StringVar(&tables, "tables", "", "Target table names (comma-separated)")
	fsCmd.IntVar(&rows, "rows", 25, "Default row count to generate per table")
	fsCmd.StringVar(&format, "format", "direct", "Output format (direct|sql|json)")
	fsCmd.StringVar(&out, "out", "", "Output file path (for sql/json fixtures, default: stdout)")
	fsCmd.Int64Var(&seedVal, "seed", 0, "Deterministic PRNG seed value (default: random)")
	fsCmd.StringVar(&dataDir, "data", "", "DBLens data directory for saved connections")

	if err := fsCmd.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 1
	}

	if conn == "" {
		fmt.Fprintln(os.Stderr, "Error: --conn is required")
		return 1
	}

	var tableList []string
	if strings.TrimSpace(tables) != "" {
		for _, t := range strings.Split(tables, ",") {
			t = strings.TrimSpace(t)
			if t != "" {
				tableList = append(tableList, t)
			}
		}
	}

	drv, cleanup, err := resolveDriver(conn, dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error connecting to database: %v\n", err)
		return 1
	}
	defer cleanup()

	ctx := context.Background()

	opts := seeder.SeederOptions{
		Schema:          schema,
		Tables:          tableList,
		DefaultRowCount: rows,
		Seed:            seedVal,
	}

	plan, err := seeder.BuildPlan(ctx, drv, opts)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error building seed plan: %v\n", err)
		return 1
	}

	fmtFmt := strings.ToLower(strings.TrimSpace(format))
	switch fmtFmt {
	case "direct":
		res, err := seeder.Run(ctx, drv, plan, nil)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error executing seed: %v\n", err)
			return 1
		}
		if len(res.Errors) > 0 {
			fmt.Fprintf(os.Stderr, "Seed completed with %d error(s):\n", len(res.Errors))
			for _, e := range res.Errors {
				fmt.Fprintf(os.Stderr, "  - %s\n", e)
			}
			return 1
		}
		fmt.Printf("Successfully seeded %d rows across %d tables in %dms\n",
			res.TotalInserted, len(res.TablesInserted), res.DurationMs)
		for tbl, cnt := range res.TablesInserted {
			fmt.Printf("  • %s: %d rows\n", tbl, cnt)
		}
		return 0

	case "sql", "json":
		data, err := seeder.Export(ctx, drv, plan, fmtFmt)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error exporting fixtures: %v\n", err)
			return 1
		}
		if out != "" {
			if err := os.WriteFile(out, data, 0644); err != nil {
				fmt.Fprintf(os.Stderr, "Error writing output file %q: %v\n", out, err)
				return 1
			}
			fmt.Fprintf(os.Stderr, "Successfully wrote %s fixture to %s (%d bytes)\n", fmtFmt, out, len(data))
		} else {
			_, _ = os.Stdout.Write(data)
			if fmtFmt == "sql" {
				fmt.Println()
			}
		}
		return 0

	default:
		fmt.Fprintf(os.Stderr, "Error: invalid format %q (allowed: direct, sql, json)\n", format)
		return 1
	}
}

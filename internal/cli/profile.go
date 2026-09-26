package cli

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/dblens/dblens/internal/profile"
)

func runProfile(ctx context.Context, args []string) int {
	fsCmd := flag.NewFlagSet("profile", flag.ContinueOnError)
	fsCmd.SetOutput(os.Stderr)

	var (
		conn           string
		table          string
		schema         string
		assertNoNulls  string
		assertUnique   string
		format         string
		out            string
		sampleRows     int
		dataDir        string
	)

	fsCmd.StringVar(&conn, "conn", "", "Database DSN or connection ID")
	fsCmd.StringVar(&table, "table", "", "Table to profile")
	fsCmd.StringVar(&schema, "schema", "", "Schema name (optional)")
	fsCmd.StringVar(&assertNoNulls, "assert-no-nulls", "", "Comma-separated columns that must have 0 nulls")
	fsCmd.StringVar(&assertUnique, "assert-unique", "", "Comma-separated columns that must have 100% uniqueness")
	fsCmd.StringVar(&format, "format", "text", "Output format (text|json|md)")
	fsCmd.StringVar(&out, "out", "", "Output file path (default: stdout)")
	fsCmd.IntVar(&sampleRows, "sample-rows", 0, "Number of sample rows to profile (0 = all)")
	fsCmd.StringVar(&dataDir, "data", "", "DBLens data directory for saved connections")

	if err := fsCmd.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 1
	}

	if conn == "" || table == "" {
		fmt.Fprintln(os.Stderr, "Error: --conn and --table are required")
		return 1
	}

	drv, cleanup, err := resolveDriver(conn, dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error connecting to database: %v\n", err)
		return 1
	}
	defer cleanup()

	req := profile.ProfileRequest{
		Schema:     schema,
		Table:      table,
		SampleRows: sampleRows,
	}

	report, err := profile.RunProfile(ctx, drv, req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error running profile: %v\n", err)
		return 1
	}

	// Index columns by lowercase name
	colMap := make(map[string]profile.ColumnProfile, len(report.Columns))
	for _, c := range report.Columns {
		colMap[strings.ToLower(c.ColumnName)] = c
	}

	// Validate quality assertions
	var assertionFailures []string

	if strings.TrimSpace(assertNoNulls) != "" {
		for _, col := range strings.Split(assertNoNulls, ",") {
			col = strings.TrimSpace(col)
			if col == "" {
				continue
			}
			cp, ok := colMap[strings.ToLower(col)]
			if !ok {
				assertionFailures = append(assertionFailures, fmt.Sprintf("assert-no-nulls: column %q not found in table", col))
			} else if cp.NullCount > 0 {
				assertionFailures = append(assertionFailures,
					fmt.Sprintf("assert-no-nulls failed for column %q: %d null(s) found (%.2f%%)", col, cp.NullCount, cp.NullPercentage))
			}
		}
	}

	if strings.TrimSpace(assertUnique) != "" {
		for _, col := range strings.Split(assertUnique, ",") {
			col = strings.TrimSpace(col)
			if col == "" {
				continue
			}
			cp, ok := colMap[strings.ToLower(col)]
			if !ok {
				assertionFailures = append(assertionFailures, fmt.Sprintf("assert-unique: column %q not found in table", col))
			} else if cp.UniquenessRatio < 1.0 {
				assertionFailures = append(assertionFailures,
					fmt.Sprintf("assert-unique failed for column %q: uniqueness ratio is %.4f (expected 1.0000)", col, cp.UniquenessRatio))
			}
		}
	}

	var outputBytes []byte
	outFmt := NormalizeFormat(format)

	switch outFmt {
	case FormatJSON:
		b, err := json.MarshalIndent(report, "", "  ")
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error formatting JSON: %v\n", err)
			return 1
		}
		outputBytes = append(b, '\n')

	case FormatMD:
		md := profile.ExportMarkdown(report)
		outputBytes = []byte(md)

	default: // FormatText
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("Profile Report for %s (Dialect: %s, Total Rows: %d, Quality Score: %.1f%%)\n",
			table, report.Dialect, report.TotalRows, report.QualityScore))

		var cols = []string{"Column", "Type", "Nulls", "Null %", "Distinct", "Uniqueness", "PII"}
		var rows [][]interface{}
		for _, c := range report.Columns {
			pii := "-"
			if c.PIIType != "" {
				pii = c.PIIType
			}
			rows = append(rows, []interface{}{
				c.ColumnName,
				c.DataType,
				c.NullCount,
				fmt.Sprintf("%.1f%%", c.NullPercentage),
				c.DistinctCount,
				fmt.Sprintf("%.2f%%", c.UniquenessRatio*100),
				pii,
			})
		}
		RenderTable(&sb, cols, rows)

		if len(report.Suggestions) > 0 {
			sb.WriteString(fmt.Sprintf("\nOptimization Suggestions (%d):\n", len(report.Suggestions)))
			for _, s := range report.Suggestions {
				sb.WriteString(fmt.Sprintf("  [%s] %s: %s\n", strings.ToUpper(s.Severity), s.Title, s.Description))
			}
		}

		if len(assertionFailures) > 0 {
			sb.WriteString(fmt.Sprintf("\nQuality Gate Assertions: FAILED (%d failures)\n", len(assertionFailures)))
			for _, f := range assertionFailures {
				sb.WriteString(fmt.Sprintf("  ✖ %s\n", f))
			}
		} else if assertNoNulls != "" || assertUnique != "" {
			sb.WriteString("\nQuality Gate Assertions: ALL PASSED\n")
		}

		outputBytes = []byte(sb.String())
	}

	if out != "" {
		if err := os.WriteFile(out, outputBytes, 0644); err != nil {
			fmt.Fprintf(os.Stderr, "Error writing output to %q: %v\n", out, err)
			return 1
		}
		fmt.Fprintf(os.Stderr, "Wrote profile report to %s\n", out)
	} else {
		_, _ = os.Stdout.Write(outputBytes)
	}

	if len(assertionFailures) > 0 {
		return 1
	}
	return 0
}

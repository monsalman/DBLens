package cli

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
)

func runQuery(ctx context.Context, args []string) int {
	fsCmd := flag.NewFlagSet("query", flag.ContinueOnError)
	fsCmd.SetOutput(os.Stderr)

	var (
		conn      string
		queryFlag string
		format    string
		dataDir   string
	)

	fsCmd.StringVar(&conn, "conn", "", "Database DSN or connection ID")
	fsCmd.StringVar(&queryFlag, "query", "", "SQL query statement to execute")
	fsCmd.StringVar(&format, "format", "table", "Output format (table|json|csv)")
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

	querySQL := strings.TrimSpace(queryFlag)
	if querySQL == "" && len(fsCmd.Args()) > 0 {
		querySQL = strings.TrimSpace(strings.Join(fsCmd.Args(), " "))
	}
	if querySQL == "" {
		// Try reading from stdin if piped
		stat, err := os.Stdin.Stat()
		if err == nil && (stat.Mode()&os.ModeCharDevice) == 0 {
			const maxStdin = 10 << 20
			b, err := io.ReadAll(io.LimitReader(os.Stdin, maxStdin+1))
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error reading from stdin: %v\n", err)
				return 1
			}
			if len(b) > maxStdin {
				fmt.Fprintln(os.Stderr, "Error: stdin input exceeds maximum allowed size (10MB)")
				return 1
			}
			querySQL = strings.TrimSpace(string(b))
		}
	}

	if querySQL == "" {
		fmt.Fprintln(os.Stderr, "Error: SQL query must be provided via --query, positional argument, or stdin")
		return 1
	}

	drv, cleanup, err := resolveDriver(conn, dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error connecting to database: %v\n", err)
		return 1
	}
	defer cleanup()

	res, err := drv.ExecuteRaw(ctx, querySQL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Query execution error: %v\n", err)
		return 1
	}

	outFmt := NormalizeFormat(format)
	switch outFmt {
	case FormatJSON:
		var list []map[string]interface{}
		for _, r := range res.Rows {
			rowMap := make(map[string]interface{}, len(res.Columns))
			for i, col := range res.Columns {
				if i < len(r) {
					rowMap[col] = r[i]
				} else {
					rowMap[col] = nil
				}
			}
			list = append(list, rowMap)
		}
		if list == nil {
			list = []map[string]interface{}{}
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(list); err != nil {
			fmt.Fprintf(os.Stderr, "Error encoding JSON: %v\n", err)
			return 1
		}

	case FormatCSV:
		w := csv.NewWriter(os.Stdout)
		if len(res.Columns) > 0 {
			_ = w.Write(res.Columns)
		}
		for _, r := range res.Rows {
			record := make([]string, len(res.Columns))
			for i := range res.Columns {
				if i < len(r) && r[i] != nil {
					record[i] = fmt.Sprintf("%v", r[i])
				}
			}
			_ = w.Write(record)
		}
		w.Flush()
		if err := w.Error(); err != nil {
			fmt.Fprintf(os.Stderr, "CSV error: %v\n", err)
			return 1
		}

	default: // FormatTable
		if len(res.Columns) > 0 {
			RenderTable(os.Stdout, res.Columns, res.Rows)
		}
		fmt.Printf("(%d row(s) returned in %dms, %d affected)\n",
			len(res.Rows), res.Elapsed, res.AffectedRows)
	}

	return 0
}

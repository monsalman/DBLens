package cli

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/benchmark"
)

func runBenchmark(ctx context.Context, args []string) int {
	fsCmd := flag.NewFlagSet("benchmark", flag.ContinueOnError)
	fsCmd.SetOutput(os.Stderr)

	var (
		conn        string
		queryFlag   string
		fileFlag    string
		concurrency int
		durationStr string
		iterations  int
		rollback    bool
		assertP99Lt float64
		format      string
		out         string
		dataDir     string
	)

	fsCmd.StringVar(&conn, "conn", "", "Database DSN or connection ID")
	fsCmd.StringVar(&queryFlag, "query", "", "SQL query statement to benchmark")
	fsCmd.StringVar(&fileFlag, "file", "", "Path to file containing SQL query")
	fsCmd.IntVar(&concurrency, "concurrency", 5, "Number of concurrent worker goroutines (default: 5)")
	fsCmd.StringVar(&durationStr, "duration", "5s", "Benchmark run duration (e.g. 5s, 10s, 1m)")
	fsCmd.IntVar(&iterations, "iterations", 0, "Total query iterations to execute (0 = run for duration)")
	fsCmd.BoolVar(&rollback, "rollback", false, "Execute queries in rollback transactions (BEGIN ... ROLLBACK)")
	fsCmd.Float64Var(&assertP99Lt, "assert-p99-lt", 0, "Fail with exit 1 if P99 latency is greater than or equal to this threshold (ms)")
	fsCmd.StringVar(&format, "format", "table", "Output format (table|json|markdown)")
	fsCmd.StringVar(&out, "out", "", "Write output to file path instead of stdout")
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
	if querySQL == "" && fileFlag != "" {
		b, err := os.ReadFile(fileFlag)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error reading query file %q: %v\n", fileFlag, err)
			return 1
		}
		querySQL = strings.TrimSpace(string(b))
	}
	if querySQL == "" && len(fsCmd.Args()) > 0 {
		querySQL = strings.TrimSpace(strings.Join(fsCmd.Args(), " "))
	}
	if querySQL == "" {
		stat, err := os.Stdin.Stat()
		if err == nil && (stat.Mode()&os.ModeCharDevice) == 0 {
			const maxStdin = 10 << 20
			b, err := io.ReadAll(io.LimitReader(os.Stdin, maxStdin+1))
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error reading from stdin: %v\n", err)
				return 1
			}
			querySQL = strings.TrimSpace(string(b))
		}
	}

	if querySQL == "" {
		fmt.Fprintln(os.Stderr, "Error: SQL query must be provided via --query, --file, positional argument, or stdin")
		return 1
	}

	var dur time.Duration
	if iterations <= 0 && durationStr != "" {
		var err error
		dur, err = time.ParseDuration(durationStr)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: invalid duration %q: %v\n", durationStr, err)
			return 1
		}
	}

	drv, cleanup, err := resolveDriver(conn, dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error connecting to database: %v\n", err)
		return 1
	}
	defer cleanup()

	cfg := benchmark.BenchmarkConfig{
		SQL:         querySQL,
		Concurrency: concurrency,
		Duration:    dur,
		Iterations:  iterations,
		Rollback:    rollback,
		AssertP99Lt: assertP99Lt,
	}

	mgr := benchmark.NewBenchmarkManager()
	ab, err := mgr.Start(ctx, drv, cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error starting benchmark: %v\n", err)
		return 1
	}

	// Wait for completion or context cancellation
	select {
	case <-ctx.Done():
		ab.Cancel()
		fmt.Fprintln(os.Stderr, "Benchmark interrupted.")
		return 1
	case <-ab.DoneCh():
	}

	res, found := mgr.Get(ab.ID)
	if !found || res == nil {
		fmt.Fprintln(os.Stderr, "Error: benchmark produced no result")
		return 1
	}

	var outputText string
	fmtFmt := strings.ToLower(strings.TrimSpace(format))
	switch fmtFmt {
	case "json":
		data, err := json.MarshalIndent(res, "", "  ")
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error serializing JSON: %v\n", err)
			return 1
		}
		outputText = string(data) + "\n"

	case "markdown", "md":
		outputText = benchmark.GenerateMarkdownReport(res)

	case "table", "":
		outputText = renderTableReport(res)

	default:
		fmt.Fprintf(os.Stderr, "Error: invalid format %q (allowed: table, json, markdown)\n", format)
		return 1
	}

	if out != "" {
		if err := os.WriteFile(out, []byte(outputText), 0644); err != nil {
			fmt.Fprintf(os.Stderr, "Error writing output to %s: %v\n", out, err)
			return 1
		}
		fmt.Printf("Benchmark results saved to %s\n", out)
	} else {
		fmt.Print(outputText)
	}

	// Quality gate assertion check
	if assertP99Lt > 0 {
		if res.P99LatencyMs >= assertP99Lt {
			fmt.Fprintf(os.Stderr, "Quality gate assertion failed: P99 latency (%.2f ms) >= threshold (%.2f ms)\n",
				res.P99LatencyMs, assertP99Lt)
			return 1
		}
	}

	return 0
}

func renderTableReport(res *benchmark.BenchmarkResult) string {
	var sb strings.Builder
	sb.WriteString("DBLens Query Latency Benchmark\n")
	sb.WriteString("============================================================\n")
	sqlPreview := strings.TrimSpace(res.SQL)
	if len(sqlPreview) > 80 {
		sqlPreview = sqlPreview[:77] + "..."
	}
	sb.WriteString(fmt.Sprintf("Target SQL:   %s\n", sqlPreview))
	sb.WriteString(fmt.Sprintf("Concurrency:  %d workers | Rollback: %t\n", res.Concurrency, res.Rollback))

	succPct := 0.0
	if res.TotalQueries > 0 {
		succPct = (float64(res.SuccessfulQueries) / float64(res.TotalQueries)) * 100.0
	}
	sb.WriteString(fmt.Sprintf("Duration:     %.2fs | Total: %d queries (%.1f%% success, %d failed)\n",
		res.DurationMs/1000.0, res.TotalQueries, succPct, res.FailedQueries))
	sb.WriteString(fmt.Sprintf("Throughput:   %.1f QPS\n\n", res.QPS))

	sb.WriteString("Latency Statistics:\n")
	sb.WriteString(fmt.Sprintf("  Min:        %.2f ms\n", res.MinLatencyMs))
	sb.WriteString(fmt.Sprintf("  P50:        %.2f ms\n", res.P50LatencyMs))
	sb.WriteString(fmt.Sprintf("  P90:        %.2f ms\n", res.P90LatencyMs))
	sb.WriteString(fmt.Sprintf("  P95:        %.2f ms\n", res.P95LatencyMs))
	sb.WriteString(fmt.Sprintf("  P99:        %.2f ms\n", res.P99LatencyMs))
	sb.WriteString(fmt.Sprintf("  Max:        %.2f ms\n", res.MaxLatencyMs))
	sb.WriteString(fmt.Sprintf("  Mean:       %.2f ms (±%.2f ms)\n", res.MeanLatencyMs, res.StdDevMs))

	if res.AssertPassed != nil {
		sb.WriteString("\nQuality Gate:\n")
		if *res.AssertPassed {
			sb.WriteString(fmt.Sprintf("  Assertion:  PASSED (P99 = %.2f ms)\n", res.P99LatencyMs))
		} else {
			sb.WriteString(fmt.Sprintf("  Assertion:  FAILED (P99 = %.2f ms)\n", res.P99LatencyMs))
		}
	}
	sb.WriteString("============================================================\n")

	return sb.String()
}

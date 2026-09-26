package cli

import (
	"context"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/dblens/dblens/internal/analyzer"
)

func runLint(args []string) int {
	fsCmd := flag.NewFlagSet("lint", flag.ContinueOnError)
	fsCmd.SetOutput(os.Stderr)

	var (
		dialect string
		failOn  string
		format  string
		schema  string
		rules   string
	)

	fsCmd.StringVar(&dialect, "dialect", "postgres", "SQL dialect (postgres|mysql|sqlite)")
	fsCmd.StringVar(&failOn, "fail-on", "error", "Failure threshold severity (error|warning|info)")
	fsCmd.StringVar(&format, "format", "text", "Output format (text|json|junit|github)")
	fsCmd.StringVar(&schema, "schema", "", "Target schema name for identifier checks")
	fsCmd.StringVar(&rules, "rules", "", "Optional comma-separated list of enabled rule IDs")

	if err := fsCmd.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 1
	}

	posArgs := fsCmd.Args()

	// Build rule config if --rules is specified
	var ruleConfig map[string]analyzer.RuleSetting
	if strings.TrimSpace(rules) != "" {
		ruleConfig = make(map[string]analyzer.RuleSetting)
		for _, r := range analyzer.AllRules {
			ruleConfig[r.Meta().ID] = analyzer.RuleSetting{Enabled: false}
		}
		for _, ruleID := range strings.Split(rules, ",") {
			ruleID = strings.TrimSpace(ruleID)
			if ruleID != "" {
				ruleConfig[ruleID] = analyzer.RuleSetting{Enabled: true}
			}
		}
	}

	threshold := strings.ToLower(strings.TrimSpace(failOn))
	if threshold != "error" && threshold != "warning" && threshold != "info" {
		threshold = "error"
	}

	var fileInputs []struct {
		path    string
		content string
	}

	// If no positional arguments, check stdin
	if len(posArgs) == 0 {
		stat, err := os.Stdin.Stat()
		if err == nil && (stat.Mode()&os.ModeCharDevice) == 0 {
			// Read from stdin
			bytes, err := io.ReadAll(os.Stdin)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error reading from stdin: %v\n", err)
				return 1
			}
			fileInputs = append(fileInputs, struct {
				path    string
				content string
			}{path: "stdin", content: string(bytes)})
		} else {
			fmt.Fprintln(os.Stderr, "Error: no SQL files or directories specified and nothing piped to stdin.")
			fmt.Fprintln(os.Stderr, "Usage: dblens lint [flags] [files/dirs...]")
			return 1
		}
	} else {
		// Discover all .sql files from positional arguments
		for _, target := range posArgs {
			fi, err := os.Stat(target)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error: cannot access %q: %v\n", target, err)
				return 1
			}
			if fi.IsDir() {
				err = filepath.WalkDir(target, func(p string, d fs.DirEntry, err error) error {
					if err != nil {
						return err
					}
					if !d.IsDir() && strings.HasSuffix(strings.ToLower(d.Name()), ".sql") {
						b, readErr := os.ReadFile(p)
						if readErr != nil {
							return readErr
						}
						fileInputs = append(fileInputs, struct {
							path    string
							content string
						}{path: p, content: string(b)})
					}
					return nil
				})
				if err != nil {
					fmt.Fprintf(os.Stderr, "Error walking directory %q: %v\n", target, err)
					return 1
				}
			} else {
				b, readErr := os.ReadFile(target)
				if readErr != nil {
					fmt.Fprintf(os.Stderr, "Error reading file %q: %v\n", target, readErr)
					return 1
				}
				fileInputs = append(fileInputs, struct {
					path    string
					content string
				}{path: target, content: string(b)})
			}
		}
	}

	if len(fileInputs) == 0 {
		fmt.Fprintln(os.Stderr, "No .sql files found to lint.")
		return 0
	}

	ctx := context.Background()
	var report LintReport
	report.Dialect = dialect
	report.TotalFiles = len(fileInputs)

	totalViolationsThreshold := 0

	for _, fi := range fileInputs {
		res := analyzer.AnalyzeSQL(ctx, fi.content, dialect, schema, nil, nil, ruleConfig)
		fileRes := LintFileResult{
			File:        fi.path,
			Diagnostics: res.Diagnostics,
			Summary:     res.Summary,
		}
		report.Files = append(report.Files, fileRes)
		report.TotalErrors += res.Summary.Errors
		report.TotalWarns += res.Summary.Warnings
		report.TotalInfo += res.Summary.Info

		for _, d := range res.Diagnostics {
			switch threshold {
			case "error":
				if d.Severity == analyzer.SeverityError {
					totalViolationsThreshold++
				}
			case "warning":
				if d.Severity == analyzer.SeverityError || d.Severity == analyzer.SeverityWarning {
					totalViolationsThreshold++
				}
			case "info":
				totalViolationsThreshold++
			}
		}
	}

	report.Passed = totalViolationsThreshold == 0

	outFmt := NormalizeFormat(format)
	if err := RenderLintReport(os.Stdout, report, outFmt); err != nil {
		fmt.Fprintf(os.Stderr, "Error rendering report: %v\n", err)
		return 1
	}

	if !report.Passed {
		return 1
	}
	return 0
}

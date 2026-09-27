package cli

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"strings"

	"github.com/dblens/dblens/internal/analyzer"
)

// OutputFormat defines reporter formats
type OutputFormat string

const (
	FormatText   OutputFormat = "text"
	FormatJSON   OutputFormat = "json"
	FormatJUnit  OutputFormat = "junit"
	FormatGitHub OutputFormat = "github"
	FormatSQL    OutputFormat = "sql"
	FormatCSV    OutputFormat = "csv"
	FormatTable  OutputFormat = "table"
	FormatMD     OutputFormat = "md"
)

// NormalizeFormat cleans user format string
func NormalizeFormat(f string) OutputFormat {
	switch strings.ToLower(strings.TrimSpace(f)) {
	case "json":
		return FormatJSON
	case "junit", "xml":
		return FormatJUnit
	case "github", "gh", "annotations":
		return FormatGitHub
	case "sql":
		return FormatSQL
	case "csv":
		return FormatCSV
	case "table":
		return FormatTable
	case "md", "markdown":
		return FormatMD
	default:
		return FormatText
	}
}

// LintFileResult holds diagnostics for one file
type LintFileResult struct {
	File        string                `json:"file"`
	Diagnostics []analyzer.Diagnostic `json:"diagnostics"`
	Summary     analyzer.AnalysisSummary `json:"summary"`
	Error       string                `json:"error,omitempty"`
}

// LintReport holds entire lint execution results
type LintReport struct {
	Passed      bool             `json:"passed"`
	Dialect     string           `json:"dialect"`
	TotalFiles  int              `json:"totalFiles"`
	TotalErrors int              `json:"totalErrors"`
	TotalWarns  int              `json:"totalWarnings"`
	TotalInfo   int              `json:"totalInfo"`
	Files       []LintFileResult `json:"files"`
}

// JUnitTestSuites for JUnit XML output
type JUnitTestSuites struct {
	XMLName  xml.Name        `xml:"testsuites"`
	Name     string          `xml:"name,attr"`
	Tests    int             `xml:"tests,attr"`
	Failures int             `xml:"failures,attr"`
	Errors   int             `xml:"errors,attr"`
	Time     string          `xml:"time,attr"`
	Suites   []JUnitTestSuite `xml:"testsuite"`
}

type JUnitTestSuite struct {
	Name     string          `xml:"name,attr"`
	Tests    int             `xml:"tests,attr"`
	Failures int             `xml:"failures,attr"`
	Errors   int             `xml:"errors,attr"`
	Time     string          `xml:"time,attr"`
	Cases    []JUnitTestCase `xml:"testcase"`
}

type JUnitTestCase struct {
	Name      string        `xml:"name,attr"`
	Classname string        `xml:"classname,attr"`
	Time      string        `xml:"time,attr"`
	Failure   *JUnitFailure `xml:"failure,omitempty"`
}

type JUnitFailure struct {
	Message string `xml:"message,attr"`
	Type    string `xml:"type,attr"`
	Body    string `xml:",chardata"`
}

// RenderLintReport writes lint results according to requested format
func RenderLintReport(w io.Writer, report LintReport, format OutputFormat) error {
	switch format {
	case FormatJSON:
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		return enc.Encode(report)

	case FormatGitHub:
		for _, f := range report.Files {
			for _, d := range f.Diagnostics {
				sev := "error"
				switch d.Severity {
				case analyzer.SeverityWarning:
					sev = "warning"
				case analyzer.SeverityInfo:
					sev = "notice"
				}
				file := f.File
				if file == "" {
					file = "stdin"
				}
				msg := strings.ReplaceAll(d.Message, "\n", " ")
				fmt.Fprintf(w, "::%s file=%s,line=%d,col=%d::[%s] %s\n", sev, file, d.Line, d.Col, d.RuleID, msg)
			}
		}
		if report.Passed {
			fmt.Fprintln(w, "::notice::DBLens SQL Quality Gate passed with 0 critical violations")
		} else {
			fmt.Fprintf(w, "::error::DBLens SQL Quality Gate failed: %d error(s), %d warning(s)\n", report.TotalErrors, report.TotalWarns)
		}
		return nil

	case FormatJUnit:
		suites := JUnitTestSuites{
			Name:     "dblens-lint",
			Tests:    report.TotalFiles,
			Failures: report.TotalErrors,
			Time:     "0.000",
		}
		for _, f := range report.Files {
			suite := JUnitTestSuite{
				Name:     f.File,
				Tests:    len(f.Diagnostics),
				Failures: f.Summary.Errors,
				Time:     "0.000",
			}
			if len(f.Diagnostics) == 0 {
				suite.Tests = 1
				suite.Cases = append(suite.Cases, JUnitTestCase{
					Name:      "Syntax & Quality Check",
					Classname: f.File,
					Time:      "0.000",
				})
			} else {
				for _, d := range f.Diagnostics {
					tc := JUnitTestCase{
						Name:      fmt.Sprintf("%s (line %d col %d)", d.RuleID, d.Line, d.Col),
						Classname: f.File,
						Time:      "0.000",
					}
					if d.Severity == analyzer.SeverityError {
						tc.Failure = &JUnitFailure{
							Message: d.Message,
							Type:    d.RuleID,
							Body:    fmt.Sprintf("%s at line %d, col %d: %s", d.RuleID, d.Line, d.Col, d.Message),
						}
					}
					suite.Cases = append(suite.Cases, tc)
				}
			}
			suites.Suites = append(suites.Suites, suite)
		}
		fmt.Fprint(w, xml.Header)
		enc := xml.NewEncoder(w)
		enc.Indent("", "  ")
		if err := enc.Encode(suites); err != nil {
			return err
		}
		fmt.Fprintln(w)
		return nil

	default: // FormatText
		for _, f := range report.Files {
			if f.Error != "" {
				fmt.Fprintf(w, "[ERROR] %s: %s\n", f.File, f.Error)
				continue
			}
			if len(f.Diagnostics) == 0 {
				fmt.Fprintf(w, "[PASS] %s (clean)\n", f.File)
				continue
			}
			for _, d := range f.Diagnostics {
				tag := "ERROR"
				switch d.Severity {
				case analyzer.SeverityWarning:
					tag = "WARN "
				case analyzer.SeverityInfo:
					tag = "INFO "
				}
				fmt.Fprintf(w, "[%s] %s:%d:%d: [%s] %s\n", tag, f.File, d.Line, d.Col, d.RuleID, d.Message)
			}
		}
		fmt.Fprintf(w, "\nLint Summary: %d error(s), %d warning(s), %d info in %d file(s)\n",
			report.TotalErrors, report.TotalWarns, report.TotalInfo, report.TotalFiles)
		if report.Passed {
			fmt.Fprintln(w, "Status: PASSED")
		} else {
			fmt.Fprintln(w, "Status: FAILED")
		}
		return nil
	}
}

// RenderTable renders an ASCII table to writer
func RenderTable(w io.Writer, columns []string, rows [][]interface{}) {
	if len(columns) == 0 {
		return
	}
	colWidths := make([]int, len(columns))
	for i, c := range columns {
		colWidths[i] = len(c)
	}
	strRows := make([][]string, len(rows))
	for rIdx, r := range rows {
		strRows[rIdx] = make([]string, len(columns))
		for cIdx := range columns {
			val := ""
			if cIdx < len(r) && r[cIdx] != nil {
				val = fmt.Sprintf("%v", r[cIdx])
			}
			strRows[rIdx][cIdx] = val
			if len(val) > colWidths[cIdx] {
				colWidths[cIdx] = len(val)
			}
		}
	}

	// Print border helper
	printBorder := func(sep string) {
		parts := make([]string, len(columns))
		for i, w := range colWidths {
			parts[i] = strings.Repeat("-", w+2)
		}
		fmt.Fprintln(w, "+"+strings.Join(parts, "+")+"+")
	}

	printBorder("-")
	// Print Header
	headerCells := make([]string, len(columns))
	for i, c := range columns {
		headerCells[i] = fmt.Sprintf(" %-*s ", colWidths[i], c)
	}
	fmt.Fprintln(w, "|"+strings.Join(headerCells, "|")+"|")
	printBorder("=")

	// Print Rows
	for _, sr := range strRows {
		cells := make([]string, len(columns))
		for i := range columns {
			cells[i] = fmt.Sprintf(" %-*s ", colWidths[i], sr[i])
		}
		fmt.Fprintln(w, "|"+strings.Join(cells, "|")+"|")
	}
	printBorder("-")
}

package cli

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/dblens/dblens/internal/annotations"
	"github.com/dblens/dblens/internal/dictionary"
)

func runDoc(ctx context.Context, args []string) int {
	fsCmd := flag.NewFlagSet("doc", flag.ContinueOnError)
	fsCmd.SetOutput(os.Stderr)

	var (
		connID  string
		conn    string
		format  string
		output  string
		out     string
		schema  string
		dataDir string
	)

	fsCmd.StringVar(&connID, "conn-id", "", "Database DSN or connection ID")
	fsCmd.StringVar(&conn, "conn", "", "Database DSN or connection ID (alias for --conn-id)")
	fsCmd.StringVar(&format, "format", "html", "Export format: html, md (markdown), or openapi")
	fsCmd.StringVar(&output, "output", "", "Output file path (default: stdout)")
	fsCmd.StringVar(&out, "out", "", "Output file path (alias for --output)")
	fsCmd.StringVar(&schema, "schema", "", "Schema name filter (optional)")
	fsCmd.StringVar(&dataDir, "data", "", "DBLens data directory for saved connections")

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
		if fsCmd.NArg() > 0 {
			targetConn = fsCmd.Arg(0)
		}
	}

	if targetConn == "" {
		fmt.Fprintln(os.Stderr, "Error: --conn-id (or --conn) is required")
		return 1
	}

	targetOut := output
	if targetOut == "" {
		targetOut = out
	}

	drv, cleanup, err := resolveDriver(targetConn, dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error connecting to database: %v\n", err)
		return 1
	}
	defer cleanup()

	var annStore dictionary.AnnotationsProvider
	if dataDir != "" {
		if s, err := annotations.NewStore(filepath.Join(dataDir, "annotations.json")); err == nil {
			annStore = s
		}
	}

	dict, err := dictionary.ExtractCatalog(ctx, drv, targetConn, schema, annStore)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error extracting catalog: %v\n", err)
		return 1
	}

	var rendered string
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "html", "htm":
		rendered, err = dictionary.RenderHTML(dict)
	case "md", "markdown":
		rendered, err = dictionary.RenderMarkdown(dict)
	case "openapi", "json", "swagger":
		rendered, err = dictionary.RenderOpenAPI(dict)
	default:
		fmt.Fprintf(os.Stderr, "Error: unsupported format %q (allowed: html, md, openapi)\n", format)
		return 1
	}

	if err != nil {
		fmt.Fprintf(os.Stderr, "Error rendering documentation: %v\n", err)
		return 1
	}

	if targetOut != "" {
		if err := os.WriteFile(targetOut, []byte(rendered), 0644); err != nil {
			fmt.Fprintf(os.Stderr, "Error writing output file: %v\n", err)
			return 1
		}
		fmt.Printf("Data dictionary exported to %s (format: %s)\n", targetOut, format)
		return 0
	}

	fmt.Print(rendered)
	return 0
}

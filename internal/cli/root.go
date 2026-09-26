package cli

import (
	"fmt"
	"os"
	"strings"

	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/driver"
	"github.com/dblens/dblens/internal/driver/types"
)

const RootUsage = `DBLens - Modern Database Management & CI/CD Quality Gate Engine

Usage:
  dblens [command] [flags]
  dblens [server-flags] (starts web UI & HTTP server)

Available Commands:
  lint       Run static SQL quality gate & syntax analyzer on files/stdin
  diff       Compare schemas or data rows between databases
  seed       Generate deterministic mock data and populate or export fixtures
  profile    Audit column distributions, null ratios, uniqueness, and PII
  query      Execute ad-hoc SQL query headlessly and print tabular/json/csv output
  serve      Run DBLens embedded web application and HTTP API server
  help       Show help for any command

Server Flags (when run without command or with 'serve'):
  -port int        Port for HTTP server (default 8080)
  -data string     Directory to store configuration or data
  -static string   Path to static frontend dist files
  -version         Show version and exit

Use "dblens [command] --help" for detailed information about a command.
`

// Execute runs the CLI router with positional args (excluding binary name).
// Returns standard POSIX exit code: 0 for success, 1 for error/failure.
func Execute(args []string) int {
	if len(args) == 0 {
		fmt.Print(RootUsage)
		return 0
	}

	cmd := args[0]
	subArgs := args[1:]

	switch cmd {
	case "lint":
		return runLint(subArgs)
	case "diff":
		return runDiff(subArgs)
	case "seed":
		return runSeed(subArgs)
	case "profile":
		return runProfile(subArgs)
	case "query":
		return runQuery(subArgs)
	case "help", "--help", "-h":
		if len(subArgs) > 0 {
			return Execute(append(subArgs, "--help"))
		}
		fmt.Print(RootUsage)
		return 0
	case "serve":
		fmt.Println("To run web server, use 'dblens serve' without subcommands or flags, or run dblens directly.")
		return 0
	default:
		fmt.Fprintf(os.Stderr, "Error: unknown command %q for dblens\n\nRun 'dblens --help' for usage.\n", cmd)
		return 1
	}
}

// resolveDriver resolves a DSN or connection identifier into a working driver instance.
// Returns the driver, a cleanup callback to close connections, and any error.
func resolveDriver(connStr, dataDir string) (types.Driver, func(), error) {
	connStr = strings.TrimSpace(connStr)
	if connStr == "" {
		return nil, nil, fmt.Errorf("connection string or profile ID is required (--conn, --source, or --target)")
	}

	// 1. Check if it matches a stored/global profile in Manager
	var mgr *connection.Manager
	if dataDir != "" {
		mgr = connection.NewManager(dataDir)
	} else {
		mgr = connection.NewManager()
	}

	if realDSN, ok := mgr.GetGlobalDSNByID(connStr); ok && realDSN != "" {
		connStr = realDSN
	} else {
		for _, prof := range mgr.GlobalProfiles() {
			if strings.EqualFold(prof["id"], connStr) || strings.EqualFold(prof["label"], connStr) {
				if dsn, found := mgr.GetGlobalDSNByID(prof["id"]); found && dsn != "" {
					connStr = dsn
					break
				}
			}
		}
	}

	// 2. Open driver via driver factory
	drv, err := driver.NewDriver(connStr)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to connect to database %q: %w", connStr, err)
	}

	cleanup := func() {
		_ = drv.Close()
	}

	return drv, cleanup, nil
}

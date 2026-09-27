package datadiff

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/alter"
	"github.com/dblens/dblens/internal/driver/types"
)

var (
	reInsertSync = regexp.MustCompile(`(?i)^INSERT(?:\s+OR\s+IGNORE|\s+IGNORE)?\s+INTO\s+((?:[a-zA-Z0-9_` + "`" + `"]+\.)?[a-zA-Z0-9_` + "`" + `"]+)`)
	reUpdateSync = regexp.MustCompile(`(?i)^UPDATE\s+((?:[a-zA-Z0-9_` + "`" + `"]+\.)?[a-zA-Z0-9_` + "`" + `"]+)\s+SET\b`)
	reDeleteSync = regexp.MustCompile(`(?i)^DELETE\s+FROM\s+((?:[a-zA-Z0-9_` + "`" + `"]+\.)?[a-zA-Z0-9_` + "`" + `"]+)\s+WHERE\b`)
)

// ValidateSyncStatement validates that a statement is a safe, permissible DML or transaction statement
// targeting expectedTable. It rejects DDL, comments, PRAGMAs, and multi-statement injections.
func ValidateSyncStatement(stmt string, expectedTable string) error {
	trimmed := strings.TrimSpace(stmt)
	trimmed = strings.TrimSuffix(trimmed, ";")
	trimmed = strings.TrimSpace(trimmed)
	if trimmed == "" {
		return fmt.Errorf("empty statement")
	}

	// Reject multi-statement injections
	if strings.Contains(trimmed, ";") {
		return fmt.Errorf("multi-statement execution is rejected")
	}

	// Reject SQL comments
	if strings.Contains(trimmed, "--") || strings.Contains(trimmed, "/*") || strings.Contains(trimmed, "*/") {
		return fmt.Errorf("comments are not permitted in sync statements")
	}

	// Allow transaction markers
	upper := strings.ToUpper(trimmed)
	if upper == "BEGIN" || upper == "COMMIT" || upper == "ROLLBACK" ||
		upper == "BEGIN TRANSACTION" || upper == "START TRANSACTION" {
		return nil
	}

	// Match permitted DML: INSERT INTO, UPDATE, DELETE FROM
	var targetRef string
	if m := reInsertSync.FindStringSubmatch(trimmed); len(m) > 1 {
		targetRef = m[1]
	} else if m := reUpdateSync.FindStringSubmatch(trimmed); len(m) > 1 {
		targetRef = m[1]
	} else if m := reDeleteSync.FindStringSubmatch(trimmed); len(m) > 1 {
		targetRef = m[1]
	} else {
		return fmt.Errorf("prohibited statement: only DML (INSERT, UPDATE, DELETE) or transaction markers permitted: %q", stmt)
	}

	// Verify target table matches expectedTable if specified
	if expectedTable != "" {
		cleanExpected := strings.Trim(strings.TrimSpace(expectedTable), "`\"")
		parts := strings.Split(targetRef, ".")
		actualTable := strings.Trim(strings.TrimSpace(parts[len(parts)-1]), "`\"")
		if !strings.EqualFold(actualTable, cleanExpected) {
			return fmt.Errorf("statement targets table %q but expected %q", actualTable, cleanExpected)
		}
	}

	return nil
}

// validateSyncStatement is an unexported alias for package-internal use.
func validateSyncStatement(stmt string, expectedTable string) error {
	return ValidateSyncStatement(stmt, expectedTable)
}

// DBProvider is implemented by drivers that expose their underlying *sql.DB.
type DBProvider interface {
	DB() *sql.DB
}

// SplitSQLStatements splits a script into individual executable statements,
// ignoring comments and empty lines.
func SplitSQLStatements(sqlScript string) []string {
	var statements []string
	var current strings.Builder
	inQuote := false
	var quoteChar rune
	runes := []rune(sqlScript)
	n := len(runes)

	for i := 0; i < n; i++ {
		ch := runes[i]

		// Handle comments outside quotes
		if !inQuote {
			// Single-line comment --
			if ch == '-' && i+1 < n && runes[i+1] == '-' {
				for i < n && runes[i] != '\n' {
					i++
				}
				continue
			}
			// Multi-line comment /* */
			if ch == '/' && i+1 < n && runes[i+1] == '*' {
				i += 2
				for i+1 < n && !(runes[i] == '*' && runes[i+1] == '/') {
					i++
				}
				i++ // skip '/'
				continue
			}
		}

		// Handle quotes: ' or " or `
		if ch == '\'' || ch == '"' || ch == '`' {
			if !inQuote {
				inQuote = true
				quoteChar = ch
			} else if ch == quoteChar {
				// Check for escaped quote '' or "" or ``
				if i+1 < n && runes[i+1] == quoteChar {
					current.WriteRune(ch)
					current.WriteRune(runes[i+1])
					i++
					continue
				}
				inQuote = false
			}
		}

		if ch == ';' && !inQuote {
			stmt := strings.TrimSpace(current.String())
			if stmt != "" {
				upper := strings.ToUpper(stmt)
				// Skip transaction control statements if present in script since we wrap atomically
				if upper != "BEGIN" && upper != "COMMIT" && upper != "ROLLBACK" &&
					upper != "BEGIN TRANSACTION" && upper != "START TRANSACTION" {
					statements = append(statements, stmt)
				}
			}
			current.Reset()
			continue
		}

		current.WriteRune(ch)
	}

	remaining := strings.TrimSpace(current.String())
	if remaining != "" {
		upper := strings.ToUpper(remaining)
		if upper != "BEGIN" && upper != "COMMIT" && upper != "ROLLBACK" &&
			upper != "BEGIN TRANSACTION" && upper != "START TRANSACTION" {
			statements = append(statements, remaining)
		}
	}

	return statements
}

// ExecuteSync executes sync statements atomically inside a transaction.
func ExecuteSync(ctx context.Context, driver types.Driver, req ApplySyncRequest) (*ApplySyncResponse, error) {
	start := time.Now()

	// Safe Mode Protection
	if req.ReadOnly {
		return nil, fmt.Errorf("connection is read-only; data diff sync mutations blocked by Safe Mode")
	}

	executable := req.Statements
	if len(executable) == 0 && strings.TrimSpace(req.SQL) != "" {
		executable = SplitSQLStatements(req.SQL)
	}

	if len(executable) == 0 {
		return &ApplySyncResponse{
			Success:            true,
			StatementsExecuted: 0,
			AffectedRows:       0,
			DurationMs:         time.Since(start).Milliseconds(),
			Message:            "No statements to execute",
		}, nil
	}

	// Validate every statement before executing
	for _, stmt := range executable {
		if err := ValidateSyncStatement(stmt, req.TargetTable); err != nil {
			return nil, fmt.Errorf("sync statement validation failed: %w", err)
		}
	}

	var totalAffected int64

	// If driver exposes underlying *sql.DB, use standard BeginTx for strict single-connection atomicity
	if prov, ok := driver.(DBProvider); ok && prov.DB() != nil {
		db := prov.DB()
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return nil, fmt.Errorf("failed to begin transaction: %w", err)
		}
		defer tx.Rollback()

		for i, stmt := range executable {
			res, err := tx.ExecContext(ctx, stmt)
			if err != nil {
				return nil, fmt.Errorf("statement %d failed: %s: %w", i+1, stmt, err)
			}
			if n, err := res.RowsAffected(); err == nil && n > 0 {
				totalAffected += n
			}
		}

		if err := tx.Commit(); err != nil {
			return nil, fmt.Errorf("failed to commit transaction: %w", err)
		}
	} else if connProv, ok := driver.(interface{ Conn(context.Context) (*sql.Conn, error) }); ok {
		conn, err := connProv.Conn(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to acquire dedicated connection: %w", err)
		}
		defer conn.Close()

		dialect := alter.NormalizeDialect(driver.Dialect())
		beginStmt := "BEGIN"
		if dialect == "mysql" {
			beginStmt = "START TRANSACTION"
		}

		if _, err := conn.ExecContext(ctx, beginStmt); err != nil {
			return nil, fmt.Errorf("failed to begin transaction on dedicated connection: %w", err)
		}

		committed := false
		defer func() {
			if !committed {
				_, _ = conn.ExecContext(ctx, "ROLLBACK")
			}
		}()

		for i, stmt := range executable {
			res, err := conn.ExecContext(ctx, stmt)
			if err != nil {
				return nil, fmt.Errorf("statement %d failed: %s: %w", i+1, stmt, err)
			}
			if n, err := res.RowsAffected(); err == nil && n > 0 {
				totalAffected += n
			}
		}

		if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
			return nil, fmt.Errorf("failed to commit transaction: %w", err)
		}
		committed = true
	} else {
		return nil, fmt.Errorf("driver does not support transactional execution: missing DBProvider or dedicated connection")
	}

	return &ApplySyncResponse{
		Success:            true,
		StatementsExecuted: len(executable),
		AffectedRows:       totalAffected,
		DurationMs:         time.Since(start).Milliseconds(),
		Message:            fmt.Sprintf("Successfully applied %d statements (%d rows affected)", len(executable), totalAffected),
	}, nil
}

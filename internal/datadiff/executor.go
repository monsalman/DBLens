package datadiff

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/alter"
	"github.com/dblens/dblens/internal/driver/types"
)

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

	var totalAffected int64

	// If driver exposes underlying *sql.DB, use standard BeginTx
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
	} else {
		// Fallback to driver.ExecuteQuery transaction wrapping
		dialect := alter.NormalizeDialect(driver.Dialect())
		beginStmt := "BEGIN"
		if dialect == "mysql" {
			beginStmt = "START TRANSACTION"
		}

		if _, err := driver.ExecuteQuery(ctx, beginStmt); err != nil {
			return nil, fmt.Errorf("failed to begin transaction: %w", err)
		}

		for i, stmt := range executable {
			res, err := driver.ExecuteQuery(ctx, stmt)
			if err != nil {
				_, _ = driver.ExecuteQuery(ctx, "ROLLBACK")
				return nil, fmt.Errorf("statement %d failed: %s: %w", i+1, stmt, err)
			}
			if res != nil && res.AffectedRows > 0 {
				totalAffected += res.AffectedRows
			}
		}

		if _, err := driver.ExecuteQuery(ctx, "COMMIT"); err != nil {
			_, _ = driver.ExecuteQuery(ctx, "ROLLBACK")
			return nil, fmt.Errorf("failed to commit transaction: %w", err)
		}
	}

	return &ApplySyncResponse{
		Success:            true,
		StatementsExecuted: len(executable),
		AffectedRows:       totalAffected,
		DurationMs:         time.Since(start).Milliseconds(),
		Message:            fmt.Sprintf("Successfully applied %d statements (%d rows affected)", len(executable), totalAffected),
	}, nil
}

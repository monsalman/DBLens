package migration

import (
	"context"
	"crypto/sha256"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
)

// Supported migration tool formats.
const (
	FormatGolangMigrate = "golang-migrate"
	FormatGoose         = "goose"
	FormatFlyway        = "flyway"
	FormatDbmate        = "dbmate"
	FormatPrisma        = "prisma"
)

var reSlugNonAlpha = regexp.MustCompile(`[^a-z0-9]+`)

// MigrationRecord represents an applied migration saved in _dblens_migrations.
type MigrationRecord struct {
	ID              int64     `json:"id"`
	Version         string    `json:"version"`
	Name            string    `json:"name"`
	AppliedAt       time.Time `json:"appliedAt"`
	Checksum        string    `json:"checksum"`
	ExecutionTimeMs int64     `json:"executionTimeMs"`
	UpSQL           string    `json:"upSql"`
	DownSQL         string    `json:"downSql"`
}

// MigrationFile represents a generated file in a bundle.
type MigrationFile struct {
	FileName string `json:"fileName"`
	Content  string `json:"content"`
}

// MigrationBundle packages all generated migration files and metadata.
type MigrationBundle struct {
	Format   string            `json:"format"`
	Version  string            `json:"version"`
	Name     string            `json:"name"`
	Checksum string            `json:"checksum"`
	Files    []MigrationFile   `json:"files"`
	FileMap  map[string]string `json:"fileMap"`
}

// GenerateMigrationRequest holds parameters to generate migration files.
type GenerateMigrationRequest struct {
	Name    string `json:"name"`
	UpSQL   string `json:"upSql"`
	DownSQL string `json:"downSql"`
	Format  string `json:"format"`
	Version string `json:"version,omitempty"`
}

// ApplyMigrationRequest holds parameters to run and track a migration.
type ApplyMigrationRequest struct {
	Version  string `json:"version,omitempty"`
	Name     string `json:"name"`
	UpSQL    string `json:"upSql"`
	DownSQL  string `json:"downSql"`
	Checksum string `json:"checksum,omitempty"`
}

// SanitizeSlug converts migration name to a filesystem and tool-safe slug.
func SanitizeSlug(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = reSlugNonAlpha.ReplaceAllString(s, "_")
	s = strings.Trim(s, "_")
	if s == "" {
		return "migration"
	}
	return s
}

// GenerateVersion returns a 14-character UTC timestamp YYYYMMDDHHMMSS.
func GenerateVersion() string {
	return time.Now().UTC().Format("20060102150405")
}

// SanitizeVersion ensures a valid version identifier or falls back to timestamp.
func SanitizeVersion(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return GenerateVersion()
	}
	var sb strings.Builder
	for _, r := range v {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == '_' || r == '-' {
			sb.WriteRune(r)
		}
	}
	res := sb.String()
	if res == "" {
		return GenerateVersion()
	}
	return res
}

// CalculateChecksum computes hex SHA-256 hash of UpSQL.
func CalculateChecksum(upSQL string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(upSQL)))
	return fmt.Sprintf("%x", sum)
}

// NormalizeFormat resolves tool format aliases.
func NormalizeFormat(format string) string {
	f := strings.ToLower(strings.TrimSpace(format))
	switch f {
	case "golang-migrate", "golang_migrate", "golangmigrate":
		return FormatGolangMigrate
	case "goose":
		return FormatGoose
	case "flyway":
		return FormatFlyway
	case "dbmate", "db-mate", "db_mate":
		return FormatDbmate
	case "prisma":
		return FormatPrisma
	default:
		return FormatGoose
	}
}

// GenerateBundle generates versioned migration files formatted for the requested tool.
func GenerateBundle(req GenerateMigrationRequest) (*MigrationBundle, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, fmt.Errorf("migration name is required")
	}

	slug := SanitizeSlug(name)
	version := SanitizeVersion(req.Version)
	upSQL := strings.TrimSpace(req.UpSQL)
	downSQL := strings.TrimSpace(req.DownSQL)
	checksum := CalculateChecksum(upSQL)
	format := NormalizeFormat(req.Format)

	bundle := &MigrationBundle{
		Format:   format,
		Version:  version,
		Name:     slug,
		Checksum: checksum,
		Files:    make([]MigrationFile, 0),
		FileMap:  make(map[string]string),
	}

	// ponytail: Single-pass format generator covers 5 standard engines; upgrade to plugin architecture if users need custom enterprise templating.
	switch format {
	case FormatGolangMigrate:
		upFile := fmt.Sprintf("%s_%s.up.sql", version, slug)
		downFile := fmt.Sprintf("%s_%s.down.sql", version, slug)
		bundle.Files = append(bundle.Files,
			MigrationFile{FileName: upFile, Content: upSQL + "\n"},
			MigrationFile{FileName: downFile, Content: downSQL + "\n"},
		)

	case FormatGoose:
		fileName := fmt.Sprintf("%s_%s.sql", version, slug)
		var sb strings.Builder
		sb.WriteString("-- +goose Up\n")
		sb.WriteString(upSQL)
		sb.WriteString("\n\n-- +goose Down\n")
		sb.WriteString(downSQL)
		sb.WriteString("\n")
		bundle.Files = append(bundle.Files, MigrationFile{FileName: fileName, Content: sb.String()})

	case FormatFlyway:
		vFile := fmt.Sprintf("V%s__%s.sql", version, slug)
		uFile := fmt.Sprintf("U%s__%s.sql", version, slug)
		bundle.Files = append(bundle.Files,
			MigrationFile{FileName: vFile, Content: upSQL + "\n"},
			MigrationFile{FileName: uFile, Content: downSQL + "\n"},
		)

	case FormatDbmate:
		fileName := fmt.Sprintf("%s_%s.sql", version, slug)
		var sb strings.Builder
		sb.WriteString("-- migrate:up\n")
		sb.WriteString(upSQL)
		sb.WriteString("\n\n-- migrate:down\n")
		sb.WriteString(downSQL)
		sb.WriteString("\n")
		bundle.Files = append(bundle.Files, MigrationFile{FileName: fileName, Content: sb.String()})

	case FormatPrisma:
		fileName := "migration.sql"
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("-- Migration: %s_%s\n", version, slug))
		sb.WriteString(upSQL)
		sb.WriteString("\n")
		bundle.Files = append(bundle.Files, MigrationFile{FileName: fileName, Content: sb.String()})
	}

	for _, f := range bundle.Files {
		bundle.FileMap[f.FileName] = f.Content
	}

	return bundle, nil
}

// TrackerTableDDL returns dialect-specific DDL for the _dblens_migrations tracking table.
func TrackerTableDDL(dialect string) string {
	d := strings.ToLower(strings.TrimSpace(dialect))
	switch d {
	case "postgres", "postgresql", "pg":
		return `CREATE TABLE IF NOT EXISTS _dblens_migrations (
    id BIGSERIAL PRIMARY KEY,
    version VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    checksum VARCHAR(64) NOT NULL,
    execution_time_ms BIGINT NOT NULL DEFAULT 0,
    up_sql TEXT NOT NULL,
    down_sql TEXT NOT NULL
);`
	case "mysql", "mariadb":
		return `CREATE TABLE IF NOT EXISTS _dblens_migrations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    version VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    checksum VARCHAR(64) NOT NULL,
    execution_time_ms BIGINT NOT NULL DEFAULT 0,
    up_sql TEXT NOT NULL,
    down_sql TEXT NOT NULL
);`
	default: // sqlite, etc.
		return `CREATE TABLE IF NOT EXISTS _dblens_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    checksum TEXT NOT NULL,
    execution_time_ms INTEGER NOT NULL DEFAULT 0,
    up_sql TEXT NOT NULL,
    down_sql TEXT NOT NULL
);`
	}
}

// EnsureTrackerTable creates _dblens_migrations table if not already present.
func EnsureTrackerTable(ctx context.Context, drv types.Driver) error {
	ddl := TrackerTableDDL(drv.Dialect())
	_, err := drv.ExecuteQuery(ctx, ddl)
	return err
}

// IsTrackerInitialized tests if _dblens_migrations exists and is accessible.
func IsTrackerInitialized(ctx context.Context, drv types.Driver) (bool, error) {
	_, err := drv.ExecuteQuery(ctx, "SELECT id FROM _dblens_migrations LIMIT 1;")
	if err == nil {
		return true, nil
	}
	return false, nil
}

// List returns all applied migrations ordered by ID ascending.
func List(ctx context.Context, drv types.Driver) ([]MigrationRecord, error) {
	init, err := IsTrackerInitialized(ctx, drv)
	if err != nil || !init {
		return []MigrationRecord{}, nil
	}

	query := `SELECT id, version, name, applied_at, checksum, execution_time_ms, up_sql, down_sql FROM _dblens_migrations ORDER BY id ASC;`
	res, err := drv.ExecuteQuery(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to list migrations: %w", err)
	}

	records := make([]MigrationRecord, 0, len(res.Rows))
	for _, row := range res.Rows {
		if len(row) < 8 {
			continue
		}
		rec := MigrationRecord{
			ID:              toInt64(row[0]),
			Version:         fmt.Sprint(row[1]),
			Name:            fmt.Sprint(row[2]),
			AppliedAt:       toTime(row[3]),
			Checksum:        fmt.Sprint(row[4]),
			ExecutionTimeMs: toInt64(row[5]),
			UpSQL:           fmt.Sprint(row[6]),
			DownSQL:         fmt.Sprint(row[7]),
		}
		records = append(records, rec)
	}
	return records, nil
}

// Apply executes UpSQL on the connection and records entry in _dblens_migrations.
func Apply(ctx context.Context, drv types.Driver, req ApplyMigrationRequest) (*MigrationRecord, error) {
	if err := EnsureTrackerTable(ctx, drv); err != nil {
		return nil, fmt.Errorf("failed to initialize migration tracker table: %w", err)
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, fmt.Errorf("migration name is required")
	}
	upSQL := strings.TrimSpace(req.UpSQL)
	if upSQL == "" {
		return nil, fmt.Errorf("migration up SQL is required")
	}
	downSQL := strings.TrimSpace(req.DownSQL)

	version := SanitizeVersion(req.Version)

	// Check if already applied
	checkSQL := `SELECT version FROM _dblens_migrations WHERE version = :ver LIMIT 1;`
	res, err := drv.ExecuteQueryWithParams(ctx, checkSQL, map[string]interface{}{"ver": version})
	if err == nil && len(res.Rows) > 0 {
		return nil, fmt.Errorf("migration version %s has already been applied", version)
	}

	checksum := strings.TrimSpace(req.Checksum)
	if checksum == "" {
		checksum = CalculateChecksum(upSQL)
	}

	start := time.Now()
	// Execute Up SQL
	if _, err := drv.ExecuteQuery(ctx, upSQL); err != nil {
		return nil, fmt.Errorf("failed executing migration up SQL: %w", err)
	}
	elapsedMs := time.Since(start).Milliseconds()

	// Record in _dblens_migrations
	insertSQL := `INSERT INTO _dblens_migrations (version, name, checksum, execution_time_ms, up_sql, down_sql) VALUES (:ver, :name, :chk, :elapsed, :up, :down);`
	_, err = drv.ExecuteQueryWithParams(ctx, insertSQL, map[string]interface{}{
		"ver":     version,
		"name":    name,
		"chk":     checksum,
		"elapsed": elapsedMs,
		"up":      upSQL,
		"down":    downSQL,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to record migration: %w", err)
	}

	// Fetch recorded row
	fetchSQL := `SELECT id, version, name, applied_at, checksum, execution_time_ms, up_sql, down_sql FROM _dblens_migrations WHERE version = :ver LIMIT 1;`
	fetchRes, err := drv.ExecuteQueryWithParams(ctx, fetchSQL, map[string]interface{}{"ver": version})
	if err == nil && len(fetchRes.Rows) > 0 {
		row := fetchRes.Rows[0]
		return &MigrationRecord{
			ID:              toInt64(row[0]),
			Version:         fmt.Sprint(row[1]),
			Name:            fmt.Sprint(row[2]),
			AppliedAt:       toTime(row[3]),
			Checksum:        fmt.Sprint(row[4]),
			ExecutionTimeMs: toInt64(row[5]),
			UpSQL:           fmt.Sprint(row[6]),
			DownSQL:         fmt.Sprint(row[7]),
		}, nil
	}

	return &MigrationRecord{
		Version:         version,
		Name:            name,
		AppliedAt:       time.Now().UTC(),
		Checksum:        checksum,
		ExecutionTimeMs: elapsedMs,
		UpSQL:           upSQL,
		DownSQL:         downSQL,
	}, nil
}

// Rollback executes DownSQL of the specified migration (or latest if empty) and removes tracking record.
func Rollback(ctx context.Context, drv types.Driver, version string) (*MigrationRecord, error) {
	init, err := IsTrackerInitialized(ctx, drv)
	if err != nil || !init {
		return nil, fmt.Errorf("migration tracker table is not initialized")
	}

	var fetchSQL string
	var params map[string]interface{}

	v := strings.TrimSpace(version)
	if v != "" {
		fetchSQL = `SELECT id, version, name, applied_at, checksum, execution_time_ms, up_sql, down_sql FROM _dblens_migrations WHERE version = :ver LIMIT 1;`
		params = map[string]interface{}{"ver": v}
	} else {
		fetchSQL = `SELECT id, version, name, applied_at, checksum, execution_time_ms, up_sql, down_sql FROM _dblens_migrations ORDER BY id DESC LIMIT 1;`
		params = nil
	}

	var fetchRes *types.QueryResult
	if params != nil {
		fetchRes, err = drv.ExecuteQueryWithParams(ctx, fetchSQL, params)
	} else {
		fetchRes, err = drv.ExecuteQuery(ctx, fetchSQL)
	}

	if err != nil {
		return nil, fmt.Errorf("failed querying migration for rollback: %w", err)
	}
	if len(fetchRes.Rows) == 0 {
		if v != "" {
			return nil, fmt.Errorf("migration version %s not found in tracking table", v)
		}
		return nil, fmt.Errorf("no applied migrations found to rollback")
	}

	row := fetchRes.Rows[0]
	record := &MigrationRecord{
		ID:              toInt64(row[0]),
		Version:         fmt.Sprint(row[1]),
		Name:            fmt.Sprint(row[2]),
		AppliedAt:       toTime(row[3]),
		Checksum:        fmt.Sprint(row[4]),
		ExecutionTimeMs: toInt64(row[5]),
		UpSQL:           fmt.Sprint(row[6]),
		DownSQL:         fmt.Sprint(row[7]),
	}

	downSQL := strings.TrimSpace(record.DownSQL)
	if downSQL == "" {
		return nil, fmt.Errorf("migration %s has no down SQL defined for rollback", record.Version)
	}

	// Execute Down SQL
	if _, err := drv.ExecuteQuery(ctx, downSQL); err != nil {
		return nil, fmt.Errorf("failed executing rollback down SQL: %w", err)
	}

	// Delete from tracker table
	deleteSQL := `DELETE FROM _dblens_migrations WHERE version = :ver;`
	if _, err := drv.ExecuteQueryWithParams(ctx, deleteSQL, map[string]interface{}{"ver": record.Version}); err != nil {
		return nil, fmt.Errorf("failed deleting rolled back migration from tracker: %w", err)
	}

	return record, nil
}

func toInt64(val interface{}) int64 {
	switch v := val.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case int32:
		return int64(v)
	case float64:
		return int64(v)
	case string:
		n, _ := strconv.ParseInt(v, 10, 64)
		return n
	default:
		return 0
	}
}

func toTime(val interface{}) time.Time {
	switch v := val.(type) {
	case time.Time:
		return v
	case string:
		layouts := []string{
			time.RFC3339Nano,
			time.RFC3339,
			"2006-01-02 15:04:05.999999-07:00",
			"2006-01-02 15:04:05-07:00",
			"2006-01-02 15:04:05",
			"2006-01-02T15:04:05",
		}
		for _, layout := range layouts {
			if t, err := time.Parse(layout, v); err == nil {
				return t
			}
		}
	}
	return time.Now().UTC()
}

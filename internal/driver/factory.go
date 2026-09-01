package driver

import (
	"fmt"
	"strings"

	"github.com/dblens/dblens/internal/driver/mysql"
	"github.com/dblens/dblens/internal/driver/postgres"
	"github.com/dblens/dblens/internal/driver/sqlite"
)

func NewDriver(dsn string) (Driver, error) {
	dsnTrim := strings.TrimSpace(dsn)
	lower := strings.ToLower(dsnTrim)

	if strings.HasPrefix(lower, "postgres://") || strings.HasPrefix(lower, "postgresql://") {
		return postgres.New(dsnTrim)
	}
	if strings.HasPrefix(lower, "mysql://") {
		return mysql.New(dsnTrim)
	}
	if strings.HasPrefix(lower, "sqlite://") || strings.HasPrefix(lower, "file:") || strings.HasSuffix(lower, ".db") || strings.HasSuffix(lower, ".sqlite") || strings.HasSuffix(lower, ".sqlite3") {
		return sqlite.New(dsnTrim)
	}

	return nil, fmt.Errorf("unsupported database DSN scheme or format: %s", dsn)
}

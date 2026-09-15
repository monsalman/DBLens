package driver

import (
	"strings"
)

// MaskDSN masks passwords in database connection strings while preserving
// usernames, hosts, ports, database names, and query parameters.
func MaskDSN(dsn string) string {
	if !strings.Contains(dsn, "@") {
		return dsn
	}

	base := dsn
	query := ""
	if qIdx := strings.Index(dsn, "?"); qIdx != -1 {
		base = dsn[:qIdx]
		query = dsn[qIdx:]
	}

	lastAt := strings.LastIndex(base, "@")
	if lastAt == -1 {
		return dsn
	}

	start := 0
	if prefixIdx := strings.Index(base, "://"); prefixIdx != -1 && prefixIdx < lastAt {
		start = prefixIdx + 3
	}

	userInfo := base[start:lastAt]
	colonIdx := strings.Index(userInfo, ":")
	if colonIdx == -1 {
		return dsn
	}

	user := userInfo[:colonIdx]
	return dsn[:start] + user + ":***" + base[lastAt:] + query
}

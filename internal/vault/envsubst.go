package vault

import (
	"fmt"
	"os"
	"regexp"
	"strings"
)

var (
	// Matches ${VAR_NAME} or $VAR_NAME
	reEnvVar = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)`)

	// URI style: scheme://user:pass@host/db
	reURIDSN = regexp.MustCompile(`^([a-zA-Z][a-zA-Z0-9+.-]*://)([^:@]+):([^@]+)@(.*)$`)

	// Standard MySQL DSN: user:pass@tcp(host:port)/db or user:pass@unix(socket)/db
	reMySQLDSN = regexp.MustCompile(`^([^:@]+):([^@]+)@(tcp|unix)\((.+)\)/([^?]*)(.*)$`)

	// Key-value DSNs (e.g. host=... password=secret ...)
	reKVPassword = regexp.MustCompile(`(?i)\bpassword\s*=\s*('[^']*'|"[^"]*"|[^\s;]+)`)
)

// IsSecretReference detects CLI / manager secret patterns (1Password op:// or pass:).
func IsSecretReference(s string) bool {
	trimmed := strings.TrimSpace(s)
	return strings.HasPrefix(trimmed, "op://") ||
		strings.HasPrefix(trimmed, "pass:") ||
		strings.Contains(trimmed, "op://") ||
		strings.Contains(trimmed, "pass:")
}

// InterpolateString scans a string for environment variables and substitutes them from os.Getenv.
func InterpolateString(s string) (string, []string) {
	var substituted []string
	seen := make(map[string]bool)

	result := reEnvVar.ReplaceAllStringFunc(s, func(match string) string {
		varName := strings.TrimPrefix(match, "$")
		varName = strings.TrimPrefix(varName, "{")
		varName = strings.TrimSuffix(varName, "}")

		val, found := os.LookupEnv(varName)
		if found && val != "" {
			if !seen[varName] {
				seen[varName] = true
				substituted = append(substituted, varName)
			}
			return val
		}
		// If not set in environment, keep the template placeholder intact
		return match
	})

	return result, substituted
}

// InterpolateConnection expands environment variables in the connection DSN and fields.
func InterpolateConnection(conn VaultConnection) (VaultConnection, []string) {
	updated := conn
	dsn, vars := InterpolateString(conn.DSN)
	updated.DSN = dsn
	return updated, vars
}

// ScrubDSN sanitizes passwords from connection strings, replacing them with an env variable placeholder.
func ScrubDSN(rawDSN string, placeholderVar string) (string, string, bool) {
	raw := strings.TrimSpace(rawDSN)
	if raw == "" {
		return raw, "", false
	}

	if placeholderVar == "" {
		placeholderVar = "$DATABASE_PASSWORD"
	}
	if !strings.HasPrefix(placeholderVar, "$") {
		placeholderVar = "$" + placeholderVar
	}

	// 1. Try URL parser and URI regex (postgres://, mysql://, etc.)
	if m := reURIDSN.FindStringSubmatch(raw); len(m) > 3 {
		scheme := m[1]
		user := m[2]
		pass := m[3]
		rest := m[4]
		if strings.HasPrefix(pass, "$") || IsSecretReference(pass) {
			return raw, pass, false
		}
		return fmt.Sprintf("%s%s:%s@%s", scheme, user, placeholderVar, rest), pass, true
	}

	// 2. MySQL user:pass@tcp(...) format
	if m := reMySQLDSN.FindStringSubmatch(raw); len(m) > 2 {
		user := m[1]
		pass := m[2]
		if pass != "" && !strings.HasPrefix(pass, "$") && !IsSecretReference(pass) {
			target := fmt.Sprintf("%s:%s@", user, pass)
			replacement := fmt.Sprintf("%s:%s@", user, placeholderVar)
			if strings.Contains(raw, target) {
				return strings.Replace(raw, target, replacement, 1), pass, true
			}
		}
	}

	// 3. Key-Value format (password=secret)
	if match := reKVPassword.FindStringSubmatchIndex(raw); len(match) >= 4 {
		valStart, valEnd := match[2], match[3]
		val := raw[valStart:valEnd]
		cleanVal := strings.Trim(val, `"'`)
		if cleanVal != "" && !strings.HasPrefix(cleanVal, "$") && !IsSecretReference(cleanVal) {
			prefix := raw[:valStart]
			suffix := raw[valEnd:]
			return prefix + placeholderVar + suffix, cleanVal, true
		}
	}

	return raw, "", false
}

// ScrubPasswords iterates over connections and scrubs passwords to placeholders.
func ScrubPasswords(conns []VaultConnection) []VaultConnection {
	result := make([]VaultConnection, len(conns))
	for i, c := range conns {
		copied := c
		var envVar string
		if c.Environment != "" {
			envVar = fmt.Sprintf("$%s_DB_PASSWORD", strings.ToUpper(c.Environment))
		} else {
			envVar = "$DATABASE_PASSWORD"
		}
		scrubbedDSN, _, _ := ScrubDSN(c.DSN, envVar)
		copied.DSN = scrubbedDSN
		result[i] = copied
	}
	return result
}

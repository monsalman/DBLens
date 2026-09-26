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

	// Key-value DSNs (e.g. host=... password=secret ... or Pwd=secret ...)
	reKVPassword = regexp.MustCompile(`(?i)\b(?:password|pwd)\s*=\s*('[^']*'|"[^"]*"|[^\s;]+)`)
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

	// 1. URI style: scheme://user:pass@host/db
	if idx := strings.Index(raw, "://"); idx != -1 {
		scheme := raw[:idx+3]
		rest := raw[idx+3:]

		// Exclude query parameters when looking for host separator @
		base := rest
		if qIdx := strings.Index(rest, "?"); qIdx != -1 {
			base = rest[:qIdx]
		}

		if lastAt := strings.LastIndex(base, "@"); lastAt != -1 {
			userInfo := rest[:lastAt]
			hostAndPath := rest[lastAt+1:]

			var host, pathAndQuery string
			if slashIdx := strings.Index(hostAndPath, "/"); slashIdx != -1 {
				host = hostAndPath[:slashIdx]
				pathAndQuery = hostAndPath[slashIdx:]
			} else if qIdx := strings.Index(hostAndPath, "?"); qIdx != -1 {
				host = hostAndPath[:qIdx]
				pathAndQuery = hostAndPath[qIdx:]
			} else {
				host = hostAndPath
			}

			// First : in userInfo separates user from password
			if firstColon := strings.Index(userInfo, ":"); firstColon != -1 {
				user := userInfo[:firstColon]
				pass := userInfo[firstColon+1:]

				if pass != "" {
					if strings.HasPrefix(pass, "$") || IsSecretReference(pass) {
						return raw, pass, false
					}
					cleanDSN := fmt.Sprintf("%s%s:%s@%s%s", scheme, user, placeholderVar, host, pathAndQuery)
					return cleanDSN, pass, true
				}
			}
		}
	}

	// 2. Key-Value format (password=secret or pwd=secret)
	if match := reKVPassword.FindStringSubmatchIndex(raw); len(match) >= 4 {
		valStart, valEnd := match[2], match[3]
		val := raw[valStart:valEnd]
		cleanVal := strings.Trim(val, `"'`)
		if cleanVal != "" {
			if strings.HasPrefix(cleanVal, "$") || IsSecretReference(cleanVal) {
				return raw, cleanVal, false
			}
			prefix := raw[:valStart]
			suffix := raw[valEnd:]
			return prefix + placeholderVar + suffix, cleanVal, true
		}
	}

	// 3. MySQL bare DSN: user:pass@tcp(host:port)/db, user:pass@unix(socket)/db, user:pass@host:port/db, user:pass@/db
	if strings.Contains(raw, "@") && !strings.Contains(raw, "://") {
		lastAt := strings.LastIndex(raw, "@")
		userInfo := raw[:lastAt]
		rest := raw[lastAt+1:]

		// Ensure userInfo has : and doesn't look like key=value pair
		if firstColon := strings.Index(userInfo, ":"); firstColon != -1 && !strings.Contains(userInfo, "=") {
			user := userInfo[:firstColon]
			pass := userInfo[firstColon+1:]

			if pass != "" {
				if strings.HasPrefix(pass, "$") || IsSecretReference(pass) {
					return raw, pass, false
				}
				cleanDSN := fmt.Sprintf("%s:%s@%s", user, placeholderVar, rest)
				return cleanDSN, pass, true
			}
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

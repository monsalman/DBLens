package params

import (
	"fmt"
	"strings"
)

// CompileNamedParams parses named parameters (:param or {{param}}) in rawSql
// and converts them to positional placeholders for the specified SQL dialect.
// Dialects: "postgres", "postgresql", "pg" use $1, $2, ...;
// "mysql", "mariadb", "sqlite" use ?, ?, ...
func CompileNamedParams(dialect string, rawSql string, p map[string]interface{}) (string, []interface{}, error) {
	d := strings.ToLower(strings.TrimSpace(dialect))
	isPostgres := d == "postgres" || d == "postgresql" || d == "pg"

	n := len(rawSql)
	var sb strings.Builder
	sb.Grow(n)
	args := make([]interface{}, 0)
	paramMap := make(map[string]int) // varName -> 1-based index for Postgres

	i := 0
	for i < n {
		c := rawSql[i]

		// Single-quoted string literal: '...'
		if c == '\'' {
			sb.WriteByte('\'')
			i++
			for i < n {
				ch := rawSql[i]
				sb.WriteByte(ch)
				i++
				if ch == '\'' {
					if i < n && rawSql[i] == '\'' {
						// Escaped single quote ''
						sb.WriteByte('\'')
						i++
					} else {
						// End of string literal
						break
					}
				} else if ch == '\\' {
					// Escape sequence (e.g. in MySQL: \')
					if i < n {
						sb.WriteByte(rawSql[i])
						i++
					}
				}
			}
			continue
		}

		// Double-quoted identifier or string: "..."
		if c == '"' {
			sb.WriteByte('"')
			i++
			for i < n {
				ch := rawSql[i]
				sb.WriteByte(ch)
				i++
				if ch == '"' {
					if i < n && rawSql[i] == '"' {
						sb.WriteByte('"')
						i++
					} else {
						break
					}
				}
			}
			continue
		}

		// Backtick identifier: `...`
		if c == '`' {
			sb.WriteByte('`')
			i++
			for i < n {
				ch := rawSql[i]
				sb.WriteByte(ch)
				i++
				if ch == '`' {
					if i < n && rawSql[i] == '`' {
						sb.WriteByte('`')
						i++
					} else {
						break
					}
				}
			}
			continue
		}

		// Line comment: -- ...
		if c == '-' && i+1 < n && rawSql[i+1] == '-' {
			sb.WriteString("--")
			i += 2
			for i < n && rawSql[i] != '\n' {
				sb.WriteByte(rawSql[i])
				i++
			}
			continue
		}

		// Block comment: /* ... */
		if c == '/' && i+1 < n && rawSql[i+1] == '*' {
			sb.WriteString("/*")
			i += 2
			for i < n {
				if rawSql[i] == '*' && i+1 < n && rawSql[i+1] == '/' {
					sb.WriteString("*/")
					i += 2
					break
				}
				sb.WriteByte(rawSql[i])
				i++
			}
			continue
		}

		// Double-brace syntax: {{var}} or {{ var }}
		if c == '{' && i+1 < n && rawSql[i+1] == '{' {
			closeIdx := strings.Index(rawSql[i+2:], "}}")
			if closeIdx != -1 {
				rawInner := rawSql[i+2 : i+2+closeIdx]
				varName := strings.TrimSpace(rawInner)
				if isValidIdent(varName) {
					val, exists := p[varName]
					if !exists {
						return "", nil, fmt.Errorf("missing value for parameter: %s", varName)
					}
					if isPostgres {
						idx, found := paramMap[varName]
						if !found {
							args = append(args, val)
							idx = len(args)
							paramMap[varName] = idx
						}
						sb.WriteString(fmt.Sprintf("$%d", idx))
					} else {
						args = append(args, val)
						sb.WriteString("?")
					}
					i = i + 2 + closeIdx + 2
					continue
				}
			}
		}

		// Named parameter: :param
		// Strictly ignore Postgres type cast (::type) and non-identifiers (:=, 12:00)
		if c == ':' {
			// Check if part of double-colon cast (e.g. ::int or :::)
			if (i > 0 && rawSql[i-1] == ':') || (i+1 < n && rawSql[i+1] == ':') {
				sb.WriteByte(':')
				i++
				continue
			}

			// Check if next char is start of an identifier [a-zA-Z_]
			if i+1 < n && (isAlpha(rawSql[i+1]) || rawSql[i+1] == '_') {
				start := i + 1
				end := start
				for end < n && (isAlphaNum(rawSql[end]) || rawSql[end] == '_') {
					end++
				}
				varName := rawSql[start:end]
				val, exists := p[varName]
				if !exists {
					return "", nil, fmt.Errorf("missing value for parameter: %s", varName)
				}
				if isPostgres {
					idx, found := paramMap[varName]
					if !found {
						args = append(args, val)
						idx = len(args)
						paramMap[varName] = idx
					}
					sb.WriteString(fmt.Sprintf("$%d", idx))
				} else {
					args = append(args, val)
					sb.WriteString("?")
				}
				i = end
				continue
			}

			sb.WriteByte(':')
			i++
			continue
		}

		sb.WriteByte(c)
		i++
	}

	return sb.String(), args, nil
}

func isValidIdent(s string) bool {
	if len(s) == 0 {
		return false
	}
	for idx, r := range s {
		b := byte(r)
		if idx == 0 {
			if !isAlpha(b) && b != '_' {
				return false
			}
		} else {
			if !isAlphaNum(b) && b != '_' {
				return false
			}
		}
	}
	return true
}

func isAlpha(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func isAlphaNum(c byte) bool {
	return isAlpha(c) || (c >= '0' && c <= '9')
}

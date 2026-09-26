package vault

import (
	"fmt"
	"strings"
)

// EnforcePolicies applies team guardrail rules to imported or unlocked connections.
func EnforcePolicies(conns []VaultConnection, vaultPolicy VaultPolicy) ([]VaultConnection, []string) {
	var logs []string
	var results []VaultConnection

	allowedEnvMap := make(map[string]bool)
	for _, env := range vaultPolicy.AllowedEnvironments {
		trimmed := strings.ToLower(strings.TrimSpace(env))
		if trimmed != "" {
			allowedEnvMap[trimmed] = true
		}
	}

	for _, c := range conns {
		conn := c
		envLower := strings.ToLower(strings.TrimSpace(conn.Environment))
		isProd := envLower == "production" || envLower == "prod"

		// 1. Allowed Environments Check: skip connection if environment not allowed
		if len(allowedEnvMap) > 0 {
			if envLower == "" || !allowedEnvMap[envLower] {
				logs = append(logs, fmt.Sprintf("[%s] Rejected: environment '%s' is not in allowed team environments", conn.Name, conn.Environment))
				continue
			}
		}

		// 2. Connection-level Read-Only policy
		if conn.Policy.EnforceReadOnly {
			if !conn.ReadOnly {
				conn.ReadOnly = true
				logs = append(logs, fmt.Sprintf("[%s] Read-Only safe mode enforced by connection policy", conn.Name))
			}
		}

		// 3. Global Production Read-Only Guardrail
		if vaultPolicy.GlobalReadOnlyProd && isProd {
			if !conn.ReadOnly {
				conn.ReadOnly = true
				logs = append(logs, fmt.Sprintf("[%s] Read-Only safe mode enforced by production guardrail policy", conn.Name))
			}
		}

		// 4. Mandatory Audit Logging for Production
		if vaultPolicy.RequireAuditAllProd && isProd {
			if !conn.Policy.RequireAuditLog {
				conn.Policy.RequireAuditLog = true
				logs = append(logs, fmt.Sprintf("[%s] Mandatory audit logging enforced by production guardrail policy", conn.Name))
			}
		}

		results = append(results, conn)
	}

	return results, logs
}

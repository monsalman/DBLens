package vault

import (
	"fmt"
	"strings"
)

// EnforcePolicies applies team guardrail rules to imported or unlocked connections.
func EnforcePolicies(conns []VaultConnection, vaultPolicy VaultPolicy) ([]VaultConnection, []string) {
	var logs []string
	results := make([]VaultConnection, len(conns))

	allowedEnvMap := make(map[string]bool)
	for _, env := range vaultPolicy.AllowedEnvironments {
		allowedEnvMap[strings.ToLower(strings.TrimSpace(env))] = true
	}

	for i, c := range conns {
		conn := c
		envLower := strings.ToLower(strings.TrimSpace(conn.Environment))
		isProd := envLower == "production" || envLower == "prod"

		// 1. Connection-level Read-Only policy
		if conn.Policy.EnforceReadOnly {
			if !conn.ReadOnly {
				conn.ReadOnly = true
				logs = append(logs, fmt.Sprintf("[%s] Read-Only safe mode enforced by connection policy", conn.Name))
			}
		}

		// 2. Global Production Read-Only Guardrail
		if vaultPolicy.GlobalReadOnlyProd && isProd {
			if !conn.ReadOnly {
				conn.ReadOnly = true
				logs = append(logs, fmt.Sprintf("[%s] Read-Only safe mode enforced by production guardrail policy", conn.Name))
			}
		}

		// 3. Mandatory Audit Logging for Production
		if vaultPolicy.RequireAuditAllProd && isProd {
			if !conn.Policy.RequireAuditLog {
				conn.Policy.RequireAuditLog = true
				logs = append(logs, fmt.Sprintf("[%s] Mandatory audit logging enforced by production guardrail policy", conn.Name))
			}
		}

		// 4. Allowed Environments Check
		if len(allowedEnvMap) > 0 && conn.Environment != "" {
			if !allowedEnvMap[envLower] {
				logs = append(logs, fmt.Sprintf("[%s] Environment '%s' is not in allowed team environments", conn.Name, conn.Environment))
			}
		}

		results[i] = conn
	}

	return results, logs
}

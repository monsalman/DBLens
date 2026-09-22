package audit

import "strings"

// ClassifyQuery returns DDL, DML, SELECT, or OTHER based on first SQL token.
func ClassifyQuery(sql string) string {
	fields := strings.Fields(strings.TrimSpace(sql))
	if len(fields) == 0 {
		return "OTHER"
	}
	switch strings.ToUpper(fields[0]) {
	case "CREATE", "DROP", "ALTER", "TRUNCATE":
		return "DDL"
	case "INSERT", "UPDATE", "DELETE":
		return "DML"
	case "SELECT":
		return "SELECT"
	default:
		return "OTHER"
	}
}

package privilege

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/dblens/dblens/internal/driver/types"
)

// RoleInfo represents a database user or role with metadata.
type RoleInfo struct {
	Name            string                 `json:"name"`
	IsSuperuser     bool                   `json:"isSuperuser"`
	CanLogin        bool                   `json:"canLogin"`
	ConnectionLimit int                    `json:"connectionLimit"`
	Inherit         bool                   `json:"inherit,omitempty"`
	CreateDB        bool                   `json:"createDb,omitempty"`
	CreateRole      bool                   `json:"createRole,omitempty"`
	Attributes      map[string]interface{} `json:"attributes,omitempty"`
}

// TablePrivilege represents a grant on a specific table for a role.
type TablePrivilege struct {
	Grantee       string `json:"grantee"`
	TableSchema   string `json:"tableSchema"`
	TableName     string `json:"tableName"`
	PrivilegeType string `json:"privilegeType"`
	IsGrantable   bool   `json:"isGrantable"`
}

// PrivilegeReport summarizes the inspected roles and table grants.
type PrivilegeReport struct {
	Dialect             string           `json:"dialect"`
	Roles               []RoleInfo       `json:"roles"`
	TablePrivileges     []TablePrivilege `json:"tablePrivileges"`
	Tables              []string         `json:"tables"`
	SupportedPrivileges []string         `json:"supportedPrivileges"`
}

// PrivilegeChange describes an intended grant or revoke action.
type PrivilegeChange struct {
	Role            string `json:"role"`
	Schema          string `json:"schema"`
	Table           string `json:"table"`
	Privilege       string `json:"privilege"`
	Action          string `json:"action"` // "GRANT" or "REVOKE"
	WithGrantOption bool   `json:"withGrantOption,omitempty"`
}

// SafetyWarning notes dangerous or impactful privilege adjustments.
type SafetyWarning struct {
	Level   string `json:"level"` // "critical", "warning", "info"
	Role    string `json:"role"`
	Message string `json:"message"`
}

// PrivilegePlan provides dry-run DDL and associated safety warnings.
type PrivilegePlan struct {
	Statements    []string        `json:"statements"`
	Warnings      []SafetyWarning `json:"warnings"`
	Dangerous     bool            `json:"dangerous"`
	AffectedRoles []string        `json:"affectedRoles"`
}

var (
	identRegex = regexp.MustCompile(`^[a-zA-Z0-9_]+$`)
	roleRegex  = regexp.MustCompile(`^[a-zA-Z0-9_@.%-]+$`)
)

var allowedPrivileges = map[string]bool{
	"SELECT":         true,
	"INSERT":         true,
	"UPDATE":         true,
	"DELETE":         true,
	"REFERENCES":     true,
	"TRUNCATE":       true,
	"TRIGGER":        true,
	"USAGE":          true,
	"ALL":            true,
	"ALL PRIVILEGES": true,
}

var standardPrivileges = []string{
	"SELECT", "INSERT", "UPDATE", "DELETE", "REFERENCES", "TRUNCATE",
}

// InspectPrivileges queries database roles and table grants across PostgreSQL, MySQL, and SQLite.
func InspectPrivileges(ctx context.Context, d types.Driver, schemaFilter string) (*PrivilegeReport, error) {
	dialect := strings.ToLower(strings.TrimSpace(d.Dialect()))

	switch dialect {
	case "postgres", "postgresql":
		return inspectPostgres(ctx, d, schemaFilter)
	case "mysql", "mariadb":
		return inspectMySQL(ctx, d, schemaFilter)
	case "sqlite", "sqlite3":
		return inspectSQLite(ctx, d, schemaFilter)
	default:
		return inspectPostgres(ctx, d, schemaFilter)
	}
}

func inspectPostgres(ctx context.Context, d types.Driver, schemaFilter string) (*PrivilegeReport, error) {
	report := &PrivilegeReport{
		Dialect:             "postgres",
		Roles:               make([]RoleInfo, 0),
		TablePrivileges:     make([]TablePrivilege, 0),
		Tables:              make([]string, 0),
		SupportedPrivileges: standardPrivileges,
	}

	// 1. Roles
	roleQuery := `SELECT rolname, rolsuper, rolcanlogin, rolconnlimit, rolinherit, rolcreatedb, rolcreaterole FROM pg_roles ORDER BY rolname;`
	res, err := d.ExecuteRaw(ctx, roleQuery)
	if err == nil && res != nil {
		for _, row := range res.Rows {
			if len(row) < 7 {
				continue
			}
			report.Roles = append(report.Roles, RoleInfo{
				Name:            toString(row[0]),
				IsSuperuser:     toBool(row[1]),
				CanLogin:        toBool(row[2]),
				ConnectionLimit: toInt(row[3]),
				Inherit:         toBool(row[4]),
				CreateDB:        toBool(row[5]),
				CreateRole:      toBool(row[6]),
			})
		}
	} else {
		// Fallback: current user only
		resUser, uErr := d.ExecuteRaw(ctx, "SELECT current_user;")
		if uErr == nil && resUser != nil && len(resUser.Rows) > 0 && len(resUser.Rows[0]) > 0 {
			report.Roles = append(report.Roles, RoleInfo{
				Name:            toString(resUser.Rows[0][0]),
				IsSuperuser:     true,
				CanLogin:        true,
				ConnectionLimit: -1,
			})
		}
	}

	// 2. Tables list
	tblQuery := `SELECT table_schema, table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name;`
	tblRes, err := d.ExecuteRaw(ctx, tblQuery)
	tableSet := make(map[string]bool)
	if err == nil && tblRes != nil {
		for _, row := range tblRes.Rows {
			if len(row) < 2 {
				continue
			}
			schema := toString(row[0])
			tbl := toString(row[1])
			if schemaFilter != "" && !strings.EqualFold(schema, schemaFilter) {
				continue
			}
			full := schema + "." + tbl
			if !tableSet[full] {
				tableSet[full] = true
				report.Tables = append(report.Tables, full)
			}
		}
	}

	// 3. Table Privileges
	privQuery := `SELECT grantee, table_schema, table_name, privilege_type, is_grantable FROM information_schema.table_privileges WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY grantee, table_schema, table_name;`
	privRes, err := d.ExecuteRaw(ctx, privQuery)
	if err == nil && privRes != nil {
		for _, row := range privRes.Rows {
			if len(row) < 5 {
				continue
			}
			schema := toString(row[1])
			if schemaFilter != "" && !strings.EqualFold(schema, schemaFilter) {
				continue
			}
			grantee := toString(row[0])
			tbl := toString(row[2])
			privType := strings.ToUpper(toString(row[3]))
			grantable := toBool(row[4])

			full := schema + "." + tbl
			if !tableSet[full] {
				tableSet[full] = true
				report.Tables = append(report.Tables, full)
			}

			report.TablePrivileges = append(report.TablePrivileges, TablePrivilege{
				Grantee:       grantee,
				TableSchema:   schema,
				TableName:     tbl,
				PrivilegeType: privType,
				IsGrantable:   grantable,
			})
		}
	}

	sort.Strings(report.Tables)
	return report, nil
}

func inspectMySQL(ctx context.Context, d types.Driver, schemaFilter string) (*PrivilegeReport, error) {
	report := &PrivilegeReport{
		Dialect:             "mysql",
		Roles:               make([]RoleInfo, 0),
		TablePrivileges:     make([]TablePrivilege, 0),
		Tables:              make([]string, 0),
		SupportedPrivileges: standardPrivileges,
	}

	// 1. Users from mysql.user or current_user
	roleQuery := `SELECT User, Host, Super_priv FROM mysql.user ORDER BY User, Host;`
	res, err := d.ExecuteRaw(ctx, roleQuery)
	if err == nil && res != nil && len(res.Rows) > 0 {
		for _, row := range res.Rows {
			if len(row) < 3 {
				continue
			}
			user := toString(row[0])
			host := toString(row[1])
			super := strings.EqualFold(toString(row[2]), "Y")
			name := user
			if host != "" && host != "%" {
				name = user + "@" + host
			}
			report.Roles = append(report.Roles, RoleInfo{
				Name:            name,
				IsSuperuser:     super,
				CanLogin:        true,
				ConnectionLimit: -1,
				Attributes: map[string]interface{}{
					"host": host,
				},
			})
		}
	} else {
		// Fallback to CURRENT_USER()
		curRes, cErr := d.ExecuteRaw(ctx, "SELECT CURRENT_USER();")
		if cErr == nil && curRes != nil && len(curRes.Rows) > 0 && len(curRes.Rows[0]) > 0 {
			curUser := toString(curRes.Rows[0][0])
			report.Roles = append(report.Roles, RoleInfo{
				Name:            curUser,
				IsSuperuser:     strings.HasPrefix(curUser, "root"),
				CanLogin:        true,
				ConnectionLimit: -1,
			})
		}
	}

	// 2. Tables list
	tblQuery := `SELECT table_schema, table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys') ORDER BY table_schema, table_name;`
	tblRes, err := d.ExecuteRaw(ctx, tblQuery)
	tableSet := make(map[string]bool)
	if err == nil && tblRes != nil {
		for _, row := range tblRes.Rows {
			if len(row) < 2 {
				continue
			}
			schema := toString(row[0])
			tbl := toString(row[1])
			if schemaFilter != "" && !strings.EqualFold(schema, schemaFilter) {
				continue
			}
			full := schema + "." + tbl
			if !tableSet[full] {
				tableSet[full] = true
				report.Tables = append(report.Tables, full)
			}
		}
	}

	// 3. Table Privileges
	privQuery := `SELECT grantee, table_schema, table_name, privilege_type, is_grantable FROM information_schema.table_privileges WHERE table_schema NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys') ORDER BY grantee, table_schema, table_name;`
	privRes, err := d.ExecuteRaw(ctx, privQuery)
	if err == nil && privRes != nil {
		for _, row := range privRes.Rows {
			if len(row) < 5 {
				continue
			}
			schema := toString(row[1])
			if schemaFilter != "" && !strings.EqualFold(schema, schemaFilter) {
				continue
			}
			rawGrantee := toString(row[0])
			grantee := cleanMySQLGrantee(rawGrantee)
			tbl := toString(row[2])
			privType := strings.ToUpper(toString(row[3]))
			grantable := toBool(row[4])

			full := schema + "." + tbl
			if !tableSet[full] {
				tableSet[full] = true
				report.Tables = append(report.Tables, full)
			}

			report.TablePrivileges = append(report.TablePrivileges, TablePrivilege{
				Grantee:       grantee,
				TableSchema:   schema,
				TableName:     tbl,
				PrivilegeType: privType,
				IsGrantable:   grantable,
			})
		}
	}

	sort.Strings(report.Tables)
	return report, nil
}

func inspectSQLite(ctx context.Context, d types.Driver, schemaFilter string) (*PrivilegeReport, error) {
	report := &PrivilegeReport{
		Dialect: "sqlite",
		Roles: []RoleInfo{
			{
				Name:            "sqlite_admin",
				IsSuperuser:     true,
				CanLogin:        true,
				ConnectionLimit: 1,
				Attributes: map[string]interface{}{
					"storage":     "file_based",
					"permissions": "read_write",
				},
			},
		},
		TablePrivileges:     make([]TablePrivilege, 0),
		Tables:              make([]string, 0),
		SupportedPrivileges: standardPrivileges,
	}

	// Tables from sqlite_master
	res, err := d.ExecuteRaw(ctx, `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;`)
	if err == nil && res != nil {
		for _, row := range res.Rows {
			if len(row) < 1 {
				continue
			}
			name := toString(row[0])
			report.Tables = append(report.Tables, name)
			// SQLite grants all permissions to local file admin
			for _, p := range standardPrivileges {
				report.TablePrivileges = append(report.TablePrivileges, TablePrivilege{
					Grantee:       "sqlite_admin",
					TableSchema:   "main",
					TableName:     name,
					PrivilegeType: p,
					IsGrantable:   false,
				})
			}
		}
	}

	return report, nil
}

// GeneratePlan validates inputs, generates DDL statements, and computes safety warnings.
func GeneratePlan(dialect string, changes []PrivilegeChange, roles []RoleInfo) (*PrivilegePlan, error) {
	d := strings.ToLower(strings.TrimSpace(dialect))
	plan := &PrivilegePlan{
		Statements:    make([]string, 0, len(changes)),
		Warnings:      make([]SafetyWarning, 0),
		Dangerous:     false,
		AffectedRoles: make([]string, 0),
	}

	roleMap := make(map[string]RoleInfo)
	for _, r := range roles {
		roleMap[r.Name] = r
		if strings.Contains(r.Name, "@") {
			parts := strings.SplitN(r.Name, "@", 2)
			roleMap[parts[0]] = r
		}
	}

	affectedMap := make(map[string]bool)

	for _, ch := range changes {
		// 1. Validation
		if err := validateIdentifier(ch.Role, true); err != nil {
			return nil, err
		}
		if ch.Schema != "" {
			if err := validateIdentifier(ch.Schema, false); err != nil {
				return nil, err
			}
		}
		if err := validateIdentifier(ch.Table, false); err != nil {
			return nil, err
		}
		if err := validatePrivilege(ch.Privilege); err != nil {
			return nil, err
		}
		if err := validateAction(ch.Action); err != nil {
			return nil, err
		}

		action := strings.ToUpper(strings.TrimSpace(ch.Action))
		priv := strings.ToUpper(strings.TrimSpace(ch.Privilege))
		affectedMap[ch.Role] = true

		// 2. Safety Warning Checks
		isSuper := false
		if r, ok := roleMap[ch.Role]; ok && r.IsSuperuser {
			isSuper = true
		}
		lowerRole := strings.ToLower(ch.Role)
		if lowerRole == "postgres" || lowerRole == "root" || lowerRole == "admin" || lowerRole == "sqlite_admin" {
			isSuper = true
		}

		if action == "REVOKE" && isSuper {
			plan.Dangerous = true
			plan.Warnings = append(plan.Warnings, SafetyWarning{
				Level: "critical",
				Role:  ch.Role,
				Message: fmt.Sprintf(
					"CRITICAL: Revoking %s privilege on '%s.%s' from administrative/superuser role '%s'. This may break system administration access.",
					priv, ch.Schema, ch.Table, ch.Role,
				),
			})
		}

		if action == "REVOKE" && (priv == "ALL" || priv == "ALL PRIVILEGES") {
			plan.Dangerous = true
			plan.Warnings = append(plan.Warnings, SafetyWarning{
				Level: "critical",
				Role:  ch.Role,
				Message: fmt.Sprintf(
					"DANGEROUS: Revoking ALL table privileges on '%s.%s' from role '%s'.",
					ch.Schema, ch.Table, ch.Role,
				),
			})
		}

		// 3. Dialect Statement Generation
		switch d {
		case "postgres", "postgresql":
			target := quotePGIdent(ch.Table)
			if ch.Schema != "" {
				target = quotePGIdent(ch.Schema) + "." + quotePGIdent(ch.Table)
			}
			roleIdent := quotePGIdent(ch.Role)

			if action == "GRANT" {
				stmt := fmt.Sprintf("GRANT %s ON %s TO %s", priv, target, roleIdent)
				if ch.WithGrantOption {
					stmt += " WITH GRANT OPTION"
				}
				plan.Statements = append(plan.Statements, stmt+";")
			} else {
				plan.Statements = append(plan.Statements, fmt.Sprintf("REVOKE %s ON %s FROM %s;", priv, target, roleIdent))
			}

		case "mysql", "mariadb":
			target := quoteMySQLIdent(ch.Table)
			if ch.Schema != "" {
				target = quoteMySQLIdent(ch.Schema) + "." + quoteMySQLIdent(ch.Table)
			}
			grantee := formatMySQLGrantee(ch.Role)

			if action == "GRANT" {
				stmt := fmt.Sprintf("GRANT %s ON %s TO %s", priv, target, grantee)
				if ch.WithGrantOption {
					stmt += " WITH GRANT OPTION"
				}
				plan.Statements = append(plan.Statements, stmt+";")
			} else {
				plan.Statements = append(plan.Statements, fmt.Sprintf("REVOKE %s ON %s FROM %s;", priv, target, grantee))
			}

		case "sqlite", "sqlite3":
			target := ch.Table
			if action == "GRANT" {
				plan.Statements = append(plan.Statements, fmt.Sprintf("-- [SQLite Simulated] GRANT %s ON %q TO %s;", priv, target, ch.Role))
			} else {
				plan.Statements = append(plan.Statements, fmt.Sprintf("-- [SQLite Simulated] REVOKE %s ON %q FROM %s;", priv, target, ch.Role))
			}

		default:
			// Default to standard SQL quotes
			target := fmt.Sprintf("%q.%q", ch.Schema, ch.Table)
			if ch.Schema == "" {
				target = fmt.Sprintf("%q", ch.Table)
			}
			if action == "GRANT" {
				plan.Statements = append(plan.Statements, fmt.Sprintf("GRANT %s ON %s TO %q;", priv, target, ch.Role))
			} else {
				plan.Statements = append(plan.Statements, fmt.Sprintf("REVOKE %s ON %s FROM %q;", priv, target, ch.Role))
			}
		}
	}

	if d == "sqlite" || d == "sqlite3" {
		plan.Warnings = append(plan.Warnings, SafetyWarning{
			Level:   "info",
			Role:    "sqlite_admin",
			Message: "SQLite operates on OS file permissions; GRANT/REVOKE statements are simulated no-ops.",
		})
	}

	for r := range affectedMap {
		plan.AffectedRoles = append(plan.AffectedRoles, r)
	}
	sort.Strings(plan.AffectedRoles)

	return plan, nil
}

// ApplyPlan executes the statements in a PrivilegePlan against the database driver.
func ApplyPlan(ctx context.Context, d types.Driver, plan *PrivilegePlan) error {
	if plan == nil || len(plan.Statements) == 0 {
		return nil
	}

	dialect := strings.ToLower(strings.TrimSpace(d.Dialect()))
	if dialect == "sqlite" || dialect == "sqlite3" {
		// SQLite permissions are file-level; simulated success
		return nil
	}

	for _, stmt := range plan.Statements {
		trimmed := strings.TrimSpace(stmt)
		if trimmed == "" || strings.HasPrefix(trimmed, "--") {
			continue
		}
		if _, err := d.ExecuteRaw(ctx, trimmed); err != nil {
			return fmt.Errorf("failed executing privilege statement %q: %w", trimmed, err)
		}
	}

	return nil
}

func validateIdentifier(id string, isRole bool) error {
	trimmed := strings.TrimSpace(id)
	if trimmed == "" {
		return fmt.Errorf("identifier cannot be empty")
	}
	if len(trimmed) > 128 {
		return fmt.Errorf("identifier %q exceeds maximum length of 128 characters", id)
	}
	if isRole {
		if !roleRegex.MatchString(trimmed) {
			return fmt.Errorf("invalid role identifier %q: contains illegal characters", id)
		}
	} else {
		if !identRegex.MatchString(trimmed) {
			return fmt.Errorf("invalid identifier %q: contains illegal characters", id)
		}
	}
	return nil
}

func validatePrivilege(priv string) error {
	upper := strings.ToUpper(strings.TrimSpace(priv))
	if !allowedPrivileges[upper] {
		return fmt.Errorf("unsupported privilege type %q", priv)
	}
	return nil
}

func validateAction(action string) error {
	upper := strings.ToUpper(strings.TrimSpace(action))
	if upper != "GRANT" && upper != "REVOKE" {
		return fmt.Errorf("unsupported privilege action %q: must be GRANT or REVOKE", action)
	}
	return nil
}

func quotePGIdent(ident string) string {
	return `"` + strings.ReplaceAll(ident, `"`, `""`) + `"`
}

func quoteMySQLIdent(ident string) string {
	return "`" + strings.ReplaceAll(ident, "`", "``") + "`"
}

func formatMySQLGrantee(role string) string {
	if strings.Contains(role, "@") {
		parts := strings.SplitN(role, "@", 2)
		user := strings.Trim(parts[0], "'`")
		host := strings.Trim(parts[1], "'`")
		return fmt.Sprintf("'%s'@'%s'", user, host)
	}
	cleaned := strings.Trim(role, "'`")
	return fmt.Sprintf("'%s'@'%%'", cleaned)
}

func cleanMySQLGrantee(grantee string) string {
	// MySQL format: 'user'@'host'
	g := strings.TrimSpace(grantee)
	if strings.HasPrefix(g, "'") && strings.Contains(g, "'@'") {
		parts := strings.SplitN(g, "@", 2)
		user := strings.Trim(parts[0], "'")
		host := strings.Trim(parts[1], "'")
		if host == "%" || host == "" {
			return user
		}
		return user + "@" + host
	}
	return strings.Trim(g, "'`")
}

func toString(v interface{}) string {
	if v == nil {
		return ""
	}
	switch val := v.(type) {
	case string:
		return val
	case []byte:
		return string(val)
	default:
		return fmt.Sprintf("%v", val)
	}
}

func toBool(v interface{}) bool {
	if v == nil {
		return false
	}
	switch val := v.(type) {
	case bool:
		return val
	case int, int64, int32:
		return fmt.Sprintf("%d", val) == "1"
	case string:
		s := strings.ToLower(strings.TrimSpace(val))
		return s == "true" || s == "t" || s == "1" || s == "y" || s == "yes"
	case []byte:
		s := strings.ToLower(strings.TrimSpace(string(val)))
		return s == "true" || s == "t" || s == "1" || s == "y" || s == "yes"
	default:
		return false
	}
}

func toInt(v interface{}) int {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case int:
		return val
	case int64:
		return int(val)
	case int32:
		return int(val)
	case float64:
		return int(val)
	case string:
		i, _ := strconv.Atoi(val)
		return i
	case []byte:
		i, _ := strconv.Atoi(string(val))
		return i
	default:
		return 0
	}
}

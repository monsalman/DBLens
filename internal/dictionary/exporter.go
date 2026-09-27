package dictionary

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"strings"
	"time"
)

// RenderHTML executes the offline self-contained HTML bundle template.
func RenderHTML(dict *DataDictionary) (string, error) {
	if dict == nil {
		return "", fmt.Errorf("data dictionary is nil")
	}

	tmpl, err := template.New("html_bundle").Parse(HTMLBundleTemplate)
	if err != nil {
		return "", fmt.Errorf("failed to parse HTML bundle template: %w", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, dict); err != nil {
		return "", fmt.Errorf("failed to execute HTML bundle template: %w", err)
	}

	return buf.String(), nil
}

func sanitizeMarkdownAnchor(s string) string {
	var sb strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			sb.WriteRune(r)
		} else if r == '_' || r == ' ' || r == '.' {
			sb.WriteRune('-')
		}
	}
	res := strings.Trim(sb.String(), "-")
	if res == "" {
		return "section"
	}
	return res
}

func escapeMarkdownTableCell(s string) string {
	s = strings.ReplaceAll(s, "\r", "")
	s = strings.ReplaceAll(s, "\n", " ")
	return strings.ReplaceAll(s, "|", `\|`)
}

// RenderMarkdown creates a standardized Markdown catalog report suitable for
// git repositories, wikis, and compliance runbooks.
func RenderMarkdown(dict *DataDictionary) (string, error) {
	if dict == nil {
		return "", fmt.Errorf("data dictionary is nil")
	}

	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("# Data Dictionary: %s\n\n", dict.ConnectionID))
	sb.WriteString(fmt.Sprintf("> **Generated:** %s | **Dialect:** %s\n",
		dict.GeneratedAt.UTC().Format(time.RFC3339), strings.ToUpper(dict.Dialect)))
	sb.WriteString("> **Compliance Audit Scope:** SOC 2 Type II / HIPAA Security Rule / GDPR Art. 30\n\n")

	sb.WriteString("## Executive Summary\n\n")
	sb.WriteString("| Metric | Value |\n")
	sb.WriteString("|---|---|\n")
	sb.WriteString(fmt.Sprintf("| **Total Schemas** | %d |\n", dict.Summary.TotalSchemas))
	sb.WriteString(fmt.Sprintf("| **Total Tables** | %d |\n", dict.Summary.TotalTables))
	sb.WriteString(fmt.Sprintf("| **Total Views** | %d |\n", dict.Summary.TotalViews))
	sb.WriteString(fmt.Sprintf("| **Total Columns** | %d |\n", dict.Summary.TotalColumns))
	sb.WriteString(fmt.Sprintf("| **Documented Columns** | %d |\n", dict.Summary.DocumentedColumns))
	sb.WriteString(fmt.Sprintf("| **Documentation Coverage** | %.1f%% |\n", dict.Summary.DocumentationCoverage))
	sb.WriteString(fmt.Sprintf("| **PII Classifications** | %d |\n\n", dict.Summary.TotalPIIColumns))

	sb.WriteString("## Table of Contents\n\n")
	for _, s := range dict.Schemas {
		sb.WriteString(fmt.Sprintf("### %s\n", s.Name))
		for _, t := range s.Tables {
			anchor := sanitizeMarkdownAnchor(fmt.Sprintf("%s-%s", s.Name, t.Name))
			sb.WriteString(fmt.Sprintf("- [%s](#%s) *(%d cols, %s)*\n", t.Name, anchor, len(t.Columns), t.Type))
		}
		sb.WriteString("\n")
	}

	sb.WriteString("---\n\n")

	for _, s := range dict.Schemas {
		sb.WriteString(fmt.Sprintf("## Schema: `%s`\n\n", s.Name))

		for _, t := range s.Tables {
			anchor := sanitizeMarkdownAnchor(fmt.Sprintf("%s-%s", s.Name, t.Name))
			sb.WriteString(fmt.Sprintf("<a name=\"%s\"></a>\n", anchor))
			sb.WriteString(fmt.Sprintf("### Table: `%s`\n\n", t.Name))

			if t.Comment != "" {
				sb.WriteString(fmt.Sprintf("%s\n\n", t.Comment))
			}

			sb.WriteString(fmt.Sprintf("- **Type:** `%s`\n", t.Type))
			sb.WriteString(fmt.Sprintf("- **Estimated Rows:** %d\n", t.RowCount))
			sb.WriteString(fmt.Sprintf("- **Storage Size:** %s\n", t.SizeFormatted))
			if t.PIICount > 0 {
				sb.WriteString(fmt.Sprintf("- **PII Fields:** %d detected\n", t.PIICount))
			}
			sb.WriteString("\n")

			sb.WriteString("| Column | Type | Nullable | Primary | Default | PII Classification | Description |\n")
			sb.WriteString("|---|---|---|---|---|---|---|\n")

			for _, c := range t.Columns {
				nullable := "NO"
				if c.IsNullable {
					nullable = "YES"
				}
				pk := ""
				if c.IsPrimary {
					pk = "✓ PK"
				}
				if c.IsForeignKey {
					if pk != "" {
						pk += " / FK"
					} else {
						pk = "FK"
					}
				}
				def := "-"
				if c.Default != nil && *c.Default != "" {
					def = fmt.Sprintf("`%s`", *c.Default)
				}
				pii := "-"
				if c.PIIType != "" {
					pii = fmt.Sprintf("🛡️ `%s`", c.PIIType)
				}
				desc := "-"
				if c.Comment != "" {
					desc = escapeMarkdownTableCell(c.Comment)
				}

				sb.WriteString(fmt.Sprintf("| `%s` | `%s` | %s | %s | %s | %s | %s |\n",
					c.Name, c.Type, nullable, pk, def, pii, desc))
			}
			sb.WriteString("\n")

			if len(t.Indexes) > 0 {
				sb.WriteString("#### Indexes\n\n")
				sb.WriteString("| Index Name | Columns | Unique | Type |\n")
				sb.WriteString("|---|---|---|---|\n")
				for _, idx := range t.Indexes {
					u := "NO"
					if idx.IsUnique {
						u = "YES"
					}
					cols := strings.Join(idx.Columns, ", ")
					sb.WriteString(fmt.Sprintf("| `%s` | `%s` | %s | %s |\n", idx.Name, cols, u, idx.Type))
				}
				sb.WriteString("\n")
			}

			if len(t.ForeignKeys) > 0 {
				sb.WriteString("#### Foreign Keys\n\n")
				sb.WriteString("| Column | Target | On Update | On Delete |\n")
				sb.WriteString("|---|---|---|---|\n")
				for _, fk := range t.ForeignKeys {
					target := fmt.Sprintf("`%s(%s)`", fk.RefTable, fk.RefColumn)
					sb.WriteString(fmt.Sprintf("| `%s` | %s | %s | %s |\n", fk.Column, target, fk.OnUpdate, fk.OnDelete))
				}
				sb.WriteString("\n")
			}

			sb.WriteString("---\n\n")
		}
	}

	return sb.String(), nil
}

// RenderOpenAPI converts the database data dictionary into an OpenAPI 3.0.3 components schema specification.
func RenderOpenAPI(dict *DataDictionary) (string, error) {
	if dict == nil {
		return "", fmt.Errorf("data dictionary is nil")
	}

	componentsSchemas := make(map[string]interface{})

	for _, s := range dict.Schemas {
		for _, t := range s.Tables {
			schemaKey := t.Name
			if s.Name != "" && !strings.EqualFold(s.Name, "public") && !strings.EqualFold(s.Name, "main") && !strings.EqualFold(s.Name, "default") {
				schemaKey = s.Name + "_" + t.Name
			}

			props := make(map[string]interface{})
			required := make([]string, 0)

			for _, c := range t.Columns {
				colProp := map[string]interface{}{}

				oaType, oaFormat := mapSQLTypeToOpenAPI(c.Type, c.DataType, c.PIIType)
				colProp["type"] = oaType
				if oaFormat != "" {
					colProp["format"] = oaFormat
				}
				if c.IsNullable {
					colProp["nullable"] = true
				}

				descParts := make([]string, 0, 2)
				if c.PIIType != "" {
					descParts = append(descParts, fmt.Sprintf("[PII: %s]", c.PIIType))
				}
				if c.Comment != "" {
					descParts = append(descParts, c.Comment)
				}
				if len(descParts) > 0 {
					colProp["description"] = strings.Join(descParts, " ")
				}

				if c.Default != nil && *c.Default != "" {
					colProp["default"] = *c.Default
				}

				props[c.Name] = colProp

				if !c.IsNullable && (c.Default == nil || *c.Default == "") {
					required = append(required, c.Name)
				}
			}

			tableSchema := map[string]interface{}{
				"type":       "object",
				"properties": props,
			}
			if t.Comment != "" {
				tableSchema["description"] = t.Comment
			}
			if len(required) > 0 {
				tableSchema["required"] = required
			}

			componentsSchemas[schemaKey] = tableSchema
		}
	}

	doc := map[string]interface{}{
		"openapi": "3.0.3",
		"info": map[string]interface{}{
			"title":       "Data Dictionary - " + dict.ConnectionID,
			"version":     "1.0.0",
			"description": "Auto-generated OpenAPI 3.0 schema definitions from DBLens living data dictionary",
		},
		"paths": map[string]interface{}{},
		"components": map[string]interface{}{
			"schemas": componentsSchemas,
		},
	}

	raw, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to marshal OpenAPI document: %w", err)
	}

	return string(raw), nil
}

func mapSQLTypeToOpenAPI(sqlType, dataType, piiType string) (string, string) {
	t := strings.ToLower(sqlType + " " + dataType)

	if piiType == "email" {
		return "string", "email"
	}

	switch {
	case strings.Contains(t, "bool"):
		return "boolean", ""
	case strings.Contains(t, "int8"), strings.Contains(t, "bigint"):
		return "integer", "int64"
	case strings.Contains(t, "int"), strings.Contains(t, "serial"):
		return "integer", "int32"
	case strings.Contains(t, "float"), strings.Contains(t, "double"), strings.Contains(t, "real"):
		return "number", "double"
	case strings.Contains(t, "numeric"), strings.Contains(t, "decimal"):
		return "number", "float"
	case strings.Contains(t, "timestamptz"), strings.Contains(t, "datetime"), strings.Contains(t, "timestamp"):
		return "string", "date-time"
	case strings.Contains(t, "date"):
		return "string", "date"
	case strings.Contains(t, "uuid"):
		return "string", "uuid"
	case strings.Contains(t, "json"):
		return "object", ""
	case strings.Contains(t, "bytea"), strings.Contains(t, "blob"):
		return "string", "byte"
	default:
		return "string", ""
	}
}

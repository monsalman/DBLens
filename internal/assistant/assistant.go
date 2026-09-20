package assistant

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
)

// LLMConfig specifies the provider endpoint, auth, and model settings.
type LLMConfig struct {
	Provider    string  `json:"provider"`    // "openai" | "anthropic"
	Endpoint    string  `json:"endpoint"`    // base URL or full endpoint
	APIKey      string  `json:"apiKey"`      // BYOK API key
	Model       string  `json:"model"`       // model name
	Temperature float64 `json:"temperature"` // default 0.1
}

// CompactColumn captures essential column metadata for prompt context.
type CompactColumn struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	PK       bool   `json:"pk,omitempty"`
	Nullable bool   `json:"nullable,omitempty"`
}

// CompactFK captures foreign key relationships.
type CompactFK struct {
	Column    string `json:"column"`
	RefTable  string `json:"refTable"`
	RefColumn string `json:"refColumn"`
}

// CompactTable represents table schema without any row data.
type CompactTable struct {
	Name    string          `json:"name"`
	Schema  string          `json:"schema,omitempty"`
	Columns []CompactColumn `json:"columns"`
	FKs     []CompactFK     `json:"fks,omitempty"`
}

// SchemaContext contains compact tables and token-efficient DDL text.
// STRICT SECURITY GUARANTEE: Contains schema metadata only. Cell values and row data are strictly excluded.
type SchemaContext struct {
	Tables []CompactTable `json:"tables"`
	DDL    string         `json:"ddl"`
}

// GenerateRequest for generating SQL from natural language.
type GenerateRequest struct {
	Prompt string    `json:"prompt"`
	Schema string    `json:"schema,omitempty"`
	Config LLMConfig `json:"config,omitempty"`
}

// FixRequest for debugging and correcting failing SQL queries.
type FixRequest struct {
	Query  string    `json:"query"`
	Error  string    `json:"error"`
	Schema string    `json:"schema,omitempty"`
	Config LLMConfig `json:"config,omitempty"`
}

// ExplainRequest for natural language explanation of SQL query.
type ExplainRequest struct {
	Query  string    `json:"query"`
	Schema string    `json:"schema,omitempty"`
	Config LLMConfig `json:"config,omitempty"`
}

// AssistantResponse contains returned SQL or explanation.
type AssistantResponse struct {
	Result string `json:"result"`
	Raw    string `json:"raw,omitempty"`
}

// ExtractCompactSchema serializes active database schema (tables, columns, types, FKs)
// into a compact token-efficient DDL context. Never queries or touches table rows.
func ExtractCompactSchema(ctx context.Context, d types.Driver, schemaFilter string) (*SchemaContext, error) {
	if d == nil {
		return nil, fmt.Errorf("driver is required")
	}

	tableMetas, err := d.InspectTables(ctx, schemaFilter)
	if err != nil {
		return nil, fmt.Errorf("failed to inspect tables: %w", err)
	}

	var compactTables []CompactTable
	var ddlParts []string

	for _, tm := range tableMetas {
		schema := tm.Schema
		if schemaFilter != "" && schema != "" && schema != schemaFilter {
			continue
		}

		details, err := d.InspectTableDetails(ctx, schema, tm.Name)
		if err != nil {
			// If details inspection fails for a specific table/view, record stub
			compactTables = append(compactTables, CompactTable{
				Name:   tm.Name,
				Schema: schema,
			})
			ddlParts = append(ddlParts, fmt.Sprintf("CREATE TABLE %s ();", tm.Name))
			continue
		}

		var cols []CompactColumn
		var colDefs []string
		fkMap := make(map[string]CompactFK)
		var fks []CompactFK

		for _, fk := range details.FKs {
			cfk := CompactFK{
				Column:    fk.Column,
				RefTable:  fk.RefTable,
				RefColumn: fk.RefColumn,
			}
			fks = append(fks, cfk)
			fkMap[fk.Column] = cfk
		}

		for _, c := range details.Columns {
			colType := c.Type
			if colType == "" {
				colType = c.DataType
			}
			if colType == "" {
				colType = "TEXT"
			}

			cols = append(cols, CompactColumn{
				Name:     c.Name,
				Type:     colType,
				PK:       c.IsPrimary,
				Nullable: c.IsNullable,
			})

			def := fmt.Sprintf("%s %s", c.Name, colType)
			if c.IsPrimary {
				def += " PRIMARY KEY"
			} else if !c.IsNullable {
				def += " NOT NULL"
			}
			if fk, ok := fkMap[c.Name]; ok && fk.RefTable != "" {
				if fk.RefColumn != "" {
					def += fmt.Sprintf(" REFERENCES %s(%s)", fk.RefTable, fk.RefColumn)
				} else {
					def += fmt.Sprintf(" REFERENCES %s", fk.RefTable)
				}
			}
			colDefs = append(colDefs, def)
		}

		compactTables = append(compactTables, CompactTable{
			Name:    tm.Name,
			Schema:  schema,
			Columns: cols,
			FKs:     fks,
		})

		tableName := tm.Name
		if schema != "" && schema != "public" && schema != "main" {
			tableName = fmt.Sprintf("%s.%s", schema, tm.Name)
		}
		ddlParts = append(ddlParts, fmt.Sprintf("CREATE TABLE %s (\n  %s\n);", tableName, strings.Join(colDefs, ",\n  ")))
	}

	return &SchemaContext{
		Tables: compactTables,
		DDL:    strings.Join(ddlParts, "\n\n"),
	}, nil
}

// StripCodeFences extracts raw SQL from LLM response fences if present.
func StripCodeFences(raw string) string {
	s := strings.TrimSpace(raw)
	fenceStart := strings.Index(s, "```")
	if fenceStart == -1 {
		return s
	}

	afterFence := s[fenceStart+3:]
	newlineIdx := strings.Index(afterFence, "\n")
	var codeStart int
	if newlineIdx != -1 {
		codeStart = fenceStart + 3 + newlineIdx + 1
	} else {
		codeStart = fenceStart + 3
	}

	fenceEnd := strings.Index(s[codeStart:], "```")
	if fenceEnd != -1 {
		return strings.TrimSpace(s[codeStart : codeStart+fenceEnd])
	}
	return strings.TrimSpace(s[codeStart:])
}

// SystemPrompt returns the role instructions for the requested operation and dialect.
func SystemPrompt(op string, dialect string) string {
	if dialect == "" {
		dialect = "SQL"
	}
	switch strings.ToLower(op) {
	case "generate":
		return fmt.Sprintf("You are an expert database assistant. Generate valid, efficient %s SQL for the user request. Strictly adhere to the provided schema. Return ONLY executable SQL. Do NOT include explanations, comments, or markdown code fences.", dialect)
	case "fix":
		return fmt.Sprintf("You are an expert %s SQL debugger. Correct the failing SQL query to resolve the given error using the provided schema. Return ONLY the fixed executable SQL. Do NOT include markdown code fences or conversational text.", dialect)
	case "explain":
		return fmt.Sprintf("You are an expert %s SQL explainer. Explain what the provided SQL query does clearly and concisely using bullet points. Describe the tables, joins, filters, and output.", dialect)
	default:
		return fmt.Sprintf("You are a helpful %s database assistant.", dialect)
	}
}

// BuildPrompt creates the prompt payload with dialect and compact schema context.
func BuildPrompt(op string, dialect string, schemaCtx *SchemaContext, input string, errMsg string) string {
	if dialect == "" {
		dialect = "SQL"
	}
	schemaDDL := "(No schema tables found in active database)"
	if schemaCtx != nil && strings.TrimSpace(schemaCtx.DDL) != "" {
		schemaDDL = strings.TrimSpace(schemaCtx.DDL)
	}

	var b strings.Builder
	b.WriteString(fmt.Sprintf("### Target Database Dialect:\n%s\n\n", dialect))
	b.WriteString(fmt.Sprintf("### Database Schema:\n%s\n\n", schemaDDL))

	switch strings.ToLower(op) {
	case "generate":
		b.WriteString(fmt.Sprintf("### Request:\nGenerate a %s SQL query for:\n%s\n\n", dialect, strings.TrimSpace(input)))
		b.WriteString("### Instructions:\n- Return ONLY the executable SQL query.\n- Do NOT wrap in markdown code fences.\n- Use only columns and tables in the schema above.")
	case "fix":
		b.WriteString(fmt.Sprintf("### Failing SQL Query:\n%s\n\n", strings.TrimSpace(input)))
		b.WriteString(fmt.Sprintf("### Error Message:\n%s\n\n", strings.TrimSpace(errMsg)))
		b.WriteString(fmt.Sprintf("### Instructions:\n- Fix the SQL query to resolve the error for %s.\n- Return ONLY the corrected executable SQL.\n- Do NOT include markdown code fences or commentary.", dialect))
	case "explain":
		b.WriteString(fmt.Sprintf("### SQL Query:\n%s\n\n", strings.TrimSpace(input)))
		b.WriteString(fmt.Sprintf("### Instructions:\n- Explain what this %s SQL query does in concise bullet points.\n- Break down: Tables accessed, Joins, Filters, Aggregations, Output result.", dialect))
	default:
		b.WriteString(fmt.Sprintf("### Request:\n%s\n", strings.TrimSpace(input)))
	}

	return b.String()
}

// CallLLM connects to OpenAI-compatible endpoints or Anthropic API.
func CallLLM(ctx context.Context, cfg LLMConfig, systemPrompt string, userPrompt string) (string, error) {
	provider := strings.ToLower(strings.TrimSpace(cfg.Provider))
	if provider == "" {
		if strings.Contains(strings.ToLower(cfg.Endpoint), "anthropic") || strings.Contains(strings.ToLower(cfg.Model), "claude") {
			provider = "anthropic"
		} else {
			provider = "openai"
		}
	}

	client := &http.Client{
		Timeout: 90 * time.Second,
	}

	if provider == "anthropic" {
		endpoint := strings.TrimSpace(cfg.Endpoint)
		if endpoint == "" {
			endpoint = "https://api.anthropic.com/v1/messages"
		} else {
			endpoint = strings.TrimRight(endpoint, "/")
			if !strings.HasSuffix(endpoint, "/messages") {
				if strings.HasSuffix(endpoint, "/v1") {
					endpoint += "/messages"
				} else {
					endpoint += "/v1/messages"
				}
			}
		}

		model := strings.TrimSpace(cfg.Model)
		if model == "" {
			model = "claude-3-5-sonnet-20241022"
		}

		type anthropicMsg struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		}
		type anthropicReq struct {
			Model       string         `json:"model"`
			System      string         `json:"system,omitempty"`
			Messages    []anthropicMsg `json:"messages"`
			MaxTokens   int            `json:"max_tokens"`
			Temperature float64        `json:"temperature"`
		}

		reqBody := anthropicReq{
			Model:       model,
			System:      systemPrompt,
			Messages:    []anthropicMsg{{Role: "user", Content: userPrompt}},
			MaxTokens:   4096,
			Temperature: cfg.Temperature,
		}

		b, err := json.Marshal(reqBody)
		if err != nil {
			return "", fmt.Errorf("failed to encode anthropic request: %w", err)
		}

		req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(b))
		if err != nil {
			return "", fmt.Errorf("failed to create anthropic request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("anthropic-version", "2023-06-01")
		if cfg.APIKey != "" {
			req.Header.Set("x-api-key", cfg.APIKey)
		}

		resp, err := client.Do(req)
		if err != nil {
			return "", fmt.Errorf("anthropic request failed: %w", err)
		}
		defer resp.Body.Close()

		respBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			return "", fmt.Errorf("failed to read anthropic response: %w", err)
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return "", fmt.Errorf("anthropic error (HTTP %d): %s", resp.StatusCode, string(respBytes))
		}

		type anthropicContent struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		type anthropicResp struct {
			Content []anthropicContent `json:"content"`
			Error   *struct {
				Message string `json:"message"`
			} `json:"error,omitempty"`
		}

		var parsed anthropicResp
		if err := json.Unmarshal(respBytes, &parsed); err != nil {
			return "", fmt.Errorf("failed to parse anthropic response: %w", err)
		}
		if parsed.Error != nil && parsed.Error.Message != "" {
			return "", fmt.Errorf("anthropic api error: %s", parsed.Error.Message)
		}
		if len(parsed.Content) == 0 {
			return "", fmt.Errorf("anthropic returned empty content")
		}

		var textParts []string
		for _, c := range parsed.Content {
			if c.Type == "text" || c.Text != "" {
				textParts = append(textParts, c.Text)
			}
		}
		return strings.TrimSpace(strings.Join(textParts, "\n")), nil
	}

	// OpenAI-compatible endpoint (OpenAI, Ollama, Groq, OpenRouter, LocalAI)
	endpoint := strings.TrimSpace(cfg.Endpoint)
	if endpoint == "" {
		endpoint = "https://api.openai.com/v1/chat/completions"
	} else {
		endpoint = strings.TrimRight(endpoint, "/")
		if !strings.HasSuffix(endpoint, "/chat/completions") {
			if strings.HasSuffix(endpoint, "/v1") {
				endpoint += "/chat/completions"
			} else {
				endpoint += "/v1/chat/completions"
			}
		}
	}

	model := strings.TrimSpace(cfg.Model)
	if model == "" {
		model = "gpt-4o-mini"
	}

	type openAIMsg struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	type openAIReq struct {
		Model       string      `json:"model"`
		Messages    []openAIMsg `json:"messages"`
		Temperature float64     `json:"temperature"`
	}

	msgs := []openAIMsg{}
	if strings.TrimSpace(systemPrompt) != "" {
		msgs = append(msgs, openAIMsg{Role: "system", Content: systemPrompt})
	}
	msgs = append(msgs, openAIMsg{Role: "user", Content: userPrompt})

	reqBody := openAIReq{
		Model:       model,
		Messages:    msgs,
		Temperature: cfg.Temperature,
	}

	b, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to encode openai request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(b))
	if err != nil {
		return "", fmt.Errorf("failed to create openai request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("llm request failed: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read llm response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("llm error (HTTP %d): %s", resp.StatusCode, string(respBytes))
	}

	type openAIChoice struct {
		Index   int       `json:"index"`
		Message openAIMsg `json:"message"`
	}
	type openAIResp struct {
		Choices []openAIChoice `json:"choices"`
		Error   *struct {
			Message string `json:"message"`
		} `json:"error,omitempty"`
	}

	var parsed openAIResp
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return "", fmt.Errorf("failed to parse llm response: %w", err)
	}
	if parsed.Error != nil && parsed.Error.Message != "" {
		return "", fmt.Errorf("llm api error: %s", parsed.Error.Message)
	}
	if len(parsed.Choices) == 0 {
		return "", fmt.Errorf("llm returned no choices")
	}

	return strings.TrimSpace(parsed.Choices[0].Message.Content), nil
}

// GenerateSQL generates a SQL query from natural language with schema context.
func GenerateSQL(ctx context.Context, d types.Driver, cfg LLMConfig, schemaFilter string, prompt string) (*AssistantResponse, error) {
	schemaCtx, err := ExtractCompactSchema(ctx, d, schemaFilter)
	if err != nil {
		return nil, err
	}
	dialect := ""
	if d != nil {
		dialect = d.Dialect()
	}
	sys := SystemPrompt("generate", dialect)
	user := BuildPrompt("generate", dialect, schemaCtx, prompt, "")

	raw, err := CallLLM(ctx, cfg, sys, user)
	if err != nil {
		return nil, err
	}
	return &AssistantResponse{
		Result: StripCodeFences(raw),
		Raw:    raw,
	}, nil
}

// FixSQL analyzes a failing SQL query and database runtime error, producing a corrected SQL query.
func FixSQL(ctx context.Context, d types.Driver, cfg LLMConfig, schemaFilter string, query string, errMsg string) (*AssistantResponse, error) {
	schemaCtx, err := ExtractCompactSchema(ctx, d, schemaFilter)
	if err != nil {
		return nil, err
	}
	dialect := ""
	if d != nil {
		dialect = d.Dialect()
	}
	sys := SystemPrompt("fix", dialect)
	user := BuildPrompt("fix", dialect, schemaCtx, query, errMsg)

	raw, err := CallLLM(ctx, cfg, sys, user)
	if err != nil {
		return nil, err
	}
	return &AssistantResponse{
		Result: StripCodeFences(raw),
		Raw:    raw,
	}, nil
}

// ExplainSQL produces concise bullet-point breakdown of the given SQL query.
func ExplainSQL(ctx context.Context, d types.Driver, cfg LLMConfig, schemaFilter string, query string) (*AssistantResponse, error) {
	schemaCtx, err := ExtractCompactSchema(ctx, d, schemaFilter)
	if err != nil {
		return nil, err
	}
	dialect := ""
	if d != nil {
		dialect = d.Dialect()
	}
	sys := SystemPrompt("explain", dialect)
	user := BuildPrompt("explain", dialect, schemaCtx, query, "")

	raw, err := CallLLM(ctx, cfg, sys, user)
	if err != nil {
		return nil, err
	}
	return &AssistantResponse{
		Result: strings.TrimSpace(raw),
		Raw:    raw,
	}, nil
}

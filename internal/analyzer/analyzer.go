package analyzer

import (
	"context"
	"fmt"
	"sort"
)

type AnalyzeRequest struct {
	SQL         string                 `json:"sql"`
	Dialect     string                 `json:"dialect,omitempty"`
	Schema      string                 `json:"schema,omitempty"`
	KnownTables []string               `json:"known_tables,omitempty"`
	KnownCols   map[string][]string    `json:"known_cols,omitempty"`
	RuleConfig  map[string]RuleSetting `json:"rule_config,omitempty"`
}

type AnalysisSummary struct {
	Errors   int `json:"errors"`
	Warnings int `json:"warnings"`
	Info     int `json:"info"`
	Total    int `json:"total"`
}

type AnalyzeResult struct {
	Diagnostics []Diagnostic    `json:"diagnostics"`
	Summary     AnalysisSummary `json:"summary"`
}

type GateRequest struct {
	SQL            string                 `json:"sql"`
	Dialect        string                 `json:"dialect,omitempty"`
	Schema         string                 `json:"schema,omitempty"`
	KnownTables    []string               `json:"known_tables,omitempty"`
	KnownCols      map[string][]string    `json:"known_cols,omitempty"`
	RuleConfig     map[string]RuleSetting `json:"rule_config,omitempty"`
	FailOnSeverity Severity               `json:"fail_on_severity,omitempty"`
	MaxAllowed     int                    `json:"max_allowed,omitempty"`
}

type GateResult struct {
	Passed      bool            `json:"passed"`
	Reason      string          `json:"reason"`
	Summary     AnalysisSummary `json:"summary"`
	Diagnostics []Diagnostic    `json:"diagnostics"`
}

func AnalyzeSQL(
	ctx context.Context,
	sql string,
	dialect string,
	schema string,
	knownTables []string,
	knownCols map[string][]string,
	ruleConfig map[string]RuleSetting,
) *AnalyzeResult {
	tokens := Tokenize(sql)
	codeTokens := TokensWithoutComments(tokens)

	ruleCtx := &RuleContext{
		SQL:         sql,
		Dialect:     dialect,
		Schema:      schema,
		Tokens:      tokens,
		CodeTokens:  codeTokens,
		KnownTables: knownTables,
		KnownCols:   knownCols,
	}

	var allDiags []Diagnostic

	for _, rule := range AllRules {
		meta := rule.Meta()
		enabled := meta.Enabled
		sev := meta.Severity

		if cfg, ok := ruleConfig[meta.ID]; ok {
			enabled = cfg.Enabled
			if cfg.Severity.IsValid() {
				sev = cfg.Severity
			}
		}

		if !enabled {
			continue
		}

		diags := rule.Check(ruleCtx)
		for _, d := range diags {
			d.Severity = sev
			allDiags = append(allDiags, d)
		}
	}

	// Sort diagnostics chronologically by position in the source
	sort.Slice(allDiags, func(i, j int) bool {
		if allDiags[i].Line != allDiags[j].Line {
			return allDiags[i].Line < allDiags[j].Line
		}
		if allDiags[i].Col != allDiags[j].Col {
			return allDiags[i].Col < allDiags[j].Col
		}
		return allDiags[i].StartOffset < allDiags[j].StartOffset
	})

	var summary AnalysisSummary
	for _, d := range allDiags {
		switch d.Severity {
		case SeverityError:
			summary.Errors++
		case SeverityWarning:
			summary.Warnings++
		case SeverityInfo:
			summary.Info++
		}
		summary.Total++
	}

	return &AnalyzeResult{
		Diagnostics: allDiags,
		Summary:     summary,
	}
}

func EvaluateGate(req GateRequest) *GateResult {
	failSev := req.FailOnSeverity
	if !failSev.IsValid() {
		failSev = SeverityError
	}

	res := AnalyzeSQL(
		context.Background(),
		req.SQL,
		req.Dialect,
		req.Schema,
		req.KnownTables,
		req.KnownCols,
		req.RuleConfig,
	)

	violations := 0
	switch failSev {
	case SeverityError:
		violations = res.Summary.Errors
	case SeverityWarning:
		violations = res.Summary.Errors + res.Summary.Warnings
	case SeverityInfo:
		violations = res.Summary.Total
	}

	passed := violations <= req.MaxAllowed
	var reason string
	if passed {
		reason = fmt.Sprintf("Quality gate passed: %d %s violation(s) found (max allowed: %d)", violations, failSev, req.MaxAllowed)
	} else {
		reason = fmt.Sprintf("Quality gate failed: %d %s violation(s) found exceeding threshold of %d", violations, failSev, req.MaxAllowed)
	}

	return &GateResult{
		Passed:      passed,
		Reason:      reason,
		Summary:     res.Summary,
		Diagnostics: res.Diagnostics,
	}
}

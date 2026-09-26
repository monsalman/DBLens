package querybuilder

import (
	"errors"
	"fmt"
	"strings"
)

// Validate checks the consistency of a QueryCanvasState.
func Validate(state *QueryCanvasState) (warnings []string, err error) {
	if state == nil || len(state.Tables) == 0 {
		return nil, errors.New("visual query must contain at least one table")
	}

	tableMap := make(map[string]CanvasTable)
	colMap := make(map[string]map[string]bool)

	for _, t := range state.Tables {
		if strings.TrimSpace(t.ID) == "" {
			return nil, errors.New("table node missing id")
		}
		if _, exists := tableMap[t.ID]; exists {
			return nil, fmt.Errorf("duplicate table id '%s'", t.ID)
		}
		tableMap[t.ID] = t

		colSet := make(map[string]bool)
		for _, c := range t.Columns {
			colSet[c.Name] = true
		}
		colMap[t.ID] = colSet
	}

	// Validate Joins
	for i, j := range state.Joins {
		srcT, okSrc := tableMap[j.SourceTableID]
		if !okSrc {
			return nil, fmt.Errorf("join #%d references non-existent source table '%s'", i+1, j.SourceTableID)
		}
		tgtT, okTgt := tableMap[j.TargetTableID]
		if !okTgt {
			return nil, fmt.Errorf("join #%d references non-existent target table '%s'", i+1, j.TargetTableID)
		}
		if len(srcT.Columns) > 0 && !colMap[j.SourceTableID][j.SourceColumn] {
			warnings = append(warnings, fmt.Sprintf("Join #%d: source column '%s' not found in table '%s'", i+1, j.SourceColumn, srcT.Name))
		}
		if len(tgtT.Columns) > 0 && !colMap[j.TargetTableID][j.TargetColumn] {
			warnings = append(warnings, fmt.Sprintf("Join #%d: target column '%s' not found in table '%s'", i+1, j.TargetColumn, tgtT.Name))
		}
	}

	// Check for disconnected tables
	if len(state.Tables) > 1 && len(state.Joins) == 0 {
		warnings = append(warnings, "Multiple tables are present without any joins, which will produce a Cartesian product (CROSS JOIN)")
	}

	// Validate Filters
	for _, f := range state.Filters {
		t, ok := tableMap[f.TableID]
		if !ok {
			return nil, fmt.Errorf("filter references non-existent table id '%s'", f.TableID)
		}
		if len(t.Columns) > 0 && !colMap[f.TableID][f.Column] {
			warnings = append(warnings, fmt.Sprintf("Filter column '%s' not found in table '%s'", f.Column, t.Name))
		}
	}

	// Validate Havings
	for _, h := range state.Havings {
		t, ok := tableMap[h.TableID]
		if !ok {
			return nil, fmt.Errorf("having clause references non-existent table id '%s'", h.TableID)
		}
		if len(t.Columns) > 0 && !colMap[h.TableID][h.Column] {
			warnings = append(warnings, fmt.Sprintf("Having column '%s' not found in table '%s'", h.Column, t.Name))
		}
	}

	// Validate OrderBy
	for _, ob := range state.OrderBy {
		t, ok := tableMap[ob.TableID]
		if !ok {
			return nil, fmt.Errorf("order by references non-existent table id '%s'", ob.TableID)
		}
		if len(t.Columns) > 0 && !colMap[ob.TableID][ob.Column] {
			warnings = append(warnings, fmt.Sprintf("Order by column '%s' not found in table '%s'", ob.Column, t.Name))
		}
	}

	return warnings, nil
}

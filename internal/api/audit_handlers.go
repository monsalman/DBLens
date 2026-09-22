package api

import (
	"bufio"
	"encoding/csv"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/audit"
)

// ListAuditLog streams NDJSON log, applies filters, returns JSON array.
func (h *Handler) ListAuditLog(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	connID := q.Get("conn_id")
	queryType := q.Get("query_type")
	actorIP := q.Get("actor_ip")
	fromStr := q.Get("from")
	toStr := q.Get("to")
	limitStr := q.Get("limit")

	limit := 200
	if limitStr != "" {
		if v, err := strconv.Atoi(limitStr); err == nil && v > 0 {
			if v > 1000 {
				v = 1000
			}
			limit = v
		}
	}

	var fromT, toT time.Time
	if fromStr != "" {
		fromT, _ = time.Parse(time.RFC3339, fromStr)
	}
	if toStr != "" {
		toT, _ = time.Parse(time.RFC3339, toStr)
	}

	entries, err := readAuditEntries(h.auditLogPath, connID, queryType, actorIP, fromT, toT, limit)
	if err != nil && !os.IsNotExist(err) {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if entries == nil {
		entries = []audit.AuditEntry{}
	}
	sendJSON(w, http.StatusOK, entries)
}

// VerifyAuditChain calls audit.VerifyChain and returns result.
func (h *Handler) VerifyAuditChain(w http.ResponseWriter, r *http.Request) {
	ok, tampered, err := audit.VerifyChain(h.auditLogPath)
	if err != nil && !os.IsNotExist(err) {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tampered == nil {
		tampered = []int{}
	}
	sendJSON(w, http.StatusOK, map[string]interface{}{
		"ok":             ok,
		"tampered_lines": tampered,
	})
}

// ExportAuditCSV streams audit log as CSV with same filters as ListAuditLog.
func (h *Handler) ExportAuditCSV(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	connID := q.Get("conn_id")
	queryType := q.Get("query_type")
	actorIP := q.Get("actor_ip")
	fromStr := q.Get("from")
	toStr := q.Get("to")

	var fromT, toT time.Time
	if fromStr != "" {
		fromT, _ = time.Parse(time.RFC3339, fromStr)
	}
	if toStr != "" {
		toT, _ = time.Parse(time.RFC3339, toStr)
	}

	entries, err := readAuditEntries(h.auditLogPath, connID, queryType, actorIP, fromT, toT, 1000)
	if err != nil && !os.IsNotExist(err) {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="audit.csv"`)
	w.WriteHeader(http.StatusOK)

	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"id", "timestamp", "actor_ip", "user_agent", "conn_id", "db_name", "schema", "query_type", "query_text", "rows_affected", "duration_ms", "error", "hash"})
	for _, e := range entries {
		_ = cw.Write([]string{
			e.ID,
			e.Timestamp.Format(time.RFC3339),
			e.ActorIP,
			e.UserAgent,
			e.ConnID,
			e.DBName,
			e.Schema,
			e.QueryType,
			e.QueryText,
			strconv.FormatInt(e.RowsAffected, 10),
			strconv.FormatInt(e.DurationMs, 10),
			e.Error,
			e.Hash,
		})
	}
	cw.Flush()
}

// readAuditEntries reads NDJSON log and applies filters.
func readAuditEntries(path, connID, queryType, actorIP string, from, to time.Time, limit int) ([]audit.AuditEntry, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var results []audit.AuditEntry
	scanner := bufio.NewScanner(f)
	for scanner.Scan() && len(results) < limit {
		var e audit.AuditEntry
		if json.Unmarshal(scanner.Bytes(), &e) != nil {
			continue
		}
		if connID != "" && e.ConnID != connID {
			continue
		}
		if queryType != "" && !strings.EqualFold(e.QueryType, queryType) {
			continue
		}
		if actorIP != "" && !strings.Contains(e.ActorIP, actorIP) {
			continue
		}
		if !from.IsZero() && e.Timestamp.Before(from) {
			continue
		}
		if !to.IsZero() && e.Timestamp.After(to) {
			continue
		}
		results = append(results, e)
	}
	return results, scanner.Err()
}

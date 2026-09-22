package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/tunnel"
	"github.com/go-chi/chi/v5"
)

// connTarget is the resolved connection for a request: either a stateless DSN
// supplied by the client (X-DBLENS-DSN header or ?dsn= query param) or a
// server-seeded global_* id from the DBLENS_CONNECTIONS environment variable.
//
// UI-created connections use browser-local "local_<timestamp>" ids which the
// server cannot resolve, so background-capable features (cron jobs, live feed)
// must carry the real DSN.
type connTarget struct {
	DSN        string
	ConnID     string
	TunnelCfg  string
	FromHeader bool
}

// resolveConnTarget extracts a DSN from the X-DBLENS-DSN header (the project's
// existing convention), then from the ?dsn= query parameter — the query
// parameter exists because the native browser EventSource API cannot set custom
// request headers. The connId path/query parameter is always carried through as
// the attribution id.
func (h *Handler) resolveConnTarget(r *http.Request) connTarget {
	t := connTarget{
		ConnID:    chi.URLParam(r, "connId"),
		TunnelCfg: strings.TrimSpace(r.Header.Get("X-DBLENS-SSH-TUNNEL")),
	}
	if t.ConnID == "" {
		t.ConnID = r.URL.Query().Get("connId")
	}
	if dsn := strings.TrimSpace(r.Header.Get("X-DBLENS-DSN")); dsn != "" {
		t.DSN = dsn
		t.FromHeader = true
		return t
	}
	// EventSource sends no custom headers, so the live-feed drawer passes the
	// DSN here instead.
	if raw := strings.TrimSpace(r.URL.Query().Get("dsn")); raw != "" {
		if decoded, err := url.QueryUnescape(raw); err == nil {
			raw = decoded
		}
		t.DSN = raw
	}
	return t
}

// pool resolves the target to a live pool entry. Order: explicit DSN first
// (stateless per-request routing), then server-seeded global_* id. The returned
// error names what was missing rather than silently resolving to something else.
func (h *Handler) pool(t connTarget) (*connection.PoolEntry, error) {
	if t.DSN != "" {
		var tunnelCfg *tunnel.SSHTunnelConfig
		if t.TunnelCfg != "" {
			var tc tunnel.SSHTunnelConfig
			if err := json.Unmarshal([]byte(t.TunnelCfg), &tc); err == nil && tc.Enabled {
				tunnelCfg = &tc
			}
		}
		return h.mgr.GetByDSNWithTunnel(t.DSN, tunnelCfg)
	}
	if t.ConnID != "" {
		if globalDSN, ok := h.mgr.GetGlobalDSNByID(t.ConnID); ok {
			return h.mgr.GetByDSN(globalDSN)
		}
		return nil, fmt.Errorf("connection not found: %s (supply the DSN via the X-DBLENS-DSN header or the dsn query parameter)", t.ConnID)
	}
	return nil, fmt.Errorf("no connection specified: supply the DSN via the X-DBLENS-DSN header or the dsn query parameter")
}

// encodeJSON marshals v for an SSE frame; returns "" on error.
func encodeJSON(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

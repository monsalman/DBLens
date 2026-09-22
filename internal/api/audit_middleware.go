package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/audit"
	"github.com/go-chi/chi/v5"
)

// auditResponseWriter captures status code and body size.
type auditResponseWriter struct {
	http.ResponseWriter
	status int
	size   int
}

func (a *auditResponseWriter) WriteHeader(code int) {
	a.status = code
	a.ResponseWriter.WriteHeader(code)
}

func (a *auditResponseWriter) Write(b []byte) (int, error) {
	if a.status == 0 {
		a.status = http.StatusOK
	}
	n, err := a.ResponseWriter.Write(b)
	a.size += n
	return n, err
}

// auditPaths — only log requests whose path contains one of these substrings.
var auditPaths = []string{"/query", "/mutate", "/export", "/execute", "/run", "/invoke"}

// AuditMiddleware logs matched requests to auditLogger after they complete.
func AuditMiddleware(logger *audit.AuditLogger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			shouldLog := false
			for _, p := range auditPaths {
				if strings.Contains(path, p) {
					shouldLog = true
					break
				}
			}

			if !shouldLog {
				next.ServeHTTP(w, r)
				return
			}

			// Buffer body so handler can still read it
			var bodyBuf []byte
			if r.Body != nil {
				bodyBuf, _ = io.ReadAll(io.LimitReader(r.Body, 1<<20))
				r.Body = io.NopCloser(bytes.NewReader(bodyBuf))
			}

			arw := &auditResponseWriter{ResponseWriter: w}
			start := time.Now()
			next.ServeHTTP(arw, r)
			elapsed := time.Since(start)

			go func() {
				// Parse SQL from body if present
				var sqlText string
				var req struct {
					SQL   string `json:"sql"`
					Query string `json:"query"`
				}
				if json.Unmarshal(bodyBuf, &req) == nil {
					sqlText = req.SQL
					if sqlText == "" {
						sqlText = req.Query
					}
				}

				queryType := audit.ClassifyQuery(sqlText)
				if strings.Contains(path, "/export") {
					queryType = "EXPORT"
				}

				connID := chi.URLParamFromCtx(r.Context(), "connId")

				errStr := ""
				if arw.status >= 400 {
					errStr = http.StatusText(arw.status)
				}

				entry := audit.AuditEntry{
					ID:         "aud_" + generateAuditID(),
					Timestamp:  start.UTC(),
					ActorIP:    r.RemoteAddr,
					UserAgent:  r.UserAgent(),
					ConnID:     connID,
					QueryType:  queryType,
					QueryText:  sqlText,
					DurationMs: elapsed.Milliseconds(),
					Error:      errStr,
				}
				logger.Log(entry)
			}()
		})
	}
}

// generateAuditID makes a simple unique ID from time nanos.
func generateAuditID() string {
	return strings.ReplaceAll(
		strings.TrimPrefix(
			strings.ReplaceAll(time.Now().Format("20060102150405.000000000"), ".", ""),
			"0",
		),
		" ", "",
	)
}

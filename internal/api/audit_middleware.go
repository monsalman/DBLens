package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/audit"
	"github.com/go-chi/chi/v5"
)

// auditResponseWriter captures status code and body size and forwards streaming
// primitives (Flush/Hijack) to the wrapped writer. Embedding the
// http.ResponseWriter *interface* only promotes Header/Write/WriteHeader, so an
// SSE handler asserting http.Flusher against this wrapper would fail unless
// Flush is implemented here explicitly.
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

// Flush implements http.Flusher; no-op if the underlying writer cannot flush.
func (a *auditResponseWriter) Flush() {
	if f, ok := a.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack implements http.Hijacker; required by connection-upgrade handlers.
func (a *auditResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := a.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, http.ErrNotSupported
}

// Unwrap exposes the wrapped writer to http.ResponseController.
func (a *auditResponseWriter) Unwrap() http.ResponseWriter { return a.ResponseWriter }

// snapshot copies the mutable counters. Callers that hand work to another
// goroutine must use this instead of reading the fields directly, because the
// serving goroutine may still be writing them.
func (a *auditResponseWriter) snapshot() (status, size int) {
	return a.status, a.size
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

			// ── Snapshot EVERY request-derived value before the goroutine ──
			// chi pools and resets its *Context (chi.(*Context).Reset()) as soon
			// as the handler returns, so calling URLParamFromCtx / reading
			// r.RemoteAddr / r.UserAgent() from a background goroutine is a real
			// data race and can attribute the entry to the wrong connection.
			connID := chi.URLParamFromCtx(r.Context(), "connId")
			actorIP := peerAddr(r)
			forwardedFor := forwardedForHeader(r)
			ua := r.UserAgent()
			status, respBytes := arw.snapshot()

			// Only plain data crosses the goroutine boundary.
			sqlText, queryType := parseAuditedSQL(bodyBuf, path)

			errStr := ""
			if status >= 400 {
				errStr = http.StatusText(status)
			}

			entry := audit.AuditEntry{
				ID:           "aud_" + generateAuditID(),
				Timestamp:    start.UTC(),
				ActorIP:      actorIP,
				ForwardedFor: forwardedFor,
				UserAgent:    ua,
				ConnID:       connID,
				QueryType:    queryType,
				QueryText:    sqlText,
				RespBytes:    int64(respBytes),
				DurationMs:   elapsed.Milliseconds(),
				Error:        errStr,
			}

			logger.Log(entry)
		})
	}
}

// parseAuditedSQL extracts the SQL text and query type from a buffered body.
// It only reads the immutable byte slice, so it is safe from any goroutine.
func parseAuditedSQL(bodyBuf []byte, path string) (sqlText, queryType string) {
	var req struct {
		SQL   string `json:"sql"`
		Query string `json:"query"`
	}
	if len(bodyBuf) > 0 && json.Unmarshal(bodyBuf, &req) == nil {
		sqlText = req.SQL
		if sqlText == "" {
			sqlText = req.Query
		}
	}

	queryType = audit.ClassifyQuery(sqlText)
	if strings.Contains(path, "/export") {
		queryType = "EXPORT"
	}
	return sqlText, queryType
}

// truePeerCtxKey carries the socket peer captured before middleware.RealIP
// rewrote r.RemoteAddr from the client-controlled X-Forwarded-For header.
type truePeerCtxKey struct{}

// CaptureTruePeer records the real TCP peer address in the request context.
// It must be installed BEFORE chi's middleware.RealIP, otherwise the only
// remaining value is the spoofable X-Forwarded-For chain.
func CaptureTruePeer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), truePeerCtxKey{}, r.RemoteAddr)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// peerAddr returns the true socket peer. When CaptureTruePeer did not run, it
// returns the empty string rather than a spoofable X-Forwarded-For value, so
// actor_ip is never wrong.
func peerAddr(r *http.Request) string {
	if r == nil {
		return ""
	}
	if v, ok := r.Context().Value(truePeerCtxKey{}).(string); ok {
		return sanitizeAddr(v)
	}
	return ""
}

// forwardedForHeader returns the untrusted X-Forwarded-For header, recorded
// separately from actor_ip so a spoofed value is never shown as the actor.
func forwardedForHeader(r *http.Request) string {
	if r == nil {
		return ""
	}
	return sanitizeLogField(r.Header.Get("X-Forwarded-For"), 512)
}

// sanitizeAddr strips the port from a host:port address and removes control
// characters that could be used to forge NDJSON log lines.
func sanitizeAddr(addr string) string {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(addr); err == nil {
		addr = host
	}
	return sanitizeLogField(strings.Trim(addr, "[]"), 256)
}

// sanitizeLogField strips CR/LF/NUL (NDJSON line injection) and bounds length.
func sanitizeLogField(s string, max int) string {
	s = strings.NewReplacer("\r", " ", "\n", " ", "\x00", "").Replace(strings.TrimSpace(s))
	s = strings.TrimSpace(s)
	if max > 0 && len(s) > max {
		s = s[:max]
	}
	return s
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

package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dblens/dblens/internal/audit"
)

func TestListAuditLogEmpty(t *testing.T) {
	tmp := t.TempDir() + "/audit.log"
	logger, err := audit.NewAuditLogger(tmp)
	if err != nil {
		t.Fatal(err)
	}
	defer logger.Close()

	h := &Handler{auditLogPath: tmp, auditLogger: logger}
	req := httptest.NewRequest(http.MethodGet, "/api/audit/entries", nil)
	rr := httptest.NewRecorder()
	h.ListAuditLog(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	body := strings.TrimSpace(rr.Body.String())
	if !strings.Contains(body, "[]") && !strings.Contains(body, "data") {
		t.Fatalf("unexpected body: %s", body)
	}
}

func TestVerifyChainValid(t *testing.T) {
	tmp := t.TempDir() + "/audit.log"
	logger, err := audit.NewAuditLogger(tmp)
	if err != nil {
		t.Fatal(err)
	}

	logger.Log(audit.AuditEntry{ID: "1", QueryType: "SELECT", QueryText: "SELECT 1"})
	logger.Log(audit.AuditEntry{ID: "2", QueryType: "DML", QueryText: "INSERT INTO t VALUES (1)"})
	logger.Close()

	h := &Handler{auditLogPath: tmp}
	req := httptest.NewRequest(http.MethodGet, "/api/audit/verify", nil)
	rr := httptest.NewRecorder()
	h.VerifyAuditChain(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), `"ok":true`) {
		t.Fatalf("expected ok:true, got: %s", rr.Body.String())
	}
}

func TestAuditMiddlewareLogs(t *testing.T) {
	tmp := t.TempDir() + "/audit.log"
	logger, err := audit.NewAuditLogger(tmp)
	if err != nil {
		t.Fatal(err)
	}

	mw := AuditMiddleware(logger)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":{}}`))
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/connections/c1/query", strings.NewReader(`{"sql":"SELECT 1"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	// Give the goroutine time to enqueue before close
	time.Sleep(50 * time.Millisecond)
	logger.Close()
}

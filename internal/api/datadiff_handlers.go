package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/dblens/dblens/internal/alter"
	"github.com/dblens/dblens/internal/datadiff"
)

var reDataDiffIdent = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

func isValidDataDiffIdent(ident string, allowEmpty bool) bool {
	ident = strings.TrimSpace(ident)
	if ident == "" {
		return allowEmpty
	}
	return reDataDiffIdent.MatchString(ident)
}

// CompareDataDiffHandler compares data between source and target tables.
// POST /api/datadiff/compare
func (h *Handler) CompareDataDiffHandler(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	var req datadiff.DataDiffRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if !isValidDataDiffIdent(req.SourceTable, false) {
		sendError(w, http.StatusBadRequest, "invalid or missing sourceTable identifier")
		return
	}
	if !isValidDataDiffIdent(req.TargetTable, false) {
		sendError(w, http.StatusBadRequest, "invalid or missing targetTable identifier")
		return
	}
	if !isValidDataDiffIdent(req.SourceSchema, true) {
		sendError(w, http.StatusBadRequest, "invalid sourceSchema identifier")
		return
	}
	if !isValidDataDiffIdent(req.TargetSchema, true) {
		sendError(w, http.StatusBadRequest, "invalid targetSchema identifier")
		return
	}

	for _, pk := range req.PrimaryKeys {
		if !isValidDataDiffIdent(pk, false) {
			sendError(w, http.StatusBadRequest, fmt.Sprintf("invalid primary key identifier: %q", pk))
			return
		}
	}
	for _, col := range req.Columns {
		if !isValidDataDiffIdent(col, false) {
			sendError(w, http.StatusBadRequest, fmt.Sprintf("invalid column identifier: %q", col))
			return
		}
	}

	if req.WhereClause != "" {
		if err := datadiff.ValidateWhereClause(req.WhereClause); err != nil {
			sendError(w, http.StatusBadRequest, "invalid where clause: "+err.Error())
			return
		}
	}

	// Resolve Source Driver
	srcEntry, err := h.resolveDriverWithFallback(r, req.SourceDSN, req.SourceConnID)
	if err != nil {
		sendError(w, http.StatusBadRequest, "source database connection failed: "+err.Error())
		return
	}

	// Resolve Target Driver
	tgtEntry, err := h.resolveDriverWithFallback(r, req.TargetDSN, req.TargetConnID)
	if err != nil {
		sendError(w, http.StatusBadRequest, "target database connection failed: "+err.Error())
		return
	}

	res, err := datadiff.CompareData(r.Context(), req, srcEntry.Driver, tgtEntry.Driver)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "data diff comparison failed: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, res)
}

// GenerateDataDiffSyncHandler generates transactional DML sync script.
// POST /api/datadiff/generate-sync
func (h *Handler) GenerateDataDiffSyncHandler(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	var req datadiff.SyncScriptRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.TargetDialect == "" && req.TargetConnID != "" {
		if tgtEntry, err := h.resolveDriverWithFallback(r, req.TargetDSN, req.TargetConnID); err == nil && tgtEntry.Driver != nil {
			req.TargetDialect = tgtEntry.Driver.Dialect()
		}
	}
	if req.SourceDialect == "" && req.SourceConnID != "" {
		if srcEntry, err := h.resolveDriverWithFallback(r, req.SourceDSN, req.SourceConnID); err == nil && srcEntry.Driver != nil {
			req.SourceDialect = srcEntry.Driver.Dialect()
		}
	}

	if !isValidDataDiffIdent(req.TargetTable, true) {
		sendError(w, http.StatusBadRequest, "invalid targetTable identifier")
		return
	}
	if !isValidDataDiffIdent(req.SourceTable, true) {
		sendError(w, http.StatusBadRequest, "invalid sourceTable identifier")
		return
	}
	if !isValidDataDiffIdent(req.TargetSchema, true) {
		sendError(w, http.StatusBadRequest, "invalid targetSchema identifier")
		return
	}
	if !isValidDataDiffIdent(req.SourceSchema, true) {
		sendError(w, http.StatusBadRequest, "invalid sourceSchema identifier")
		return
	}

	for _, pk := range req.PrimaryKeys {
		if !isValidDataDiffIdent(pk, false) {
			sendError(w, http.StatusBadRequest, fmt.Sprintf("invalid primary key identifier: %q", pk))
			return
		}
	}
	for _, col := range req.Columns {
		if !isValidDataDiffIdent(col, false) {
			sendError(w, http.StatusBadRequest, fmt.Sprintf("invalid column identifier: %q", col))
			return
		}
	}

	res, err := datadiff.GenerateSyncScript(req)
	if err != nil {
		sendError(w, http.StatusBadRequest, "sync script generation failed: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, res)
}

// ApplyDataDiffSyncHandler applies sync script/statements atomically against the target connection.
// POST /api/datadiff/apply-sync
func (h *Handler) ApplyDataDiffSyncHandler(w http.ResponseWriter, r *http.Request) {
	// Safe Mode check: HTTP header, query param, or payload flag
	isReadOnly := isTruthy(r.Header.Get("X-DBLENS-READONLY")) ||
		isTruthy(r.URL.Query().Get("readonly"))

	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	var req datadiff.ApplySyncRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if isReadOnly || req.ReadOnly {
		sendError(w, http.StatusForbidden, "connection is read-only; sync mutations blocked by Safe Mode")
		return
	}

	if req.TargetTable != "" && !isValidDataDiffIdent(req.TargetTable, false) {
		sendError(w, http.StatusBadRequest, "invalid targetTable identifier")
		return
	}
	if req.TargetSchema != "" && !isValidDataDiffIdent(req.TargetSchema, false) {
		sendError(w, http.StatusBadRequest, "invalid targetSchema identifier")
		return
	}

	stmtsToValidate := req.Statements
	if len(stmtsToValidate) == 0 && strings.TrimSpace(req.SQL) != "" {
		stmtsToValidate = datadiff.SplitSQLStatements(req.SQL)
	}
	for _, stmt := range stmtsToValidate {
		if err := datadiff.ValidateSyncStatement(stmt, req.TargetTable); err != nil {
			sendError(w, http.StatusBadRequest, "invalid sync statement: "+err.Error())
			return
		}
	}

	tgtEntry, err := h.resolveDriverWithFallback(r, req.TargetDSN, req.TargetConnID)
	if err != nil {
		sendError(w, http.StatusBadRequest, "target database connection failed: "+err.Error())
		return
	}

	res, err := datadiff.ExecuteSync(r.Context(), tgtEntry.Driver, req)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "failed to apply sync: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, res)
}

// ExportDataDiffSQLHandler exports generated SQL sync script as an attachment.
// GET /api/datadiff/export.sql or POST /api/datadiff/export.sql
func (h *Handler) ExportDataDiffSQLHandler(w http.ResponseWriter, r *http.Request) {
	var req datadiff.SyncScriptRequest

	if r.Method == http.MethodPost {
		r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			sendError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
			return
		}
	} else {
		// GET query parameter parsing
		q := r.URL.Query()
		req.SourceConnID = q.Get("sourceConnId")
		req.SourceDSN = q.Get("sourceDsn")
		req.SourceSchema = q.Get("sourceSchema")
		req.SourceTable = q.Get("sourceTable")
		req.SourceDialect = q.Get("sourceDialect")
		req.TargetConnID = q.Get("targetConnId")
		req.TargetDSN = q.Get("targetDsn")
		req.TargetSchema = q.Get("targetSchema")
		req.TargetTable = q.Get("targetTable")
		req.Strategy = datadiff.SyncConflictStrategy(q.Get("strategy"))
		req.TargetDialect = q.Get("targetDialect")
		req.DeleteExcess = isTruthy(q.Get("deleteExcess"))

		if pks := q.Get("pks"); pks != "" {
			req.PrimaryKeys = strings.Split(pks, ",")
		}
		if cols := q.Get("columns"); cols != "" {
			req.Columns = strings.Split(cols, ",")
		}
	}

	if !isValidDataDiffIdent(req.TargetTable, true) {
		sendError(w, http.StatusBadRequest, "invalid targetTable identifier")
		return
	}
	if !isValidDataDiffIdent(req.SourceTable, true) {
		sendError(w, http.StatusBadRequest, "invalid sourceTable identifier")
		return
	}
	if !isValidDataDiffIdent(req.TargetSchema, true) {
		sendError(w, http.StatusBadRequest, "invalid targetSchema identifier")
		return
	}
	if !isValidDataDiffIdent(req.SourceSchema, true) {
		sendError(w, http.StatusBadRequest, "invalid sourceSchema identifier")
		return
	}

	for _, pk := range req.PrimaryKeys {
		if !isValidDataDiffIdent(pk, false) {
			sendError(w, http.StatusBadRequest, fmt.Sprintf("invalid primary key identifier: %q", pk))
			return
		}
	}
	for _, col := range req.Columns {
		if !isValidDataDiffIdent(col, false) {
			sendError(w, http.StatusBadRequest, fmt.Sprintf("invalid column identifier: %q", col))
			return
		}
	}

	if req.TargetDialect == "" && req.TargetConnID != "" {
		if tgtEntry, err := h.resolveDriverWithFallback(r, req.TargetDSN, req.TargetConnID); err == nil && tgtEntry.Driver != nil {
			req.TargetDialect = alter.NormalizeDialect(tgtEntry.Driver.Dialect())
		}
	}
	if req.SourceDialect == "" && req.SourceConnID != "" {
		if srcEntry, err := h.resolveDriverWithFallback(r, req.SourceDSN, req.SourceConnID); err == nil && srcEntry.Driver != nil {
			req.SourceDialect = alter.NormalizeDialect(srcEntry.Driver.Dialect())
		}
	}

	res, err := datadiff.GenerateSyncScript(req)
	if err != nil {
		sendError(w, http.StatusBadRequest, "failed to generate export SQL: "+err.Error())
		return
	}

	filename := "sync.sql"
	if req.TargetTable != "" && isValidDataDiffIdent(req.TargetTable, false) {
		filename = fmt.Sprintf("sync_%s.sql", req.TargetTable)
	}

	w.Header().Set("Content-Type", "application/sql; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(res.SQL))
}

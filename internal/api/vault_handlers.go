package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/dblens/dblens/internal/vault"
)

// SetVaultFastKDF sets fast Argon2id parameters for testing.
func (h *Handler) SetVaultFastKDF(fast bool) {
	if h.vaultMgr != nil {
		h.vaultMgr.SetFastKDF(fast)
	}
}

// ExportVault handles POST /api/vault/export
func (h *Handler) ExportVault(w http.ResponseWriter, r *http.Request) {
	if h.vaultMgr == nil {
		sendError(w, http.StatusInternalServerError, "Vault manager not initialized")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 5<<20)
	var req vault.ExportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid JSON payload: "+err.Error())
		return
	}

	if strings.TrimSpace(req.Passphrase) == "" {
		sendError(w, http.StatusBadRequest, "Passphrase cannot be empty")
		return
	}

	res, err := h.vaultMgr.Export(req)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Export failed: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, res)
}

// ImportVault handles POST /api/vault/import
func (h *Handler) ImportVault(w http.ResponseWriter, r *http.Request) {
	if h.vaultMgr == nil {
		sendError(w, http.StatusInternalServerError, "Vault manager not initialized")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 5<<20)
	var req vault.ImportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid JSON payload: "+err.Error())
		return
	}

	if strings.TrimSpace(req.Passphrase) == "" {
		sendError(w, http.StatusBadRequest, "Passphrase cannot be empty")
		return
	}

	res, err := h.vaultMgr.Import(req)
	if err != nil {
		sendError(w, http.StatusBadRequest, "Import failed: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, res)
}

// UnlockVault handles POST /api/vault/unlock
func (h *Handler) UnlockVault(w http.ResponseWriter, r *http.Request) {
	if h.vaultMgr == nil {
		sendError(w, http.StatusInternalServerError, "Vault manager not initialized")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 5<<20)
	var req vault.UnlockRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid JSON payload: "+err.Error())
		return
	}

	if strings.TrimSpace(req.Passphrase) == "" {
		sendError(w, http.StatusBadRequest, "Passphrase cannot be empty")
		return
	}

	res, err := h.vaultMgr.Unlock(req)
	if err != nil {
		sendError(w, http.StatusBadRequest, "Unlock failed: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, res)
}

// LockVault handles POST /api/vault/lock
func (h *Handler) LockVault(w http.ResponseWriter, r *http.Request) {
	if h.vaultMgr == nil {
		sendError(w, http.StatusInternalServerError, "Vault manager not initialized")
		return
	}

	res := h.vaultMgr.Lock()
	sendJSON(w, http.StatusOK, res)
}

// GetVaultStatus handles GET /api/vault/status
func (h *Handler) GetVaultStatus(w http.ResponseWriter, r *http.Request) {
	if h.vaultMgr == nil {
		sendError(w, http.StatusInternalServerError, "Vault manager not initialized")
		return
	}

	res := h.vaultMgr.Status()
	sendJSON(w, http.StatusOK, res)
}

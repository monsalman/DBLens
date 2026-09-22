package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/dblens/dblens/internal/migration"
)

// MigrationListResponse represents the list of applied migrations and tracker status.
type MigrationListResponse struct {
	Initialized bool                        `json:"initialized"`
	Dialect     string                      `json:"dialect"`
	Migrations  []migration.MigrationRecord `json:"migrations"`
}

// RollbackMigrationRequest represents the optional version parameter for rollback.
type RollbackMigrationRequest struct {
	Version string `json:"version,omitempty"`
}

// GetMigrations lists all applied migrations from _dblens_migrations.
func (h *Handler) GetMigrations(w http.ResponseWriter, r *http.Request) {
	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	initialized, err := migration.IsTrackerInitialized(r.Context(), entry.Driver)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to check migration status: "+err.Error())
		return
	}

	migrations, err := migration.List(r.Context(), entry.Driver)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to list migrations: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, MigrationListResponse{
		Initialized: initialized,
		Dialect:     entry.Driver.Dialect(),
		Migrations:  migrations,
	})
}

// InitMigrationTracker initializes the _dblens_migrations tracking table.
func (h *Handler) InitMigrationTracker(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := migration.EnsureTrackerTable(r.Context(), entry.Driver); err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to initialize migration tracker: "+err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"message":     "Migration tracking table initialized successfully",
		"initialized": true,
	})
}

// GenerateMigration formats migration files for tools like Goose, Flyway, etc.
func (h *Handler) GenerateMigration(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 5<<20) // 5MB limit
	var req migration.GenerateMigrationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	if strings.TrimSpace(req.Name) == "" {
		sendError(w, http.StatusBadRequest, "Migration name is required")
		return
	}

	bundle, err := migration.GenerateBundle(req)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, bundle)
}

// ApplyMigration applies the migration SQL to the database and records it in _dblens_migrations.
func (h *Handler) ApplyMigration(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 10<<20) // 10MB limit
	var req migration.ApplyMigrationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	if strings.TrimSpace(req.Name) == "" {
		sendError(w, http.StatusBadRequest, "Migration name is required")
		return
	}
	if strings.TrimSpace(req.UpSQL) == "" {
		sendError(w, http.StatusBadRequest, "Migration upSql is required")
		return
	}

	record, err := migration.Apply(r.Context(), entry.Driver, req)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, record)
}

// RollbackMigration executes DownSQL and deletes the migration record from _dblens_migrations.
func (h *Handler) RollbackMigration(w http.ResponseWriter, r *http.Request) {
	if isTruthy(r.Header.Get("X-DBLENS-READONLY")) {
		sendError(w, http.StatusForbidden, "Connection is read-only. Mutation blocked by Safe Mode.")
		return
	}

	entry, err := h.resolveDriver(r)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	var req RollbackMigrationRequest
	if r.Body != nil {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	record, err := migration.Rollback(r.Context(), entry.Driver, req.Version)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, record)
}

package api

import (
	"encoding/json"
	"net/http"

	"github.com/dblens/dblens/internal/webhook"
	"github.com/go-chi/chi/v5"
)

// GetWebhooks returns all registered webhooks for connection connId.
func (h *Handler) GetWebhooks(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	list := h.WebhookManager().List(connID)
	sendJSON(w, http.StatusOK, list)
}

// CreateWebhook registers a new webhook endpoint under connId.
func (h *Handler) CreateWebhook(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	var wh webhook.Webhook
	if err := json.NewDecoder(r.Body).Decode(&wh); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	created, err := h.WebhookManager().Create(connID, wh)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}
	sendJSON(w, http.StatusCreated, created)
}

// UpdateWebhook updates an existing webhook under connId.
func (h *Handler) UpdateWebhook(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	id := chi.URLParam(r, "id")

	var wh webhook.Webhook
	if err := json.NewDecoder(r.Body).Decode(&wh); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	updated, err := h.WebhookManager().Update(connID, id, wh)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, updated)
}

// DeleteWebhook deletes a webhook by id.
func (h *Handler) DeleteWebhook(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	id := chi.URLParam(r, "id")

	if err := h.WebhookManager().Delete(connID, id); err != nil {
		sendError(w, http.StatusNotFound, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// GetWebhookDeliveries retrieves historical delivery logs for connId.
func (h *Handler) GetWebhookDeliveries(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	deliveries := h.WebhookManager().GetDeliveries(connID)
	sendJSON(w, http.StatusOK, deliveries)
}

// RetryWebhookDelivery re-dispatches a delivery by its delivery ID.
func (h *Handler) RetryWebhookDelivery(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	delivery, err := h.WebhookManager().RetryDelivery(r.Context(), id)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, delivery)
}

// SimulateWebhook sends a synthetic database change event without mutating actual data.
func (h *Handler) SimulateWebhook(w http.ResponseWriter, r *http.Request) {
	connID := chi.URLParam(r, "connId")
	var req webhook.SimulateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	res, err := h.WebhookManager().Simulate(r.Context(), connID, req)
	if err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, res)
}

package api

import (
	"encoding/json"
	"net/http"

	"github.com/dblens/dblens/internal/tunnel"
)

// TestTunnelHandler handles POST /api/tunnel/test to verify bastion connectivity and latency.
func (h *Handler) TestTunnelHandler(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var cfg tunnel.SSHTunnelConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	res, err := tunnel.TestTunnel(cfg)
	if err != nil {
		if res == nil {
			res = &tunnel.TunnelTestResult{
				Success: false,
				Message: err.Error(),
			}
		}
		sendJSON(w, http.StatusOK, res)
		return
	}

	sendJSON(w, http.StatusOK, res)
}

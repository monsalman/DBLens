package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/dblens/dblens/internal/gis"
)

// GISParseRequest represents the payload for parsing spatial data.
type GISParseRequest struct {
	Data string `json:"data"`
	SRID int    `json:"srid,omitempty"`
}

// GISParseResponse represents the parsed spatial geometry and associated representations.
type GISParseResponse struct {
	Geometry    *gis.Geometry          `json:"geometry"`
	GeoJSON     map[string]interface{} `json:"geojson"`
	SQLSnippets map[string]string      `json:"sql_snippets"`
}

// GISConvertRequest represents the payload for converting spatial data.
type GISConvertRequest struct {
	Data         string `json:"data"`
	TargetFormat string `json:"target_format"` // "geojson", "wkt", "ewkt", "wkb_hex", "sql"
	TargetSRID   int    `json:"target_srid,omitempty"`
	Dialect      string `json:"dialect,omitempty"` // "postgres", "mysql", "sqlite"
}

// GISConvertResponse represents the converted spatial result.
type GISConvertResponse struct {
	Format    string      `json:"format"`
	Converted interface{} `json:"converted"`
	SRID      int         `json:"srid"`
}

// ParseGISData parses spatial geometry from EWKB hex, WKB, WKT, or GeoJSON.
func (h *Handler) ParseGISData(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20) // 10MB
	var req GISParseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	req.Data = strings.TrimSpace(req.Data)
	if req.Data == "" {
		sendError(w, http.StatusBadRequest, "Spatial data cannot be empty")
		return
	}

	geom, err := gis.Parse(req.Data, req.SRID)
	if err != nil {
		sendError(w, http.StatusBadRequest, "Failed to parse spatial data: "+err.Error())
		return
	}

	feature := gis.ToGeoJSONFeature(geom)
	snippets := gis.GenerateSQLSnippets(geom)

	sendJSON(w, http.StatusOK, GISParseResponse{
		Geometry:    geom,
		GeoJSON:     feature,
		SQLSnippets: snippets,
	})
}

// ConvertGISData converts spatial data between WKB hex, WKT, EWKT, GeoJSON, and SQL snippets.
func (h *Handler) ConvertGISData(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	var req GISConvertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	req.Data = strings.TrimSpace(req.Data)
	if req.Data == "" {
		sendError(w, http.StatusBadRequest, "Spatial data cannot be empty")
		return
	}

	geom, err := gis.Parse(req.Data, req.TargetSRID)
	if err != nil {
		sendError(w, http.StatusBadRequest, "Failed to parse spatial data: "+err.Error())
		return
	}

	if req.TargetSRID > 0 {
		geom.SRID = req.TargetSRID
		geom.EWKT = gis.ToEWKT(geom)
	}

	targetFmt := strings.ToLower(strings.TrimSpace(req.TargetFormat))
	if targetFmt == "" {
		targetFmt = "geojson"
	}

	var converted interface{}
	switch targetFmt {
	case "geojson":
		converted = gis.ToGeoJSONFeature(geom)
	case "wkt":
		converted = gis.ToWKT(geom)
	case "ewkt":
		converted = gis.ToEWKT(geom)
	case "wkb_hex", "wkb", "hex":
		hexStr, err := gis.ToEWKBHex(geom)
		if err != nil {
			sendError(w, http.StatusInternalServerError, "Failed to encode EWKB hex: "+err.Error())
			return
		}
		converted = hexStr
	case "sql":
		dialect := strings.ToLower(strings.TrimSpace(req.Dialect))
		if dialect == "" {
			if entry, err := h.resolveDriver(r); err == nil && entry != nil && entry.Driver != nil {
				dialect = strings.ToLower(entry.Driver.Dialect())
			} else {
				dialect = "postgres"
			}
		}
		snippets := gis.GenerateSQLSnippets(geom)
		if snip, ok := snippets[dialect]; ok {
			converted = snip
		} else {
			converted = snippets["postgres"]
		}
	default:
		sendError(w, http.StatusBadRequest, "Unsupported target format: "+req.TargetFormat)
		return
	}

	sendJSON(w, http.StatusOK, GISConvertResponse{
		Format:    targetFmt,
		Converted: converted,
		SRID:      geom.SRID,
	})
}

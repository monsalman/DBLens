package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dblens/dblens/internal/api"
	"github.com/dblens/dblens/internal/connection"
)

func setupGISTestServer() http.Handler {
	mgr := connection.NewManager()
	h := api.NewHandler(mgr)
	return api.SetupRouter(h, api.RouterConfig{})
}

func TestGISParseEndpoint(t *testing.T) {
	router := setupGISTestServer()

	// 1. Test WKT Point
	body, _ := json.Marshal(map[string]interface{}{
		"data": "POINT(-122.4194 37.7749)",
		"srid": 4326,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/connections/test-conn/gis/parse", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Data *struct {
			Geometry struct {
				Type     string     `json:"type"`
				SRID     int        `json:"srid"`
				Vertices int        `json:"vertices"`
				BBox     [4]float64 `json:"bbox"`
			} `json:"geometry"`
			GeoJSON     map[string]interface{} `json:"geojson"`
			SQLSnippets map[string]string      `json:"sql_snippets"`
		} `json:"data"`
		Error *string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Error != nil {
		t.Fatalf("unexpected API error: %s", *resp.Error)
	}
	if resp.Data == nil || resp.Data.Geometry.Type != "Point" {
		t.Fatalf("expected Type 'Point', got %+v", resp.Data)
	}
	if resp.Data.Geometry.SRID != 4326 {
		t.Errorf("expected SRID 4326, got %d", resp.Data.Geometry.SRID)
	}
	if resp.Data.SQLSnippets["postgres"] == "" {
		t.Errorf("missing postgres SQL snippet")
	}

	// 2. Test Invalid Data
	invalidBody, _ := json.Marshal(map[string]interface{}{
		"data": "NOT_A_SPATIAL_SHAPE",
	})
	req2 := httptest.NewRequest(http.MethodPost, "/api/connections/test-conn/gis/parse", bytes.NewReader(invalidBody))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request, got %d", rec2.Code)
	}
}

func TestGISConvertEndpoint(t *testing.T) {
	router := setupGISTestServer()

	// 1. Convert WKT to GeoJSON
	body, _ := json.Marshal(map[string]interface{}{
		"data":          "POINT(-122.4194 37.7749)",
		"target_format": "geojson",
		"target_srid":   4326,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/connections/test-conn/gis/convert", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Data *struct {
			Format    string      `json:"format"`
			Converted interface{} `json:"converted"`
			SRID      int         `json:"srid"`
		} `json:"data"`
		Error *string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Data == nil || resp.Data.Format != "geojson" {
		t.Fatalf("unexpected convert result: %+v", resp.Data)
	}

	// 2. Convert WKT to WKB Hex
	bodyHex, _ := json.Marshal(map[string]interface{}{
		"data":          "POINT(-122.4194 37.7749)",
		"target_format": "wkb_hex",
		"target_srid":   4326,
	})
	reqHex := httptest.NewRequest(http.MethodPost, "/api/connections/test-conn/gis/convert", bytes.NewReader(bodyHex))
	reqHex.Header.Set("Content-Type", "application/json")
	recHex := httptest.NewRecorder()
	router.ServeHTTP(recHex, reqHex)

	if recHex.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for wkb_hex, got %d", recHex.Code)
	}

	// 3. Convert WKT to SQL
	bodySQL, _ := json.Marshal(map[string]interface{}{
		"data":          "POINT(-122.4194 37.7749)",
		"target_format": "sql",
		"dialect":       "mysql",
		"target_srid":   4326,
	})
	reqSQL := httptest.NewRequest(http.MethodPost, "/api/connections/test-conn/gis/convert", bytes.NewReader(bodySQL))
	reqSQL.Header.Set("Content-Type", "application/json")
	recSQL := httptest.NewRecorder()
	router.ServeHTTP(recSQL, reqSQL)

	if recSQL.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for sql, got %d", recSQL.Code)
	}

	// 4. Invalid target format
	bodyInvalid, _ := json.Marshal(map[string]interface{}{
		"data":          "POINT(-122.4194 37.7749)",
		"target_format": "unsupported_xyz",
	})
	reqInvalid := httptest.NewRequest(http.MethodPost, "/api/connections/test-conn/gis/convert", bytes.NewReader(bodyInvalid))
	reqInvalid.Header.Set("Content-Type", "application/json")
	recInvalid := httptest.NewRecorder()
	router.ServeHTTP(recInvalid, reqInvalid)

	if recInvalid.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request for unsupported format, got %d", recInvalid.Code)
	}
}

package gis

import (
	"bytes"
	"encoding/binary"
	"math"
	"strings"
	"testing"
)

func TestParseWKTPoint(t *testing.T) {
	wkt := "POINT(-122.4194 37.7749)"
	geom, err := Parse(wkt, 4326)
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
	}

	if geom.Type != TypePoint {
		t.Errorf("expected TypePoint, got %s", geom.Type)
	}
	if geom.SRID != 4326 {
		t.Errorf("expected SRID 4326, got %d", geom.SRID)
	}
	coords, ok := geom.Coordinates.([]float64)
	if !ok || len(coords) < 2 {
		t.Fatalf("invalid coordinates: %v", geom.Coordinates)
	}
	if math.Abs(coords[0]-(-122.4194)) > 1e-6 || math.Abs(coords[1]-37.7749) > 1e-6 {
		t.Errorf("unexpected coordinates: %v", coords)
	}
	if geom.Vertices != 1 {
		t.Errorf("expected 1 vertex, got %d", geom.Vertices)
	}
	if geom.BBox[0] != coords[0] || geom.BBox[1] != coords[1] {
		t.Errorf("unexpected BBox: %v", geom.BBox)
	}
	if geom.Centroid[0] != coords[0] || geom.Centroid[1] != coords[1] {
		t.Errorf("unexpected centroid: %v", geom.Centroid)
	}
}

func TestParseEWKTWithSRID(t *testing.T) {
	ewkt := "SRID=3857;POINT(1000 2000)"
	geom, err := Parse(ewkt, 4326)
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
	}
	if geom.SRID != 3857 {
		t.Errorf("expected SRID 3857, got %d", geom.SRID)
	}
	if !strings.HasPrefix(geom.EWKT, "SRID=3857;POINT") {
		t.Errorf("unexpected EWKT: %s", geom.EWKT)
	}
}

func TestParseWKTLineString(t *testing.T) {
	wkt := "LINESTRING(0 0, 1 1, 2 0)"
	geom, err := Parse(wkt, 4326)
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
	}
	if geom.Type != TypeLineString {
		t.Errorf("expected TypeLineString, got %s", geom.Type)
	}
	if geom.Vertices != 3 {
		t.Errorf("expected 3 vertices, got %d", geom.Vertices)
	}
	if geom.Length <= 0 {
		t.Errorf("expected positive length, got %f", geom.Length)
	}
	if geom.BBox != [4]float64{0, 0, 2, 1} {
		t.Errorf("unexpected bbox: %v", geom.BBox)
	}
}

func TestParseWKTPolygon(t *testing.T) {
	wkt := "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))"
	geom, err := Parse(wkt, 4326)
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
	}
	if geom.Type != TypePolygon {
		t.Errorf("expected TypePolygon, got %s", geom.Type)
	}
	if geom.Vertices != 5 {
		t.Errorf("expected 5 vertices, got %d", geom.Vertices)
	}
	if geom.Area <= 0 {
		t.Errorf("expected positive area, got %f", geom.Area)
	}
	if geom.Length <= 0 {
		t.Errorf("expected positive perimeter, got %f", geom.Length)
	}
}

func TestParseWKBHex(t *testing.T) {
	// Point (-122.4194, 37.7749) with SRID 4326
	orig := &Geometry{
		Type:        TypePoint,
		SRID:        4326,
		Coordinates: []float64{-122.4194, 37.7749},
	}
	hexStr, err := ToEWKBHex(orig)
	if err != nil {
		t.Fatalf("ToEWKBHex failed: %v", err)
	}

	geom, err := Parse(hexStr, 0)
	if err != nil {
		t.Fatalf("Parse hex failed: %v", err)
	}
	if geom.Type != TypePoint {
		t.Errorf("expected TypePoint, got %s", geom.Type)
	}
	if geom.SRID != 4326 {
		t.Errorf("expected SRID 4326, got %d", geom.SRID)
	}
	coords := geom.Coordinates.([]float64)
	if math.Abs(coords[0]-(-122.4194)) > 1e-6 || math.Abs(coords[1]-37.7749) > 1e-6 {
		t.Errorf("unexpected coordinates from hex: %v", coords)
	}
}

func TestParseHexWithPrefix(t *testing.T) {
	orig := &Geometry{
		Type:        TypePoint,
		SRID:        4326,
		Coordinates: []float64{10, 20},
	}
	hexStr, err := ToEWKBHex(orig)
	if err != nil {
		t.Fatalf("ToEWKBHex failed: %v", err)
	}

	// Test \x prefix (PostgreSQL bytea hex)
	geom1, err := Parse("\\x"+hexStr, 0)
	if err != nil {
		t.Fatalf("Parse with \\x failed: %v", err)
	}
	if geom1.Type != TypePoint {
		t.Errorf("expected TypePoint, got %s", geom1.Type)
	}

	// Test 0x prefix
	geom2, err := Parse("0x"+hexStr, 0)
	if err != nil {
		t.Fatalf("Parse with 0x failed: %v", err)
	}
	if geom2.Type != TypePoint {
		t.Errorf("expected TypePoint, got %s", geom2.Type)
	}
}

func TestParseGeoJSON(t *testing.T) {
	geoJSON := `{"type": "Feature", "geometry": {"type": "Point", "coordinates": [-73.9851, 40.7488]}, "properties": {"name": "Empire State Building"}}`
	geom, err := Parse(geoJSON, 4326)
	if err != nil {
		t.Fatalf("Parse GeoJSON failed: %v", err)
	}
	if geom.Type != TypePoint {
		t.Errorf("expected TypePoint, got %s", geom.Type)
	}
	coords := geom.Coordinates.([]float64)
	if math.Abs(coords[0]-(-73.9851)) > 1e-4 || math.Abs(coords[1]-40.7488) > 1e-4 {
		t.Errorf("unexpected coords: %v", coords)
	}
}

func TestParseMultiPointAndLineString(t *testing.T) {
	wktMP := "MULTIPOINT((10 40), (40 30), (20 20))"
	geomMP, err := Parse(wktMP, 4326)
	if err != nil {
		t.Fatalf("Parse MULTIPOINT failed: %v", err)
	}
	if geomMP.Type != TypeMultiPoint {
		t.Errorf("expected TypeMultiPoint, got %s", geomMP.Type)
	}
	if geomMP.Vertices != 3 {
		t.Errorf("expected 3 vertices, got %d", geomMP.Vertices)
	}

	// Test roundtrip to EWKB and back
	hexMP, err := ToEWKBHex(geomMP)
	if err != nil {
		t.Fatalf("ToEWKBHex failed: %v", err)
	}
	geomMP2, err := Parse(hexMP, 0)
	if err != nil {
		t.Fatalf("Parse hex MP failed: %v", err)
	}
	if geomMP2.Vertices != 3 {
		t.Errorf("expected 3 vertices in roundtrip, got %d", geomMP2.Vertices)
	}
}

func TestSQLSnippets(t *testing.T) {
	geom := &Geometry{
		Type:        TypePoint,
		SRID:        4326,
		Coordinates: []float64{10, 20},
		WKT:         "POINT(10 20)",
	}
	snippets := GenerateSQLSnippets(geom)
	if snippets["postgres"] != "ST_GeomFromText('POINT(10 20)', 4326)" {
		t.Errorf("unexpected postgres snippet: %s", snippets["postgres"])
	}
	if snippets["mysql"] != "ST_GeomFromText('POINT(10 20)', 4326)" {
		t.Errorf("unexpected mysql snippet: %s", snippets["mysql"])
	}
	if snippets["sqlite"] != "GeomFromText('POINT(10 20)', 4326)" {
		t.Errorf("unexpected sqlite snippet: %s", snippets["sqlite"])
	}
}

func TestInvalidInput(t *testing.T) {
	_, err := Parse("", 4326)
	if err == nil {
		t.Errorf("expected error for empty string")
	}

	_, err = Parse("NOT_A_GEO_STRING_123", 4326)
	if err == nil {
		t.Errorf("expected error for random non-geo string")
	}

	_, err = Parse("POINT(invalid coordinates)", 4326)
	if err == nil {
		t.Errorf("expected error for malformed WKT")
	}
}

func TestMalformedCoordinates(t *testing.T) {
	// 1. LineString with points having len < 2
	malformedLineJSON := `{"type":"LineString","coordinates":[[10],[20]]}`
	geom, err := Parse(malformedLineJSON, 4326)
	if err != nil {
		t.Fatalf("unexpected error parsing malformed LineString: %v", err)
	}
	if geom.Length != 0 {
		t.Errorf("expected 0 length for malformed coords, got %f", geom.Length)
	}

	// 2. Polygon with points having len < 2
	malformedPolyJSON := `{"type":"Polygon","coordinates":[[[10],[20],[30]]]}`
	geomPoly, err := Parse(malformedPolyJSON, 4326)
	if err != nil {
		t.Fatalf("unexpected error parsing malformed Polygon: %v", err)
	}
	if geomPoly.Area != 0 || geomPoly.Length != 0 {
		t.Errorf("expected 0 area and perimeter for malformed coords, got area=%f, len=%f", geomPoly.Area, geomPoly.Length)
	}

	// 3. Direct function checks
	if l := calculatePathLength([][]float64{{1.0}, {2.0}}, false); l != 0 {
		t.Errorf("expected 0 path length, got %f", l)
	}
	if a := shoelaceArea([][]float64{{1.0}, {2.0}, {3.0}}); a != 0 {
		t.Errorf("expected 0 shoelace area, got %f", a)
	}
}

func TestOversizedWKBCountRejection(t *testing.T) {
	// 1. LineString claimed count > maxWKBItems (1_000_000)
	buf := new(bytes.Buffer)
	buf.WriteByte(1) // LittleEndian
	_ = binary.Write(buf, binary.LittleEndian, uint32(2)) // LineString
	_ = binary.Write(buf, binary.LittleEndian, uint32(1_000_001))
	_, err := ParseWKB(buf.Bytes(), 4326)
	if err == nil || !strings.Contains(err.Error(), "exceeds maximum allowed limit") {
		t.Fatalf("expected max count error, got: %v", err)
	}

	// 2. LineString claimed count requires more buffer than remaining
	buf.Reset()
	buf.WriteByte(1) // LittleEndian
	_ = binary.Write(buf, binary.LittleEndian, uint32(2)) // LineString
	_ = binary.Write(buf, binary.LittleEndian, uint32(10_000)) // requires 160_000 bytes, but buffer ends
	_, err = ParseWKB(buf.Bytes(), 4326)
	if err == nil || !strings.Contains(err.Error(), "insufficient buffer") {
		t.Fatalf("expected insufficient buffer error, got: %v", err)
	}

	// 3. Polygon claimed rings requires more buffer than remaining
	buf.Reset()
	buf.WriteByte(1)
	_ = binary.Write(buf, binary.LittleEndian, uint32(3)) // Polygon
	_ = binary.Write(buf, binary.LittleEndian, uint32(100_000))
	_, err = ParseWKB(buf.Bytes(), 4326)
	if err == nil || !strings.Contains(err.Error(), "insufficient buffer") {
		t.Fatalf("expected insufficient buffer error for polygon, got: %v", err)
	}

	// 4. MultiPoint claimed items exceeds buffer
	buf.Reset()
	buf.WriteByte(1)
	_ = binary.Write(buf, binary.LittleEndian, uint32(4)) // MultiPoint
	_ = binary.Write(buf, binary.LittleEndian, uint32(50_000))
	_, err = ParseWKB(buf.Bytes(), 4326)
	if err == nil || !strings.Contains(err.Error(), "insufficient buffer") {
		t.Fatalf("expected insufficient buffer error for multipoint, got: %v", err)
	}
}

func TestDeepRecursionRejection(t *testing.T) {
	// Construct nested GeometryCollections: depth > 32
	var buf bytes.Buffer
	for i := 0; i < 35; i++ {
		buf.WriteByte(1)
		_ = binary.Write(&buf, binary.LittleEndian, uint32(7))
		_ = binary.Write(&buf, binary.LittleEndian, uint32(1))
	}
	// Innermost Point
	buf.WriteByte(1)
	_ = binary.Write(&buf, binary.LittleEndian, uint32(1))
	_ = binary.Write(&buf, binary.LittleEndian, float64(10.0))
	_ = binary.Write(&buf, binary.LittleEndian, float64(20.0))

	_, err := ParseWKB(buf.Bytes(), 4326)
	if err == nil || !strings.Contains(err.Error(), "recursion depth exceeded") {
		t.Fatalf("expected recursion depth error, got: %v", err)
	}
}

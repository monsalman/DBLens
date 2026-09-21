package gis

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"
)

// GeometryType represents the OGC geometry type.
type GeometryType string

const (
	TypePoint              GeometryType = "Point"
	TypeLineString         GeometryType = "LineString"
	TypePolygon            GeometryType = "Polygon"
	TypeMultiPoint         GeometryType = "MultiPoint"
	TypeMultiLineString    GeometryType = "MultiLineString"
	TypeMultiPolygon       GeometryType = "MultiPolygon"
	TypeGeometryCollection GeometryType = "GeometryCollection"
)

// PostGIS EWKB flags
const (
	wkbSRID = 0x20000000
	wkbM    = 0x40000000
	wkbZ    = 0x80000000
)

// Geometry represents a parsed spatial geometry with computed spatial metrics.
type Geometry struct {
	Type        GeometryType `json:"type"`
	SRID        int          `json:"srid,omitempty"`
	Coordinates interface{}  `json:"coordinates,omitempty"`
	Geometries  []Geometry   `json:"geometries,omitempty"` // For GeometryCollection
	BBox        [4]float64   `json:"bbox"`                 // [minLng, minLat, maxLng, maxLat]
	Centroid    [2]float64   `json:"centroid"`             // [lng, lat]
	Vertices    int          `json:"vertices"`
	Length      float64      `json:"length"` // in meters (geographic) or units (planar)
	Area        float64      `json:"area"`   // in sq meters (geographic) or units (planar)
	WKT         string       `json:"wkt"`
	EWKT        string       `json:"ewkt"`
}

// Parse parses spatial data from an unknown input (hex EWKB/WKB, binary bytes, WKT string, or GeoJSON).
func Parse(input interface{}, defaultSRID int) (*Geometry, error) {
	if defaultSRID <= 0 {
		defaultSRID = 4326
	}

	switch v := input.(type) {
	case []byte:
		return ParseBytes(v, defaultSRID)
	case string:
		return ParseString(v, defaultSRID)
	case json.RawMessage:
		return ParseGeoJSON(v, defaultSRID)
	default:
		return nil, fmt.Errorf("unsupported input type: %T", input)
	}
}

// ParseString parses a string input into a Geometry.
func ParseString(s string, defaultSRID int) (*Geometry, error) {
	str := strings.TrimSpace(s)
	if str == "" {
		return nil, errors.New("empty spatial input")
	}

	// 1. Check for JSON / GeoJSON
	if strings.HasPrefix(str, "{") {
		return ParseGeoJSON([]byte(str), defaultSRID)
	}

	// 2. Check for WKT (e.g. POINT, LINESTRING, POLYGON, MULTI*, GEOMETRYCOLLECTION, SRID=...)
	upper := strings.ToUpper(str)
	if strings.HasPrefix(upper, "SRID=") ||
		strings.HasPrefix(upper, "POINT") ||
		strings.HasPrefix(upper, "LINESTRING") ||
		strings.HasPrefix(upper, "POLYGON") ||
		strings.HasPrefix(upper, "MULTIPOINT") ||
		strings.HasPrefix(upper, "MULTILINESTRING") ||
		strings.HasPrefix(upper, "MULTIPOLYGON") ||
		strings.HasPrefix(upper, "GEOMETRYCOLLECTION") {
		return ParseWKT(str, defaultSRID)
	}

	// 3. Check for Hex EWKB / WKB (optionally prefixed with \x or 0x)
	cleanedHex := str
	if strings.HasPrefix(cleanedHex, "\\x") || strings.HasPrefix(cleanedHex, "\\X") {
		cleanedHex = cleanedHex[2:]
	} else if strings.HasPrefix(cleanedHex, "0x") || strings.HasPrefix(cleanedHex, "0X") {
		cleanedHex = cleanedHex[2:]
	}

	// If it consists entirely of hex characters and has even length >= 10:
	if len(cleanedHex) >= 10 && len(cleanedHex)%2 == 0 && isHex(cleanedHex) {
		raw, err := hex.DecodeString(cleanedHex)
		if err == nil {
			return ParseWKB(raw, defaultSRID)
		}
	}

	return nil, fmt.Errorf("unrecognized spatial data format")
}

// ParseBytes parses raw bytes as WKB/EWKB or GeoJSON.
func ParseBytes(data []byte, defaultSRID int) (*Geometry, error) {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return nil, errors.New("empty spatial byte data")
	}

	if trimmed[0] == '{' {
		return ParseGeoJSON(trimmed, defaultSRID)
	}

	// Could be hex string inside bytes
	if len(trimmed) >= 10 && isHex(string(trimmed)) {
		raw, err := hex.DecodeString(string(trimmed))
		if err == nil {
			return ParseWKB(raw, defaultSRID)
		}
	}

	return ParseWKB(trimmed, defaultSRID)
}

func isHex(s string) bool {
	for _, r := range s {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}

// ─────────────────────────────────────────────────────────────────────────────
// WKB / EWKB PARSER
// ─────────────────────────────────────────────────────────────────────────────

type wkbReader struct {
	data []byte
	pos  int
}

func (r *wkbReader) remaining() int {
	return len(r.data) - r.pos
}

func (r *wkbReader) readByte() (byte, error) {
	if r.remaining() < 1 {
		return 0, errors.New("unexpected EOF reading byte")
	}
	b := r.data[r.pos]
	r.pos++
	return b, nil
}

func (r *wkbReader) readUint32(order binary.ByteOrder) (uint32, error) {
	if r.remaining() < 4 {
		return 0, errors.New("unexpected EOF reading uint32")
	}
	val := order.Uint32(r.data[r.pos : r.pos+4])
	r.pos += 4
	return val, nil
}

func (r *wkbReader) readFloat64(order binary.ByteOrder) (float64, error) {
	if r.remaining() < 8 {
		return 0, errors.New("unexpected EOF reading float64")
	}
	bits := order.Uint64(r.data[r.pos : r.pos+8])
	r.pos += 8
	return math.Float64frombits(bits), nil
}

// ParseWKB parses binary WKB or PostGIS EWKB or MySQL spatial binary data.
func ParseWKB(data []byte, defaultSRID int) (*Geometry, error) {
	if len(data) < 5 {
		return nil, errors.New("WKB data too short")
	}

	// Detect MySQL Spatial format: 4-byte SRID prefix + standard WKB
	// In MySQL: bytes 0..3 is SRID (e.g. 0 or 4326 LittleEndian), byte 4 is endianness (0 or 1),
	// bytes 5..8 is geometry type (1..7).
	if len(data) >= 9 && (data[4] == 0 || data[4] == 1) && (data[0] != 0 && data[0] != 1) {
		mySRID := int(binary.LittleEndian.Uint32(data[0:4]))
		r := &wkbReader{data: data[4:], pos: 0}
		geom, err := parseWKBGeometry(r, mySRID)
		if err != nil {
			return nil, err
		}
		if geom.SRID == 0 && mySRID != 0 {
			geom.SRID = mySRID
		}
		finalizeGeometry(geom)
		return geom, nil
	}

	r := &wkbReader{data: data, pos: 0}
	geom, err := parseWKBGeometry(r, defaultSRID)
	if err != nil {
		return nil, err
	}
	finalizeGeometry(geom)
	return geom, nil
}

func parseWKBGeometry(r *wkbReader, inheritSRID int) (*Geometry, error) {
	byteOrderByte, err := r.readByte()
	if err != nil {
		return nil, err
	}

	var order binary.ByteOrder
	switch byteOrderByte {
	case 0:
		order = binary.BigEndian
	case 1:
		order = binary.LittleEndian
	default:
		return nil, fmt.Errorf("invalid byte order flag: %d", byteOrderByte)
	}

	rawType, err := r.readUint32(order)
	if err != nil {
		return nil, err
	}

	srid := inheritSRID
	if (rawType & wkbSRID) != 0 {
		s, err := r.readUint32(order)
		if err != nil {
			return nil, err
		}
		srid = int(s)
	}

	hasZ := (rawType & wkbZ) != 0
	hasM := (rawType & wkbM) != 0

	baseType := rawType & 0x1FFFFFFF
	if baseType >= 1000 && baseType < 2000 {
		hasZ = true
		baseType -= 1000
	} else if baseType >= 2000 && baseType < 3000 {
		hasM = true
		baseType -= 2000
	} else if baseType >= 3000 && baseType < 4000 {
		hasZ = true
		hasM = true
		baseType -= 3000
	}

	readPoint := func() ([]float64, error) {
		x, err := r.readFloat64(order)
		if err != nil {
			return nil, err
		}
		y, err := r.readFloat64(order)
		if err != nil {
			return nil, err
		}
		if hasZ {
			z, err := r.readFloat64(order)
			if err != nil {
				return nil, err
			}
			if hasM {
				if _, err := r.readFloat64(order); err != nil {
					return nil, err
				}
			}
			return []float64{x, y, z}, nil
		}
		if hasM {
			if _, err := r.readFloat64(order); err != nil {
				return nil, err
			}
		}
		return []float64{x, y}, nil
	}

	geom := &Geometry{SRID: srid}

	switch baseType {
	case 1: // Point
		geom.Type = TypePoint
		coords, err := readPoint()
		if err != nil {
			return nil, err
		}
		geom.Coordinates = coords

	case 2: // LineString
		geom.Type = TypeLineString
		n, err := r.readUint32(order)
		if err != nil {
			return nil, err
		}
		coords := make([][]float64, n)
		for i := 0; i < int(n); i++ {
			pt, err := readPoint()
			if err != nil {
				return nil, err
			}
			coords[i] = pt
		}
		geom.Coordinates = coords

	case 3: // Polygon
		geom.Type = TypePolygon
		numRings, err := r.readUint32(order)
		if err != nil {
			return nil, err
		}
		rings := make([][][]float64, numRings)
		for ringIdx := 0; ringIdx < int(numRings); ringIdx++ {
			n, err := r.readUint32(order)
			if err != nil {
				return nil, err
			}
			ring := make([][]float64, n)
			for i := 0; i < int(n); i++ {
				pt, err := readPoint()
				if err != nil {
					return nil, err
				}
				ring[i] = pt
			}
			rings[ringIdx] = ring
		}
		geom.Coordinates = rings

	case 4: // MultiPoint
		geom.Type = TypeMultiPoint
		n, err := r.readUint32(order)
		if err != nil {
			return nil, err
		}
		coords := make([][]float64, n)
		for i := 0; i < int(n); i++ {
			sub, err := parseWKBGeometry(r, srid)
			if err != nil {
				return nil, err
			}
			if pt, ok := sub.Coordinates.([]float64); ok {
				coords[i] = pt
			} else {
				return nil, fmt.Errorf("unexpected coordinate type in MultiPoint")
			}
		}
		geom.Coordinates = coords

	case 5: // MultiLineString
		geom.Type = TypeMultiLineString
		n, err := r.readUint32(order)
		if err != nil {
			return nil, err
		}
		lines := make([][][]float64, n)
		for i := 0; i < int(n); i++ {
			sub, err := parseWKBGeometry(r, srid)
			if err != nil {
				return nil, err
			}
			if line, ok := sub.Coordinates.([][]float64); ok {
				lines[i] = line
			} else {
				return nil, fmt.Errorf("unexpected coordinate type in MultiLineString")
			}
		}
		geom.Coordinates = lines

	case 6: // MultiPolygon
		geom.Type = TypeMultiPolygon
		n, err := r.readUint32(order)
		if err != nil {
			return nil, err
		}
		polys := make([][][][]float64, n)
		for i := 0; i < int(n); i++ {
			sub, err := parseWKBGeometry(r, srid)
			if err != nil {
				return nil, err
			}
			if poly, ok := sub.Coordinates.([][][]float64); ok {
				polys[i] = poly
			} else {
				return nil, fmt.Errorf("unexpected coordinate type in MultiPolygon")
			}
		}
		geom.Coordinates = polys

	case 7: // GeometryCollection
		geom.Type = TypeGeometryCollection
		n, err := r.readUint32(order)
		if err != nil {
			return nil, err
		}
		geoms := make([]Geometry, n)
		for i := 0; i < int(n); i++ {
			sub, err := parseWKBGeometry(r, srid)
			if err != nil {
				return nil, err
			}
			geoms[i] = *sub
		}
		geom.Geometries = geoms

	default:
		return nil, fmt.Errorf("unsupported WKB geometry type: %d", baseType)
	}

	return geom, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// WKT / EWKT PARSER
// ─────────────────────────────────────────────────────────────────────────────

type wktLexer struct {
	input []rune
	pos   int
}

type wktTokenType int

const (
	tokWord wktTokenType = iota
	tokNumber
	tokLParen
	tokRParen
	tokComma
	tokSemicolon
	tokEquals
	tokEOF
)

type wktToken struct {
	typ wktTokenType
	val string
}

func newWKTLexer(s string) *wktLexer {
	return &wktLexer{input: []rune(s), pos: 0}
}

func (l *wktLexer) nextToken() wktToken {
	for l.pos < len(l.input) && unicode.IsSpace(l.input[l.pos]) {
		l.pos++
	}
	if l.pos >= len(l.input) {
		return wktToken{typ: tokEOF}
	}

	ch := l.input[l.pos]
	switch ch {
	case '(':
		l.pos++
		return wktToken{typ: tokLParen, val: "("}
	case ')':
		l.pos++
		return wktToken{typ: tokRParen, val: ")"}
	case ',':
		l.pos++
		return wktToken{typ: tokComma, val: ","}
	case ';':
		l.pos++
		return wktToken{typ: tokSemicolon, val: ";"}
	case '=':
		l.pos++
		return wktToken{typ: tokEquals, val: "="}
	}

	if ch == '-' || ch == '+' || unicode.IsDigit(ch) || ch == '.' {
		start := l.pos
		for l.pos < len(l.input) {
			c := l.input[l.pos]
			if unicode.IsDigit(c) || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E' {
				l.pos++
			} else {
				break
			}
		}
		return wktToken{typ: tokNumber, val: string(l.input[start:l.pos])}
	}

	if unicode.IsLetter(ch) || ch == '_' {
		start := l.pos
		for l.pos < len(l.input) && (unicode.IsLetter(l.input[l.pos]) || unicode.IsDigit(l.input[l.pos]) || l.input[l.pos] == '_') {
			l.pos++
		}
		return wktToken{typ: tokWord, val: string(l.input[start:l.pos])}
	}

	l.pos++
	return wktToken{typ: tokWord, val: string(ch)}
}

type wktParser struct {
	lexer *wktLexer
	cur   wktToken
}

func newWKTParser(s string) *wktParser {
	p := &wktParser{lexer: newWKTLexer(s)}
	p.cur = p.lexer.nextToken()
	return p
}

func (p *wktParser) next() {
	p.cur = p.lexer.nextToken()
}

func (p *wktParser) parseCoord() ([]float64, error) {
	if p.cur.typ != tokNumber {
		return nil, fmt.Errorf("expected coordinate number, got %q", p.cur.val)
	}
	x, err := strconv.ParseFloat(p.cur.val, 64)
	if err != nil {
		return nil, err
	}
	p.next()

	if p.cur.typ != tokNumber {
		return nil, fmt.Errorf("expected Y coordinate number, got %q", p.cur.val)
	}
	y, err := strconv.ParseFloat(p.cur.val, 64)
	if err != nil {
		return nil, err
	}
	p.next()

	if p.cur.typ == tokNumber {
		z, err := strconv.ParseFloat(p.cur.val, 64)
		if err == nil {
			p.next()
			return []float64{x, y, z}, nil
		}
	}

	return []float64{x, y}, nil
}

func (p *wktParser) parseCoordList() ([][]float64, error) {
	var list [][]float64
	for {
		pt, err := p.parseCoord()
		if err != nil {
			return nil, err
		}
		list = append(list, pt)
		if p.cur.typ == tokComma {
			p.next()
			continue
		}
		break
	}
	return list, nil
}

// ParseWKT parses a WKT or EWKT string.
func ParseWKT(s string, defaultSRID int) (*Geometry, error) {
	p := newWKTParser(s)
	srid := defaultSRID

	// Check for optional SRID=4326;
	if p.cur.typ == tokWord && strings.ToUpper(p.cur.val) == "SRID" {
		p.next()
		if p.cur.typ != tokEquals {
			return nil, errors.New("expected '=' after SRID")
		}
		p.next()
		if p.cur.typ != tokNumber {
			return nil, errors.New("expected SRID number")
		}
		val, err := strconv.Atoi(p.cur.val)
		if err != nil {
			return nil, fmt.Errorf("invalid SRID number: %w", err)
		}
		srid = val
		p.next()
		if p.cur.typ != tokSemicolon {
			return nil, errors.New("expected ';' after SRID definition")
		}
		p.next()
	}

	geom, err := p.parseGeometry(srid)
	if err != nil {
		return nil, err
	}
	finalizeGeometry(geom)
	return geom, nil
}

func (p *wktParser) parseGeometry(srid int) (*Geometry, error) {
	if p.cur.typ != tokWord {
		return nil, fmt.Errorf("expected geometry type name, got %q", p.cur.val)
	}

	rawType := strings.ToUpper(p.cur.val)
	p.next()

	// Skip Z, M, ZM tokens if separated by whitespace (e.g. POINT Z (1 2 3))
	if p.cur.typ == tokWord {
		w := strings.ToUpper(p.cur.val)
		if w == "Z" || w == "M" || w == "ZM" {
			p.next()
		}
	}

	// Normalize type name
	var gType GeometryType
	switch {
	case strings.HasPrefix(rawType, "POINT"):
		gType = TypePoint
	case strings.HasPrefix(rawType, "LINESTRING"):
		gType = TypeLineString
	case strings.HasPrefix(rawType, "POLYGON"):
		gType = TypePolygon
	case strings.HasPrefix(rawType, "MULTIPOINT"):
		gType = TypeMultiPoint
	case strings.HasPrefix(rawType, "MULTILINESTRING"):
		gType = TypeMultiLineString
	case strings.HasPrefix(rawType, "MULTIPOLYGON"):
		gType = TypeMultiPolygon
	case strings.HasPrefix(rawType, "GEOMETRYCOLLECTION"):
		gType = TypeGeometryCollection
	default:
		return nil, fmt.Errorf("unsupported WKT geometry type: %s", rawType)
	}

	// Check EMPTY
	if p.cur.typ == tokWord && strings.ToUpper(p.cur.val) == "EMPTY" {
		p.next()
		return &Geometry{Type: gType, SRID: srid}, nil
	}

	if p.cur.typ != tokLParen {
		return nil, fmt.Errorf("expected '(' after %s, got %q", gType, p.cur.val)
	}
	p.next()

	geom := &Geometry{Type: gType, SRID: srid}

	switch gType {
	case TypePoint:
		pt, err := p.parseCoord()
		if err != nil {
			return nil, err
		}
		geom.Coordinates = pt
		if p.cur.typ != tokRParen {
			return nil, fmt.Errorf("expected ')' after POINT coordinates")
		}
		p.next()

	case TypeLineString:
		coords, err := p.parseCoordList()
		if err != nil {
			return nil, err
		}
		geom.Coordinates = coords
		if p.cur.typ != tokRParen {
			return nil, fmt.Errorf("expected ')' after LINESTRING coordinates")
		}
		p.next()

	case TypePolygon:
		var rings [][][]float64
		for {
			if p.cur.typ != tokLParen {
				return nil, fmt.Errorf("expected '(' at start of polygon ring")
			}
			p.next()
			ring, err := p.parseCoordList()
			if err != nil {
				return nil, err
			}
			if p.cur.typ != tokRParen {
				return nil, fmt.Errorf("expected ')' at end of polygon ring")
			}
			p.next()
			rings = append(rings, ring)
			if p.cur.typ == tokComma {
				p.next()
				continue
			}
			break
		}
		geom.Coordinates = rings
		if p.cur.typ != tokRParen {
			return nil, fmt.Errorf("expected ')' at end of POLYGON")
		}
		p.next()

	case TypeMultiPoint:
		// MULTIPOINT can be MULTIPOINT((1 2), (3 4)) or MULTIPOINT(1 2, 3 4)
		var pts [][]float64
		if p.cur.typ == tokLParen {
			for {
				if p.cur.typ != tokLParen {
					return nil, fmt.Errorf("expected '(' for MultiPoint point")
				}
				p.next()
				pt, err := p.parseCoord()
				if err != nil {
					return nil, err
				}
				if p.cur.typ != tokRParen {
					return nil, fmt.Errorf("expected ')' for MultiPoint point")
				}
				p.next()
				pts = append(pts, pt)
				if p.cur.typ == tokComma {
					p.next()
					continue
				}
				break
			}
		} else {
			coords, err := p.parseCoordList()
			if err != nil {
				return nil, err
			}
			pts = coords
		}
		geom.Coordinates = pts
		if p.cur.typ != tokRParen {
			return nil, fmt.Errorf("expected ')' at end of MULTIPOINT")
		}
		p.next()

	case TypeMultiLineString:
		var lines [][][]float64
		for {
			if p.cur.typ != tokLParen {
				return nil, fmt.Errorf("expected '(' at start of MultiLineString line")
			}
			p.next()
			line, err := p.parseCoordList()
			if err != nil {
				return nil, err
			}
			if p.cur.typ != tokRParen {
				return nil, fmt.Errorf("expected ')' at end of MultiLineString line")
			}
			p.next()
			lines = append(lines, line)
			if p.cur.typ == tokComma {
				p.next()
				continue
			}
			break
		}
		geom.Coordinates = lines
		if p.cur.typ != tokRParen {
			return nil, fmt.Errorf("expected ')' at end of MULTILINESTRING")
		}
		p.next()

	case TypeMultiPolygon:
		var polys [][][][]float64
		for {
			if p.cur.typ != tokLParen {
				return nil, fmt.Errorf("expected '(' at start of MultiPolygon polygon")
			}
			p.next()
			var rings [][][]float64
			for {
				if p.cur.typ != tokLParen {
					return nil, fmt.Errorf("expected '(' at start of polygon ring")
				}
				p.next()
				ring, err := p.parseCoordList()
				if err != nil {
					return nil, err
				}
				if p.cur.typ != tokRParen {
					return nil, fmt.Errorf("expected ')' at end of polygon ring")
				}
				p.next()
				rings = append(rings, ring)
				if p.cur.typ == tokComma {
					p.next()
					continue
				}
				break
			}
			if p.cur.typ != tokRParen {
				return nil, fmt.Errorf("expected ')' at end of polygon in MultiPolygon")
			}
			p.next()
			polys = append(polys, rings)
			if p.cur.typ == tokComma {
				p.next()
				continue
			}
			break
		}
		geom.Coordinates = polys
		if p.cur.typ != tokRParen {
			return nil, fmt.Errorf("expected ')' at end of MULTIPOLYGON")
		}
		p.next()

	case TypeGeometryCollection:
		var geoms []Geometry
		for {
			sub, err := p.parseGeometry(srid)
			if err != nil {
				return nil, err
			}
			finalizeGeometry(sub)
			geoms = append(geoms, *sub)
			if p.cur.typ == tokComma {
				p.next()
				continue
			}
			break
		}
		geom.Geometries = geoms
		if p.cur.typ != tokRParen {
			return nil, fmt.Errorf("expected ')' at end of GEOMETRYCOLLECTION")
		}
		p.next()
	}

	return geom, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// GEOJSON PARSER
// ─────────────────────────────────────────────────────────────────────────────

type geoJSONCRS struct {
	Type       string                 `json:"type"`
	Properties map[string]interface{} `json:"properties"`
}

type geoJSONRaw struct {
	Type        string                 `json:"type"`
	Coordinates json.RawMessage        `json:"coordinates,omitempty"`
	Geometries  []geoJSONRaw           `json:"geometries,omitempty"`
	Geometry    *geoJSONRaw            `json:"geometry,omitempty"`
	Features    []geoJSONRaw           `json:"features,omitempty"`
	CRS         *geoJSONCRS            `json:"crs,omitempty"`
	Properties  map[string]interface{} `json:"properties,omitempty"`
}

// ParseGeoJSON parses a GeoJSON byte slice (Geometry, Feature, or FeatureCollection).
func ParseGeoJSON(data []byte, defaultSRID int) (*Geometry, error) {
	var raw geoJSONRaw
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("invalid GeoJSON: %w", err)
	}

	srid := defaultSRID
	if raw.CRS != nil && raw.CRS.Properties != nil {
		if name, ok := raw.CRS.Properties["name"].(string); ok {
			// Extract EPSG:4326 or urn:ogc:def:crs:EPSG::4326
			parts := strings.Split(name, ":")
			if len(parts) > 0 {
				if last, err := strconv.Atoi(parts[len(parts)-1]); err == nil && last > 0 {
					srid = last
				}
			}
		}
	} else if raw.Properties != nil {
		if val, ok := raw.Properties["srid"]; ok {
			switch num := val.(type) {
			case float64:
				srid = int(num)
			case string:
				if s, err := strconv.Atoi(num); err == nil {
					srid = s
				}
			}
		}
	}

	geom, err := parseGeoJSONRaw(&raw, srid)
	if err != nil {
		return nil, err
	}
	finalizeGeometry(geom)
	return geom, nil
}

func parseGeoJSONRaw(raw *geoJSONRaw, srid int) (*Geometry, error) {
	t := raw.Type
	switch t {
	case "Feature":
		if raw.Geometry == nil {
			return nil, errors.New("Feature missing geometry")
		}
		return parseGeoJSONRaw(raw.Geometry, srid)

	case "FeatureCollection":
		if len(raw.Features) == 0 {
			return &Geometry{Type: TypeGeometryCollection, SRID: srid}, nil
		}
		if len(raw.Features) == 1 {
			return parseGeoJSONRaw(&raw.Features[0], srid)
		}
		geoms := make([]Geometry, 0, len(raw.Features))
		for _, f := range raw.Features {
			sub, err := parseGeoJSONRaw(&f, srid)
			if err != nil {
				return nil, err
			}
			geoms = append(geoms, *sub)
		}
		return &Geometry{
			Type:       TypeGeometryCollection,
			SRID:       srid,
			Geometries: geoms,
		}, nil

	case "GeometryCollection":
		geoms := make([]Geometry, 0, len(raw.Geometries))
		for _, g := range raw.Geometries {
			sub, err := parseGeoJSONRaw(&g, srid)
			if err != nil {
				return nil, err
			}
			geoms = append(geoms, *sub)
		}
		return &Geometry{
			Type:       TypeGeometryCollection,
			SRID:       srid,
			Geometries: geoms,
		}, nil

	case "Point":
		var coords []float64
		if err := json.Unmarshal(raw.Coordinates, &coords); err != nil {
			return nil, err
		}
		return &Geometry{Type: TypePoint, SRID: srid, Coordinates: coords}, nil

	case "LineString":
		var coords [][]float64
		if err := json.Unmarshal(raw.Coordinates, &coords); err != nil {
			return nil, err
		}
		return &Geometry{Type: TypeLineString, SRID: srid, Coordinates: coords}, nil

	case "Polygon":
		var coords [][][]float64
		if err := json.Unmarshal(raw.Coordinates, &coords); err != nil {
			return nil, err
		}
		return &Geometry{Type: TypePolygon, SRID: srid, Coordinates: coords}, nil

	case "MultiPoint":
		var coords [][]float64
		if err := json.Unmarshal(raw.Coordinates, &coords); err != nil {
			return nil, err
		}
		return &Geometry{Type: TypeMultiPoint, SRID: srid, Coordinates: coords}, nil

	case "MultiLineString":
		var coords [][][]float64
		if err := json.Unmarshal(raw.Coordinates, &coords); err != nil {
			return nil, err
		}
		return &Geometry{Type: TypeMultiLineString, SRID: srid, Coordinates: coords}, nil

	case "MultiPolygon":
		var coords [][][][]float64
		if err := json.Unmarshal(raw.Coordinates, &coords); err != nil {
			return nil, err
		}
		return &Geometry{Type: TypeMultiPolygon, SRID: srid, Coordinates: coords}, nil

	default:
		return nil, fmt.Errorf("unsupported GeoJSON type: %s", t)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// METRICS & COMPUTATIONS
// ─────────────────────────────────────────────────────────────────────────────

func finalizeGeometry(geom *Geometry) {
	if geom == nil {
		return
	}
	computeMetrics(geom)
	geom.WKT = ToWKT(geom)
	geom.EWKT = ToEWKT(geom)
}

func computeMetrics(geom *Geometry) {
	var (
		points [][]float64
		minX   = math.MaxFloat64
		minY   = math.MaxFloat64
		maxX   = -math.MaxFloat64
		maxY   = -math.MaxFloat64
	)

	addPt := func(pt []float64) {
		if len(pt) < 2 {
			return
		}
		x, y := pt[0], pt[1]
		if x < minX {
			minX = x
		}
		if x > maxX {
			maxX = x
		}
		if y < minY {
			minY = y
		}
		if y > maxY {
			maxY = y
		}
		points = append(points, pt)
	}

	var collectPoints func(g *Geometry)
	collectPoints = func(g *Geometry) {
		if g == nil {
			return
		}
		switch g.Type {
		case TypePoint:
			if pt, ok := g.Coordinates.([]float64); ok {
				addPt(pt)
			}
		case TypeLineString, TypeMultiPoint:
			if pts, ok := g.Coordinates.([][]float64); ok {
				for _, pt := range pts {
					addPt(pt)
				}
			}
		case TypePolygon, TypeMultiLineString:
			if rings, ok := g.Coordinates.([][][]float64); ok {
				for _, ring := range rings {
					for _, pt := range ring {
						addPt(pt)
					}
				}
			}
		case TypeMultiPolygon:
			if polys, ok := g.Coordinates.([][][][]float64); ok {
				for _, poly := range polys {
					for _, ring := range poly {
						for _, pt := range ring {
							addPt(pt)
						}
					}
				}
			}
		case TypeGeometryCollection:
			for i := range g.Geometries {
				collectPoints(&g.Geometries[i])
			}
		}
	}

	collectPoints(geom)

	if len(points) == 0 {
		geom.BBox = [4]float64{0, 0, 0, 0}
		geom.Centroid = [2]float64{0, 0}
		geom.Vertices = 0
		geom.Length = 0
		geom.Area = 0
		return
	}

	geom.Vertices = len(points)
	geom.BBox = [4]float64{minX, minY, maxX, maxY}

	var sumX, sumY float64
	for _, pt := range points {
		sumX += pt[0]
		sumY += pt[1]
	}
	n := float64(len(points))
	centroid := [2]float64{sumX / n, sumY / n}
	geom.Centroid = centroid

	isGeo := geom.SRID == 4326 || (minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90)

	// Length & Area computation
	switch geom.Type {
	case TypePoint, TypeMultiPoint:
		geom.Length = 0
		geom.Area = 0

	case TypeLineString:
		if pts, ok := geom.Coordinates.([][]float64); ok {
			geom.Length = calculatePathLength(pts, isGeo)
		}

	case TypeMultiLineString:
		if lines, ok := geom.Coordinates.([][][]float64); ok {
			var tot float64
			for _, line := range lines {
				tot += calculatePathLength(line, isGeo)
			}
			geom.Length = tot
		}

	case TypePolygon:
		if rings, ok := geom.Coordinates.([][][]float64); ok {
			geom.Length, geom.Area = calculatePolygonMetrics(rings, centroid[1], isGeo)
		}

	case TypeMultiPolygon:
		if polys, ok := geom.Coordinates.([][][][]float64); ok {
			var totLen, totArea float64
			for _, poly := range polys {
				l, a := calculatePolygonMetrics(poly, centroid[1], isGeo)
				totLen += l
				totArea += a
			}
			geom.Length = totLen
			geom.Area = totArea
		}

	case TypeGeometryCollection:
		var totLen, totArea float64
		for _, sub := range geom.Geometries {
			totLen += sub.Length
			totArea += sub.Area
		}
		geom.Length = totLen
		geom.Area = totArea
	}
}

func calculatePathLength(pts [][]float64, isGeo bool) float64 {
	if len(pts) < 2 {
		return 0
	}
	var dist float64
	for i := 0; i < len(pts)-1; i++ {
		p1 := pts[i]
		p2 := pts[i+1]
		if isGeo {
			dist += haversine(p1[0], p1[1], p2[0], p2[1])
		} else {
			dist += math.Hypot(p2[0]-p1[0], p2[1]-p1[1])
		}
	}
	return dist
}

func calculatePolygonMetrics(rings [][][]float64, centroidLat float64, isGeo bool) (perimeter float64, area float64) {
	if len(rings) == 0 {
		return 0, 0
	}

	for _, ring := range rings {
		perimeter += calculatePathLength(ring, isGeo)
	}

	// Outer ring area minus inner rings
	outerPlanar := shoelaceArea(rings[0])
	var innerPlanar float64
	for _, hole := range rings[1:] {
		innerPlanar += shoelaceArea(hole)
	}
	netPlanar := outerPlanar - innerPlanar
	if netPlanar < 0 {
		netPlanar = -netPlanar
	}

	if isGeo {
		// Project degrees to square meters at centroid latitude
		rad := centroidLat * math.Pi / 180.0
		cosLat := math.Cos(rad)
		metersPerDegLat := 111132.95
		metersPerDegLng := 111412.84 * math.Abs(cosLat)
		area = netPlanar * metersPerDegLat * metersPerDegLng
	} else {
		area = netPlanar
	}

	return perimeter, area
}

func shoelaceArea(ring [][]float64) float64 {
	n := len(ring)
	if n < 3 {
		return 0
	}
	var sum float64
	for i := 0; i < n-1; i++ {
		sum += ring[i][0]*ring[i+1][1] - ring[i+1][0]*ring[i][1]
	}
	sum += ring[n-1][0]*ring[0][1] - ring[0][0]*ring[n-1][1]
	return math.Abs(sum) * 0.5
}

func haversine(lng1, lat1, lng2, lat2 float64) float64 {
	const earthRadiusMeters = 6371000.0
	rad := math.Pi / 180.0

	dLat := (lat2 - lat1) * rad
	dLng := (lng2 - lng1) * rad
	lat1Rad := lat1 * rad
	lat2Rad := lat2 * rad

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadiusMeters * c
}

// ─────────────────────────────────────────────────────────────────────────────
// WKT SERIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

func formatCoord(pt []float64) string {
	if len(pt) >= 3 {
		return fmt.Sprintf("%g %g %g", pt[0], pt[1], pt[2])
	}
	if len(pt) >= 2 {
		return fmt.Sprintf("%g %g", pt[0], pt[1])
	}
	return ""
}

func formatCoordList(pts [][]float64) string {
	var sb strings.Builder
	for i, pt := range pts {
		if i > 0 {
			sb.WriteString(", ")
		}
		sb.WriteString(formatCoord(pt))
	}
	return sb.String()
}

// ToWKT formats geometry into standard Well-Known Text.
func ToWKT(geom *Geometry) string {
	if geom == nil {
		return ""
	}

	switch geom.Type {
	case TypePoint:
		if pt, ok := geom.Coordinates.([]float64); ok && len(pt) >= 2 {
			return fmt.Sprintf("POINT(%s)", formatCoord(pt))
		}
		return "POINT EMPTY"

	case TypeLineString:
		if pts, ok := geom.Coordinates.([][]float64); ok && len(pts) > 0 {
			return fmt.Sprintf("LINESTRING(%s)", formatCoordList(pts))
		}
		return "LINESTRING EMPTY"

	case TypePolygon:
		if rings, ok := geom.Coordinates.([][][]float64); ok && len(rings) > 0 {
			var sb strings.Builder
			sb.WriteString("POLYGON(")
			for i, r := range rings {
				if i > 0 {
					sb.WriteString(", ")
				}
				sb.WriteString("(")
				sb.WriteString(formatCoordList(r))
				sb.WriteString(")")
			}
			sb.WriteString(")")
			return sb.String()
		}
		return "POLYGON EMPTY"

	case TypeMultiPoint:
		if pts, ok := geom.Coordinates.([][]float64); ok && len(pts) > 0 {
			var sb strings.Builder
			sb.WriteString("MULTIPOINT(")
			for i, pt := range pts {
				if i > 0 {
					sb.WriteString(", ")
				}
				sb.WriteString("(")
				sb.WriteString(formatCoord(pt))
				sb.WriteString(")")
			}
			sb.WriteString(")")
			return sb.String()
		}
		return "MULTIPOINT EMPTY"

	case TypeMultiLineString:
		if lines, ok := geom.Coordinates.([][][]float64); ok && len(lines) > 0 {
			var sb strings.Builder
			sb.WriteString("MULTILINESTRING(")
			for i, l := range lines {
				if i > 0 {
					sb.WriteString(", ")
				}
				sb.WriteString("(")
				sb.WriteString(formatCoordList(l))
				sb.WriteString(")")
			}
			sb.WriteString(")")
			return sb.String()
		}
		return "MULTILINESTRING EMPTY"

	case TypeMultiPolygon:
		if polys, ok := geom.Coordinates.([][][][]float64); ok && len(polys) > 0 {
			var sb strings.Builder
			sb.WriteString("MULTIPOLYGON(")
			for i, p := range polys {
				if i > 0 {
					sb.WriteString(", ")
				}
				sb.WriteString("(")
				for j, r := range p {
					if j > 0 {
						sb.WriteString(", ")
					}
					sb.WriteString("(")
					sb.WriteString(formatCoordList(r))
					sb.WriteString(")")
				}
				sb.WriteString(")")
			}
			sb.WriteString(")")
			return sb.String()
		}
		return "MULTIPOLYGON EMPTY"

	case TypeGeometryCollection:
		if len(geom.Geometries) > 0 {
			var sb strings.Builder
			sb.WriteString("GEOMETRYCOLLECTION(")
			for i, g := range geom.Geometries {
				if i > 0 {
					sb.WriteString(", ")
				}
				sb.WriteString(ToWKT(&g))
			}
			sb.WriteString(")")
			return sb.String()
		}
		return "GEOMETRYCOLLECTION EMPTY"
	}

	return ""
}

// ToEWKT formats geometry into PostGIS Extended Well-Known Text with SRID prefix.
func ToEWKT(geom *Geometry) string {
	wkt := ToWKT(geom)
	if geom.SRID > 0 {
		return fmt.Sprintf("SRID=%d;%s", geom.SRID, wkt)
	}
	return wkt
}

// ─────────────────────────────────────────────────────────────────────────────
// GEOJSON SERIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

// ToGeoJSONFeature converts a Geometry into a standard GeoJSON Feature object.
func ToGeoJSONFeature(geom *Geometry) map[string]interface{} {
	if geom == nil {
		return nil
	}

	var geometryObj map[string]interface{}
	if geom.Type == TypeGeometryCollection {
		subGeoms := make([]map[string]interface{}, len(geom.Geometries))
		for i, sub := range geom.Geometries {
			subGeoms[i] = map[string]interface{}{
				"type":        string(sub.Type),
				"coordinates": sub.Coordinates,
			}
		}
		geometryObj = map[string]interface{}{
			"type":       "GeometryCollection",
			"geometries": subGeoms,
		}
	} else {
		geometryObj = map[string]interface{}{
			"type":        string(geom.Type),
			"coordinates": geom.Coordinates,
		}
	}

	props := map[string]interface{}{
		"srid":     geom.SRID,
		"vertices": geom.Vertices,
		"length":   geom.Length,
		"area":     geom.Area,
		"wkt":      geom.WKT,
	}

	return map[string]interface{}{
		"type":       "Feature",
		"geometry":   geometryObj,
		"properties": props,
		"bbox":       []float64{geom.BBox[0], geom.BBox[1], geom.BBox[2], geom.BBox[3]},
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// WKB / EWKB SERIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

// ToWKB converts a Geometry into binary LittleEndian PostGIS EWKB format.
func ToWKB(geom *Geometry) ([]byte, error) {
	var buf bytes.Buffer
	if err := writeWKBGeometry(&buf, geom, geom.SRID); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ToEWKBHex converts a Geometry into an uppercase PostGIS EWKB hex string.
func ToEWKBHex(geom *Geometry) (string, error) {
	bytesData, err := ToWKB(geom)
	if err != nil {
		return "", err
	}
	return strings.ToUpper(hex.EncodeToString(bytesData)), nil
}

func writeWKBGeometry(buf *bytes.Buffer, geom *Geometry, rootSRID int) error {
	// LittleEndian = 1
	buf.WriteByte(1)
	order := binary.LittleEndian

	var baseType uint32
	switch geom.Type {
	case TypePoint:
		baseType = 1
	case TypeLineString:
		baseType = 2
	case TypePolygon:
		baseType = 3
	case TypeMultiPoint:
		baseType = 4
	case TypeMultiLineString:
		baseType = 5
	case TypeMultiPolygon:
		baseType = 6
	case TypeGeometryCollection:
		baseType = 7
	default:
		return fmt.Errorf("cannot serialize unknown type: %s", geom.Type)
	}

	hasSRID := rootSRID > 0
	rawType := baseType
	if hasSRID {
		rawType |= wkbSRID
	}

	_ = binary.Write(buf, order, rawType)
	if hasSRID {
		_ = binary.Write(buf, order, uint32(rootSRID))
	}

	writePoint := func(pt []float64) {
		x, y := 0.0, 0.0
		if len(pt) >= 1 {
			x = pt[0]
		}
		if len(pt) >= 2 {
			y = pt[1]
		}
		_ = binary.Write(buf, order, x)
		_ = binary.Write(buf, order, y)
	}

	switch geom.Type {
	case TypePoint:
		if pt, ok := geom.Coordinates.([]float64); ok {
			writePoint(pt)
		} else {
			writePoint([]float64{0, 0})
		}

	case TypeLineString:
		pts, _ := geom.Coordinates.([][]float64)
		_ = binary.Write(buf, order, uint32(len(pts)))
		for _, pt := range pts {
			writePoint(pt)
		}

	case TypePolygon:
		rings, _ := geom.Coordinates.([][][]float64)
		_ = binary.Write(buf, order, uint32(len(rings)))
		for _, ring := range rings {
			_ = binary.Write(buf, order, uint32(len(ring)))
			for _, pt := range ring {
				writePoint(pt)
			}
		}

	case TypeMultiPoint:
		pts, _ := geom.Coordinates.([][]float64)
		_ = binary.Write(buf, order, uint32(len(pts)))
		for _, pt := range pts {
			sub := &Geometry{Type: TypePoint, Coordinates: pt}
			if err := writeWKBGeometry(buf, sub, 0); err != nil {
				return err
			}
		}

	case TypeMultiLineString:
		lines, _ := geom.Coordinates.([][][]float64)
		_ = binary.Write(buf, order, uint32(len(lines)))
		for _, line := range lines {
			sub := &Geometry{Type: TypeLineString, Coordinates: line}
			if err := writeWKBGeometry(buf, sub, 0); err != nil {
				return err
			}
		}

	case TypeMultiPolygon:
		polys, _ := geom.Coordinates.([][][][]float64)
		_ = binary.Write(buf, order, uint32(len(polys)))
		for _, poly := range polys {
			sub := &Geometry{Type: TypePolygon, Coordinates: poly}
			if err := writeWKBGeometry(buf, sub, 0); err != nil {
				return err
			}
		}

	case TypeGeometryCollection:
		_ = binary.Write(buf, order, uint32(len(geom.Geometries)))
		for i := range geom.Geometries {
			if err := writeWKBGeometry(buf, &geom.Geometries[i], 0); err != nil {
				return err
			}
		}
	}

	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL SNIPPET GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

// GenerateSQLSnippets generates dialect-specific SQL expressions for PostgreSQL, MySQL, and SQLite.
func GenerateSQLSnippets(geom *Geometry) map[string]string {
	if geom == nil {
		return map[string]string{}
	}

	srid := geom.SRID
	if srid <= 0 {
		srid = 4326
	}
	wkt := geom.WKT

	// Escape single quotes if any
	safeWKT := strings.ReplaceAll(wkt, "'", "''")

	return map[string]string{
		"postgres": fmt.Sprintf("ST_GeomFromText('%s', %d)", safeWKT, srid),
		"mysql":    fmt.Sprintf("ST_GeomFromText('%s', %d)", safeWKT, srid),
		"sqlite":   fmt.Sprintf("GeomFromText('%s', %d)", safeWKT, srid),
	}
}

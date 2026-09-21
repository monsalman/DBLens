import {
  isSpatialColumn,
  isSpatialValue,
  isHexEWKB,
  detectSpatialFormat,
  lngLatToTile,
  tileToLngLat,
  lngLatToPixel,
  pixelToLngLat,
  calculateBoundsZoom,
  parseWKTClient,
  formatCoordinate,
  formatDistance,
  formatArea,
} from './gisHelper.ts'

declare const process: { exit: (code: number) => void }

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`)
  }
}

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err: any) {
    failed++
    console.error(`  ✗ ${name}: ${err.message}`)
  }
}

console.log('--- Running gisHelper Unit Tests ---')

// 1. Column detection
test('isSpatialColumn: detects spatial column names and types', () => {
  assert(isSpatialColumn('geom'), 'geom name')
  assert(isSpatialColumn('the_geom'), 'the_geom name')
  assert(isSpatialColumn('user_location'), 'user_location name')
  assert(isSpatialColumn('coordinates'), 'coordinates name')
  assert(isSpatialColumn('delivery_coords'), 'delivery_coords name')
  assert(isSpatialColumn('col', 'geometry'), 'geometry type')
  assert(isSpatialColumn('col', 'geography'), 'geography type')
  assert(isSpatialColumn('col', 'point'), 'point type')
  assert(isSpatialColumn('col', 'polygon'), 'polygon type')
  assert(!isSpatialColumn('title', 'varchar(255)'), 'non spatial col')
})

// 2. Value detection
test('isSpatialValue: detects WKT, EWKB hex, GeoJSON', () => {
  assert(isHexEWKB('0101000020E610000000000000000000000000000000000000'), 'isHexEWKB true')
  assert(!isHexEWKB('not_hex'), 'isHexEWKB false')
  assert(isSpatialValue('POINT(-122.4194 37.7749)'), 'wkt point')
  assert(isSpatialValue('SRID=4326;POINT(-122.4194 37.7749)'), 'ewkt point')
  assert(isSpatialValue('LINESTRING(0 0, 1 1)'), 'wkt linestring')
  assert(isSpatialValue('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))'), 'wkt polygon')
  assert(isSpatialValue('0101000020E610000000000000000000000000000000000000'), 'hex ewkb')
  assert(isSpatialValue('{"type":"Point","coordinates":[-122.4,37.7]}'), 'geojson str')
  assert(isSpatialValue({ type: 'Point', coordinates: [1, 2] }), 'geojson obj')
  assert(!isSpatialValue('hello world'), 'plain string')
  assert(!isSpatialValue(12345), 'number')
})

// 3. detectSpatialFormat
test('detectSpatialFormat: classifies spatial strings correctly', () => {
  assert(detectSpatialFormat('SRID=4326;POINT(1 2)') === 'ewkt', 'ewkt format')
  assert(detectSpatialFormat('POINT(1 2)') === 'wkt', 'wkt format')
  assert(detectSpatialFormat('{"type":"Point","coordinates":[1,2]}') === 'geojson', 'geojson format')
  assert(detectSpatialFormat('0101000020E610000000000000000000000000000000000000') === 'ewkb_hex', 'hex format')
  assert(detectSpatialFormat('not_spatial') === null, 'null for non spatial')
})

// 4. Slippy Map Math
test('lngLatToTile and tileToLngLat: round-trip tile conversions', () => {
  const zoom = 10
  const lng = -122.4194
  const lat = 37.7749

  const tile = lngLatToTile(lng, lat, zoom)
  assert(tile.x >= 0 && tile.y >= 0, 'positive tile coordinates')

  const recovered = tileToLngLat(tile.x, tile.y, zoom)
  assert(Math.abs(recovered.lng - lng) < 1.0, 'approx lng match')
  assert(Math.abs(recovered.lat - lat) < 1.0, 'approx lat match')
})

// 5. Pixel conversions
test('lngLatToPixel and pixelToLngLat: screen projection consistency', () => {
  const zoom = 12
  const centerLng = 10.0
  const centerLat = 50.0
  const width = 800
  const height = 600

  // Center point should project to screen center (width/2, height/2)
  const centerPix = lngLatToPixel(centerLng, centerLat, zoom, centerLng, centerLat, width, height)
  assert(Math.abs(centerPix.x - 400) < 1e-3, 'center x should be 400')
  assert(Math.abs(centerPix.y - 300) < 1e-3, 'center y should be 300')

  const backToCoord = pixelToLngLat(centerPix.x, centerPix.y, zoom, centerLng, centerLat, width, height)
  assert(Math.abs(backToCoord.lng - centerLng) < 1e-5, 'roundtrip center lng')
  assert(Math.abs(backToCoord.lat - centerLat) < 1e-5, 'roundtrip center lat')
})

// 6. calculateBoundsZoom
test('calculateBoundsZoom: fits bounding box within screen dimensions', () => {
  const bbox: [number, number, number, number] = [-122.5, 37.7, -122.3, 37.8]
  const res = calculateBoundsZoom(bbox, 800, 600)
  assert(res.zoom >= 1 && res.zoom <= 18, 'reasonable zoom')
  assert(Math.abs(res.center[0] - (-122.4)) < 1e-4, 'center lng match')
  assert(Math.abs(res.center[1] - 37.75) < 1e-4, 'center lat match')
})

// 7. parseWKTClient
test('parseWKTClient: client fallback parses Point and LineString', () => {
  const pt = parseWKTClient('POINT(-122.4194 37.7749)')
  assert(pt !== null, 'point should not be null')
  assert(pt?.type === 'Point', 'point type')
  assert(pt?.vertices === 1, '1 vertex')
  assert(Math.abs(pt?.coordinates[0] - (-122.4194)) < 1e-4, 'point lng')

  const ls = parseWKTClient('LINESTRING(0 0, 1 1, 2 0)')
  assert(ls !== null, 'linestring should not be null')
  assert(ls?.type === 'LineString', 'linestring type')
  assert(ls?.vertices === 3, '3 vertices')
})

// 8. Formatters
test('formatters: format coordinates, distance, area', () => {
  const coord = formatCoordinate(37.7749, -122.4194)
  assert(coord.includes('37.774900° N'), 'latitude format')
  assert(coord.includes('122.419400° W'), 'longitude format')

  const distM = formatDistance(540)
  assert(distM === '540 m', 'meters format')
  const distKm = formatDistance(3500)
  assert(distKm === '3.50 km', 'km format')

  const areaM2 = formatArea(400)
  assert(areaM2 === '400 m²', 'sq meters format')
  const areaHa = formatArea(25000)
  assert(areaHa === '2.50 ha', 'hectares format')
  const areaKm2 = formatArea(4500000)
  assert(areaKm2 === '4.50 km²', 'sq km format')
})

console.log(`--- Finished: ${passed} passed, ${failed} failed ---`)
if (failed > 0) {
  process.exit(1)
}

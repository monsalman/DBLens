export type GeometryType =
  | 'Point'
  | 'LineString'
  | 'Polygon'
  | 'MultiPoint'
  | 'MultiLineString'
  | 'MultiPolygon'
  | 'GeometryCollection'

export interface SpatialGeometry {
  type: GeometryType
  srid?: number
  coordinates?: any
  geometries?: SpatialGeometry[]
  bbox: [number, number, number, number] // [minLng, minLat, maxLng, maxLat]
  centroid: [number, number] // [lng, lat]
  vertices: number
  length: number // meters or units
  area: number // sq meters or units
  wkt: string
  ewkt?: string
}

export interface GISParseResponse {
  geometry: SpatialGeometry
  geojson: any
  sql_snippets: Record<string, string>
}

export interface GISConvertResponse {
  format: string
  converted: any
  srid: number
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECTION HEURISTICS
// ─────────────────────────────────────────────────────────────────────────────

const SPATIAL_TYPE_REGEX =
  /^(geometry|geography|point|linestring|polygon|multipoint|multilinestring|multipolygon|geomcollection|geometrycollection|sdo_geometry)/i

const SPATIAL_COLUMN_REGEX =
  /(^|_)(geom|geometry|geog|geography|shape|location|loc|coordinates|coords|coord|position|lat_lng|latlng|bbox|the_geom|poly|point|polygon|waypoints|gps)($|_)/i

const WKT_PREFIX_REGEX =
  /^\s*(SRID=\d+;)?\s*(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\b/i

export function isSpatialColumn(columnName: string, dataType?: string): boolean {
  if (dataType && SPATIAL_TYPE_REGEX.test(dataType.trim())) {
    return true
  }
  return SPATIAL_COLUMN_REGEX.test(columnName.trim())
}

export function isHexEWKB(str: string): boolean {
  let s = str.trim()
  if (s.startsWith('\\x') || s.startsWith('\\X') || s.startsWith('0x') || s.startsWith('0X')) {
    s = s.slice(2)
  }
  if (s.length < 10 || s.length % 2 !== 0) return false
  if (!/^[0-9a-fA-F]+$/.test(s)) return false

  // PostGIS EWKB little endian (01...) or big endian (00...)
  // Or MySQL internal spatial format prefix
  return (
    s.startsWith('01010000') ||
    s.startsWith('01020000') ||
    s.startsWith('01030000') ||
    s.startsWith('01040000') ||
    s.startsWith('01050000') ||
    s.startsWith('01060000') ||
    s.startsWith('01070000') ||
    s.startsWith('0000000001') ||
    s.startsWith('E610000001') || // MySQL 4326 LittleEndian
    s.length >= 42
  )
}

export function isSpatialValue(value: unknown): boolean {
  if (value === null || value === undefined) return false

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.type === 'string') {
      const t = obj.type.toLowerCase()
      return (
        t === 'point' ||
        t === 'linestring' ||
        t === 'polygon' ||
        t === 'multipoint' ||
        t === 'multilinestring' ||
        t === 'multipolygon' ||
        t === 'geometrycollection' ||
        t === 'feature' ||
        t === 'featurecollection'
      )
    }
    return false
  }

  if (typeof value !== 'string') return false
  const s = value.trim()
  if (!s) return false

  if (WKT_PREFIX_REGEX.test(s)) return true

  if (s.startsWith('{') && s.endsWith('}')) {
    try {
      const parsed = JSON.parse(s)
      return isSpatialValue(parsed)
    } catch {
      return false
    }
  }

  return isHexEWKB(s)
}

export function detectSpatialFormat(
  value: unknown
): 'wkt' | 'ewkt' | 'ewkb_hex' | 'geojson' | null {
  if (value === null || value === undefined) return null

  if (typeof value === 'object') {
    if (isSpatialValue(value)) return 'geojson'
    return null
  }

  if (typeof value !== 'string') return null
  const s = value.trim()

  if (/^\s*SRID=\d+;/i.test(s)) return 'ewkt'
  if (WKT_PREFIX_REGEX.test(s)) return 'wkt'
  if (s.startsWith('{')) return 'geojson'
  if (isHexEWKB(s)) return 'ewkb_hex'

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIPPY MAP MATH (Web Mercator EPSG:3857)
// ─────────────────────────────────────────────────────────────────────────────

const TILE_SIZE = 256

export function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max)
}

export function lngLatToTile(
  lng: number,
  lat: number,
  zoom: number
): { x: number; y: number } {
  const n = Math.pow(2, zoom)
  const clampedLat = clamp(lat, -85.05112878, 85.05112878)
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (clampedLat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  )
  return { x, y }
}

export function tileToLngLat(
  x: number,
  y: number,
  zoom: number
): { lng: number; lat: number } {
  const n = Math.pow(2, zoom)
  const lng = (x / n) * 360 - 180
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)))
  const lat = (latRad * 180) / Math.PI
  return { lng, lat }
}

export function lngLatToWorldPixel(
  lng: number,
  lat: number,
  zoom: number
): { x: number; y: number } {
  const scale = TILE_SIZE * Math.pow(2, zoom)
  const clampedLat = clamp(lat, -85.05112878, 85.05112878)
  const x = ((lng + 180) / 360) * scale
  const latRad = (clampedLat * Math.PI) / 180
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale
  return { x, y }
}

export function worldPixelToLngLat(
  px: number,
  py: number,
  zoom: number
): { lng: number; lat: number } {
  const scale = TILE_SIZE * Math.pow(2, zoom)
  const lng = (px / scale) * 360 - 180
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / scale)))
  const lat = (latRad * 180) / Math.PI
  return { lng, lat }
}

export function lngLatToPixel(
  lng: number,
  lat: number,
  zoom: number,
  centerLng: number,
  centerLat: number,
  width: number,
  height: number
): { x: number; y: number } {
  const pt = lngLatToWorldPixel(lng, lat, zoom)
  const center = lngLatToWorldPixel(centerLng, centerLat, zoom)
  return {
    x: width / 2 + (pt.x - center.x),
    y: height / 2 + (pt.y - center.y),
  }
}

export function pixelToLngLat(
  screenX: number,
  screenY: number,
  zoom: number,
  centerLng: number,
  centerLat: number,
  width: number,
  height: number
): { lng: number; lat: number } {
  const center = lngLatToWorldPixel(centerLng, centerLat, zoom)
  const worldX = center.x + (screenX - width / 2)
  const worldY = center.y + (screenY - height / 2)
  return worldPixelToLngLat(worldX, worldY, zoom)
}

export function calculateBoundsZoom(
  bbox: [number, number, number, number],
  width: number,
  height: number,
  padding = 40
): { center: [number, number]; zoom: number } {
  const [minLng, minLat, maxLng, maxLat] = bbox

  const centerLng = (minLng + maxLng) / 2
  const centerLat = (minLat + maxLat) / 2

  const dLng = Math.abs(maxLng - minLng)
  const dLat = Math.abs(maxLat - minLat)

  if (dLng < 1e-6 && dLat < 1e-6) {
    return { center: [centerLng, centerLat], zoom: 14 }
  }

  const effectiveW = Math.max(width - padding * 2, 100)
  const effectiveH = Math.max(height - padding * 2, 100)

  let zoom = 18
  for (; zoom >= 1; zoom--) {
    const pMin = lngLatToWorldPixel(minLng, minLat, zoom)
    const pMax = lngLatToWorldPixel(maxLng, maxLat, zoom)
    const spanX = Math.abs(pMax.x - pMin.x)
    const spanY = Math.abs(pMax.y - pMin.y)
    if (spanX <= effectiveW && spanY <= effectiveH) {
      break
    }
  }

  return {
    center: [centerLng, centerLat],
    zoom: Math.max(1, Math.min(18, zoom)),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT-SIDE FAST WKT PARSER (ZERO-LATENCY FALLBACK)
// ─────────────────────────────────────────────────────────────────────────────

export function parseWKTClient(wktStr: string): SpatialGeometry | null {
  const trimmed = wktStr.trim()
  if (!trimmed) return null

  let str = trimmed
  let srid = 4326

  const sridMatch = str.match(/^SRID=(\d+);/i)
  if (sridMatch) {
    srid = parseInt(sridMatch[1], 10)
    str = str.slice(sridMatch[0].length).trim()
  }

  const typeMatch = str.match(
    /^(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\b/i
  )
  if (!typeMatch) return null

  const rawType = typeMatch[1].toUpperCase()

  const parseNumPairs = (s: string): [number, number][] => {
    const pairs: [number, number][] = []
    const tokens = s.split(',')
    for (const tok of tokens) {
      const parts = tok.trim().split(/\s+/)
      if (parts.length >= 2) {
        const x = parseFloat(parts[0])
        const y = parseFloat(parts[1])
        if (!isNaN(x) && !isNaN(y)) {
          pairs.push([x, y])
        }
      }
    }
    return pairs
  }

  if (rawType === 'POINT') {
    const m = str.match(/POINT\s*\(\s*([-\d.eE+]+)\s+([-\d.eE+]+)/i)
    if (m) {
      const x = parseFloat(m[1])
      const y = parseFloat(m[2])
      return {
        type: 'Point',
        srid,
        coordinates: [x, y],
        bbox: [x, y, x, y],
        centroid: [x, y],
        vertices: 1,
        length: 0,
        area: 0,
        wkt: `POINT(${x} ${y})`,
        ewkt: `SRID=${srid};POINT(${x} ${y})`,
      }
    }
  }

  if (rawType === 'LINESTRING') {
    const m = str.match(/LINESTRING\s*\(([^()]+)\)/i)
    if (m) {
      const coords = parseNumPairs(m[1])
      if (coords.length > 0) {
        let minX = coords[0][0]
        let maxX = coords[0][0]
        let minY = coords[0][1]
        let maxY = coords[0][1]
        let sumX = 0
        let sumY = 0

        for (const [x, y] of coords) {
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)
          sumX += x
          sumY += y
        }

        return {
          type: 'LineString',
          srid,
          coordinates: coords,
          bbox: [minX, minY, maxX, maxY],
          centroid: [sumX / coords.length, sumY / coords.length],
          vertices: coords.length,
          length: 0,
          area: 0,
          wkt: `LINESTRING(${coords.map((c) => `${c[0]} ${c[1]}`).join(', ')})`,
          ewkt: `SRID=${srid};LINESTRING(${coords.map((c) => `${c[0]} ${c[1]}`).join(', ')})`,
        }
      }
    }
  }

  if (rawType === 'POLYGON') {
    const ringMatches = [...str.matchAll(/\(([^()]+)\)/g)]
    if (ringMatches.length > 0) {
      const rings: [number, number][][] = []
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      let totalVerts = 0
      let sumX = 0
      let sumY = 0

      for (const rm of ringMatches) {
        const ring = parseNumPairs(rm[1])
        if (ring.length > 0) {
          rings.push(ring)
          totalVerts += ring.length
          for (const [x, y] of ring) {
            minX = Math.min(minX, x)
            maxX = Math.max(maxX, x)
            minY = Math.min(minY, y)
            maxY = Math.max(maxY, y)
            sumX += x
            sumY += y
          }
        }
      }

      if (rings.length > 0 && totalVerts > 0) {
        return {
          type: 'Polygon',
          srid,
          coordinates: rings,
          bbox: [minX, minY, maxX, maxY],
          centroid: [sumX / totalVerts, sumY / totalVerts],
          vertices: totalVerts,
          length: 0,
          area: 0,
          wkt: `POLYGON(${rings.map((r) => `(${r.map((c) => `${c[0]} ${c[1]}`).join(', ')})`).join(', ')})`,
          ewkt: `SRID=${srid};POLYGON(${rings.map((r) => `(${r.map((c) => `${c[0]} ${c[1]}`).join(', ')})`).join(', ')})`,
        }
      }
    }
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────

export function formatCoordinate(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S'
  const lngDir = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(6)}° ${latDir}, ${Math.abs(lng).toFixed(6)}° ${lngDir}`
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`
  }
  return `${(meters / 1000).toFixed(2)} km`
}

export function formatArea(sqMeters: number): string {
  if (sqMeters < 10000) {
    return `${Math.round(sqMeters)} m²`
  }
  if (sqMeters < 1000000) {
    return `${(sqMeters / 10000).toFixed(2)} ha`
  }
  return `${(sqMeters / 1000000).toFixed(2)} km²`
}

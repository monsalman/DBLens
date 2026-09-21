import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  X,
  Globe,
  Maximize2,
  Plus,
  Minus,
  Layers,
  MapPin,
  Copy,
  Check,
  Download,
  RefreshCw,
  Navigation,
  Save,
} from 'lucide-react'
import type { SpatialGeometry } from './gisHelper.ts'
import {
  lngLatToPixel,
  pixelToLngLat,
  lngLatToTile,
  calculateBoundsZoom,
  formatCoordinate,
  formatDistance,
  formatArea,
  parseWKTClient,
} from './gisHelper.ts'
import { api } from '../../lib/api.ts'

export interface SpatialMapDrawerProps {
  isOpen: boolean
  initialValue: any
  columnName?: string
  tableName?: string
  connId?: string
  dialect?: string
  readOnly?: boolean
  onClose: () => void
  onSave?: (newValue: string) => void
}

type TabType = 'metrics' | 'geojson' | 'wkt' | 'sql'

export const SpatialMapDrawer: React.FC<SpatialMapDrawerProps> = ({
  isOpen,
  initialValue,
  columnName = 'geometry',
  tableName,
  connId = '',
  dialect = 'postgres',
  readOnly = false,
  onClose,
  onSave,
}) => {
  const [geometry, setGeometry] = useState<SpatialGeometry | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Map state
  const [center, setCenter] = useState<[number, number]>([0, 0])
  const [zoom, setZoom] = useState<number>(3)
  const [mapLayer, setMapLayer] = useState<'osm' | 'offline'>('osm')
  const [, setTileRenderTick] = useState<number>(0)
  const [pinnedCoord, setPinnedCoord] = useState<[number, number] | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('metrics')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [sqlSnippets, setSqlSnippets] = useState<Record<string, string>>({})
  const [geojsonText, setGeojsonText] = useState<string>('')

  // Coordinate manual editing
  const [inputLat, setInputLat] = useState<string>('')
  const [inputLng, setInputLng] = useState<string>('')

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const tileCache = useRef<Map<string, HTMLImageElement>>(new Map())
  const isDraggingRef = useRef(false)
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const clickStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  // Load and parse spatial data
  const loadData = useCallback(async () => {
    if (!initialValue) {
      setGeometry(null)
      setError('No spatial data to display')
      return
    }

    setLoading(true)
    setError(null)

    const rawStr =
      typeof initialValue === 'object'
        ? JSON.stringify(initialValue)
        : String(initialValue).trim()

    // Try client-side fast parse for instant view
    const clientFallback = parseWKTClient(rawStr)
    if (clientFallback) {
      setGeometry(clientFallback)
      setCenter(clientFallback.centroid)
      setGeojsonText(
        JSON.stringify(
          {
            type: 'Feature',
            geometry: {
              type: clientFallback.type,
              coordinates: clientFallback.coordinates,
            },
            properties: { srid: clientFallback.srid },
          },
          null,
          2
        )
      )
    }

    try {
      const res = await api.parseGIS(connId, rawStr)
      if (res && res.geometry) {
        setGeometry(res.geometry)
        setCenter(res.geometry.centroid)
        if (res.sql_snippets) {
          setSqlSnippets(res.sql_snippets)
        }
        if (res.geojson) {
          setGeojsonText(JSON.stringify(res.geojson, null, 2))
        }

        // Auto-fit bounds on initial load
        if (containerRef.current) {
          const w = containerRef.current.clientWidth || 600
          const h = containerRef.current.clientHeight || 450
          const { center: fitCenter, zoom: fitZoom } = calculateBoundsZoom(
            res.geometry.bbox,
            w,
            h
          )
          setCenter(fitCenter)
          setZoom(fitZoom)
        }

        if (res.geometry.type === 'Point' && Array.isArray(res.geometry.coordinates)) {
          setPinnedCoord([
            res.geometry.coordinates[0],
            res.geometry.coordinates[1],
          ])
          setInputLng(String(res.geometry.coordinates[0]))
          setInputLat(String(res.geometry.coordinates[1]))
        }
      }
    } catch (err: any) {
      // If server parse fails but client fallback worked, keep client fallback
      if (!clientFallback) {
        setError(err?.message || 'Failed to parse spatial data')
      }
    } finally {
      setLoading(false)
    }
  }, [initialValue, connId])

  useEffect(() => {
    if (isOpen) {
      loadData()
    }
  }, [isOpen, loadData])

  // Fit bounds button handler
  const handleFitBounds = useCallback(() => {
    if (!geometry || !containerRef.current) return
    const w = containerRef.current.clientWidth || 600
    const h = containerRef.current.clientHeight || 450
    const { center: fitCenter, zoom: fitZoom } = calculateBoundsZoom(
      geometry.bbox,
      w,
      h
    )
    setCenter(fitCenter)
    setZoom(fitZoom)
  }, [geometry])

  // Apply manual lat/lng coordinate edits
  const handleApplyCoordinates = () => {
    const lat = parseFloat(inputLat)
    const lng = parseFloat(inputLng)
    if (isNaN(lat) || isNaN(lng)) return

    setPinnedCoord([lng, lat])
    setCenter([lng, lat])

    if (geometry && geometry.type === 'Point') {
      const updatedWkt = `POINT(${lng} ${lat})`
      const srid = geometry.srid || 4326
      const updated: SpatialGeometry = {
        ...geometry,
        coordinates: [lng, lat],
        bbox: [lng, lat, lng, lat],
        centroid: [lng, lat],
        wkt: updatedWkt,
        ewkt: `SRID=${srid};${updatedWkt}`,
      }
      setGeometry(updated)
      setGeojsonText(
        JSON.stringify(
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: { srid },
          },
          null,
          2
        )
      )
    }
  }

  // Save changes back to cell
  const handleSave = () => {
    if (!onSave || !geometry) return
    // Default to EWKT or WKT
    const valToSave = geometry.ewkt || geometry.wkt
    onSave(valToSave)
    onClose()
  }

  // Download GeoJSON
  const handleDownloadGeoJSON = () => {
    if (!geojsonText) return
    const blob = new Blob([geojsonText], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${tableName || 'spatial'}_${columnName || 'layer'}.geojson`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CANVAS RENDERER
  // ─────────────────────────────────────────────────────────────────────────
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    ctx.clearRect(0, 0, width, height)

    // Background
    ctx.fillStyle = '#090d16'
    ctx.fillRect(0, 0, width, height)

    const curZoom = Math.round(zoom)
    const [cLng, cLat] = center

    if (mapLayer === 'osm') {
      // Slippy Map OSM Tiles
      const z = Math.max(0, Math.min(19, curZoom))
      const n = Math.pow(2, z)

      // Calculate screen corners in tile coordinates
      const pTopLeft = pixelToLngLat(0, 0, z, cLng, cLat, width, height)
      const pBottomRight = pixelToLngLat(width, height, z, cLng, cLat, width, height)

      const minT = lngLatToTile(pTopLeft.lng, pTopLeft.lat, z)
      const maxT = lngLatToTile(pBottomRight.lng, pBottomRight.lat, z)

      const startX = Math.max(0, minT.x - 1)
      const endX = Math.min(n - 1, maxT.x + 1)
      const startY = Math.max(0, minT.y - 1)
      const endY = Math.min(n - 1, maxT.y + 1)

      for (let tx = startX; tx <= endX; tx++) {
        for (let ty = startY; ty <= endY; ty++) {
          const tileKey = `${z}/${tx}/${ty}`
          const tileUrl = `https://tile.openstreetmap.org/${tileKey}.png`

          let img = tileCache.current.get(tileKey)
          if (!img) {
            img = new Image()
            img.crossOrigin = 'anonymous'
            img.src = tileUrl
            img.onload = () => {
              setTileRenderTick((t) => t + 1)
            }
            tileCache.current.set(tileKey, img)
          }

          if (img.complete && img.naturalWidth !== 0) {
            // Convert tile top-left to screen pixel
            const tileLng = (tx / n) * 360 - 180
            const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n)))
            const tileLat = (latRad * 180) / Math.PI

            const sp = lngLatToPixel(tileLng, tileLat, z, cLng, cLat, width, height)
            ctx.drawImage(img, sp.x, sp.y, 256, 256)
          }
        }
      }

      // Elegant dark tone overlay for contrast
      ctx.fillStyle = 'rgba(9, 13, 22, 0.48)'
      ctx.fillRect(0, 0, width, height)
    }

    // Draw Offline Vector Grid & Meridians
    if (mapLayer === 'offline') {
      ctx.strokeStyle = '#1e293b'
      ctx.lineWidth = 1

      // Draw latitude / longitude lines
      const step = curZoom > 8 ? 0.1 : curZoom > 4 ? 1 : 10
      for (let l = -180; l <= 180; l += step) {
        const p1 = lngLatToPixel(l, -80, curZoom, cLng, cLat, width, height)
        const p2 = lngLatToPixel(l, 80, curZoom, cLng, cLat, width, height)
        ctx.beginPath()
        ctx.moveTo(p1.x, p1.y)
        ctx.lineTo(p2.x, p2.y)
        ctx.stroke()
      }

      for (let l = -80; l <= 80; l += step) {
        const p1 = lngLatToPixel(-180, l, curZoom, cLng, cLat, width, height)
        const p2 = lngLatToPixel(180, l, curZoom, cLng, cLat, width, height)
        ctx.beginPath()
        ctx.moveTo(p1.x, p1.y)
        ctx.lineTo(p2.x, p2.y)
        ctx.stroke()
      }

      // Highlight Equator & Prime Meridian
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 1.5
      const eq1 = lngLatToPixel(-180, 0, curZoom, cLng, cLat, width, height)
      const eq2 = lngLatToPixel(180, 0, curZoom, cLng, cLat, width, height)
      ctx.beginPath()
      ctx.moveTo(eq1.x, eq1.y)
      ctx.lineTo(eq2.x, eq2.y)
      ctx.stroke()

      const pm1 = lngLatToPixel(0, -80, curZoom, cLng, cLat, width, height)
      const pm2 = lngLatToPixel(0, 80, curZoom, cLng, cLat, width, height)
      ctx.beginPath()
      ctx.moveTo(pm1.x, pm1.y)
      ctx.lineTo(pm2.x, pm2.y)
      ctx.stroke()
    }

    // Draw Geometry
    if (geometry) {
      const drawPoint = (pt: [number, number], color = '#10b981') => {
        const sp = lngLatToPixel(pt[0], pt[1], curZoom, cLng, cLat, width, height)

        // Pulsing glow halo
        ctx.beginPath()
        ctx.arc(sp.x, sp.y, 12, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(16, 185, 129, 0.25)'
        ctx.fill()

        // Point inner circle
        ctx.beginPath()
        ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.stroke()
      }

      const drawLine = (pts: [number, number][], color = '#06b6d4') => {
        if (pts.length < 2) return
        ctx.beginPath()
        for (let i = 0; i < pts.length; i++) {
          const sp = lngLatToPixel(pts[i][0], pts[i][1], curZoom, cLng, cLat, width, height)
          if (i === 0) ctx.moveTo(sp.x, sp.y)
          else ctx.lineTo(sp.x, sp.y)
        }
        ctx.strokeStyle = color
        ctx.lineWidth = 3
        ctx.stroke()

        // Vertices dots
        for (const pt of pts) {
          const sp = lngLatToPixel(pt[0], pt[1], curZoom, cLng, cLat, width, height)
          ctx.beginPath()
          ctx.arc(sp.x, sp.y, 3, 0, Math.PI * 2)
          ctx.fillStyle = '#ffffff'
          ctx.fill()
        }
      }

      const drawPolygon = (rings: [number, number][][]) => {
        if (rings.length === 0) return
        for (let r = 0; r < rings.length; r++) {
          const ring = rings[r]
          if (ring.length < 3) continue
          ctx.beginPath()
          for (let i = 0; i < ring.length; i++) {
            const sp = lngLatToPixel(ring[i][0], ring[i][1], curZoom, cLng, cLat, width, height)
            if (i === 0) ctx.moveTo(sp.x, sp.y)
            else ctx.lineTo(sp.x, sp.y)
          }
          ctx.closePath()

          // Fill only outer ring
          if (r === 0) {
            ctx.fillStyle = 'rgba(16, 185, 129, 0.2)'
            ctx.fill()
          }
          ctx.strokeStyle = '#10b981'
          ctx.lineWidth = 2.5
          ctx.stroke()

          // Vertices
          for (const pt of ring) {
            const sp = lngLatToPixel(pt[0], pt[1], curZoom, cLng, cLat, width, height)
            ctx.beginPath()
            ctx.arc(sp.x, sp.y, 2.5, 0, Math.PI * 2)
            ctx.fillStyle = '#34d399'
            ctx.fill()
          }
        }
      }

      const renderGeomNode = (g: SpatialGeometry) => {
        switch (g.type) {
          case 'Point':
            if (Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
              drawPoint([g.coordinates[0], g.coordinates[1]])
            }
            break
          case 'LineString':
            if (Array.isArray(g.coordinates)) {
              drawLine(g.coordinates)
            }
            break
          case 'Polygon':
            if (Array.isArray(g.coordinates)) {
              drawPolygon(g.coordinates)
            }
            break
          case 'MultiPoint':
            if (Array.isArray(g.coordinates)) {
              for (const pt of g.coordinates) {
                drawPoint(pt)
              }
            }
            break
          case 'MultiLineString':
            if (Array.isArray(g.coordinates)) {
              for (const line of g.coordinates) {
                drawLine(line)
              }
            }
            break
          case 'MultiPolygon':
            if (Array.isArray(g.coordinates)) {
              for (const poly of g.coordinates) {
                drawPolygon(poly)
              }
            }
            break
          case 'GeometryCollection':
            if (Array.isArray(g.geometries)) {
              for (const sub of g.geometries) {
                renderGeomNode(sub)
              }
            }
            break
        }
      }

      renderGeomNode(geometry)
    }

    // Draw Pinned Coordinate Marker (Pin Drop)
    if (pinnedCoord) {
      const sp = lngLatToPixel(pinnedCoord[0], pinnedCoord[1], curZoom, cLng, cLat, width, height)

      // Amber pin marker
      ctx.beginPath()
      ctx.arc(sp.x, sp.y - 14, 8, 0, Math.PI * 2)
      ctx.fillStyle = '#f59e0b'
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.stroke()

      // Pin needle
      ctx.beginPath()
      ctx.moveTo(sp.x, sp.y - 6)
      ctx.lineTo(sp.x, sp.y)
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = 3
      ctx.stroke()

      // Small target dot at origin
      ctx.beginPath()
      ctx.arc(sp.x, sp.y, 2, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
    }
  }, [center, zoom, mapLayer, geometry, pinnedCoord])

  useEffect(() => {
    renderCanvas()
  }, [renderCanvas])

  // Responsive canvas resize
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (canvasRef.current && width > 0 && height > 0) {
          canvasRef.current.width = width
          canvasRef.current.height = height
          renderCanvas()
        }
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [renderCanvas])

  // Mouse pan & zoom handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true
    lastMousePosRef.current = { x: e.clientX, y: e.clientY }
    clickStartPosRef.current = { x: e.clientX, y: e.clientY }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current || !canvasRef.current) return
    const dx = e.clientX - lastMousePosRef.current.x
    const dy = e.clientY - lastMousePosRef.current.y
    lastMousePosRef.current = { x: e.clientX, y: e.clientY }

    const width = canvasRef.current.width
    const height = canvasRef.current.height

    const curZoom = Math.round(zoom)
    const newCenter = pixelToLngLat(
      width / 2 - dx,
      height / 2 - dy,
      curZoom,
      center[0],
      center[1],
      width,
      height
    )
    setCenter([newCenter.lng, newCenter.lat])
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current || !canvasRef.current) return
    isDraggingRef.current = false

    // Check if it was a click (pin drop)
    const dist = Math.hypot(
      e.clientX - clickStartPosRef.current.x,
      e.clientY - clickStartPosRef.current.y
    )
    if (dist < 4) {
      const rect = canvasRef.current.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const clickY = e.clientY - rect.top

      const clicked = pixelToLngLat(
        clickX,
        clickY,
        Math.round(zoom),
        center[0],
        center[1],
        canvasRef.current.width,
        canvasRef.current.height
      )

      setPinnedCoord([clicked.lng, clicked.lat])
      setInputLng(clicked.lng.toFixed(6))
      setInputLat(clicked.lat.toFixed(6))

      if (editMode && geometry && geometry.type === 'Point') {
        const updatedWkt = `POINT(${clicked.lng.toFixed(6)} ${clicked.lat.toFixed(6)})`
        const srid = geometry.srid || 4326
        const updated: SpatialGeometry = {
          ...geometry,
          coordinates: [clicked.lng, clicked.lat],
          bbox: [clicked.lng, clicked.lat, clicked.lng, clicked.lat],
          centroid: [clicked.lng, clicked.lat],
          wkt: updatedWkt,
          ewkt: `SRID=${srid};${updatedWkt}`,
        }
        setGeometry(updated)
        setGeojsonText(
          JSON.stringify(
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [clicked.lng, clicked.lat] },
              properties: { srid },
            },
            null,
            2
          )
        )
      }
    }
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const curZoom = Math.round(zoom)
    const cursorLngLat = pixelToLngLat(
      mouseX,
      mouseY,
      curZoom,
      center[0],
      center[1],
      canvasRef.current.width,
      canvasRef.current.height
    )

    const delta = e.deltaY < 0 ? 1 : -1
    const newZoom = Math.max(1, Math.min(19, curZoom + delta))
    if (newZoom === curZoom) return

    // Re-adjust center around cursor
    const newCenter = pixelToLngLat(
      canvasRef.current.width / 2 + (mouseX - canvasRef.current.width / 2),
      canvasRef.current.height / 2 + (mouseY - canvasRef.current.height / 2),
      newZoom,
      cursorLngLat.lng,
      cursorLngLat.lat,
      canvasRef.current.width,
      canvasRef.current.height
    )

    setZoom(newZoom)
    setCenter([newCenter.lng, newCenter.lat])
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="relative flex flex-col w-full max-w-6xl h-[88vh] bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden font-sans text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[var(--bg)] border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-[var(--fg)]">
                  Spatial & PostGIS Studio
                </span>
                {geometry && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    {geometry.type}
                  </span>
                )}
                {geometry?.srid ? (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                    EPSG:{geometry.srid}
                  </span>
                ) : null}
              </div>
              <span className="text-[11px] text-[var(--muted)] font-mono">
                {tableName ? `${tableName}.${columnName}` : columnName}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!readOnly && onSave && (
              <button
                onClick={handleSave}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-sm transition-colors cursor-pointer"
                title="Save updated coordinates back to table cell"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save to Cell</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Layout: Map on left, Inspector on right */}
        <div className="flex-1 flex overflow-hidden">
          {/* Map Viewer Container */}
          <div className="relative flex-1 bg-[#090d16] overflow-hidden" ref={containerRef}>
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onWheel={handleWheel}
              className="w-full h-full cursor-grab active:cursor-grabbing block select-none"
            />

            {/* Map Controls Floating Overlay */}
            <div className="absolute top-3 left-3 flex flex-col gap-1.5 z-10">
              <button
                onClick={() => setZoom((z) => Math.min(19, Math.round(z) + 1))}
                className="p-1.5 rounded-md bg-[var(--surface)]/90 backdrop-blur border border-[var(--border)] text-[var(--fg)] hover:bg-[var(--hover)] shadow transition-colors cursor-pointer"
                title="Zoom In"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setZoom((z) => Math.max(1, Math.round(z) - 1))}
                className="p-1.5 rounded-md bg-[var(--surface)]/90 backdrop-blur border border-[var(--border)] text-[var(--fg)] hover:bg-[var(--hover)] shadow transition-colors cursor-pointer"
                title="Zoom Out"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleFitBounds}
                className="p-1.5 rounded-md bg-[var(--surface)]/90 backdrop-blur border border-[var(--border)] text-[var(--fg)] hover:bg-[var(--hover)] shadow transition-colors cursor-pointer"
                title="Fit to Bounding Box"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setMapLayer((m) => (m === 'osm' ? 'offline' : 'osm'))}
                className={`p-1.5 rounded-md border shadow transition-colors cursor-pointer ${
                  mapLayer === 'osm'
                    ? 'bg-indigo-600 text-white border-indigo-500'
                    : 'bg-[var(--surface)]/90 text-[var(--fg)] border-[var(--border)] hover:bg-[var(--hover)]'
                }`}
                title={mapLayer === 'osm' ? 'Tile Map active (click for Vector Grid)' : 'Offline Grid active (click for OSM Tiles)'}
              >
                <Layers className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setEditMode((m) => !m)}
                className={`p-1.5 rounded-md border shadow transition-colors cursor-pointer ${
                  editMode
                    ? 'bg-amber-600 text-white border-amber-500'
                    : 'bg-[var(--surface)]/90 text-[var(--fg)] border-[var(--border)] hover:bg-[var(--hover)]'
                }`}
                title={editMode ? 'Pin drop mode active' : 'Click to enable interactive pin drop'}
              >
                <MapPin className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Bottom Status Overlay */}
            <div className="absolute bottom-2 left-3 z-10 flex items-center gap-2 bg-[var(--surface)]/85 backdrop-blur px-2.5 py-1 rounded-md border border-[var(--border)] text-[11px] text-[var(--muted)] font-mono">
              <span className="flex items-center gap-1 text-[var(--fg)]">
                <Navigation className="w-3 h-3 text-indigo-400" />
                {formatCoordinate(center[1], center[0])}
              </span>
              <span>•</span>
              <span>Zoom: {Math.round(zoom)}</span>
              <span>•</span>
              <span className="text-[10px] text-[var(--muted)]">
                {mapLayer === 'osm' ? '© OpenStreetMap' : 'Offline Vector Grid'}
              </span>
            </div>

            {/* Loading / Error Banner */}
            {loading && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-xs">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow">
                  <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" />
                  <span className="text-xs text-[var(--fg)]">Parsing spatial geometry...</span>
                </div>
              </div>
            )}
            {error && (
              <div className="absolute top-3 right-3 z-20 max-w-sm px-3 py-2 rounded-md bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs">
                {error}
              </div>
            )}
          </div>

          {/* Inspector Panel */}
          <div className="w-96 flex flex-col bg-[var(--bg)] border-l border-[var(--border)] shrink-0 overflow-hidden">
            {/* Tabs */}
            <div className="flex items-center border-b border-[var(--border)] px-2 bg-[var(--surface)] shrink-0">
              <button
                onClick={() => setActiveTab('metrics')}
                className={`px-3 py-2.5 font-medium border-b-2 transition-colors cursor-pointer ${
                  activeTab === 'metrics'
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                Metrics
              </button>
              <button
                onClick={() => setActiveTab('geojson')}
                className={`px-3 py-2.5 font-medium border-b-2 transition-colors cursor-pointer ${
                  activeTab === 'geojson'
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                GeoJSON
              </button>
              <button
                onClick={() => setActiveTab('wkt')}
                className={`px-3 py-2.5 font-medium border-b-2 transition-colors cursor-pointer ${
                  activeTab === 'wkt'
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                WKT
              </button>
              <button
                onClick={() => setActiveTab('sql')}
                className={`px-3 py-2.5 font-medium border-b-2 transition-colors cursor-pointer ${
                  activeTab === 'sql'
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                SQL
              </button>
            </div>

            {/* Tab Body */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {activeTab === 'metrics' && (
                <div className="space-y-3">
                  {/* Pin-Drop & Coordinate Editor */}
                  <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-[var(--fg)] flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-amber-400" />
                        Coordinate Inspector
                      </span>
                      {pinnedCoord && (
                        <button
                          onClick={() => copyToClipboard(`${pinnedCoord[1]}, ${pinnedCoord[0]}`, 'pin')}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                        >
                          {copiedKey === 'pin' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          Copy Coords
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <label className="text-[10px] text-[var(--muted)] block mb-1">Latitude</label>
                        <input
                          type="text"
                          value={inputLat}
                          onChange={(e) => setInputLat(e.target.value)}
                          placeholder="37.7749"
                          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono text-[var(--fg)] focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-[var(--muted)] block mb-1">Longitude</label>
                        <input
                          type="text"
                          value={inputLng}
                          onChange={(e) => setInputLng(e.target.value)}
                          placeholder="-122.4194"
                          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono text-[var(--fg)] focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] text-[var(--muted)]">
                        Click on map to drop pin marker
                      </span>
                      <button
                        onClick={handleApplyCoordinates}
                        className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-[11px] transition-colors cursor-pointer"
                      >
                        Apply Coordinates
                      </button>
                    </div>
                  </div>

                  {/* Computed Metrics */}
                  {geometry ? (
                    <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-2">
                      <span className="font-semibold text-xs text-[var(--fg)] block">
                        Spatial Properties
                      </span>
                      <div className="space-y-1.5 text-[11px] font-mono">
                        <div className="flex justify-between py-0.5 border-b border-[var(--border)]/50">
                          <span className="text-[var(--muted)] font-sans">Type</span>
                          <span className="text-emerald-400 font-semibold">{geometry.type}</span>
                        </div>
                        <div className="flex justify-between py-0.5 border-b border-[var(--border)]/50">
                          <span className="text-[var(--muted)] font-sans">SRID</span>
                          <span className="text-[var(--fg)]">{geometry.srid || 4326}</span>
                        </div>
                        <div className="flex justify-between py-0.5 border-b border-[var(--border)]/50">
                          <span className="text-[var(--muted)] font-sans">Vertices</span>
                          <span className="text-[var(--fg)]">{geometry.vertices}</span>
                        </div>
                        <div className="flex justify-between py-0.5 border-b border-[var(--border)]/50">
                          <span className="text-[var(--muted)] font-sans">Centroid</span>
                          <span className="text-[var(--fg)] truncate max-w-[200px]" title={`${geometry.centroid[1]}, ${geometry.centroid[0]}`}>
                            {geometry.centroid[1].toFixed(5)}, {geometry.centroid[0].toFixed(5)}
                          </span>
                        </div>
                        <div className="flex justify-between py-0.5 border-b border-[var(--border)]/50">
                          <span className="text-[var(--muted)] font-sans">Length / Perimeter</span>
                          <span className="text-[var(--fg)]">{formatDistance(geometry.length)}</span>
                        </div>
                        <div className="flex justify-between py-0.5 border-b border-[var(--border)]/50">
                          <span className="text-[var(--muted)] font-sans">Estimated Area</span>
                          <span className="text-[var(--fg)]">{formatArea(geometry.area)}</span>
                        </div>
                        <div className="py-0.5 space-y-1">
                          <span className="text-[var(--muted)] font-sans block">Bounding Box [minX, minY, maxX, maxY]</span>
                          <div className="p-1.5 rounded bg-[var(--bg)] text-[10px] text-[var(--fg)] break-all border border-[var(--border)]">
                            [{geometry.bbox.map((n) => n.toFixed(5)).join(', ')}]
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {activeTab === 'geojson' && (
                <div className="space-y-2 h-full flex flex-col">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[var(--muted)]">GeoJSON Feature</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => copyToClipboard(geojsonText, 'geojson')}
                        className="px-2 py-1 rounded bg-[var(--surface)] hover:bg-[var(--hover)] border border-[var(--border)] text-[var(--fg)] text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        {copiedKey === 'geojson' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        Copy
                      </button>
                      <button
                        onClick={handleDownloadGeoJSON}
                        className="px-2 py-1 rounded bg-[var(--surface)] hover:bg-[var(--hover)] border border-[var(--border)] text-[var(--fg)] text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Download className="w-3 h-3" />
                        Download
                      </button>
                    </div>
                  </div>
                  <pre className="flex-1 p-2.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] font-mono text-[11px] text-[var(--fg)] overflow-auto whitespace-pre-wrap">
                    {geojsonText || 'No GeoJSON available'}
                  </pre>
                </div>
              )}

              {activeTab === 'wkt' && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-[var(--fg)]">Well-Known Text (WKT)</span>
                      <button
                        onClick={() => copyToClipboard(geometry?.wkt || '', 'wkt')}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                      >
                        {copiedKey === 'wkt' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        Copy WKT
                      </button>
                    </div>
                    <pre className="p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] font-mono text-[11px] text-[var(--fg)] overflow-auto break-all">
                      {geometry?.wkt || 'N/A'}
                    </pre>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-[var(--fg)]">Extended WKT (PostGIS EWKT)</span>
                      <button
                        onClick={() => copyToClipboard(geometry?.ewkt || '', 'ewkt')}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                      >
                        {copiedKey === 'ewkt' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        Copy EWKT
                      </button>
                    </div>
                    <pre className="p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] font-mono text-[11px] text-[var(--fg)] overflow-auto break-all">
                      {geometry?.ewkt || 'N/A'}
                    </pre>
                  </div>
                </div>
              )}

              {activeTab === 'sql' && (
                <div className="space-y-3">
                  {['postgres', 'mysql', 'sqlite'].map((d) => {
                    const isCurrent = d === dialect
                    const snip =
                      sqlSnippets[d] ||
                      (d === 'sqlite'
                        ? `GeomFromText('${geometry?.wkt}', ${geometry?.srid || 4326})`
                        : `ST_GeomFromText('${geometry?.wkt}', ${geometry?.srid || 4326})`)
                    return (
                      <div key={d} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold capitalize text-[var(--fg)] flex items-center gap-1.5">
                            {d === 'postgres' ? 'PostgreSQL / PostGIS' : d === 'mysql' ? 'MySQL' : 'SQLite / SpatiaLite'}
                            {isCurrent && (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-normal">
                                Active DB
                              </span>
                            )}
                          </span>
                          <button
                            onClick={() => copyToClipboard(snip, `sql_${d}`)}
                            className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                          >
                            {copiedKey === `sql_${d}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            Copy SQL
                          </button>
                        </div>
                        <pre className="p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] font-mono text-[11px] text-emerald-400 overflow-auto break-all">
                          {snip}
                        </pre>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

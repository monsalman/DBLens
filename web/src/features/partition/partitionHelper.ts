export interface PartitionTopology {
  parentTable: string
  schema: string
  dialect: string
  strategy: string
  partitionKey?: string
  totalRows: number
  totalBytes: number
  skewIndex: number
  partitions: PartitionNode[]
  healthReport?: PartitionHealthReport
}

export interface PartitionNode {
  name: string
  schema: string
  parentTable: string
  boundExpression: string
  partitionType: string
  rows: number
  bytes: number
  rowSharePct: number
  byteSharePct: number
  status: string // 'healthy' | 'hot_skew' | 'approaching_capacity' | 'missing_future'
  subpartitions?: PartitionNode[]
  isDetached?: boolean
  metadata?: Record<string, any>
}

export interface PartitionHealthReport {
  parentTable: string
  skewIndex: number
  hasHotSkew: boolean
  hotNodes?: string[]
  missingFuture: boolean
  futureBufferDays?: number
  warnings: string[]
  score: number // 0-100
}

export interface GeneratePartitionDDLRequest {
  parentTable: string
  schema?: string
  dialect?: string
  strategy?: string
  partitionKey?: string
  interval?: 'day' | 'month' | 'year'
  count?: number
  startDate?: string
}

export interface MaintenancePlan {
  parentTable: string
  schema?: string
  generatedDDL: string[]
  detachDDL?: string[]
  recommendation: string
}

export interface DetachPartitionRequest {
  parentTable: string
  schema?: string
  partitionName: string
  concurrently?: boolean
}

export interface TreemapRect {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  value: number
  percentage: number
  node: PartitionNode
}

export function formatBytes(b: number): string {
  if (!b || b <= 0) return '0 B'
  const unit = 1024
  if (b < unit) return `${b} B`
  const exp = Math.floor(Math.log(b) / Math.log(unit))
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  const val = b / Math.pow(unit, exp)
  return `${val.toFixed(1)} ${units[exp - 1] || 'B'}`
}

export function formatRows(r: number): string {
  if (r === undefined || r === null) return '0'
  return Number(r).toLocaleString()
}

export function formatShare(pct: number): string {
  if (!pct || pct <= 0) return '0%'
  return `${pct.toFixed(1)}%`
}

export function getSkewBadge(skewIndex: number): {
  label: string
  badgeClass: string
  description: string
} {
  if (skewIndex < 0.5) {
    return {
      label: 'Balanced',
      badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      description: 'Storage is evenly distributed across partitions (CV < 0.5)',
    }
  }
  if (skewIndex < 1.2) {
    return {
      label: 'Moderate Skew',
      badgeClass: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      description: 'Acceptable storage variance across partitions (0.5 <= CV < 1.2)',
    }
  }
  if (skewIndex < 2.0) {
    return {
      label: 'High Skew',
      badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      description: 'Significant partition size imbalance (1.2 <= CV < 2.0)',
    }
  }
  return {
    label: 'Severe Skew',
    badgeClass: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    description: 'Extreme storage concentration in one or few partitions (CV >= 2.0)',
  }
}

export function getStatusBadge(status: string): {
  label: string
  badgeClass: string
  bgFill: string
} {
  switch (status) {
    case 'hot_skew':
      return {
        label: 'HOT SKEW',
        badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
        bgFill: '#ef4444',
      }
    case 'approaching_capacity':
      return {
        label: 'CAPACITY WARN',
        badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
        bgFill: '#f59e0b',
      }
    case 'missing_future':
      return {
        label: 'HEADROOM LOW',
        badgeClass: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
        bgFill: '#eab308',
      }
    case 'healthy':
    default:
      return {
        label: 'HEALTHY',
        badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
        bgFill: '#10b981',
      }
  }
}

export function getHealthScoreColor(score: number): {
  textClass: string
  borderClass: string
  bgClass: string
} {
  if (score >= 80) {
    return {
      textClass: 'text-emerald-400',
      borderClass: 'border-emerald-500/30',
      bgClass: 'bg-emerald-500/10',
    }
  }
  if (score >= 50) {
    return {
      textClass: 'text-amber-400',
      borderClass: 'border-amber-500/30',
      bgClass: 'bg-amber-500/10',
    }
  }
  return {
    textClass: 'text-rose-400',
    borderClass: 'border-rose-500/30',
    bgClass: 'bg-rose-500/10',
  }
}

/**
 * Computes native treemap rectangle coordinates for partition nodes
 * sized by bytes or rows using squarified recursive subdivision.
 */
export function computeTreemapLayout(
  nodes: PartitionNode[],
  width: number,
  height: number,
  metric: 'bytes' | 'rows' = 'bytes'
): TreemapRect[] {
  if (!nodes || nodes.length === 0 || width <= 0 || height <= 0) {
    return []
  }

  // Calculate values with fallback for zero values to ensure visibility
  const rawValues = nodes.map((n) => (metric === 'bytes' ? n.bytes : n.rows))
  const rawSum = rawValues.reduce((a, b) => a + (b > 0 ? b : 0), 0)

  // Items to layout
  interface LayoutItem {
    node: PartitionNode
    weight: number
    percentage: number
  }

  const items: LayoutItem[] = nodes.map((node, i) => {
    const raw = rawValues[i]
    const pct = rawSum > 0 ? (raw / rawSum) * 100 : 100 / nodes.length
    // Minimum 1% weight for rendering
    const weight = Math.max(raw > 0 ? raw : rawSum * 0.01 || 1, 1)
    return {
      node,
      weight,
      percentage: pct,
    }
  })

  // Sort descending by weight
  items.sort((a, b) => b.weight - a.weight)

  const totalWeight = items.reduce((acc, it) => acc + it.weight, 0)
  const rects: TreemapRect[] = []

  function squarify(
    remaining: LayoutItem[],
    currentRow: LayoutItem[],
    x: number,
    y: number,
    w: number,
    h: number
  ) {
    if (remaining.length === 0) {
      if (currentRow.length > 0) {
        layoutRow(currentRow, x, y, w, h)
      }
      return
    }

    const item = remaining[0]
    const nextRow = [...currentRow, item]

    if (currentRow.length === 0 || worst(currentRow, w, h) >= worst(nextRow, w, h)) {
      squarify(remaining.slice(1), nextRow, x, y, w, h)
    } else {
      const { newX, newY, newW, newH } = layoutRow(currentRow, x, y, w, h)
      squarify(remaining, [], newX, newY, newW, newH)
    }
  }

  function worst(row: LayoutItem[], w: number, h: number): number {
    const rowWeight = row.reduce((acc, it) => acc + it.weight, 0)
    const rowArea = (rowWeight / totalWeight) * (width * height)
    const side = Math.min(w, h)
    if (side <= 0 || rowArea <= 0) return 1000000

    let maxAspect = 0
    for (const it of row) {
      const itemArea = (it.weight / totalWeight) * (width * height)
      const itemLength = itemArea / (rowArea / side)
      const rowBreadth = rowArea / side
      const aspect = Math.max(itemLength / rowBreadth, rowBreadth / itemLength)
      if (aspect > maxAspect) maxAspect = aspect
    }
    return maxAspect
  }

  function layoutRow(
    row: LayoutItem[],
    rx: number,
    ry: number,
    rw: number,
    rh: number
  ): { newX: number; newY: number; newW: number; newH: number } {
    const rowWeight = row.reduce((acc, it) => acc + it.weight, 0)
    const rowArea = (rowWeight / totalWeight) * (width * height)

    if (rw >= rh) {
      // Divide vertically
      const rowWidth = rh > 0 ? rowArea / rh : 0
      let currentY = ry
      for (const it of row) {
        const itemArea = (it.weight / totalWeight) * (width * height)
        const itemHeight = rowWidth > 0 ? itemArea / rowWidth : 0
        rects.push({
          id: it.node.name,
          name: it.node.name,
          x: Math.round(rx * 10) / 10,
          y: Math.round(currentY * 10) / 10,
          width: Math.max(Math.round(rowWidth * 10) / 10, 1),
          height: Math.max(Math.round(itemHeight * 10) / 10, 1),
          value: metric === 'bytes' ? it.node.bytes : it.node.rows,
          percentage: it.percentage,
          node: it.node,
        })
        currentY += itemHeight
      }
      return {
        newX: rx + rowWidth,
        newY: ry,
        newW: Math.max(rw - rowWidth, 0),
        newH: rh,
      }
    } else {
      // Divide horizontally
      const rowHeight = rw > 0 ? rowArea / rw : 0
      let currentX = rx
      for (const it of row) {
        const itemArea = (it.weight / totalWeight) * (width * height)
        const itemWidth = rowHeight > 0 ? itemArea / rowHeight : 0
        rects.push({
          id: it.node.name,
          name: it.node.name,
          x: Math.round(currentX * 10) / 10,
          y: Math.round(ry * 10) / 10,
          width: Math.max(Math.round(itemWidth * 10) / 10, 1),
          height: Math.max(Math.round(rowHeight * 10) / 10, 1),
          value: metric === 'bytes' ? it.node.bytes : it.node.rows,
          percentage: it.percentage,
          node: it.node,
        })
        currentX += itemWidth
      }
      return {
        newX: rx,
        newY: ry + rowHeight,
        newW: rw,
        newH: Math.max(rh - rowHeight, 0),
      }
    }
  }

  squarify(items, [], 0, 0, width, height)
  return rects
}

/**
 * Builds upcoming partition DDL on client side.
 */
export function buildUpcomingPartitionDDL(req: GeneratePartitionDDLRequest): string[] {
  const parent = req.parentTable.trim()
  if (!parent) return []

  const count = Math.min(Math.max(req.count || 3, 1), 60)
  const interval = req.interval || 'month'
  const dialect = (req.dialect || 'postgres').toLowerCase()
  const schema = (req.schema || '').trim()

  const ddlList: string[] = []
  let cur = req.startDate ? new Date(req.startDate) : new Date()
  if (isNaN(cur.getTime())) {
    cur = new Date()
  }

  // Adjust to start of next interval if no explicit startDate
  if (!req.startDate) {
    if (interval === 'month') {
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1))
    } else if (interval === 'year') {
      cur = new Date(Date.UTC(cur.getUTCFullYear() + 1, 0, 1))
    } else {
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate() + 1))
    }
  }

  const schemaPrefix = schema && dialect === 'postgres' ? `"${schema}".` : ''

  for (let i = 0; i < count; i++) {
    let next: Date
    let suffix: string
    let startStr: string
    let endStr: string

    if (interval === 'day') {
      next = new Date(cur.getTime() + 86400000)
      suffix = cur.toISOString().slice(0, 10).replace(/-/g, '_')
      startStr = cur.toISOString().slice(0, 10)
      endStr = next.toISOString().slice(0, 10)
    } else if (interval === 'year') {
      next = new Date(Date.UTC(cur.getUTCFullYear() + 1, 0, 1))
      suffix = `${cur.getUTCFullYear()}`
      startStr = `${cur.getUTCFullYear()}-01-01`
      endStr = `${next.getUTCFullYear()}-01-01`
    } else {
      next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1))
      const m = String(cur.getUTCMonth() + 1).padStart(2, '0')
      suffix = `${cur.getUTCFullYear()}_${m}`
      startStr = `${cur.getUTCFullYear()}-${m}-01`
      const nextM = String(next.getUTCMonth() + 1).padStart(2, '0')
      endStr = `${next.getUTCFullYear()}-${nextM}-01`
    }

    const partName = `${parent}_${suffix}`

    if (dialect === 'mysql' || dialect === 'mariadb') {
      const mysqlPartName = `p${suffix.replace(/_/g, '')}`
      ddlList.push(
        `ALTER TABLE \`${parent}\` ADD PARTITION (PARTITION \`${mysqlPartName}\` VALUES LESS THAN ('${endStr}'));`
      )
    } else if (dialect === 'sqlite' || dialect === 'sqlite3') {
      ddlList.push(
        `CREATE TABLE IF NOT EXISTS ${schemaPrefix}${partName} AS SELECT * FROM ${schemaPrefix}${parent} WHERE 0;`
      )
    } else {
      ddlList.push(
        `CREATE TABLE IF NOT EXISTS ${schemaPrefix}${partName} PARTITION OF ${schemaPrefix}${parent} FOR VALUES FROM ('${startStr}') TO ('${endStr}');`
      )
    }

    cur = next
  }

  return ddlList
}

/**
 * Builds detach DDL statement.
 */
export function buildDetachDDL(req: DetachPartitionRequest, dialect: string): string {
  const parent = req.parentTable.trim()
  const part = req.partitionName.trim()
  const schema = (req.schema || '').trim()
  const d = (dialect || 'postgres').toLowerCase()

  const escapePg = (s: string) => `"${s.replace(/"/g, '""')}"`
  const escapeMy = (s: string) => `\`${s.replace(/`/g, '``')}\``

  if (d === 'mysql' || d === 'mariadb') {
    return `ALTER TABLE ${escapeMy(parent)} DROP PARTITION ${escapeMy(part)};`
  }
  if (d === 'sqlite' || d === 'sqlite3') {
    return `DROP TABLE IF EXISTS ${escapeMy(part)};`
  }

  const parentRef = schema ? `${escapePg(schema)}.${escapePg(parent)}` : escapePg(parent)
  const partRef = schema ? `${escapePg(schema)}.${escapePg(part)}` : escapePg(part)
  if (req.concurrently) {
    return `ALTER TABLE ${parentRef} DETACH PARTITION ${partRef} CONCURRENTLY;`
  }
  return `ALTER TABLE ${parentRef} DETACH PARTITION ${partRef};`
}

// Banded layout around the active thought, no physics:
//   parents row above, children grid below, jumps column left, siblings column right.
// Cards are content-sized (tight reflow): each carries its own width `w`, rows pack
// by actual width + a gap, and columns anchor their inner edge a constant gap from
// the focus so wider cards grow OUTWARD. With a uniform `w = NODE.W` this reproduces
// the original fixed-slot coordinates exactly. All coordinates are "world" units with
// the active thought at (0, 0).

import type { Graph } from '../types'

export interface LayoutNode {
  name: string
  x: number
  y: number
  w: number
  zone: string
  via?: string
}

export interface LayoutBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface LayoutResult {
  focus: string
  nodes: LayoutNode[]
  bbox: LayoutBox
}

// computeLayout reads only these fields off a Graph; the arrays default to [] when
// absent, so they're optional here (siblingsTruncated is unused by the layout).
export type LayoutGraph = Pick<Graph, 'focus'> &
  Partial<Pick<Graph, 'parents' | 'children' | 'jumps' | 'siblings' | 'siblingParent'>>

export const NODE = { W: 208, H: 40 }

const BAND_Y = 210 // vertical distance to the parent/child rows (space BETWEEN groups)
const BAND_X = 360 // horizontal distance to the jump/sibling columns (space BETWEEN groups)
const ROW_GAP = 16 // horizontal gap between cards in a row (space WITHIN a group)
const COL_STEP = 54 // center-to-center vertical step in a column (cards are fixed-height)
const CHILD_GAP = 92 // inner gap between the two children columns (> ROW_GAP for a clear split)

// Per-card width by name (case-insensitive); falls back to NODE.W when unmeasured.
type Widths = Record<string, number> | undefined
function widthOf(widths: Widths, name: string): number {
  const w = widths?.[name.toLowerCase()]
  return typeof w === 'number' && w > 0 ? w : NODE.W
}

// A row packed left→right by actual width + ROW_GAP, centered so its midpoint is x=0.
function rowPositions(names: string[], y: number, widths: Widths) {
  const ws = names.map((n) => widthOf(widths, n))
  const total = ws.reduce((a, b) => a + b, 0) + ROW_GAP * Math.max(0, names.length - 1)
  let cursor = -total / 2
  return names.map((name, i) => {
    const w = ws[i]
    const x = cursor + w / 2
    cursor += w + ROW_GAP
    return { name, x, y, w }
  })
}

// A vertical column whose INNER edge sits a constant gap (BAND_X) from the focus, so
// wider cards grow outward. sign = -1 (jumps, left) or +1 (siblings, right).
function colPositions(names: string[], sign: number, widths: Widths) {
  const n = names.length
  return names.map((name, i) => {
    const w = widthOf(widths, name)
    const x = sign * (BAND_X + (w - NODE.W) / 2)
    const y = (i - (n - 1) / 2) * COL_STEP
    return { name, x, y, w }
  })
}

// Children fill two columns row-major; each column is centered on its own center,
// sized to its widest card, with the pair centered on x=0 and rows stacking downward.
function childPositions(names: string[], y0: number, widths: Widths) {
  const cols: string[][] = [[], []]
  names.forEach((name, i) => cols[i % 2].push(name))
  const colWidth = (c: string[]) => (c.length ? Math.max(...c.map((n) => widthOf(widths, n))) : NODE.W)
  const leftCenter = -(CHILD_GAP / 2 + colWidth(cols[0]) / 2)
  const rightCenter = CHILD_GAP / 2 + colWidth(cols[1]) / 2
  return names.map((name, i) => {
    const x = i % 2 === 0 ? leftCenter : rightCenter
    const y = y0 + Math.floor(i / 2) * COL_STEP
    return { name, x, y, w: widthOf(widths, name) }
  })
}

export function computeLayout(graph: LayoutGraph, widths?: Record<string, number>): LayoutResult {
  const raw: LayoutNode[] = [{ name: graph.focus, x: 0, y: 0, w: widthOf(widths, graph.focus), zone: 'focus' }]
  for (const p of rowPositions(graph.parents || [], -BAND_Y, widths)) raw.push({ ...p, zone: 'parent' })
  for (const c of childPositions(graph.children || [], BAND_Y, widths)) raw.push({ ...c, zone: 'child' })
  for (const j of colPositions(graph.jumps || [], -1, widths)) raw.push({ ...j, zone: 'jump' })
  const siblingParent = graph.siblingParent || {}
  for (const s of colPositions(graph.siblings || [], 1, widths)) {
    raw.push({ ...s, zone: 'sibling', via: siblingParent[s.name] })
  }

  // A name should appear once; keep the highest-priority zone (order above).
  const seen = new Set<string>()
  const nodes: LayoutNode[] = []
  for (const nd of raw) {
    const k = nd.name.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    nodes.push(nd)
  }

  return { focus: graph.focus, nodes, bbox: computeBBox(nodes) }
}

function computeBBox(nodes: LayoutNode[]): LayoutBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.w / 2)
    maxX = Math.max(maxX, n.x + n.w / 2)
    minY = Math.min(minY, n.y - NODE.H / 2)
    maxY = Math.max(maxY, n.y + NODE.H / 2)
  }
  if (!isFinite(minX)) return { minX: -NODE.W / 2, minY: -NODE.H / 2, maxX: NODE.W / 2, maxY: NODE.H / 2 }
  return { minX, minY, maxX, maxY }
}

// Banded layout around the active thought, no physics:
//   parents row above, children grid below, jumps column left, siblings column right.
// Cards are content-sized (tight reflow): each carries its own width `w`, rows pack
// by actual width + a gap, and columns anchor their inner edge a constant gap from
// the focus so wider cards grow OUTWARD. With a uniform `w = NODE.W` this reproduces
// the original fixed-slot coordinates exactly. All coordinates are "world" units with
// the active thought at (0, 0).
//
// There is NO camera scale anymore (zoom was removed): the view renders cards at true
// px and only translates the world to center the active thought. Pass `opts.viewport`
// (+ the current `cardH` from the size level): the HORIZONTAL band distances fill the
// panel width (columns hug the edges, clamped), while the VERTICAL layout is DENSE —
// fixed gaps that grow OUTWARD from the centre (within-group V_GAP; the middle band sits
// SECTION_GAP from parents/children), independent of panel height. Omit `opts.viewport`
// → fixed fallback constants (identity pass + pure unit tests).

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

export const NODE = { W: 208, H: 28 } // base card size at size level 1.0 (H tuned for 1rem text)

// Fixed fallback spacing — today's constants, used when no viewport is supplied (the
// identity pass + pure unit tests). With a viewport these are replaced by the
// responsive `Spacing` below.
const DEF_BAND_Y = 240 // vertical distance to the parent/child rows (space BETWEEN groups)
const DEF_BAND_X = 380 // horizontal distance to the jump/sibling columns (space BETWEEN groups)
const DEF_STEP = 80 // center-to-center vertical step in a column (fallback)
const DEF_CHILD_GAP = 120 // inner gap between the two children columns (> ROW_GAP for a clear split)
const ROW_GAP = 40 // horizontal gap between cards in a row (space WITHIN a group)

// Responsive bounds (tunable). The four directional zones are kept in separate vertical
// BANDS — parents top, jumps/siblings middle (centred on the focus), children bottom — so
// they are Y-separated and can never overlap, however wide the cards get.
const PAD_X = 24 // screen-px kept between a column's outer edge and the panel edge
const GAP = 48 // minimum horizontal clearance between the focus/parents and the side columns
const MAX_BAND_X = 620 // cap so columns don't fly apart on a wide monitor
const V_GAP = 12 // FIXED vertical gap between cards stacked WITHIN a group (columns, child rows)
const SECTION_GAP = 48 // FIXED vertical gap between the middle (jumps/siblings) band and parents/children
const MIN_CHILD_GAP = 80 // the two children columns stay at least this far apart...
const MAX_CHILD_GAP = 240 // ...and spread up to this far on a roomy panel

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export interface LayoutOpts {
  viewport?: { w: number; h: number }
  cardH?: number // live card height (size-level derived); defaults to NODE.H
}

// Per-card width by name (case-insensitive); falls back to NODE.W when unmeasured.
type Widths = Record<string, number> | undefined
function widthOf(widths: Widths, name: string): number {
  const w = widths?.[name.toLowerCase()]
  return typeof w === 'number' && w > 0 ? w : NODE.W
}

interface Spacing {
  bandYTop: number // parents row, above the focus
  bandYBottom: number // first children row, below the focus
  bandXLeft: number // jumps column (left)
  bandXRight: number // siblings column (right)
  colStep: number // vertical step within the jump/sibling columns
  childStep: number // vertical step between children rows
  childGap: number // horizontal gap between the two children columns
}

// Derive the zone bands from the live panel size. The four directional zones live in
// separate vertical bands — parents TOP, jumps/siblings MIDDLE (centred on the focus),
// children BOTTOM — so they are Y-separated and can't collide; this also lets the children
// grid spread as wide as it likes without pushing the side columns off-screen. Columns hug
// the L/R edges (clamped: MAX so they don't fly apart, a focus/parent-aware MIN so they
// clear the centre); their vertical span is bounded to the middle band so they don't reach
// the parent row or the child grid. Omit the viewport → fixed fallback (identity pass + tests).
function computeSpacing(graph: LayoutGraph, widths: Widths, opts?: LayoutOpts): Spacing {
  const cardH = opts?.cardH ?? NODE.H
  const vp = opts?.viewport
  if (!vp)
    return {
      bandYTop: DEF_BAND_Y,
      bandYBottom: DEF_BAND_Y,
      bandXLeft: DEF_BAND_X,
      bandXRight: DEF_BAND_X,
      colStep: DEF_STEP,
      childStep: DEF_STEP,
      childGap: DEF_CHILD_GAP,
    }

  const colW = (names: string[] | undefined) =>
    names && names.length ? Math.max(...names.map((n) => widthOf(widths, n))) : NODE.W
  const focusHalf = widthOf(widths, graph.focus) / 2
  const parents = graph.parents || []
  const parentRowHalf = parents.length
    ? (parents.reduce((a, n) => a + widthOf(widths, n), 0) + ROW_GAP * (parents.length - 1)) / 2
    : 0

  // Horizontal: columns hug the edge, clamped. MIN only has to clear the focus + parent row
  // (NOT the children — they're in the bottom band, Y-separated from the columns).
  const minBandX = NODE.W / 2 + GAP + Math.max(focusHalf, parentRowHalf)
  const bandXFor = (names: string[] | undefined) =>
    clamp(vp.w / 2 - PAD_X - colW(names) + NODE.W / 2, minBandX, MAX_BAND_X)

  // WITHIN a group the vertical gap between stacked cards is FIXED at V_GAP.
  const colStep = cardH + V_GAP
  const childStep = cardH + V_GAP

  // DENSE vertical layout that grows OUTWARD from the centre. The jumps/siblings columns sit
  // centred on the focus; the parent row (above) and the children grid (below) sit a fixed
  // SECTION_GAP clear of that middle block. Panel height no longer spreads the layout — it
  // only decides whether everything fits (else pan).
  const colSlots = Math.max(graph.jumps?.length || 0, graph.siblings?.length || 0)
  const colHalf = colSlots > 1 ? ((colSlots - 1) / 2) * colStep : 0 // half-height of the tallest middle column
  const bandY = colHalf + cardH + SECTION_GAP // centre-to-centre: focus → parent row / first child row
  const bandYTop = bandY
  const bandYBottom = bandY

  const childGap = clamp(vp.w * 0.16, MIN_CHILD_GAP, MAX_CHILD_GAP)

  return {
    bandYTop,
    bandYBottom,
    bandXLeft: bandXFor(graph.jumps),
    bandXRight: bandXFor(graph.siblings),
    colStep,
    childStep,
    childGap,
  }
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

// A vertical column whose INNER edge sits a constant gap (bandX) from the focus, so
// wider cards grow outward. sign = -1 (jumps, left) or +1 (siblings, right).
function colPositions(names: string[], sign: number, widths: Widths, bandX: number, step: number) {
  const n = names.length
  return names.map((name, i) => {
    const w = widthOf(widths, name)
    const x = sign * (bandX + (w - NODE.W) / 2)
    const y = (i - (n - 1) / 2) * step
    return { name, x, y, w }
  })
}

// Children fill two columns row-major; each column is centered on its own center,
// sized to its widest card, with the pair centered on x=0 (split by `childGap`) and rows
// stacking downward.
function childPositions(names: string[], y0: number, widths: Widths, step: number, childGap: number) {
  const cols: string[][] = [[], []]
  names.forEach((name, i) => cols[i % 2].push(name))
  const colWidth = (c: string[]) => (c.length ? Math.max(...c.map((n) => widthOf(widths, n))) : NODE.W)
  const leftCenter = -(childGap / 2 + colWidth(cols[0]) / 2)
  const rightCenter = childGap / 2 + colWidth(cols[1]) / 2
  return names.map((name, i) => {
    const x = i % 2 === 0 ? leftCenter : rightCenter
    const y = y0 + Math.floor(i / 2) * step
    return { name, x, y, w: widthOf(widths, name) }
  })
}

export function computeLayout(graph: LayoutGraph, widths?: Record<string, number>, opts?: LayoutOpts): LayoutResult {
  const sp = computeSpacing(graph, widths, opts)
  const cardH = opts?.cardH ?? NODE.H
  const raw: LayoutNode[] = [{ name: graph.focus, x: 0, y: 0, w: widthOf(widths, graph.focus), zone: 'focus' }]
  for (const p of rowPositions(graph.parents || [], -sp.bandYTop, widths)) raw.push({ ...p, zone: 'parent' })
  for (const c of childPositions(graph.children || [], sp.bandYBottom, widths, sp.childStep, sp.childGap)) {
    raw.push({ ...c, zone: 'child' })
  }
  for (const j of colPositions(graph.jumps || [], -1, widths, sp.bandXLeft, sp.colStep)) raw.push({ ...j, zone: 'jump' })
  const siblingParent = graph.siblingParent || {}
  for (const s of colPositions(graph.siblings || [], 1, widths, sp.bandXRight, sp.colStep)) {
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

  return { focus: graph.focus, nodes, bbox: computeBBox(nodes, cardH) }
}

function computeBBox(nodes: LayoutNode[], cardH: number): LayoutBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.w / 2)
    maxX = Math.max(maxX, n.x + n.w / 2)
    minY = Math.min(minY, n.y - cardH / 2)
    maxY = Math.max(maxY, n.y + cardH / 2)
  }
  if (!isFinite(minX)) return { minX: -NODE.W / 2, minY: -cardH / 2, maxX: NODE.W / 2, maxY: cardH / 2 }
  return { minX, minY, maxX, maxY }
}

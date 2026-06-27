import { NODE } from './layout'
import type { Adjacency } from '../types'

export interface Point {
  x: number
  y: number
}

// The link a removable edge would strip ({from, to, role}).
export interface EdgeRemove {
  from: string
  to: string
  role: string
}

export interface Edge {
  a: Point
  b: Point
  neighbor: string
  role: string
  zone: string
  via: boolean
  remove: EdgeRemove | null
}

// computeEdges reads only nodes (with their zone/coords/optional via) off a layout.
export interface EdgeLayoutNode {
  name: string
  zone: string
  x: number
  y: number
  via?: string
}
export interface EdgeLayout {
  nodes: EdgeLayoutNode[]
}

// Which gate of the active thought connects to which gate of the linked card, per zone.
const GATES: Record<string, { focus: string; node: string }> = {
  parent: { focus: 'top', node: 'bottom' },
  child: { focus: 'bottom', node: 'top' },
  jump: { focus: 'left', node: 'right' },
  sibling: { focus: 'right', node: 'left' },
}

export function gatePoint(node: Point, side: string): Point {
  const hw = NODE.W / 2
  const hh = NODE.H / 2
  switch (side) {
    case 'top':
      return { x: node.x, y: node.y - hh }
    case 'bottom':
      return { x: node.x, y: node.y + hh }
    case 'left':
      return { x: node.x - hw, y: node.y }
    case 'right':
      return { x: node.x + hw, y: node.y }
    default:
      return { x: node.x, y: node.y }
  }
}

// Stable, case-insensitive identity for an edge (its `role` + `neighbor` name) — used to
// match the hovered edge across re-computed edge lists for the hover highlight.
export function edgeKey(e: { role: string; neighbor?: string | null } | null | undefined): string | null {
  return e ? e.role + ':' + String(e.neighbor || '').toLowerCase() : null
}

// Pure: turn a (live) layout into a retained list of edges with world-space
// endpoints + metadata, so the same list can be drawn AND hit-tested. Each
// removable edge carries a `remove` descriptor {from, to, role} naming the
// link to strip — for siblings that's the (shared parent → sibling)
// child link, not an active-thought↔sibling link (which is only computed).
export function computeEdges(layout: EdgeLayout | null | undefined): Edge[] {
  if (!layout) return []
  const focus = layout.nodes.find((n) => n.zone === 'focus')
  if (!focus) return []
  const edges: Edge[] = []
  for (const n of layout.nodes) {
    if (n.zone === 'focus') continue

    // Siblings connect to their shared PARENT, not the active thought.
    if (n.zone === 'sibling') {
      const parentName = n.via ? String(n.via) : null
      const via =
        parentName &&
        layout.nodes.find(
          (m) => m.zone === 'parent' && m.name.toLowerCase() === parentName.toLowerCase(),
        )
      // Removable iff we know the shared parent: unlink the sibling FROM it.
      const remove: EdgeRemove | null = parentName ? { from: parentName, to: n.name, role: 'child' } : null
      if (via) {
        edges.push({ a: gatePoint(via, 'bottom'), b: gatePoint(n, 'top'), neighbor: n.name, role: 'sibling', zone: 'child', via: true, remove })
      } else {
        edges.push({ a: gatePoint(focus, 'right'), b: gatePoint(n, 'left'), neighbor: n.name, role: 'sibling', zone: 'sibling', via: false, remove })
      }
      continue
    }

    const g = GATES[n.zone]
    if (!g) continue
    edges.push({ a: gatePoint(focus, g.focus), b: gatePoint(n, g.node), neighbor: n.name, role: n.zone, zone: n.zone, via: false, remove: { from: focus.name, to: n.name, role: n.zone } })
  }
  return edges
}

// Unordered, case-insensitive identity for a pair of card names.
function pairKey(a: string, b: string): string {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x < y ? x + '|' + y : y + '|' + x
}

// One display-only connector between two non-active cards. Gate sides follow the
// dominant axis between the card centres so the curve looks natural between
// arbitrary positions; `zone` is the curve-orientation tag `curve()` understands
// ('jump' = horizontal S, 'child' = vertical S), `role` only drives the colour.
function secondaryEdge(a: EdgeLayoutNode, b: EdgeLayoutNode, jump: boolean): Edge {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let aSide: string
  let bSide: string
  let zone: string
  if (Math.abs(dx) >= Math.abs(dy)) {
    zone = 'jump' // horizontal S-curve
    aSide = dx >= 0 ? 'right' : 'left'
    bSide = dx >= 0 ? 'left' : 'right'
  } else {
    zone = 'child' // vertical S-curve
    aSide = dy >= 0 ? 'bottom' : 'top'
    bSide = dy >= 0 ? 'top' : 'bottom'
  }
  return {
    a: gatePoint(a, aSide),
    b: gatePoint(b, bSide),
    neighbor: b.name,
    role: jump ? 'jump' : 'child',
    zone,
    via: false,
    remove: null,
  }
}

// Pure: connectors for declared parent/child/jump links BETWEEN two visible cards
// that don't touch the active thought ("secondary" links). Deduped against the
// primary edges — so the focus↔neighbour edges and the sibling→shared-parent
// connector are never redrawn — and against the reverse direction. These are
// display-only (`remove: null`); the caller draws them faded and does not hit-test
// them. Excludes any pair involving the active thought (already drawn as primary).
export function computeSecondaryEdges(
  layout: EdgeLayout | null | undefined,
  adjacency: Adjacency | null | undefined,
  primaryEdges: Edge[] | null | undefined,
): Edge[] {
  if (!layout || !adjacency) return []
  const focus = layout.nodes.find((n) => n.zone === 'focus')
  const byName = new Map<string, EdgeLayoutNode>()
  for (const n of layout.nodes) byName.set(n.name.toLowerCase(), n)

  // Pairs already drawn by the primary edges: a removable edge names both ends in
  // its `remove` descriptor (covers the sibling-via parent→sibling pair); the rest
  // are focus↔neighbour.
  const drawn = new Set<string>()
  for (const e of primaryEdges || []) {
    if (e.remove) drawn.add(pairKey(e.remove.from, e.remove.to))
    else if (focus) drawn.add(pairKey(focus.name, e.neighbor))
  }

  const out: Edge[] = []
  const seen = new Set<string>()
  for (const a of layout.nodes) {
    if (a.zone === 'focus') continue
    const adj = adjacency[a.name.toLowerCase()]
    if (!adj) continue
    const links: Array<{ to: string; jump: boolean }> = [
      ...adj.parents.map((t) => ({ to: t, jump: false })),
      ...adj.children.map((t) => ({ to: t, jump: false })),
      ...adj.jumps.map((t) => ({ to: t, jump: true })),
    ]
    for (const { to, jump } of links) {
      const b = byName.get(to.toLowerCase())
      if (!b || b.zone === 'focus') continue // both ends must be visible non-active cards
      const key = pairKey(a.name, to)
      if (drawn.has(key) || seen.has(key)) continue
      seen.add(key)
      out.push(secondaryEdge(a, b, jump))
    }
  }
  return out
}

function curve(ctx: CanvasRenderingContext2D, a: Point, b: Point, zone: string): void {
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  if (zone === 'parent' || zone === 'child') {
    const midY = (a.y + b.y) / 2
    ctx.bezierCurveTo(a.x, midY, b.x, midY, b.x, b.y)
  } else {
    const midX = (a.x + b.x) / 2
    ctx.bezierCurveTo(midX, a.y, midX, b.y, b.x, b.y)
  }
  ctx.stroke()
}

// Connectors that don't touch the active thought are drawn at this fraction of the
// normal alpha, so they read as present but recede behind the active links.
const SECONDARY_ALPHA = 0.4

// Draw the retained edges in world space (sharing the card transform), plus an
// optional dashed drag-preview line. The edge whose key matches `highlightKey`
// (the one under the cursor) is drawn thicker in the accent colour. `secondary`
// edges (links between visible cards not involving the active thought) are drawn
// UNDER the primary edges at reduced alpha. Endpoint dots are superseded by DOM
// handles.
export function drawEdges(
  ctx: CanvasRenderingContext2D,
  edges: Edge[] | null | undefined,
  transform: { s: number; tx: number; ty: number },
  theme: { edge: string; jumpEdge: string; highlight: string },
  dpr: number,
  pending?: { a: Point; b: Point; zone?: string } | null,
  highlightKey?: string | null,
  secondary?: Edge[] | null,
): void {
  const canvas = ctx.canvas
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const { s, tx, ty } = transform
  ctx.setTransform(s * dpr, 0, 0, s * dpr, tx * dpr, ty * dpr)

  if (secondary && secondary.length) {
    ctx.save()
    ctx.globalAlpha = SECONDARY_ALPHA
    ctx.lineWidth = 1.5
    for (const e of secondary) {
      ctx.strokeStyle = e.role === 'jump' || e.role === 'sibling' ? theme.jumpEdge : theme.edge
      curve(ctx, e.a, e.b, e.zone)
    }
    ctx.restore()
  }

  for (const e of edges || []) {
    const hot = highlightKey && edgeKey(e) === highlightKey
    ctx.lineWidth = hot ? 2.5 : 1.5
    ctx.strokeStyle = hot
      ? theme.highlight
      : e.role === 'jump' || e.role === 'sibling'
        ? theme.jumpEdge
        : theme.edge
    curve(ctx, e.a, e.b, e.zone)
  }

  if (pending) {
    ctx.save()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = theme.edge
    ctx.setLineDash([6, 4])
    curve(ctx, pending.a, pending.b, pending.zone || 'jump')
    ctx.restore()
  }
}

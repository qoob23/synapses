import { NODE } from './layout'

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

// Draw the retained edges in world space (sharing the card transform), plus an
// optional dashed drag-preview line. The edge whose key matches `highlightKey`
// (the one under the cursor) is drawn thicker in the accent colour. Endpoint
// dots are superseded by DOM handles.
export function drawEdges(
  ctx: CanvasRenderingContext2D,
  edges: Edge[] | null | undefined,
  transform: { s: number; tx: number; ty: number },
  theme: { edge: string; jumpEdge: string; highlight: string },
  dpr: number,
  pending?: { a: Point; b: Point; zone?: string } | null,
  highlightKey?: string | null,
): void {
  const canvas = ctx.canvas
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const { s, tx, ty } = transform
  ctx.setTransform(s * dpr, 0, 0, s * dpr, tx * dpr, ty * dpr)

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

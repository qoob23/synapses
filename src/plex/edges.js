import { NODE } from './layout.js'

// Which gate of the focus connects to which gate of the neighbor, per zone.
const GATES = {
  parent: { focus: 'top', node: 'bottom' },
  child: { focus: 'bottom', node: 'top' },
  jump: { focus: 'left', node: 'right' },
  sibling: { focus: 'right', node: 'left' },
}

export function gatePoint(node, side) {
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

// Pure: turn a (live) layout into a retained list of edges with world-space
// endpoints + metadata, so the same list can be drawn AND hit-tested.
export function computeEdges(layout) {
  if (!layout) return []
  const focus = layout.nodes.find((n) => n.zone === 'focus')
  if (!focus) return []
  const edges = []
  for (const n of layout.nodes) {
    if (n.zone === 'focus') continue

    // Siblings connect to their shared PARENT, not the focus.
    if (n.zone === 'sibling') {
      const via =
        n.via &&
        layout.nodes.find(
          (m) => m.zone === 'parent' && m.name.toLowerCase() === String(n.via).toLowerCase(),
        )
      if (via) {
        edges.push({ a: gatePoint(via, 'bottom'), b: gatePoint(n, 'top'), neighbor: n.name, role: 'sibling', zone: 'child', via: true })
      } else {
        edges.push({ a: gatePoint(focus, 'right'), b: gatePoint(n, 'left'), neighbor: n.name, role: 'sibling', zone: 'sibling', via: false })
      }
      continue
    }

    const g = GATES[n.zone]
    if (!g) continue
    edges.push({ a: gatePoint(focus, g.focus), b: gatePoint(n, g.node), neighbor: n.name, role: n.zone, zone: n.zone, via: false })
  }
  return edges
}

function curve(ctx, a, b, zone) {
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

// Draw the retained edges in world space (sharing the node transform), plus an
// optional dashed drag-preview line. Endpoint dots are superseded by DOM handles.
export function drawEdges(ctx, edges, transform, theme, dpr, pending) {
  const canvas = ctx.canvas
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const { s, tx, ty } = transform
  ctx.setTransform(s * dpr, 0, 0, s * dpr, tx * dpr, ty * dpr)

  ctx.lineWidth = 1.5
  for (const e of edges || []) {
    ctx.strokeStyle = e.role === 'jump' || e.role === 'sibling' ? theme.jumpEdge : theme.edge
    curve(ctx, e.a, e.b, e.zone)
  }

  if (pending) {
    ctx.save()
    ctx.strokeStyle = theme.edge
    ctx.setLineDash([6, 4])
    curve(ctx, pending.a, pending.b, pending.zone || 'jump')
    ctx.restore()
  }
}

import { NODE } from './layout.js'

// Which gate of the focus connects to which gate of the neighbor, per zone.
const GATES = {
  parent: { focus: 'top', node: 'bottom' },
  child: { focus: 'bottom', node: 'top' },
  jump: { focus: 'left', node: 'right' },
  sibling: { focus: 'right', node: 'left' },
}

function gatePoint(node, side) {
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

// Draw focus->neighbor connectors. `transform` is {s, tx, ty}; `dpr` is device
// pixel ratio. Edges are drawn in world space so they share the node transform.
export function drawEdges(ctx, layout, transform, theme, dpr) {
  const canvas = ctx.canvas
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!layout) return

  const { s, tx, ty } = transform
  ctx.setTransform(s * dpr, 0, 0, s * dpr, tx * dpr, ty * dpr)

  const focus = layout.nodes.find((n) => n.zone === 'focus')
  if (!focus) return

  ctx.lineWidth = 1.5
  for (const n of layout.nodes) {
    if (n.zone === 'focus') continue

    // Siblings connect to their shared PARENT, not the focus.
    if (n.zone === 'sibling') {
      const via =
        n.via &&
        layout.nodes.find(
          (m) => m.zone === 'parent' && m.name.toLowerCase() === String(n.via).toLowerCase(),
        )
      ctx.strokeStyle = theme.jumpEdge
      if (via) curve(ctx, gatePoint(via, 'bottom'), gatePoint(n, 'top'), 'child')
      else curve(ctx, gatePoint(focus, 'right'), gatePoint(n, 'left'), 'sibling')
      continue
    }

    const g = GATES[n.zone]
    if (!g) continue
    ctx.strokeStyle = n.zone === 'jump' ? theme.jumpEdge : theme.edge
    curve(ctx, gatePoint(focus, g.focus), gatePoint(n, g.node), n.zone)
  }
}

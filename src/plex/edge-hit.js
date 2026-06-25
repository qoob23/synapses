// Pure hover hit-testing for the canvas edges: sample each bézier (using the same
// control points as edges.js curve()) into points, then point-to-polyline distance.

export function distToSegment(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = a.x + t * dx
  const cy = a.y + t * dy
  return Math.hypot(p.x - cx, p.y - cy)
}

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

export function sampleEdge(a, b, zone, n = 16) {
  let c1
  let c2
  if (zone === 'parent' || zone === 'child') {
    const midY = (a.y + b.y) / 2
    c1 = { x: a.x, y: midY }
    c2 = { x: b.x, y: midY }
  } else {
    const midX = (a.x + b.x) / 2
    c1 = { x: midX, y: a.y }
    c2 = { x: midX, y: b.y }
  }
  const pts = []
  for (let i = 0; i <= n; i++) pts.push(cubic(a, c1, c2, b, i / n))
  return pts
}

export function distToEdge(p, edge) {
  const pts = sampleEdge(edge.a, edge.b, edge.zone)
  let min = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(p, pts[i], pts[i + 1])
    if (d < min) min = d
  }
  return min
}

export function hitTest(p, edges, threshold) {
  let best = null
  let bestD = threshold
  for (const e of edges || []) {
    if (e.role === 'sibling') continue // computed; not directly removable
    const d = distToEdge(p, e)
    if (d <= bestD) {
      bestD = d
      best = e
    }
  }
  return best
}

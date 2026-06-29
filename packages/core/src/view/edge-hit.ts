// Pure hover hit-testing for the canvas edges: sample each bézier (using the shared
// bezierControls so the sampled curve matches edges.ts curve() exactly) into points,
// then point-to-polyline distance.

import { bezierControls } from './curve'

export interface Point {
  x: number
  y: number
}

// Minimal edge geometry the hit-testing reads (the full edge carries more metadata).
export interface HitEdge {
  a: Point
  b: Point
  zone: string
  remove?: unknown
  neighbor?: string
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = a.x + t * dx
  const cy = a.y + t * dy
  return Math.hypot(p.x - cx, p.y - cy)
}

function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

export function sampleEdge(a: Point, b: Point, zone: string, n = 16): Point[] {
  const { c1, c2 } = bezierControls(a, b, zone)
  const pts: Point[] = []
  for (let i = 0; i <= n; i++) pts.push(cubic(a, c1, c2, b, i / n))
  return pts
}

export function distToEdge(p: Point, edge: { a: Point; b: Point; zone: string }): number {
  const pts = sampleEdge(edge.a, edge.b, edge.zone)
  let min = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(p, pts[i], pts[i + 1])
    if (d < min) min = d
  }
  return min
}

// The world point a fixed arc-distance `dist` back from the edge's `b` endpoint
// (the non-active card's gate) along its bézier. Anchors the unlink control just
// off that card, ON the connector — not in the gap between cards, not over a
// card. Clamped to the curve's midpoint so it never crosses toward the active
// card on short links. `dist` is in world units (callers divide screen px by zoom).
export function pointAtDistanceFromEnd(edge: { a: Point; b: Point; zone: string }, dist: number): Point {
  const pts = sampleEdge(edge.a, edge.b, edge.zone, 32)
  let total = 0
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  let remaining = Math.min(dist, total / 2)
  for (let i = pts.length - 1; i > 0; i--) {
    const p = pts[i]
    const q = pts[i - 1]
    const seg = Math.hypot(p.x - q.x, p.y - q.y)
    if (seg >= remaining) {
      const f = seg ? remaining / seg : 0
      return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f }
    }
    remaining -= seg
  }
  return pts[0]
}

export function hitTest(p: Point, edges: HitEdge[] | null | undefined, threshold: number): HitEdge | null {
  let best: HitEdge | null = null
  let bestD = threshold
  for (const e of edges || []) {
    if (!e.remove) continue // computed/not removable (e.g. parentless sibling)
    const d = distToEdge(p, e)
    if (d <= bestD) {
      bestD = d
      best = e
    }
  }
  return best
}

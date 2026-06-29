// The two cubic-bezier control points for a connector between `a` and `b`, by curve
// orientation: a vertical S for parent/child (control points share the midpoint Y), a
// horizontal S otherwise (share the midpoint X). Shared by the canvas draw path
// (edges.ts `curve()`) and the hit-test sampler (edge-hit.ts `sampleEdge()`) so the drawn
// connector and its hover / unlink-anchor geometry can never drift apart.
export interface Pt {
  x: number
  y: number
}

export function bezierControls(a: Pt, b: Pt, zone: string): { c1: Pt; c2: Pt } {
  if (zone === 'parent' || zone === 'child') {
    const midY = (a.y + b.y) / 2
    return { c1: { x: a.x, y: midY }, c2: { x: b.x, y: midY } }
  }
  const midX = (a.x + b.x) / 2
  return { c1: { x: midX, y: a.y }, c2: { x: midX, y: b.y } }
}

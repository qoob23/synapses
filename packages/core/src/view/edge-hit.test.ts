import { describe, it, expect } from 'vitest'
import { distToSegment, hitTest, pointAtDistanceFromEnd } from './edge-hit'

describe('distToSegment', () => {
  it('measures perpendicular distance to a segment', () => {
    expect(distToSegment({ x: 0, y: 5 }, { x: -10, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5)
  })
  it('clamps to the nearest endpoint past the ends', () => {
    expect(distToSegment({ x: 20, y: 0 }, { x: -10, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(10)
  })
})

describe('hitTest', () => {
  const edges = [
    { a: { x: 0, y: 0 }, b: { x: 0, y: 100 }, zone: 'child', role: 'child', neighbor: 'C', remove: { from: 'F', to: 'C', role: 'child' } },
    { a: { x: 0, y: 0 }, b: { x: 0, y: 100 }, zone: 'child', role: 'sibling', neighbor: 'S' }, // no remove → computed
  ]
  it('returns the nearest removable edge within threshold', () => {
    const hit = hitTest({ x: 2, y: 50 }, edges, 6)
    expect(hit && hit.neighbor).toBe('C')
  })
  it('returns null when no edge is within threshold', () => {
    expect(hitTest({ x: 80, y: 50 }, edges, 6)).toBe(null)
  })
  it('skips an edge with no remove descriptor (computed sibling)', () => {
    const onlyComputed = [edges[1]]
    expect(hitTest({ x: 2, y: 50 }, onlyComputed, 6)).toBe(null)
  })
  it('returns a sibling edge that carries a remove descriptor', () => {
    const removableSibling = [{ ...edges[1], remove: { from: 'P', to: 'S', role: 'child' } }]
    const hit = hitTest({ x: 2, y: 50 }, removableSibling, 6)
    expect(hit && hit.neighbor).toBe('S')
  })
})

describe('pointAtDistanceFromEnd', () => {
  const edge = { a: { x: 0, y: 0 }, b: { x: 0, y: 100 }, zone: 'child' }
  it('returns a point the given distance back from b, toward a', () => {
    const p = pointAtDistanceFromEnd(edge, 20)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(80) // 20 back from b=(0,100)
  })
  it('clamps to the curve midpoint for distances past halfway', () => {
    const p = pointAtDistanceFromEnd(edge, 1000)
    expect(p.y).toBeCloseTo(50) // never crosses the middle toward a
  })
})

import { describe, it, expect } from 'vitest'
import { distToSegment, hitTest, pointOnEdge } from './edge-hit.js'

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

describe('pointOnEdge', () => {
  const edge = { a: { x: 0, y: 0 }, b: { x: 0, y: 100 }, zone: 'child' }
  it('returns the start at t=0 and the end at t=1', () => {
    expect(pointOnEdge(edge, 0)).toEqual({ x: 0, y: 0 })
    expect(pointOnEdge(edge, 1)).toEqual({ x: 0, y: 100 })
  })
  it('biases toward the b endpoint for t > 0.5', () => {
    const p = pointOnEdge(edge, 0.78)
    expect(p.y).toBeGreaterThan(50) // closer to b than to a
    expect(p.y).toBeLessThan(100)
  })
})

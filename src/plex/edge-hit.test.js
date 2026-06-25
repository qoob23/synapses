import { describe, it, expect } from 'vitest'
import { distToSegment, hitTest } from './edge-hit.js'

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
    { a: { x: 0, y: 0 }, b: { x: 0, y: 100 }, zone: 'child', role: 'child', neighbor: 'C' },
    { a: { x: 0, y: 0 }, b: { x: 0, y: 100 }, zone: 'child', role: 'sibling', neighbor: 'S' },
  ]
  it('returns the nearest removable edge within threshold', () => {
    const hit = hitTest({ x: 2, y: 50 }, edges, 6)
    expect(hit && hit.neighbor).toBe('C')
  })
  it('returns null when no edge is within threshold', () => {
    expect(hitTest({ x: 80, y: 50 }, edges, 6)).toBe(null)
  })
  it('never returns a sibling edge (computed, not removable)', () => {
    const onlySibling = [edges[1]]
    expect(hitTest({ x: 2, y: 50 }, onlySibling, 6)).toBe(null)
  })
})

import { describe, it, expect } from 'vitest'
import { computeEdges } from './edges.js'
import { NODE } from './layout.js'

// Minimal hand-placed layout: focus at origin, one parent above, one child below.
const layout = {
  focus: 'F',
  nodes: [
    { name: 'F', zone: 'focus', x: 0, y: 0 },
    { name: 'P', zone: 'parent', x: 0, y: -150 },
    { name: 'C', zone: 'child', x: 0, y: 150 },
  ],
}

describe('computeEdges', () => {
  it('produces one edge per non-focus node with role + endpoints', () => {
    const edges = computeEdges(layout)
    expect(edges.map((e) => e.neighbor).sort()).toEqual(['C', 'P'])
    const parent = edges.find((e) => e.neighbor === 'P')
    expect(parent.role).toBe('parent')
    // focus parent-gate is its top edge; neighbor child-gate is its bottom edge
    expect(parent.a).toEqual({ x: 0, y: -NODE.H / 2 })
    expect(parent.b).toEqual({ x: 0, y: -150 + NODE.H / 2 })
  })

  it('returns [] when there is no focus node', () => {
    expect(computeEdges({ nodes: [] })).toEqual([])
  })

  it('sibling-via-parent: edge connects parent bottom-gate to sibling top-gate', () => {
    const siblingLayout = {
      focus: 'F',
      nodes: [
        { name: 'F', zone: 'focus', x: 0, y: 0 },
        { name: 'P', zone: 'parent', x: 0, y: -150 },
        { name: 'S', zone: 'sibling', x: 150, y: -150, via: 'P' },
      ],
    }
    const edges = computeEdges(siblingLayout)
    const sibEdge = edges.find((e) => e.neighbor === 'S')
    expect(sibEdge.role).toBe('sibling')
    expect(sibEdge.zone).toBe('child')
    expect(sibEdge.via).toBe(true)
    // a = P's bottom gate, b = S's top gate
    expect(sibEdge.a).toEqual({ x: 0, y: -150 + NODE.H / 2 })
    expect(sibEdge.b).toEqual({ x: 150, y: -150 - NODE.H / 2 })
  })
})

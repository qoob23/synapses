import { describe, it, expect } from 'vitest'
import { computeEdges, edgeKey } from './edges.js'
import { NODE } from './layout.js'

// Minimal hand-placed layout: active thought at origin, one parent above, one child below.
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
    // active thought's parent-gate is its top edge; the linked card's child-gate is its bottom edge
    expect(parent.a).toEqual({ x: 0, y: -NODE.H / 2 })
    expect(parent.b).toEqual({ x: 0, y: -150 + NODE.H / 2 })
  })

  it('carries a remove descriptor (focus → neighbor) for parent/child edges', () => {
    const edges = computeEdges(layout)
    expect(edges.find((e) => e.neighbor === 'P').remove).toEqual({ from: 'F', to: 'P', role: 'parent' })
    expect(edges.find((e) => e.neighbor === 'C').remove).toEqual({ from: 'F', to: 'C', role: 'child' })
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
    // removable: unlinks the sibling from its shared parent (parent → child)
    expect(sibEdge.remove).toEqual({ from: 'P', to: 'S', role: 'child' })
  })

  it('sibling whose parent is not rendered: removable via the parent name, drawn from focus', () => {
    const detached = {
      focus: 'F',
      nodes: [
        { name: 'F', zone: 'focus', x: 0, y: 0 },
        { name: 'S', zone: 'sibling', x: 150, y: 0, via: 'P' },
      ],
    }
    const sibEdge = computeEdges(detached).find((e) => e.neighbor === 'S')
    expect(sibEdge.via).toBe(false)
    expect(sibEdge.remove).toEqual({ from: 'P', to: 'S', role: 'child' })
  })

  it('sibling with no known parent is not removable (no remove descriptor)', () => {
    const orphan = {
      focus: 'F',
      nodes: [
        { name: 'F', zone: 'focus', x: 0, y: 0 },
        { name: 'S', zone: 'sibling', x: 150, y: 0 },
      ],
    }
    const sibEdge = computeEdges(orphan).find((e) => e.neighbor === 'S')
    expect(sibEdge.remove).toBeFalsy()
  })
})

describe('edgeKey', () => {
  it('is a stable, case-insensitive identity for an edge (role + neighbor)', () => {
    expect(edgeKey({ role: 'parent', neighbor: 'Foo' })).toBe('parent:foo')
    expect(edgeKey({ role: 'parent', neighbor: 'foo' })).toBe(edgeKey({ role: 'parent', neighbor: 'FOO' }))
    expect(edgeKey({ role: 'jump', neighbor: 'Foo' })).not.toBe(edgeKey({ role: 'parent', neighbor: 'Foo' }))
  })
  it('returns null for a missing edge', () => {
    expect(edgeKey(null)).toBe(null)
  })
})

import { describe, it, expect } from 'vitest'
import { computeEdges, computeSecondaryEdges, edgeKey, gatePoint } from './edges'
import { NODE } from './layout'

// Order-independent set of an edge's two endpoints (rounded), for asserting which
// two cards a connector joins without depending on the a→b direction.
const ptKey = (p: { x: number; y: number }) => `${Math.round(p.x)},${Math.round(p.y)}`
const endpointSet = (e: { a: { x: number; y: number }; b: { x: number; y: number } }) =>
  [ptKey(e.a), ptKey(e.b)].sort()

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
    const parent = edges.find((e) => e.neighbor === 'P')!
    expect(parent.role).toBe('parent')
    // active thought's parent-gate is its top edge; the linked card's child-gate is its bottom edge
    expect(parent.a).toEqual({ x: 0, y: -NODE.H / 2 })
    expect(parent.b).toEqual({ x: 0, y: -150 + NODE.H / 2 })
  })

  it('carries a remove descriptor (focus → neighbor) for parent/child edges', () => {
    const edges = computeEdges(layout)
    expect(edges.find((e) => e.neighbor === 'P')!.remove).toEqual({ from: 'F', to: 'P', role: 'parent' })
    expect(edges.find((e) => e.neighbor === 'C')!.remove).toEqual({ from: 'F', to: 'C', role: 'child' })
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
    const sibEdge = edges.find((e) => e.neighbor === 'S')!
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
    const sibEdge = computeEdges(detached).find((e) => e.neighbor === 'S')!
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
    const sibEdge = computeEdges(orphan).find((e) => e.neighbor === 'S')!
    expect(sibEdge.remove).toBeFalsy()
  })
})

describe('computeSecondaryEdges', () => {
  it('emits a display-only connector for a jump link between two non-active cards', () => {
    const layout = {
      focus: 'F',
      nodes: [
        { name: 'F', zone: 'focus', x: 0, y: 0 },
        { name: 'P', zone: 'parent', x: 0, y: -150 },
        { name: 'J', zone: 'jump', x: -200, y: 0 },
      ],
    }
    // F links to P (parent) and J (jump); additionally P and J jump to each other.
    const adjacency = {
      f: { parents: ['P'], children: [], jumps: ['J'] },
      p: { parents: [], children: ['F'], jumps: ['J'] },
      j: { parents: [], children: [], jumps: ['F', 'P'] },
    }
    const primary = computeEdges(layout)
    const secondary = computeSecondaryEdges(layout, adjacency, primary)
    expect(secondary).toHaveLength(1)
    expect(secondary[0].role).toBe('jump') // jump link → jump connector colour
    expect(secondary[0].remove).toBeNull() // display-only, not removable
    // dominant axis is horizontal (|dx|=200 > |dy|=150): P's left gate ↔ J's right gate
    expect(endpointSet(secondary[0])).toEqual(
      [ptKey({ x: -NODE.W / 2, y: -150 }), ptKey({ x: -200 + NODE.W / 2, y: 0 })].sort(),
    )
  })

  it('uses the normal connector role for a parent/child link, with vertical gates', () => {
    const layout = {
      focus: 'F',
      nodes: [
        { name: 'F', zone: 'focus', x: 0, y: 0 },
        { name: 'P', zone: 'parent', x: 0, y: -150 },
        { name: 'C', zone: 'child', x: 0, y: 150 },
      ],
    }
    // P is also a direct parent of C (a link between two non-active cards).
    const adjacency = {
      f: { parents: ['P'], children: ['C'], jumps: [] },
      p: { parents: [], children: ['F', 'C'], jumps: [] },
      c: { parents: ['F', 'P'], children: [], jumps: [] },
    }
    const secondary = computeSecondaryEdges(layout, adjacency, computeEdges(layout))
    expect(secondary).toHaveLength(1)
    expect(secondary[0].role).toBe('child') // parent/child link → normal connector colour
    // dominant axis is vertical: P's bottom gate ↔ C's top gate
    expect(endpointSet(secondary[0])).toEqual(
      [ptKey({ x: 0, y: -150 + NODE.H / 2 }), ptKey({ x: 0, y: 150 - NODE.H / 2 })].sort(),
    )
  })

  it('excludes links that involve the active thought', () => {
    const layout = {
      focus: 'F',
      nodes: [
        { name: 'F', zone: 'focus', x: 0, y: 0 },
        { name: 'P', zone: 'parent', x: 0, y: -150 },
        { name: 'C', zone: 'child', x: 0, y: 150 },
      ],
    }
    // the only links are focus↔neighbour (already drawn as primary edges)
    const adjacency = {
      f: { parents: ['P'], children: ['C'], jumps: [] },
      p: { parents: [], children: ['F'], jumps: [] },
      c: { parents: ['F'], children: [], jumps: [] },
    }
    expect(computeSecondaryEdges(layout, adjacency, computeEdges(layout))).toEqual([])
  })

  it('dedupes against a primary edge (the sibling→shared-parent connector)', () => {
    const layout = {
      focus: 'F',
      nodes: [
        { name: 'F', zone: 'focus', x: 0, y: 0 },
        { name: 'P', zone: 'parent', x: 0, y: -150 },
        { name: 'S', zone: 'sibling', x: 180, y: 0, via: 'P' },
      ],
    }
    // S is a child of P — already drawn by computeEdges as the sibling-via connector.
    const adjacency = {
      f: { parents: ['P'], children: [], jumps: [] },
      p: { parents: [], children: ['F', 'S'], jumps: [] },
      s: { parents: ['P'], children: [], jumps: [] },
    }
    expect(computeSecondaryEdges(layout, adjacency, computeEdges(layout))).toEqual([])
  })

  it('emits one connector per linked pair (reverse direction deduped)', () => {
    const layout = {
      focus: 'F',
      nodes: [
        { name: 'F', zone: 'focus', x: 0, y: 0 },
        { name: 'P', zone: 'parent', x: 0, y: -150 },
        { name: 'J', zone: 'jump', x: -200, y: 0 },
      ],
    }
    // the P↔J jump appears in BOTH cards' adjacency — must not double-draw
    const adjacency = {
      p: { parents: [], children: [], jumps: ['J'] },
      j: { parents: [], children: [], jumps: ['P'] },
    }
    expect(computeSecondaryEdges(layout, adjacency, computeEdges(layout))).toHaveLength(1)
  })

  it('returns [] with missing/empty adjacency', () => {
    const layout = { focus: 'F', nodes: [{ name: 'F', zone: 'focus', x: 0, y: 0 }] }
    expect(computeSecondaryEdges(layout, {}, [])).toEqual([])
    expect(computeSecondaryEdges(layout, undefined, [])).toEqual([])
    expect(computeSecondaryEdges(null, {}, [])).toEqual([])
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

describe('gatePoint', () => {
  it('meets the actual (content-sized) left/right edge via node.w', () => {
    const node = { x: 100, y: 0, w: 300 }
    expect(gatePoint(node, 'left')).toEqual({ x: 100 - 150, y: 0 })
    expect(gatePoint(node, 'right')).toEqual({ x: 100 + 150, y: 0 })
  })
  it('falls back to NODE.W when no width is given, and uses NODE.H for top/bottom', () => {
    const node = { x: 0, y: 0 }
    expect(gatePoint(node, 'left')).toEqual({ x: -NODE.W / 2, y: 0 })
    expect(gatePoint(node, 'top')).toEqual({ x: 0, y: -NODE.H / 2 })
  })
})

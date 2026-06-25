import { describe, it, expect } from 'vitest'
import { buildIndex, queryGraph, applyEdge, hasEdge, reconcilePatches, removeEdge, getAdjacency } from './graph.js'

const ONT = { parent: ['parent'], child: ['child'], jump: ['jump'] }

// Mixed-direction fixture: some links declared on the parent (child::), some on
// the child (parent::), to exercise the reciprocal index.
const PAGES = {
  Philosophy: { child: ['Metaphysics', 'Epistemology'] },
  Ethics: { parent: ['Philosophy'], child: ['Virtue Ethics'], jump: ['Aristotle'] },
  Logic: { parent: ['Philosophy'] },
  Metaphysics: {},
  Epistemology: { child: ['Empiricism', 'Rationalism'] },
  'Virtue Ethics': { parent: ['Ethics'] },
  Aristotle: { child: ['Nicomachean Ethics'] },
  'Nicomachean Ethics': { parent: ['Aristotle', 'Ethics'] },
  Rationalism: { jump: ['Descartes'] },
  Descartes: { jump: ['Rationalism'] },
}

const INDEX = buildIndex(
  Object.entries(PAGES).map(([name, props]) => ({ name, props })),
  ONT,
)
const build = (focus) => queryGraph(INDEX, focus)

describe('relationship index', () => {
  it('merges forward + reciprocal children', () => {
    const g = build('Philosophy')
    expect(g.children.sort()).toEqual(['Epistemology', 'Ethics', 'Logic', 'Metaphysics'])
    expect(g.parents).toEqual([])
  })

  it('computes siblings from a shared parent and resolves all four zones', () => {
    const g = build('Ethics')
    expect(g.parents).toEqual(['Philosophy'])
    expect(g.jumps).toEqual(['Aristotle'])
    expect(g.siblings.sort()).toEqual(['Epistemology', 'Logic', 'Metaphysics'])
  })

  it('infers reverse + symmetric jumps on a hub', () => {
    const g = build('Aristotle')
    expect(g.children).toContain('Nicomachean Ethics')
    expect(g.jumps).toContain('Ethics') // Ethics declares jump:: Aristotle
    expect(g.parents).toEqual([])
  })

  it('handles a multi-parent node with siblings from both parents', () => {
    const g = build('Nicomachean Ethics')
    expect(g.parents.sort()).toEqual(['Aristotle', 'Ethics'])
    expect(g.siblings).toContain('Virtue Ethics') // via the Ethics parent
  })

  it('records which parent each sibling came from', () => {
    const g = build('Nicomachean Ethics')
    expect(g.siblingParent['Virtue Ethics']).toBe('Ethics')
  })

  it('infers a reverse-only parent (the parent declares the child)', () => {
    const g = build('Rationalism')
    expect(g.parents).toContain('Epistemology')
    expect(g.jumps).toContain('Descartes')
  })

  it('de-duplicates relationships', () => {
    const g = build('Ethics')
    const dupes = g.children.filter((c) => c.toLowerCase() === 'virtue ethics')
    expect(dupes.length).toBe(1)
  })

  it('de-duplicates a symmetric jump declared on both sides', () => {
    const g = build('Rationalism')
    const dupes = g.jumps.filter((j) => j.toLowerCase() === 'descartes')
    expect(dupes.length).toBe(1)
  })

  it('applyEdge adds a reciprocal edge and is idempotent', () => {
    const idx = buildIndex([], ONT)
    applyEdge(idx, 'Plato', 'child', 'Rationalism')
    expect(hasEdge(idx, 'Plato', 'child', 'Rationalism')).toBe(true)
    expect(queryGraph(idx, 'Rationalism').parents).toContain('Plato') // reciprocal
    applyEdge(idx, 'Plato', 'child', 'Rationalism') // again
    const children = queryGraph(idx, 'Plato').children.filter((c) => c.toLowerCase() === 'rationalism')
    expect(children.length).toBe(1) // no duplicate
  })

  it('never lists the focus as its own neighbor', () => {
    const g = build('Ethics')
    const all = [...g.parents, ...g.children, ...g.jumps, ...g.siblings]
    expect(all.some((n) => n.toLowerCase() === 'ethics')).toBe(false)
  })
})

describe('reconcilePatches (rebuild replay path)', () => {
  const patch = (focus, role, target, ts) => ({ focus, role, target, ts })

  it('drops a patch the fresh read has already confirmed', () => {
    const fresh = buildIndex([{ name: 'A', props: { child: ['B'] } }], ONT)
    const keep = reconcilePatches(fresh, [patch('A', 'child', 'B', 1000)], 1500, 4000)
    expect(keep).toEqual([]) // read confirmed it — stop tracking
  })

  it('drops a stale unconfirmed patch and does NOT resurrect its edge', () => {
    const fresh = buildIndex([{ name: 'A', props: {} }], ONT)
    const keep = reconcilePatches(fresh, [patch('A', 'child', 'C', 1000)], 1000 + 4001, 4000)
    expect(keep).toEqual([]) // outlived the settle window
    expect(hasEdge(fresh, 'A', 'child', 'C')).toBe(false) // a later external removal wins
  })

  it('re-applies and keeps a fresh unconfirmed patch (survives the swap)', () => {
    const fresh = buildIndex([{ name: 'A', props: {} }], ONT)
    const keep = reconcilePatches(fresh, [patch('A', 'child', 'C', 1000)], 1500, 4000)
    expect(keep).toHaveLength(1)
    expect(hasEdge(fresh, 'A', 'child', 'C')).toBe(true) // replayed onto the fresh index
    expect(hasEdge(fresh, 'C', 'parent', 'A')).toBe(true) // with its reciprocal
  })
})

describe('removeEdge', () => {
  it('removes an edge and its reciprocal from both nodes', () => {
    const idx = buildIndex([{ name: 'A', props: { child: ['B'] } }], ONT)
    expect(hasEdge(idx, 'A', 'child', 'B')).toBe(true)
    removeEdge(idx, 'A', 'child', 'B')
    expect(hasEdge(idx, 'A', 'child', 'B')).toBe(false)
    expect(hasEdge(idx, 'B', 'parent', 'A')).toBe(false)
  })
})

describe('reconcilePatches with remove ops', () => {
  const rm = (focus, role, target, ts) => ({ focus, role, target, ts, kind: 'remove' })

  it('re-removes an edge a stale read still shows, and keeps tracking it', () => {
    const fresh = buildIndex([{ name: 'A', props: { child: ['B'] } }], ONT) // read still has it
    const keep = reconcilePatches(fresh, [rm('A', 'child', 'B', 1000)], 1500, 4000)
    expect(keep).toHaveLength(1)
    expect(hasEdge(fresh, 'A', 'child', 'B')).toBe(false) // removal re-applied
  })

  it('drops a remove op once the read confirms the edge is gone', () => {
    const fresh = buildIndex([{ name: 'A', props: {} }], ONT) // read no longer has it
    const keep = reconcilePatches(fresh, [rm('A', 'child', 'B', 1000)], 1500, 4000)
    expect(keep).toEqual([])
  })

  it('drops a stale remove op after TTL (so a re-add can win)', () => {
    const fresh = buildIndex([{ name: 'A', props: { child: ['B'] } }], ONT)
    const keep = reconcilePatches(fresh, [rm('A', 'child', 'B', 1000)], 1000 + 4001, 4000)
    expect(keep).toEqual([])
    expect(hasEdge(fresh, 'A', 'child', 'B')).toBe(true) // not re-removed
  })
})

describe('getAdjacency', () => {
  it('returns display-cased neighbor arrays per direction, reciprocals included', () => {
    const idx = buildIndex([
      { name: 'Ethics', props: { parent: ['Philosophy'], jump: ['Aristotle'] } },
      { name: 'Philosophy', props: { child: ['Logic'] } },
    ], ONT)
    const adj = getAdjacency(idx, ['Ethics', 'Philosophy'])
    expect(adj.ethics.parents).toEqual(['Philosophy'])
    expect(adj.ethics.jumps).toEqual(['Aristotle'])
    expect(adj.philosophy.children.sort()).toEqual(['Ethics', 'Logic']) // reciprocal Ethics + declared Logic
  })
  it('omits names not in the index', () => {
    const idx = buildIndex([{ name: 'A', props: {} }], ONT)
    expect(getAdjacency(idx, ['Nope'])).toEqual({})
  })
})

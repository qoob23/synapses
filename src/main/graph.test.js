import { describe, it, expect } from 'vitest'
import { buildIndex, queryGraph, applyEdge, hasEdge } from './graph.js'

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

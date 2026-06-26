import { describe, it, expect } from 'vitest'
import { NODE, computeLayout, gridPositions } from './layout'
// Read the CSS via Vite's ?raw import (no node builtins) so core source stays
// editor-agnostic and typechecks under tsconfig's `types: []`.
import cssText from './styles.css?raw'

describe('node geometry single source of truth', () => {
  // view.js sets --synapses-node-w/h from NODE at runtime; styles.css carries
  // matching fallback literals. This guards them from silently diverging.
  it('styles.css fallback literals match NODE', () => {
    expect(cssText).toContain(`var(--synapses-node-w, ${NODE.W}px)`)
    expect(cssText).toContain(`var(--synapses-node-h, ${NODE.H}px)`)
  })

  it('styles.css drives node label size from --synapses-node-font', () => {
    expect(cssText).toContain('font-size: var(--synapses-node-font, 1.7rem)')
  })
})

describe('gridPositions (2-column grid)', () => {
  it('fills two centered columns, then wraps to the next row', () => {
    const out = gridPositions(['a', 'b', 'c'], 100, { cols: 2, colGap: 200, rowGap: 80 })
    expect(out).toEqual([
      { name: 'a', x: -100, y: 100 },
      { name: 'b', x: 100, y: 100 },
      { name: 'c', x: -100, y: 180 },
    ])
  })
})

describe('computeLayout', () => {
  it('places the focus at the origin and keeps one node per name', () => {
    const g = {
      focus: 'F',
      parents: ['P'],
      children: ['C'],
      jumps: ['J'],
      siblings: ['C'], // also a child — must dedupe, keeping the higher-priority zone
      siblingParent: {},
    }
    const layout = computeLayout(g)

    expect(layout.nodes.find((n) => n.zone === 'focus')).toMatchObject({ name: 'F', x: 0, y: 0 })

    const names = layout.nodes.map((n) => n.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length) // no duplicate names

    expect(layout.nodes.find((n) => n.name === 'C')!.zone).toBe('child') // child beats sibling
  })

  it('lays children out in two columns growing downward', () => {
    const g = { focus: 'F', parents: [], children: ['c1', 'c2', 'c3', 'c4'], jumps: [], siblings: [], siblingParent: {} }
    const kids = computeLayout(g).nodes.filter((n) => n.zone === 'child')
    const xs = [...new Set(kids.map((n) => n.x))]
    const ys = [...new Set(kids.map((n) => n.y))]
    expect(xs.length).toBe(2) // exactly two columns
    expect(ys.length).toBe(2) // 4 children => two rows
  })

  it('adjacent parents (sorted by x) are at least NODE.W apart', () => {
    const g = { focus: 'F', parents: ['p1', 'p2', 'p3'], children: [], jumps: [], siblings: [], siblingParent: {} }
    const parents = computeLayout(g).nodes.filter((n) => n.zone === 'parent').sort((a, b) => a.x - b.x)
    for (let i = 1; i < parents.length; i++) {
      expect(parents[i].x - parents[i - 1].x).toBeGreaterThanOrEqual(NODE.W)
    }
  })

  it('two children centers are at least NODE.W apart (no horizontal column overlap)', () => {
    const g = { focus: 'F', parents: [], children: ['c1', 'c2'], jumps: [], siblings: [], siblingParent: {} }
    const kids = computeLayout(g).nodes.filter((n) => n.zone === 'child').sort((a, b) => a.x - b.x)
    expect(kids[1].x - kids[0].x).toBeGreaterThanOrEqual(NODE.W)
  })

  it('children columns are spaced wider than adjacent in-row parents', () => {
    const g = { focus: 'F', parents: ['p1', 'p2'], children: ['c1', 'c2'], jumps: [], siblings: [], siblingParent: {} }
    const nodes = computeLayout(g).nodes
    const kids = nodes.filter((n) => n.zone === 'child').sort((a, b) => a.x - b.x)
    const parents = nodes.filter((n) => n.zone === 'parent').sort((a, b) => a.x - b.x)
    expect(kids[1].x - kids[0].x).toBeGreaterThan(parents[1].x - parents[0].x)
  })

  it('adjacent jumps (sorted by y) are at least NODE.H apart (no vertical overlap)', () => {
    const g = { focus: 'F', parents: [], children: [], jumps: ['j1', 'j2', 'j3'], siblings: [], siblingParent: {} }
    const jumps = computeLayout(g).nodes.filter((n) => n.zone === 'jump').sort((a, b) => a.y - b.y)
    for (let i = 1; i < jumps.length; i++) {
      expect(jumps[i].y - jumps[i - 1].y).toBeGreaterThanOrEqual(NODE.H)
    }
  })
})

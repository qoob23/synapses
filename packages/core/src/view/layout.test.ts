import { describe, it, expect } from 'vitest'
import { NODE, computeLayout } from './layout'
// Read the CSS via Vite's ?raw import (no node builtins) so core source stays
// editor-agnostic and typechecks under tsconfig's `types: []`.
import cssText from './styles.css?raw'

describe('node geometry single source of truth', () => {
  // Card size now scales with the size level via CSS vars (height/font/max-width), but
  // the CSS FALLBACKS must still track the base geometry: height → NODE.H, font → 1.7rem,
  // max-width → the base cap.
  it('styles.css height fallback matches NODE.H', () => {
    expect(cssText).toContain(`var(--synapses-node-h, ${NODE.H}px)`)
  })
  it('styles.css sizes cards to content, capped by the max-width var', () => {
    expect(cssText).toContain('width: fit-content')
    expect(cssText).toContain('max-width: var(--synapses-node-maxw')
  })
  it('styles.css drives node label size from --synapses-node-font', () => {
    expect(cssText).toContain('font-size: var(--synapses-node-font, 1.7rem)')
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

  it('every node carries a width (defaults to NODE.W)', () => {
    const g = { focus: 'F', parents: ['P'], children: [], jumps: [], siblings: [], siblingParent: {} }
    for (const n of computeLayout(g).nodes) expect(n.w).toBe(NODE.W)
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

// These assert the tight-reflow RELATIONSHIPS (constant gaps, inner-edge anchoring,
// per-column sizing) rather than exact pixels, so they survive spacing re-tuning.
describe('computeLayout with variable widths (tight reflow)', () => {
  it('packs a row with a constant gap between adjacent cards, centered on x=0', () => {
    const g = { focus: 'F', parents: ['a', 'b', 'c'], children: [], jumps: [], siblings: [], siblingParent: {} }
    const ps = computeLayout(g, { a: 100, b: 300, c: 150 }).nodes
      .filter((n) => n.zone === 'parent')
      .sort((x, y) => x.x - y.x)
    const gaps: number[] = []
    for (let i = 1; i < ps.length; i++) gaps.push(ps[i].x - ps[i].w / 2 - (ps[i - 1].x + ps[i - 1].w / 2))
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.001) // all adjacent gaps equal
    expect(gaps[0]).toBeGreaterThan(0) // there IS a gap (no overlap)
    // centered: leftmost left-edge mirrors rightmost right-edge
    expect(ps[0].x - ps[0].w / 2).toBeCloseTo(-(ps[ps.length - 1].x + ps[ps.length - 1].w / 2))
    expect(ps.find((p) => p.name === 'b')!.w).toBe(300) // carries its width
  })

  it('anchors a column inner edge independent of width (cards grow outward)', () => {
    const g = { focus: 'F', parents: [], children: [], jumps: ['n', 'w'], siblings: [], siblingParent: {} }
    const nodes = computeLayout(g, { n: NODE.W, w: 400 }).nodes.filter((nd) => nd.zone === 'jump')
    const inner = nodes.map((nd) => nd.x + nd.w / 2) // right (inner) edge for the left column
    expect(inner[0]).toBeCloseTo(inner[1]) // same inner edge regardless of width
    expect(nodes.every((nd) => nd.x < 0)).toBe(true) // left of focus
    const wide = nodes.find((n) => n.name === 'w')!
    const narrow = nodes.find((n) => n.name === 'n')!
    expect(wide.x).toBeLessThan(narrow.x) // wider card's center pushed further out
  })

  it('mirrors the jump (left) and sibling (right) columns', () => {
    const j = computeLayout({ focus: 'F', jumps: ['x'], parents: [], children: [], siblings: [], siblingParent: {} }, { x: 300 })
      .nodes.find((n) => n.zone === 'jump')!
    const s = computeLayout({ focus: 'F', siblings: ['x'], parents: [], children: [], jumps: [], siblingParent: {} }, { x: 300 })
      .nodes.find((n) => n.zone === 'sibling')!
    expect(s.x).toBeCloseTo(-j.x)
  })

  it('sizes each children column to its widest card; a column shares one center', () => {
    // row-major fill: c1,c3 → left column; c2 → right column
    const g = { focus: 'F', parents: [], children: ['c1', 'c2', 'c3'], jumps: [], siblings: [], siblingParent: {} }
    const nodes = computeLayout(g, { c1: 100, c2: 300, c3: 400 }).nodes
    const c1 = nodes.find((n) => n.name === 'c1')!
    const c2 = nodes.find((n) => n.name === 'c2')!
    const c3 = nodes.find((n) => n.name === 'c3')!
    expect(c1.x).toBeCloseTo(c3.x) // same (left) column center
    expect(c1.x).toBeLessThan(0)
    expect(c2.x).toBeGreaterThan(0)
    expect(c3.y).toBeGreaterThan(c1.y) // wraps to the next row
    expect(Math.abs(c1.x)).toBeGreaterThan(Math.abs(c2.x)) // left column (wider, 400) sits further out
  })

  it('expands the bbox to include a wide card', () => {
    const g = { focus: 'F', parents: ['wide'], children: [], jumps: [], siblings: [], siblingParent: {} }
    const { bbox } = computeLayout(g, { wide: 600 })
    expect(bbox.minX).toBe(-300) // single parent centered at x=0, half of 600
    expect(bbox.maxX).toBe(300)
  })
})

// Zoom was removed: the view renders at true px and only translates, so the SPACING
// fills the panel. With a viewport, band distances + the vertical step derive from the
// panel size (clamped); without one, the fixed constants above still apply.
describe('computeLayout fills the panel (responsive spacing)', () => {
  const vp = (w: number, h: number) => ({ viewport: { w, h }, cardH: NODE.H })

  it('falls back to the fixed constants when no viewport is given', () => {
    const g = { focus: 'F', jumps: ['j'], parents: [], children: [], siblings: [], siblingParent: {} }
    const noVp = computeLayout(g).nodes.find((n) => n.zone === 'jump')!.x
    const withVp = computeLayout(g, undefined, vp(700, 800)).nodes.find((n) => n.zone === 'jump')!.x
    expect(noVp).not.toBeCloseTo(withVp) // the responsive path differs from the constant fallback
  })

  it('pushes columns toward the panel edge, clamped to one max on huge viewports', () => {
    const g = { focus: 'F', jumps: ['j'], parents: [], children: [], siblings: [], siblingParent: {} }
    const narrow = computeLayout(g, undefined, vp(700, 800)).nodes.find((n) => n.zone === 'jump')!
    const wide = computeLayout(g, undefined, vp(4000, 800)).nodes.find((n) => n.zone === 'jump')!
    const huger = computeLayout(g, undefined, vp(8000, 800)).nodes.find((n) => n.zone === 'jump')!
    expect(Math.abs(wide.x)).toBeGreaterThan(Math.abs(narrow.x)) // wider panel → columns further out
    expect(wide.x).toBeCloseTo(huger.x) // ...but clamped to the same MAX (never flies apart)
  })

  it('never lets a column overlap the focus on a tiny viewport', () => {
    const g = { focus: 'F', jumps: ['j'], parents: [], children: [], siblings: [], siblingParent: {} }
    const nodes = computeLayout(g, undefined, vp(280, 360)).nodes
    const jump = nodes.find((n) => n.zone === 'jump')!
    const focus = nodes.find((n) => n.zone === 'focus')!
    const innerEdge = Math.abs(jump.x) - jump.w / 2 // edge facing the focus
    expect(innerEdge).toBeGreaterThanOrEqual(focus.w / 2) // clears the focus box
  })

  it('spreads a column to fill height on a tall panel and floors the gap on a short one', () => {
    const g = { focus: 'F', siblings: ['a', 'b', 'c'], parents: [], children: [], jumps: [], siblingParent: {} }
    const step = (h: number) => {
      const sibs = computeLayout(g, undefined, vp(600, h)).nodes
        .filter((n) => n.zone === 'sibling')
        .sort((x, y) => x.y - y.y)
      return sibs[1].y - sibs[0].y
    }
    expect(step(1600)).toBeGreaterThan(step(360)) // taller panel → more air
    expect(step(360)).toBeGreaterThanOrEqual(NODE.H) // ...but never overlapping
  })

  it('sets the bbox height from cardH (the size level)', () => {
    const g = { focus: 'F', parents: [], children: [], jumps: [], siblings: [], siblingParent: {} }
    const small = computeLayout(g, undefined, { viewport: { w: 600, h: 600 }, cardH: 40 })
    const big = computeLayout(g, undefined, { viewport: { w: 600, h: 600 }, cardH: 80 })
    expect(small.bbox.maxY - small.bbox.minY).toBe(40)
    expect(big.bbox.maxY - big.bbox.minY).toBe(80)
  })
})

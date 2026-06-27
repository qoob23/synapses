import { describe, it, expect } from 'vitest'
import { NODE, computeLayout } from './layout'
// Read the CSS via Vite's ?raw import (no node builtins) so core source stays
// editor-agnostic and typechecks under tsconfig's `types: []`.
import cssText from './styles.css?raw'

describe('node geometry single source of truth', () => {
  // Height stays fixed (titles are single-line), so the CSS height fallback must
  // still track NODE.H. Width is now content-sized, capped by the viewport-derived
  // max-width var (see the adaptive-width design).
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

describe('computeLayout with variable widths (tight reflow)', () => {
  const g3parents = { focus: 'F', parents: ['p1', 'p2', 'p3'], children: [], jumps: [], siblings: [], siblingParent: {} }

  it('uniform NODE.W widths reproduce the original fixed-slot coordinates', () => {
    const widths = { f: NODE.W, p1: NODE.W, p2: NODE.W, p3: NODE.W }
    const xs = computeLayout(g3parents, widths).nodes
      .filter((n) => n.zone === 'parent')
      .sort((a, b) => a.x - b.x)
      .map((n) => n.x)
    expect(xs).toEqual([-224, 0, 224]) // == old GAP_X (208 + 16) spacing
  })

  it('packs a parents row tightly by actual width + a 16px gap, centered on x=0', () => {
    const g = { focus: 'F', parents: ['a', 'b'], children: [], jumps: [], siblings: [], siblingParent: {} }
    const nodes = computeLayout(g, { a: 100, b: 300 }).nodes
    const a = nodes.find((n) => n.name === 'a')!
    const b = nodes.find((n) => n.name === 'b')!
    // total = 100 + 16 + 300 = 416 → start at -208; a@-208+50=-158, b@-158+50+16+150=58
    expect(a.x).toBe(-158)
    expect(b.x).toBe(58)
    // tight gap: b's left edge minus a's right edge == 16
    expect((b.x - 300 / 2) - (a.x + 100 / 2)).toBe(16)
    expect(a.w).toBe(100)
    expect(b.w).toBe(300)
  })

  it('anchors the jump column inner edge a constant gap from the focus (grows leftward)', () => {
    const g = { focus: 'F', parents: [], children: [], jumps: ['j'], siblings: [], siblingParent: {} }
    const j = computeLayout(g, { j: 300 }).nodes.find((n) => n.zone === 'jump')!
    // center = -(BAND_X + (w - NODE.W)/2) = -(360 + (300-208)/2) = -(360+46) = -406
    expect(j.x).toBe(-406)
    // right (inner) edge stays at -(BAND_X - NODE.W/2) = -256 regardless of width
    expect(j.x + j.w / 2).toBe(-256)
  })

  it('anchors the sibling column inner edge to the right of the focus (grows rightward)', () => {
    const g = { focus: 'F', parents: [], children: [], jumps: [], siblings: ['s'], siblingParent: {} }
    const s = computeLayout(g, { s: 300 }).nodes.find((n) => n.zone === 'sibling')!
    expect(s.x).toBe(406)
    expect(s.x - s.w / 2).toBe(256) // left (inner) edge fixed at BAND_X - NODE.W/2 = 256
  })

  it('sizes each children column to its widest card', () => {
    // row-major fill: c1,c3 → left column; c2 → right column
    const g = { focus: 'F', parents: [], children: ['c1', 'c2', 'c3'], jumps: [], siblings: [], siblingParent: {} }
    const nodes = computeLayout(g, { c1: 100, c2: 300, c3: 400 }).nodes
    const c1 = nodes.find((n) => n.name === 'c1')!
    const c2 = nodes.find((n) => n.name === 'c2')!
    const c3 = nodes.find((n) => n.name === 'c3')!
    // leftColW = max(100,400)=400 → leftCenter = -(92/2 + 400/2) = -246
    // rightColW = 300 → rightCenter = +(46 + 150) = 196
    expect(c1.x).toBe(-246)
    expect(c3.x).toBe(-246) // same column, centered on the column center
    expect(c2.x).toBe(196)
    expect(c3.y).toBeGreaterThan(c1.y) // c3 wraps to the next row
  })

  it('expands the bbox to include a wide card', () => {
    const g = { focus: 'F', parents: ['wide'], children: [], jumps: [], siblings: [], siblingParent: {} }
    const { bbox } = computeLayout(g, { wide: 600 })
    expect(bbox.minX).toBe(-300) // single parent centered at x=0, half of 600
    expect(bbox.maxX).toBe(300)
  })
})

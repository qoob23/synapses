import { describe, it, expect } from 'vitest'
import { computeSymmetryRepairs, runSymmetryRepair, reconcileNoteAdjacency, type RepairOp } from './migrate'
import { buildOntology } from './ontology'
import type { DataSource, PageEntry, PropMap } from './types'

const ONT = buildOntology()
const pages = (o: Record<string, PropMap>): PageEntry[] => Object.entries(o).map(([name, props]) => ({ name, props }))
const setOp = (ops: RepairOp[], page: string, key: string) =>
  ops.find((o): o is Extract<RepairOp, { kind: 'set' }> => o.kind === 'set' && o.page === page && o.key === key)
const removeKeys = (ops: RepairOp[], page: string) =>
  ops.filter((o) => o.kind === 'remove' && o.page === page).map((o) => o.key)

const ONT_SIMPLE = { parent: ['parent'], child: ['child'], jump: ['jump'] }

it('reconcileNoteAdjacency surfaces an incoming-only parent', () => {
  // B declares A as its child; A declares nothing. A should see B as parent.
  const adj = reconcileNoteAdjacency('A', {}, [{ name: 'B', props: { child: ['A'] } }], ONT_SIMPLE)
  expect(adj.parents).toEqual(['B'])
  expect(adj.children).toEqual([])
})

it('reconcileNoteAdjacency: structural beats opposing jump (migration precedence)', () => {
  // A says jump:: B; B says child:: A (=> A is B's child => A sees B as parent). Structural wins.
  const adj = reconcileNoteAdjacency('A', { jump: ['B'] }, [{ name: 'B', props: { child: ['A'] } }], ONT_SIMPLE)
  expect(adj.parents).toEqual(['B'])
  expect(adj.jumps).toEqual([])
})

it('reconcileNoteAdjacency: incoming-only jump appears', () => {
  const adj = reconcileNoteAdjacency('A', {}, [{ name: 'B', props: { jump: ['A'] } }], ONT_SIMPLE)
  expect(adj.jumps).toEqual(['B'])
})

it('reconcileNoteAdjacency: no pairs => empty adjacency', () => {
  expect(reconcileNoteAdjacency('A', {}, [], ONT_SIMPLE)).toEqual({ parents: [], children: [], jumps: [] })
})

describe('computeSymmetryRepairs', () => {
  it('adds the missing reciprocal for a one-sided parent', () => {
    const ops = computeSymmetryRepairs(pages({ A: { parent: ['B'] } }), ONT)
    expect(setOp(ops, 'B', 'child')?.targets).toEqual(['A'])
    expect(setOp(ops, 'A', 'parent')).toBeUndefined()
  })
  it('leaves an already-symmetric pair untouched', () => {
    expect(computeSymmetryRepairs(pages({ A: { parent: ['B'] }, B: { child: ['A'] } }), ONT)).toEqual([])
  })
  it('completes a one-sided jump symmetrically', () => {
    expect(setOp(computeSymmetryRepairs(pages({ A: { jump: ['B'] } }), ONT), 'B', 'jump')?.targets).toEqual(['A'])
  })
  it('recognizes alias keys and writes the canonical reciprocal', () => {
    const ops = computeSymmetryRepairs(pages({ A: { parents: ['B'] } }), ONT)
    expect(setOp(ops, 'B', 'child')?.targets).toEqual(['A'])
    expect(setOp(ops, 'A', 'parent')).toBeUndefined()
  })
  it('preserves targets already present on the reciprocal key', () => {
    const ops = computeSymmetryRepairs(pages({ A: { parent: ['B'] }, B: { child: ['X'] } }), ONT)
    const t = setOp(ops, 'B', 'child')?.targets
    expect(t).toContain('X'); expect(t).toContain('A')
  })
  it('ignores self-links', () => {
    expect(computeSymmetryRepairs(pages({ A: { parent: ['A'] } }), ONT)).toEqual([])
  })
  it('materializes a referenced-but-uncreated target', () => {
    expect(setOp(computeSymmetryRepairs(pages({ A: { child: ['Ghost'] } }), ONT), 'Ghost', 'parent')?.targets).toEqual(['A'])
  })
  it('treats names case-insensitively', () => {
    expect(computeSymmetryRepairs(pages({ A: { parent: ['b'] }, B: { child: ['a'] } }), ONT)).toEqual([])
  })
  it('resolves a kind conflict structurally (parent/child beats jump)', () => {
    const ops = computeSymmetryRepairs(pages({ A: { parent: ['B'] }, B: { jump: ['A'] } }), ONT)
    expect(setOp(ops, 'B', 'child')?.targets).toEqual(['A'])
    expect(removeKeys(ops, 'B')).toContain('jump')
    expect(setOp(ops, 'A', 'parent')).toBeUndefined()
  })
  it('resolves opposing structural claims via the alphabetically-first page', () => {
    const ops = computeSymmetryRepairs(pages({ A: { parent: ['B'] }, B: { parent: ['A'] } }), ONT)
    expect(setOp(ops, 'A', 'parent')).toBeUndefined()
    expect(setOp(ops, 'B', 'child')?.targets).toEqual(['A'])
    expect(removeKeys(ops, 'B')).toContain('parent')
  })
})

describe('runSymmetryRepair', () => {
  function fakeDS(initial: Record<string, PropMap>) {
    const store = new Map<string, PropMap>()
    const names = new Map<string, string>()
    for (const [k, v] of Object.entries(initial)) { store.set(k.toLowerCase(), { ...v }); names.set(k.toLowerCase(), k) }
    const ds: DataSource = {
      getPageProps: async (n) => ({ ...(store.get(n.toLowerCase()) ?? {}) }),
      ensurePage: async (n) => { const l = n.toLowerCase(); if (!store.has(l)) { store.set(l, {}); names.set(l, n) } },
      setPropertyLinks: async (n, k, t) => { const l = n.toLowerCase(); const e = store.get(l) ?? {}; e[k] = t; store.set(l, e); if (!names.has(l)) names.set(l, n) },
      removePropertyKey: async (n, k) => { const e = store.get(n.toLowerCase()); if (e) delete e[k] },
      searchPages: async () => [],
      listAllPages: async () => [...store.entries()].map(([l, props]) => ({ name: names.get(l) ?? l, props })),
    }
    return { ds, store }
  }

  it('applies the resolved ops to the data source', async () => {
    const { ds, store } = fakeDS({ A: { parent: ['B'] }, B: { jump: ['A'] } })
    const n = await runSymmetryRepair(ds, ONT)
    expect(n).toBeGreaterThan(0)
    expect(store.get('b')?.child).toEqual(['A'])
    expect(store.get('b')?.jump).toBeUndefined()
    expect(store.get('a')?.parent).toEqual(['B'])
  })
  it('returns 0 when the data source cannot enumerate pages', async () => {
    const ds: DataSource = {
      getPageProps: async () => ({}), ensurePage: async () => {}, setPropertyLinks: async () => {},
      removePropertyKey: async () => {}, searchPages: async () => [],
    }
    expect(await runSymmetryRepair(ds, ONT)).toBe(0)
  })
})

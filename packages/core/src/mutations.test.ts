import { describe, it, expect } from 'vitest'
import { removeFromLinkList, createMutations } from './mutations'
import type { DataSource, OntologyConfig, PropMap } from './types'

describe('removeFromLinkList', () => {
  it('removes the target case-insensitively, preserving the rest and order', () => {
    expect(removeFromLinkList(['Ethics', 'Logic', 'Aristotle'], 'logic')).toEqual(['Ethics', 'Aristotle'])
  })
  it('is a no-op when the target is absent', () => {
    expect(removeFromLinkList(['Ethics'], 'Logic')).toEqual(['Ethics'])
  })
  it('returns [] when removing the only entry', () => {
    expect(removeFromLinkList(['Logic'], 'logic')).toEqual([])
  })
})

const ONT: OntologyConfig = { parent: ['parent', 'up'], child: ['child'], jump: ['jump'] }

// A live in-memory DataSource: writes mutate the store (so symmetric both-sides effects are
// observable) AND are recorded for assertions.
function fakeDataSource(initial: Record<string, PropMap> = {}) {
  const store = new Map<string, PropMap>(Object.entries(initial).map(([k, v]) => [k.toLowerCase(), { ...v }]))
  const sets: Array<[string, string, string[]]> = []
  const removes: Array<[string, string]> = []
  const ds: DataSource = {
    getPageProps: async (n) => ({ ...(store.get(n.toLowerCase()) ?? {}) }),
    ensurePage: async (n) => { if (!store.has(n.toLowerCase())) store.set(n.toLowerCase(), {}) },
    setPropertyLinks: async (n, k, t) => {
      sets.push([n, k, t])
      const e = store.get(n.toLowerCase()) ?? {}
      e[k] = t
      store.set(n.toLowerCase(), e)
    },
    removePropertyKey: async (n, k) => {
      removes.push([n, k])
      const e = store.get(n.toLowerCase()); if (e) delete e[k]
    },
    searchPages: async () => [],
  }
  const props = (n: string) => store.get(n.toLowerCase()) ?? {}
  return { ds, sets, removes, props }
}

describe('createMutations — symmetric writes', () => {
  it('createChild writes child on focus AND parent on the target (both sides)', async () => {
    const { ds, props } = fakeDataSource({ A: {} })
    const ok = await createMutations(ds, () => ONT).createChild('A', 'B')
    expect(ok).toBe(true)
    expect(props('A')).toEqual({ child: ['B'] })
    expect(props('B')).toEqual({ parent: ['A'] })
  })

  it('createParent writes parent on focus AND child on the target', async () => {
    const { ds, props } = fakeDataSource({ A: {} })
    await createMutations(ds, () => ONT).createParent('A', 'P')
    expect(props('A')).toEqual({ parent: ['P'] })
    expect(props('P')).toEqual({ child: ['A'] })
  })

  it('createJump writes jump on both sides (symmetric)', async () => {
    const { ds, props } = fakeDataSource({ A: {} })
    await createMutations(ds, () => ONT).createJump('A', 'B')
    expect(props('A')).toEqual({ jump: ['B'] })
    expect(props('B')).toEqual({ jump: ['A'] })
  })

  it('createChild merges onto an existing child list, keeping the originals', async () => {
    const { ds, props } = fakeDataSource({ A: { child: ['B'] }, B: { parent: ['A'] } })
    await createMutations(ds, () => ONT).createChild('A', 'C')
    expect(props('A').child).toEqual(['B', 'C'])
    expect(props('C')).toEqual({ parent: ['A'] })
  })

  it('removeLink rewrites the remainder and clears the reciprocal on the other page', async () => {
    const { ds, props, removes } = fakeDataSource({ A: { child: ['B', 'C'] }, B: { parent: ['A'] } })
    await createMutations(ds, () => ONT).removeLink('A', 'B', 'child')
    expect(props('A').child).toEqual(['C']) // remainder kept
    expect(removes).not.toContainEqual(['A', 'child']) // not removed wholesale
    expect(removes).toContainEqual(['B', 'parent']) // reciprocal cleared on B (became empty)
  })

  it('removeLink strips the alias key on both sides', async () => {
    const { ds, removes } = fakeDataSource({ A: { up: ['P'] }, P: { child: ['A'] } })
    await createMutations(ds, () => ONT).removeLink('A', 'P', 'parent')
    expect(removes).toContainEqual(['A', 'up']) // 'up' is a parent alias, became empty
    expect(removes).toContainEqual(['P', 'child'])
  })

  it('linkExisting on an unconnected pair only adds, on both sides', async () => {
    const { ds, props, removes } = fakeDataSource({ A: {}, B: {} })
    await createMutations(ds, () => ONT).linkExisting('A', 'B', 'jump')
    expect(props('A')).toEqual({ jump: ['B'] })
    expect(props('B')).toEqual({ jump: ['A'] })
    expect(removes).toEqual([])
  })

  it('retypes an existing parent into a jump, clearing the old role on both pages', async () => {
    const { ds, props, removes } = fakeDataSource({ A: { parent: ['B'] }, B: { child: ['A'] } })
    await createMutations(ds, () => ONT).linkExisting('A', 'B', 'jump')
    expect(removes).toContainEqual(['A', 'parent']) // old declaration cleared on A
    expect(removes).toContainEqual(['B', 'child']) // and its reciprocal on B
    expect(props('A')).toEqual({ jump: ['B'] })
    expect(props('B')).toEqual({ jump: ['A'] })
  })

  it('flips a parent into a child (direction reversal), symmetric on both pages', async () => {
    const { ds, props } = fakeDataSource({ A: { parent: ['B'] }, B: { child: ['A'] } })
    await createMutations(ds, () => ONT).linkExisting('A', 'B', 'child')
    expect(props('A')).toEqual({ child: ['B'] })
    expect(props('B')).toEqual({ parent: ['A'] })
  })

  it('re-affirming the same role removes nothing and dedupes', async () => {
    const { ds, props, removes } = fakeDataSource({ A: { jump: ['B'] }, B: { jump: ['A'] } })
    await createMutations(ds, () => ONT).linkExisting('A', 'B', 'jump')
    expect(removes).toEqual([])
    expect(props('A').jump).toEqual(['B']) // deduped, not doubled
    expect(props('B').jump).toEqual(['A'])
  })

  it('collapses a legacy multi-role pair to the single chosen role', async () => {
    const { ds, props, removes } = fakeDataSource({ A: { parent: ['B'], jump: ['B'] }, B: { child: ['A'] } })
    await createMutations(ds, () => ONT).linkExisting('A', 'B', 'parent') // keep parent, drop the stray jump
    expect(removes).toContainEqual(['A', 'jump'])
    expect(removes).not.toContainEqual(['A', 'parent']) // parent kept
    expect(props('A').parent).toEqual(['B'])
    expect(props('B').child).toEqual(['A'])
  })
})

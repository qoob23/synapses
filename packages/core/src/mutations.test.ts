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

// A live in-memory DataSource: writes mutate the store (so single-sided writes and the
// reciprocal-clearing they perform on the other page are observable) AND are recorded for
// assertions.
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

// Writes are single-sided: the role is declared ONLY on the note the user interacted with
// (`focus`). Any pre-existing connection between the pair — declared on EITHER page — is
// dropped from both pages first; the reciprocal is never written to the untouched target.
describe('createMutations — single-sided writes', () => {
  it('createChild writes child only on the focus, no reciprocal on the target', async () => {
    const { ds, props } = fakeDataSource({ A: {} })
    const ok = await createMutations(ds, () => ONT).createChild('A', 'B')
    expect(ok).toBe(true)
    expect(props('A')).toEqual({ child: ['B'] })
    expect(props('B')).toEqual({}) // target untouched
  })

  it('createParent writes parent only on the focus', async () => {
    const { ds, props } = fakeDataSource({ A: {} })
    await createMutations(ds, () => ONT).createParent('A', 'P')
    expect(props('A')).toEqual({ parent: ['P'] })
    expect(props('P')).toEqual({})
  })

  it('createJump writes jump only on the focus', async () => {
    const { ds, props } = fakeDataSource({ A: {} })
    await createMutations(ds, () => ONT).createJump('A', 'B')
    expect(props('A')).toEqual({ jump: ['B'] })
    expect(props('B')).toEqual({})
  })

  it('createChild merges onto an existing child list, keeping the originals', async () => {
    const { ds, props } = fakeDataSource({ A: { child: ['B'] } })
    await createMutations(ds, () => ONT).createChild('A', 'C')
    expect(props('A').child).toEqual(['B', 'C'])
    expect(props('C')).toEqual({})
  })

  it('dedupes when re-affirming a link the focus already declares', async () => {
    const { ds, props, removes } = fakeDataSource({ A: { jump: ['B'] } })
    await createMutations(ds, () => ONT).linkExisting('A', 'B', 'jump')
    expect(props('A').jump).toEqual(['B']) // deduped, not doubled
    expect(removes).toEqual([])
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

  it('removeLink clears both sides so a link cannot resurrect on read', async () => {
    const { ds, props } = fakeDataSource({ A: { parent: ['B'] }, B: { child: ['A'] } })
    await createMutations(ds, () => ONT).removeLink('A', 'B', 'parent')
    expect(props('A')).toEqual({})
    expect(props('B')).toEqual({})
  })

  // The canonical spec example: A has parent::B (B holds nothing); the user drags the
  // jump handle from B to A → linkExisting(focus=B, target=A, jump). Result: B gets
  // jump::A and A is emptied (its conflicting parent::B is removed).
  it('drops the conflicting connection from the OTHER page and leaves it bare', async () => {
    const { ds, props } = fakeDataSource({ A: { parent: ['B'] }, B: {} })
    await createMutations(ds, () => ONT).linkExisting('B', 'A', 'jump')
    expect(props('B')).toEqual({ jump: ['A'] })
    expect(props('A')).toEqual({}) // parent::B removed, no jump::B added
  })

  it('drops a conflicting role declared on the interacted note itself', async () => {
    const { ds, props } = fakeDataSource({ A: { parent: ['B'] }, B: {} })
    await createMutations(ds, () => ONT).linkExisting('A', 'B', 'jump')
    expect(props('A')).toEqual({ jump: ['B'] })
    expect(props('B')).toEqual({})
  })

  it('retypes a connection on the focus, clearing the old role on both pages', async () => {
    const { ds, props, removes } = fakeDataSource({ A: { parent: ['B'] }, B: { child: ['A'] } })
    await createMutations(ds, () => ONT).linkExisting('A', 'B', 'jump')
    expect(removes).toContainEqual(['A', 'parent']) // old declaration cleared on A
    expect(removes).toContainEqual(['B', 'child']) // and its reciprocal on B
    expect(props('A')).toEqual({ jump: ['B'] })
    expect(props('B')).toEqual({}) // reciprocal NOT re-written single-sided
  })

  it('collapses a legacy multi-role pair to the single chosen role', async () => {
    const { ds, props, removes } = fakeDataSource({ A: { parent: ['B'], jump: ['B'] }, B: { child: ['A'] } })
    await createMutations(ds, () => ONT).linkExisting('A', 'B', 'parent') // keep parent, drop the stray jump
    expect(removes).toContainEqual(['A', 'jump'])
    expect(props('A')).toEqual({ parent: ['B'] })
    expect(props('B')).toEqual({}) // the other page is only cleaned, never given a reciprocal
  })
})

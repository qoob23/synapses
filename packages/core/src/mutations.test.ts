import { describe, it, expect, vi } from 'vitest'
import { removeFromLinkList, createMutations } from './mutations'
import type { DataSource, OntologyConfig } from './types'

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

function spyDataSource(initial: Record<string, Record<string, string[]>> = {}): DataSource & { sets: any[]; removes: any[] } {
  const props = new Map(Object.entries(initial).map(([k, v]) => [k.toLowerCase(), v]))
  const sets: any[] = []; const removes: any[] = []
  return {
    sets, removes,
    listPages: async () => [],
    getPageProps: async (n: string) => props.get(n.toLowerCase()) ?? {},
    ensurePage: vi.fn(async () => {}),
    setPropertyLinks: async (n: string, k: string, t: string[]) => { sets.push([n, k, t]) },
    removePropertyKey: async (n: string, k: string) => { removes.push([n, k]) },
    searchPages: async () => [],
  } as any
}

describe('createMutations', () => {
  it('createChild ensures the target page, appends the child link, and patches the index', async () => {
    const ds = spyDataSource({ A: {} })
    const patch = vi.fn()
    const mut = createMutations(ds, { patchIndex: patch, patchRemove: vi.fn() } as any, () => ONT)
    const ok = await mut.createChild('A', 'B')
    expect(ok).toBe(true)
    expect(ds.ensurePage).toHaveBeenCalledWith('B')
    expect(ds.sets).toContainEqual(['A', 'child', ['B']])
    expect(patch).toHaveBeenCalledWith('A', 'child', 'B')
  })

  it('createChild merges onto an existing child list, keeping the originals', async () => {
    const ds = spyDataSource({ A: { child: ['B'] } })
    const patch = vi.fn()
    const mut = createMutations(ds, { patchIndex: patch, patchRemove: vi.fn() } as any, () => ONT)
    await mut.createChild('A', 'C')
    expect(ds.sets).toContainEqual(['A', 'child', ['B', 'C']]) // merged, original kept
    expect(patch).toHaveBeenCalledWith('A', 'child', 'C')
  })

  it('removeLink rewrites the key with the remainder when other targets remain', async () => {
    const ds = spyDataSource({ A: { child: ['B', 'C'] } })
    const patchRemove = vi.fn()
    const mut = createMutations(ds, { patchIndex: vi.fn(), patchRemove } as any, () => ONT)
    await mut.removeLink('A', 'B', 'child')
    expect(ds.sets).toContainEqual(['A', 'child', ['C']]) // rewrite with the remainder
    expect(ds.removes).not.toContainEqual(['A', 'child']) // NOT removed wholesale
    expect(patchRemove).toHaveBeenCalledWith('A', 'child', 'B')
  })

  it('removeLink strips the alias key on both sides and patches removal', async () => {
    const ds = spyDataSource({ A: { up: ['P'] }, P: { child: ['A'] } })
    const patchRemove = vi.fn()
    const mut = createMutations(ds, { patchIndex: vi.fn(), patchRemove } as any, () => ONT)
    await mut.removeLink('A', 'P', 'parent')
    expect(ds.removes).toContainEqual(['A', 'up']) // 'up' is a parent alias, became empty
    expect(ds.removes).toContainEqual(['P', 'child'])
    expect(patchRemove).toHaveBeenCalledWith('A', 'parent', 'P')
  })
})

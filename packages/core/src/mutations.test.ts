import { describe, it, expect, vi } from 'vitest'
import { removeFromLinkList, createMutations } from './mutations'
import type { DataSource, OntologyConfig, Role } from './types'

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

// A stub index whose rolesBetween returns a fixed set, recording the patch calls.
function spyIndex(existing: Role[] = []) {
  return {
    patchIndex: vi.fn(),
    patchRemove: vi.fn(),
    rolesBetween: vi.fn(async () => existing),
  }
}

describe('createMutations', () => {
  it('createChild ensures the target page, appends the child link, and patches the index', async () => {
    const ds = spyDataSource({ A: {} })
    const index = spyIndex([])
    const mut = createMutations(ds, index, () => ONT)
    const ok = await mut.createChild('A', 'B')
    expect(ok).toBe(true)
    expect(ds.ensurePage).toHaveBeenCalledWith('B')
    expect(ds.sets).toContainEqual(['A', 'child', ['B']])
    expect(index.patchIndex).toHaveBeenCalledWith('A', 'child', 'B')
    expect(index.patchRemove).not.toHaveBeenCalled() // brand-new page: nothing to retype
  })

  it('createChild merges onto an existing child list, keeping the originals', async () => {
    const ds = spyDataSource({ A: { child: ['B'] } })
    const index = spyIndex(['child']) // B already a child — same role, no removal
    const mut = createMutations(ds, index, () => ONT)
    await mut.createChild('A', 'C')
    expect(ds.sets).toContainEqual(['A', 'child', ['B', 'C']]) // merged, original kept
    expect(index.patchIndex).toHaveBeenCalledWith('A', 'child', 'C')
  })

  it('removeLink rewrites the key with the remainder when other targets remain', async () => {
    const ds = spyDataSource({ A: { child: ['B', 'C'] } })
    const index = spyIndex()
    const mut = createMutations(ds, index, () => ONT)
    await mut.removeLink('A', 'B', 'child')
    expect(ds.sets).toContainEqual(['A', 'child', ['C']]) // rewrite with the remainder
    expect(ds.removes).not.toContainEqual(['A', 'child']) // NOT removed wholesale
    expect(index.patchRemove).toHaveBeenCalledWith('A', 'child', 'B')
  })

  it('removeLink strips the alias key on both sides and patches removal', async () => {
    const ds = spyDataSource({ A: { up: ['P'] }, P: { child: ['A'] } })
    const index = spyIndex()
    const mut = createMutations(ds, index, () => ONT)
    await mut.removeLink('A', 'P', 'parent')
    expect(ds.removes).toContainEqual(['A', 'up']) // 'up' is a parent alias, became empty
    expect(ds.removes).toContainEqual(['P', 'child'])
    expect(index.patchRemove).toHaveBeenCalledWith('A', 'parent', 'P')
  })

  it('linkExisting on an unconnected pair only adds, with no removal', async () => {
    const ds = spyDataSource({ A: {} })
    const index = spyIndex([])
    const mut = createMutations(ds, index, () => ONT)
    await mut.linkExisting('A', 'B', 'jump')
    expect(ds.sets).toContainEqual(['A', 'jump', ['B']])
    expect(ds.removes).toEqual([])
    expect(index.patchRemove).not.toHaveBeenCalled()
    expect(index.patchIndex).toHaveBeenCalledWith('A', 'jump', 'B')
  })

  it('linkExisting retypes an existing parent into a jump, clearing both declaration sides', async () => {
    // B is the parent of A, declared as A.parent::B (and the reciprocal B.child::A on B).
    const ds = spyDataSource({ A: { parent: ['B'] }, B: { child: ['A'] } })
    const index = spyIndex(['parent'])
    const mut = createMutations(ds, index, () => ONT)
    await mut.linkExisting('A', 'B', 'jump')
    // old parent declaration removed on both pages
    expect(ds.removes).toContainEqual(['A', 'parent']) // A.parent::B was the only value → key removed
    expect(ds.removes).toContainEqual(['B', 'child']) // reciprocal cleared on B
    expect(index.patchRemove).toHaveBeenCalledWith('A', 'parent', 'B')
    // new jump declaration written
    expect(ds.sets).toContainEqual(['A', 'jump', ['B']])
    expect(index.patchIndex).toHaveBeenCalledWith('A', 'jump', 'B')
  })

  it('linkExisting flips a parent into a child (direction reversal)', async () => {
    const ds = spyDataSource({ A: { parent: ['B'] }, B: { child: ['A'] } })
    const index = spyIndex(['parent'])
    const mut = createMutations(ds, index, () => ONT)
    await mut.linkExisting('A', 'B', 'child')
    expect(ds.removes).toContainEqual(['A', 'parent'])
    expect(ds.removes).toContainEqual(['B', 'child'])
    expect(ds.sets).toContainEqual(['A', 'child', ['B']])
    expect(index.patchRemove).toHaveBeenCalledWith('A', 'parent', 'B')
    expect(index.patchIndex).toHaveBeenCalledWith('A', 'child', 'B')
  })

  it('linkExisting re-affirming the same role does not remove anything', async () => {
    const ds = spyDataSource({ A: { jump: ['B'] }, B: { jump: ['A'] } })
    const index = spyIndex(['jump'])
    const mut = createMutations(ds, index, () => ONT)
    await mut.linkExisting('A', 'B', 'jump')
    expect(ds.removes).toEqual([])
    expect(index.patchRemove).not.toHaveBeenCalled()
    expect(ds.sets).toContainEqual(['A', 'jump', ['B']]) // deduped append (no-op set)
  })

  it('linkExisting collapses a legacy multi-role pair to the single chosen role', async () => {
    // Buggy pre-existing state: A declares BOTH parent::B and jump::B.
    const ds = spyDataSource({ A: { parent: ['B'], jump: ['B'] }, B: {} })
    const index = spyIndex(['parent', 'jump'])
    const mut = createMutations(ds, index, () => ONT)
    await mut.linkExisting('A', 'B', 'parent') // keep parent, drop the stray jump
    expect(ds.removes).toContainEqual(['A', 'jump'])
    expect(index.patchRemove).toHaveBeenCalledWith('A', 'jump', 'B')
    expect(index.patchRemove).not.toHaveBeenCalledWith('A', 'parent', 'B') // parent kept
    expect(ds.sets).toContainEqual(['A', 'parent', ['B']])
  })
})

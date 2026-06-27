import { describe, it, expect } from 'vitest'
import { createLinkIndex } from './link-index'
import type { DataSource, PageEntry, PropMap, OntologyConfig } from '../types'

const ONT: OntologyConfig = { parent: ['parent'], child: ['child'], jump: ['jump'] }

function fakeDataSource(pages: PageEntry[]): DataSource {
  const map = new Map(pages.map((p) => [p.name.toLowerCase(), p]))
  return {
    listPages: async () => [...map.values()],
    getPageProps: async (n) => map.get(n.toLowerCase())?.props ?? {},
    ensurePage: async () => {},
    setPropertyLinks: async () => {},
    removePropertyKey: async () => {},
    searchPages: async () => [],
    pageExists: async (n) => map.has(n.toLowerCase()),
  }
}

describe('createLinkIndex', () => {
  it('builds once and queries reciprocals', async () => {
    const ds = fakeDataSource([{ name: 'A', props: { child: ['B'] } as PropMap }, { name: 'B', props: {} }])
    const idx = createLinkIndex(ds, () => ONT)
    const g = await idx.buildGraph('B')
    expect(g.parents).toEqual(['A'])
  })

  it('patchIndex makes an edge visible before rebuild, and rebuild keeps an unconfirmed patch', async () => {
    const ds = fakeDataSource([{ name: 'A', props: {} }, { name: 'B', props: {} }])
    const idx = createLinkIndex(ds, () => ONT)
    await idx.buildGraph('A')
    idx.patchIndex('A', 'child', 'B')
    expect((await idx.buildGraph('A')).children).toEqual(['B'])
    await idx.rebuild() // fresh read still lacks A->B; patch must be replayed
    expect((await idx.buildGraph('A')).children).toEqual(['B'])
  })

  it('patchRemove hides an edge and survives rebuild until the read confirms it', async () => {
    const ds = fakeDataSource([{ name: 'A', props: { child: ['B'] } as PropMap }, { name: 'B', props: {} }])
    const idx = createLinkIndex(ds, () => ONT)
    await idx.buildGraph('A')
    idx.patchRemove('A', 'child', 'B')
    expect((await idx.buildGraph('A')).children).toEqual([])
    await idx.rebuild() // read still HAS A->B; remove patch replayed
    expect((await idx.buildGraph('A')).children).toEqual([])
  })
})

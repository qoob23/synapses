import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createCoreBackend } from './backend'
import type { DataSource, EditorServices, PageEntry } from './types'

function fakes(pages: PageEntry[] = []) {
  const map = new Map(pages.map((p) => [p.name.toLowerCase(), p]))
  const store = new Map<string, string>()
  let graphCb = () => {}, activeCb = (_: string | null) => {}
  const ds: DataSource = {
    listPages: async () => [...map.values()],
    getPageProps: async (n) => map.get(n.toLowerCase())?.props ?? {},
    ensurePage: async (n) => { if (!map.has(n.toLowerCase())) map.set(n.toLowerCase(), { name: n, props: {} }) },
    setPropertyLinks: async (n, k, t) => { const e = map.get(n.toLowerCase())!; e.props = { ...e.props, [k]: t } },
    removePropertyKey: async (n, k) => { const e = map.get(n.toLowerCase())!; const { [k]: _, ...rest } = e.props; e.props = rest },
    searchPages: async (q) => [...map.values()].map((p) => p.name).filter((n) => n.toLowerCase().includes(q.toLowerCase())),
    pageExists: async (n) => map.has(n.toLowerCase()),
  }
  const services: EditorServices = {
    getActivePageName: () => 'A',
    onActivePageChange: (cb) => { activeCb = cb },
    navigateTo: vi.fn(async () => {}),
    getTheme: () => ({ mode: 'light' }),
    onThemeChange: () => {},
    onGraphChange: (cb) => { graphCb = cb },
    getOntology: () => ({ parent: ['parent'], child: ['child'], jump: ['jump'] }),
    onOntologyChange: () => {},
    persistence: {
      load: async (k: string) => store.get(k) ?? null,
      save: async (k: string, v: string) => { store.set(k, v) },
    },
  }
  return { ds, services, fireGraph: () => graphCb(), fireActive: (n: string | null) => activeCb(n) }
}

describe('createCoreBackend', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('buildGraph reflects a createChild mutation immediately (via patch)', async () => {
    const { ds, services } = fakes([{ name: 'A', props: {} }])
    const be = createCoreBackend(ds, services)
    await be.createChild('A', 'B')
    expect((await be.buildGraph('A')).children).toEqual(['B'])
  })

  it('onGraphChange debounces a rebuild then emits refresh', async () => {
    const { ds, services, fireGraph } = fakes([{ name: 'A', props: {} }])
    const be = createCoreBackend(ds, services)
    const refresh = vi.fn(); be.on('refresh', refresh)
    fireGraph(); fireGraph()
    await vi.advanceTimersByTimeAsync(400)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('histRemove removes an entry, returns new state, and persists', async () => {
    const { ds, services } = fakes([{ name: 'A', props: {} }, { name: 'B', props: {} }])
    const be = createCoreBackend(ds, services)
    await be.histPush('A'); await be.histPush('B')
    expect(await be.histRemove('A')).toEqual({ list: ['B'], index: 0 })
    await vi.advanceTimersByTimeAsync(300)
    const raw = await services.persistence.load('history.json')
    expect(raw && JSON.parse(raw)).toEqual({ stack: ['B'], idx: 0 })
  })

  it('histRemoveMissing prunes only entries whose file is gone', async () => {
    const { ds, services } = fakes([{ name: 'A', props: {} }, { name: 'C', props: {} }])
    const be = createCoreBackend(ds, services)
    await be.histPush('A'); await be.histPush('B'); await be.histPush('C')
    const { removed, state } = await be.histRemoveMissing(['A', 'B', 'C'])
    expect(removed).toEqual(['B'])
    expect(state).toEqual({ list: ['A', 'C'], index: 1 })
  })

  it('onActivePageChange emits recenter with the page', () => {
    const { ds, services, fireActive } = fakes()
    const be = createCoreBackend(ds, services)
    const recenter = vi.fn(); be.on('recenter', recenter)
    fireActive('Z')
    expect(recenter).toHaveBeenCalledWith({ page: 'Z' })
  })

  it('getSize returns null when unset', async () => {
    const { ds, services } = fakes()
    const be = createCoreBackend(ds, services)
    expect(await be.getSize()).toBeNull()
  })

  it('setSize then getSize round-trips the level through persistence (debounced)', async () => {
    const { ds, services } = fakes()
    const be = createCoreBackend(ds, services)
    await be.setSize(3)
    await vi.advanceTimersByTimeAsync(300)
    expect(await be.getSize()).toBe(3)
  })

  it('setSize(null) clears the remembered size immediately (reset to default)', async () => {
    const { ds, services } = fakes()
    const be = createCoreBackend(ds, services)
    await be.setSize(3)
    await vi.advanceTimersByTimeAsync(300)
    await be.setSize(null) // immediate, no debounce
    expect(await be.getSize()).toBeNull()
  })
})

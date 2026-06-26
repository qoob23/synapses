import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createCoreBackend } from './backend'
import type { DataSource, EditorServices, PageEntry } from './types'

function fakes(pages: PageEntry[] = []) {
  const map = new Map(pages.map((p) => [p.name.toLowerCase(), p]))
  let graphCb = () => {}, activeCb = (_: string | null) => {}
  const ds: DataSource = {
    listPages: async () => [...map.values()],
    getPageProps: async (n) => map.get(n.toLowerCase())?.props ?? {},
    ensurePage: async (n) => { if (!map.has(n.toLowerCase())) map.set(n.toLowerCase(), { name: n, props: {} }) },
    setPropertyLinks: async (n, k, t) => { const e = map.get(n.toLowerCase())!; e.props = { ...e.props, [k]: t } },
    removePropertyKey: async (n, k) => { const e = map.get(n.toLowerCase())!; const { [k]: _, ...rest } = e.props; e.props = rest },
    searchPages: async (q) => [...map.values()].map((p) => p.name).filter((n) => n.toLowerCase().includes(q.toLowerCase())),
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
    persistence: { load: async () => null, save: vi.fn(async () => {}) },
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

  it('onActivePageChange emits recenter with the page', () => {
    const { ds, services, fireActive } = fakes()
    const be = createCoreBackend(ds, services)
    const recenter = vi.fn(); be.on('recenter', recenter)
    fireActive('Z')
    expect(recenter).toHaveBeenCalledWith({ page: 'Z' })
  })
})

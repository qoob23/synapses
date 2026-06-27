import { createLinkIndex } from './graph/link-index'
import { createMutations } from './mutations'
import { createHistory, serialize, deserialize } from './history'
import type { HistoryStack } from './history'
import type { DataSource, EditorServices, SynapsesBackend, BackendEvent, Palette } from './types'

export const GRAPH_DEBOUNCE_MS = 400
export const HISTORY_SAVE_DEBOUNCE_MS = 300
export const ZOOM_SAVE_DEBOUNCE_MS = 300
const HISTORY_KEY = 'history.json'
const ZOOM_KEY = 'zoom'

export function createCoreBackend(dataSource: DataSource, services: EditorServices): SynapsesBackend {
  const getOntology = () => services.getOntology()
  const index = createLinkIndex(dataSource, getOntology)
  const mut = createMutations(dataSource, index, getOntology)

  // history with debounced persistence
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const history = createHistory((state: HistoryStack) => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      services.persistence.save(HISTORY_KEY, serialize(state)).catch((e) => console.warn('[synapses] history save failed', e))
    }, HISTORY_SAVE_DEBOUNCE_MS)
  })
  const ready = (async () => {
    try {
      const raw = await services.persistence.load(HISTORY_KEY)
      const loaded = raw ? deserialize(raw) : null
      if (loaded) history.load(loaded)
    } catch (e) { console.warn('[synapses] history load failed', e) }
  })()

  // events
  const listeners = new Map<BackendEvent, Set<(p?: any) => void>>([
    ['recenter', new Set()], ['theme', new Set()], ['refresh', new Set()],
  ])
  const emit = (evt: BackendEvent, payload?: any) => listeners.get(evt)!.forEach((fn) => fn(payload))

  // remembered wheel-zoom scale, persisted with the same debounce shape as history
  let zoomTimer: ReturnType<typeof setTimeout> | undefined

  let graphTimer: ReturnType<typeof setTimeout> | undefined
  services.onGraphChange(() => {
    if (graphTimer) clearTimeout(graphTimer)
    graphTimer = setTimeout(async () => {
      try { await index.rebuild() } catch (e) { console.warn('[synapses] rebuild failed', e) }
      emit('refresh')
    }, GRAPH_DEBOUNCE_MS)
  })
  services.onActivePageChange((name) => { if (name) emit('recenter', { page: name }) })
  services.onThemeChange((p: Palette) => emit('theme', p))
  services.onOntologyChange(async () => {
    try { await index.rebuild() } catch (e) { console.warn('[synapses] rebuild failed', e) }
    emit('refresh')
  })

  return {
    getActivePage: async () => services.getActivePageName(),
    getTheme: async () => services.getTheme(),
    buildGraph: (name) => index.buildGraph(name),
    nodeAdjacency: (names) => index.nodeAdjacency(names),
    histState: async () => { await ready; return history.state() },
    histPush: async (name) => { await ready; return history.push(name) },
    histJump: async (i) => { await ready; return history.jump(i) },
    navigate: async (name) => { await services.navigateTo(name); return true },
    createChild: mut.createChild,
    createParent: mut.createParent,
    createJump: mut.createJump,
    linkExisting: mut.linkExisting,
    removeLink: mut.removeLink,
    searchPages: (q) => dataSource.searchPages(q),
    getZoom: async () => {
      try {
        const raw = await services.persistence.load(ZOOM_KEY)
        if (raw == null) return null
        const n = Number(raw)
        return Number.isFinite(n) ? n : null
      } catch (e) { console.warn('[synapses] zoom load failed', e); return null }
    },
    setZoom: async (s) => {
      if (zoomTimer) clearTimeout(zoomTimer)
      zoomTimer = setTimeout(() => {
        services.persistence.save(ZOOM_KEY, String(s)).catch((e) => console.warn('[synapses] zoom save failed', e))
      }, ZOOM_SAVE_DEBOUNCE_MS)
    },
    on: (event, handler) => { listeners.get(event)!.add(handler); return () => listeners.get(event)!.delete(handler) },
  }
}

import { createLinkIndex } from './graph/link-index'
import { createHistory, serialize, deserialize } from './history'
import { createMutations } from './mutations'
import type { HistoryStack } from './history'
import type { DataSource, EditorServices, SynapsesBackend, BackendEvent, BackendEventPayloads, Palette, ConnectorColors } from './types'

export const GRAPH_DEBOUNCE_MS = 400
export const HISTORY_SAVE_DEBOUNCE_MS = 300
export const SIZE_SAVE_DEBOUNCE_MS = 300
const HISTORY_KEY = 'history.json'
const SIZE_KEY = 'size'
const COLORS_KEY = 'connectorColors'

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

  // events — typed per-event payloads via BackendEventPayloads
  const listeners: { [K in BackendEvent]: Set<(p: BackendEventPayloads[K]) => void> } = {
    recenter: new Set(), theme: new Set(), refresh: new Set(), uimode: new Set(),
  }
  function emit<K extends BackendEvent>(evt: K, payload: BackendEventPayloads[K]) {
    for (const fn of listeners[evt]) fn(payload)
  }

  // remembered card/text size level, persisted with the same debounce shape as history
  let sizeTimer: ReturnType<typeof setTimeout> | undefined

  // Shared by the debounced graph-change and the ontology-change listeners.
  async function rebuildAndRefresh() {
    try { await index.rebuild() } catch (e) { console.warn('[synapses] rebuild failed', e) }
    emit('refresh', undefined)
  }

  let graphTimer: ReturnType<typeof setTimeout> | undefined
  services.onGraphChange(() => {
    if (graphTimer) clearTimeout(graphTimer)
    graphTimer = setTimeout(() => void rebuildAndRefresh(), GRAPH_DEBOUNCE_MS)
  })
  services.onActivePageChange((name) => { if (name) emit('recenter', { page: name }) })
  services.onThemeChange((p: Palette) => emit('theme', p))
  services.onUiModeChange(() => emit('uimode', undefined))
  services.onOntologyChange(() => void rebuildAndRefresh())

  return {
    getActivePage: async () => services.getActivePageName(),
    getTheme: async () => services.getTheme(),
    getUiMode: async () => services.getUiMode(),
    buildGraph: (name) => index.buildGraph(name),
    nodeAdjacency: (names) => index.nodeAdjacency(names),
    // Hard refresh: blow away the in-memory index + pending patches and rebuild
    // straight from the editor. The app forces a full re-render after awaiting this,
    // so we deliberately don't emit 'refresh' (which the view may skip if unchanged).
    rebuildIndex: () => index.hardReset(),
    histState: async () => { await ready; return history.state() },
    histPush: async (name) => { await ready; return history.push(name) },
    histJump: async (i) => { await ready; return history.jump(i) },
    histRemove: async (name) => { await ready; return history.remove(name) },
    histRemoveMissing: async (names) => {
      await ready
      const removed: string[] = []
      for (const n of names) {
        let exists = true
        try { exists = await dataSource.pageExists(n) } catch { exists = true }
        if (!exists) { removed.push(n); history.remove(n) }
      }
      return { removed, state: history.state() }
    },
    navigate: async (name) => { await services.navigateTo(name); return true },
    createChild: mut.createChild,
    createParent: mut.createParent,
    createJump: mut.createJump,
    linkExisting: mut.linkExisting,
    removeLink: mut.removeLink,
    searchPages: (q) => dataSource.searchPages(q),
    getSize: async () => {
      try {
        const raw = await services.persistence.load(SIZE_KEY)
        if (raw == null || raw === '') return null
        const n = Number(raw)
        return Number.isInteger(n) && n >= 0 ? n : null // '' / NaN / non-int == reset (default size)
      } catch (e) { console.warn('[synapses] size load failed', e); return null }
    },
    // level === null resets to the default size; an integer level is debounced like
    // history. Clearing is immediate so a reset can't be clobbered by a stale save.
    setSize: async (level) => {
      if (sizeTimer) clearTimeout(sizeTimer)
      if (level == null) {
        services.persistence.save(SIZE_KEY, '').catch((e) => console.warn('[synapses] size clear failed', e))
        return
      }
      sizeTimer = setTimeout(() => {
        services.persistence.save(SIZE_KEY, String(level)).catch((e) => console.warn('[synapses] size save failed', e))
      }, SIZE_SAVE_DEBOUNCE_MS)
    },
    getConnectorColors: async () => {
      try {
        const raw = await services.persistence.load(COLORS_KEY)
        if (!raw) return {}
        const obj: unknown = JSON.parse(raw)
        return obj && typeof obj === 'object' ? (obj as ConnectorColors) : {}
      } catch (e) { console.warn('[synapses] connector colors load failed', e); return {} }
    },
    // Persisted immediately (not debounced) — color edits are deliberate, infrequent
    // clicks, and a reset must not be clobbered by a stale debounced save.
    setConnectorColors: async (colors) => {
      try { await services.persistence.save(COLORS_KEY, JSON.stringify(colors || {})) }
      catch (e) { console.warn('[synapses] connector colors save failed', e) }
    },
    on: <K extends BackendEvent>(event: K, handler: (p: BackendEventPayloads[K]) => void) => {
      listeners[event].add(handler)
      return () => listeners[event].delete(handler)
    },
  }
}

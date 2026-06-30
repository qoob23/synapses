import { assembleGraph, type NoteAdjacency } from './graph/index-pure'
import { createHistory, serialize, deserialize } from './history'
import { log } from './log'
import { noopLogger, type Logger } from './logger'
import { runSymmetryRepair, reconcileNoteAdjacency } from './migrate'
import { createMutations } from './mutations'
import type { HistoryStack } from './history'
import type { DataSource, EditorServices, SynapsesBackend, BackendEvent, BackendEventPayloads, Palette, ConnectorColors, Adjacency } from './types'

export const HISTORY_SAVE_DEBOUNCE_MS = 300
export const SIZE_SAVE_DEBOUNCE_MS = 300
const HISTORY_KEY = 'history.json'
const SIZE_KEY = 'size'
const COLORS_KEY = 'connectorColors'

export function createCoreBackend(dataSource: DataSource, services: EditorServices, logger: Logger = noopLogger): SynapsesBackend {
  const getOntology = () => services.getOntology()
  const mut = createMutations(dataSource, getOntology, () => services.getSymmetricLinks())

  // On-demand reconciled neighborhood reads (no in-memory index). A note's links =
  // own props reconciled with its backlinks (notes pointing at it), so links
  // declared only on OTHER note still show. Conflict resolution =
  // symmetry-migration precedence (structural beats jump; opposing → alphabetical).
  async function reconcile(name: string): Promise<NoteAdjacency> {
    const ont = getOntology()
    const [own, back] = await Promise.all([
      dataSource.getPageProps(name),
      dataSource.getBacklinks ? dataSource.getBacklinks(name) : Promise.resolve([]),
    ])
    return reconcileNoteAdjacency(name, own, back, ont)
  }
  async function buildGraph(name: string) {
    const adj = await reconcile(name)
    const parentsAdj: Record<string, NoteAdjacency> = {}
    await Promise.all(adj.parents.map(async (p) => { parentsAdj[p.toLowerCase()] = await reconcile(p) }))
    return assembleGraph(name, adj, parentsAdj)
  }
  async function nodeAdjacency(names: string[]): Promise<Adjacency> {
    const out: Adjacency = {}
    await Promise.all((names || []).map(async (n) => { out[n.toLowerCase()] = await reconcile(n) }))
    return out
  }

  // history with debounced persistence
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const history = createHistory((state: HistoryStack) => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      services.persistence.save(HISTORY_KEY, serialize(state)).catch((e) => log.warn('history save failed', e))
    }, HISTORY_SAVE_DEBOUNCE_MS)
  })
  const ready = (async () => {
    try {
      const raw = await services.persistence.load(HISTORY_KEY)
      const loaded = raw ? deserialize(raw) : null
      if (loaded) history.load(loaded)
    } catch (e) { log.warn('history load failed', e) }
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

  // No index to rebuild: every editor change just tells the app to re-read + re-render the
  // focus note on demand. Undebounced — reads are small and the app's graphKey guard absorbs
  // the duplicate/two-sided-write events without flicker.
  services.onGraphChange(() => { logger.log('editor', 'graphChange'); emit('refresh', undefined) })
  services.onActivePageChange((name) => { if (name) { logger.log('editor', 'activePage', { page: name }); emit('recenter', { page: name }) } })
  services.onThemeChange((p: Palette) => { logger.log('editor', 'theme', { mode: p.mode }); emit('theme', p) })
  services.onUiModeChange(() => { logger.log('editor', 'uimode'); emit('uimode', undefined) })
  services.onOntologyChange(() => { logger.log('editor', 'ontology'); emit('refresh', undefined) })

  return {
    getActivePage: async () => services.getActivePageName(),
    getTheme: async () => services.getTheme(),
    getUiMode: async () => services.getUiMode(),
    buildGraph,
    nodeAdjacency,
    histState: async () => { await ready; return history.state() },
    histPush: async (name) => { await ready; return history.push(name) },
    histJump: async (i) => { await ready; return history.jump(i) },
    histRemove: async (name) => { await ready; return history.remove(name) },
    navigate: async (name) => { await services.navigateTo(name); return true },
    createChild: mut.createChild,
    createParent: mut.createParent,
    createJump: mut.createJump,
    linkExisting: mut.linkExisting,
    removeLink: mut.removeLink,
    repairSymmetry: async () => {
      try {
        const n = await runSymmetryRepair(dataSource, getOntology())
        log.info(`symmetry repair complete: ${n} link(s) normalized`)
        return n
      } catch (e) { log.warn('symmetry repair failed', e); return 0 }
    },
    searchPages: (q) => dataSource.searchPages(q),
    getSize: async () => {
      try {
        const raw = await services.persistence.load(SIZE_KEY)
        if (raw == null || raw === '') return null
        const n = Number(raw)
        return Number.isInteger(n) && n >= 0 ? n : null // '' / NaN / non-int == reset (default size)
      } catch (e) { log.warn('size load failed', e); return null }
    },
    // level === null resets to the default size; an integer level is debounced like
    // history. Clearing is immediate so a reset can't be clobbered by a stale save.
    setSize: async (level) => {
      if (sizeTimer) clearTimeout(sizeTimer)
      if (level == null) {
        services.persistence.save(SIZE_KEY, '').catch((e) => log.warn('size clear failed', e))
        return
      }
      sizeTimer = setTimeout(() => {
        services.persistence.save(SIZE_KEY, String(level)).catch((e) => log.warn('size save failed', e))
      }, SIZE_SAVE_DEBOUNCE_MS)
    },
    getConnectorColors: async () => {
      try {
        const raw = await services.persistence.load(COLORS_KEY)
        if (!raw) return {}
        const obj: unknown = JSON.parse(raw)
        return obj && typeof obj === 'object' ? (obj as ConnectorColors) : {}
      } catch (e) { log.warn('connector colors load failed', e); return {} }
    },
    // Persisted immediately (not debounced) — color edits are deliberate, infrequent
    // clicks, and a reset must not be clobbered by a stale debounced save.
    setConnectorColors: async (colors) => {
      try { await services.persistence.save(COLORS_KEY, JSON.stringify(colors || {})) }
      catch (e) { log.warn('connector colors save failed', e) }
    },
    on: <K extends BackendEvent>(event: K, handler: (p: BackendEventPayloads[K]) => void) => {
      listeners[event].add(handler)
      return () => listeners[event].delete(handler)
    },
  }
}

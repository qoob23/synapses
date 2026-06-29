// Optional, opt-in file logging for debugging communication problems between the
// view, the backend, and the editor. Records are JSONL: one compact JSON object per
// line `{t, ctx, cat, act, ...}`. Five categories trace one interaction end to end:
//
//   user   — a user action in the view (activate / create / link / unlink / refresh)
//   call   — a SynapsesBackend method: args + ok|err + duration (what was sent / what it did)
//   edit   — a DataSource write: page / key / targets (what edit was actually made)
//   editor — an editor change event the backend emitted (refresh / recenter / theme / uimode)
//   ui     — a view render: focus + per-zone counts (what changed on screen)
//
// `ctx` tags the origin context. In Logseq the view (P, the iframe) can't touch the
// filesystem, so it forwards its `user`/`ui` lines to the plugin main context (M),
// which owns the single file. A `user` line in P with no matching `call` line in M
// therefore pinpoints a dropped bridge message — the whole point of the feature.

import { errText } from './errText'
import type { DataSource, SynapsesBackend } from './types'

export interface Logger {
  enabled(): boolean
  setEnabled(on: boolean): void
  // Build a record from the current context and write it (no-op while disabled).
  log(cat: string, act: string, data?: Record<string, unknown>): void
  // Accept an already-serialized line produced by another context (no-op while disabled).
  ingest(line: string): void
}

const nowIso = (): string => new Date().toISOString()

export function createLogger(
  write: (line: string) => void,
  opts: { ctx: string; enabled?: boolean },
): Logger {
  let on = opts.enabled ?? false
  const emit = (line: string) => { if (on) write(line) }
  return {
    enabled: () => on,
    setEnabled: (v) => { on = v },
    log(cat, act, data) {
      if (!on) return
      const rec: Record<string, unknown> = { t: nowIso(), ctx: opts.ctx, cat, act, ...(data ?? {}) }
      try { emit(JSON.stringify(rec)) } catch { /* a record must never break the app */ }
    },
    ingest(line) { emit(line) },
  }
}

// A no-op logger so call sites can stay unconditional (`logger.log(...)`) whether or
// not the editor wired one up.
export const noopLogger: Logger = {
  enabled: () => false,
  setEnabled: () => {},
  log: () => {},
  ingest: () => {},
}

// ---- buffered file sink (editor-agnostic) ----
// The editor supplies how to read/write its one log file; this owns batching, a size
// cap, and a debounce so a chatty session can't thrash the disk or grow unbounded.
export interface BufferedSink { write(line: string): void; flush(): void; dispose(): void }

const DEFAULT_CAP = 1_000_000
const DEFAULT_FLUSH = 500

// Trim from the front to the start of the next line so the file stays valid JSONL.
function capFront(text: string, capBytes: number): string {
  if (text.length <= capBytes) return text
  const cut = text.length - capBytes
  const nl = text.indexOf('\n', cut)
  return nl >= 0 ? text.slice(nl + 1) : text.slice(cut)
}

export function createBufferedSink(opts: {
  load: () => Promise<string | null>        // read existing log (seeds the buffer across reloads)
  persist: (text: string) => Promise<void>  // rewrite the whole file (no append API needed)
  capBytes?: number                         // rolling cap; oldest whole lines are dropped first
  flushMs?: number                          // debounce before persisting
}): BufferedSink {
  const cap = opts.capBytes ?? DEFAULT_CAP
  const flushMs = opts.flushMs ?? DEFAULT_FLUSH
  let buffer = ''
  let loaded = false
  const pre: string[] = [] // lines written before the initial load resolved
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  void opts.load()
    .then((txt) => { buffer = capFront((txt ?? '') + pre.join(''), cap) })
    .catch(() => { buffer = capFront(pre.join(''), cap) })
    .finally(() => { loaded = true; pre.length = 0; if (buffer) schedule() })

  function doFlush() {
    timer = undefined
    void opts.persist(buffer).catch(() => { /* a debug log must never surface errors */ })
  }
  function schedule() {
    if (disposed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(doFlush, flushMs)
  }
  return {
    write(line) {
      if (disposed) return
      if (!loaded) { pre.push(line + '\n'); return }
      buffer = capFront(buffer + line + '\n', cap)
      schedule()
    },
    flush() { if (timer) { clearTimeout(timer); doFlush() } },
    dispose() { disposed = true; if (timer) { clearTimeout(timer); doFlush() } },
  }
}

// ---- seam wrappers ----
// Collapse arrays to a count and drop anything bulky so a `call` line stays one short
// object — names, roles, levels survive; large structures don't.
function brief(args: unknown[]): unknown[] {
  return args.map((a) => (Array.isArray(a) ? { n: a.length } : a))
}

const BACKEND_LOGGED = [
  'getActivePage', 'getTheme', 'getUiMode', 'buildGraph', 'nodeAdjacency',
  'histState', 'histPush', 'histJump', 'histRemove', 'histRemoveMissing',
  'navigate', 'createChild', 'createParent', 'createJump', 'linkExisting', 'removeLink',
  'searchPages', 'getSize', 'setSize', 'getConnectorColors', 'setConnectorColors',
] as const satisfies readonly Exclude<keyof SynapsesBackend, 'on'>[]

// Wrap every backend method so each invocation logs args + outcome + duration. `on`
// is passed through untouched (event emission is logged in the backend itself).
export function wrapBackendWithLogging(backend: SynapsesBackend, logger: Logger): SynapsesBackend {
  const out = { on: backend.on.bind(backend) } as SynapsesBackend
  for (const name of BACKEND_LOGGED) {
    const orig = backend[name] as (...a: unknown[]) => Promise<unknown>
    const wrapped = async (...a: unknown[]): Promise<unknown> => {
      if (!logger.enabled()) return orig(...a)
      const start = Date.now()
      try {
        const r = await orig(...a)
        logger.log('call', name, { args: brief(a), ok: true, ms: Date.now() - start })
        return r
      } catch (e) {
        logger.log('call', name, { args: brief(a), ok: false, err: errText(e), ms: Date.now() - start })
        throw e
      }
    }
    ;(out as unknown as Record<string, unknown>)[name] = wrapped
  }
  return out
}

// Wrap the three write methods so the actual property mutation is logged where it
// happens. Reads pass through (a `call` line for buildGraph/searchPages already
// implies the reads, and logging every getPageProps would drown the signal).
export function wrapDataSource(ds: DataSource, logger: Logger): DataSource {
  return {
    getPageProps: ds.getPageProps.bind(ds),
    searchPages: ds.searchPages.bind(ds),
    pageExists: ds.pageExists.bind(ds),
    async ensurePage(name) {
      logger.log('edit', 'ensurePage', { page: name })
      return ds.ensurePage(name)
    },
    async setPropertyLinks(name, key, targets) {
      logger.log('edit', 'setPropertyLinks', { page: name, key, targets })
      return ds.setPropertyLinks(name, key, targets)
    },
    async removePropertyKey(name, key) {
      logger.log('edit', 'removePropertyKey', { page: name, key })
      return ds.removePropertyKey(name, key)
    },
  }
}

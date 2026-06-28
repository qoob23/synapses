// Generic postMessage transport shared by the plugin main context (server) and
// the synapses iframe (client), plus the typed SynapsesBackend serve/proxy layer.
//
// The low-level startServer/createClient are a verbatim port of src/shared/rpc.js:
// the injected iframe has no `logseq` global, so it calls back to the main
// context, which performs every read/write. Only the TAG string and TS type
// annotations differ from the original; the handshake / queue / pending-map
// logic is unchanged.

import type { SynapsesBackend, BackendEvent } from './types'

const TAG = '__synapses_rpc__'

// ---- server: runs in the plugin main context (has `logseq`) ----
export function startServer(handlers: Record<string, (...args: any[]) => any>) {
  let peer: Window | null = null
  let queued: any[] = [] // events fired before the iframe finished its handshake

  window.addEventListener('message', async (e) => {
    const d = e.data
    if (!d || d[TAG] !== true) return

    if (d.kind === 'ready') {
      peer = e.source as Window
      for (const msg of queued) peer.postMessage(msg, '*')
      queued = []
      return
    }

    if (d.kind === 'req') {
      const fn = handlers[d.method]
      try {
        if (typeof fn !== 'function') throw new Error('unknown method: ' + d.method)
        const result = await fn(...(d.args || []))
        ;(e.source as Window).postMessage({ [TAG]: true, kind: 'res', id: d.id, result }, '*')
      } catch (err: any) {
        ;(e.source as Window).postMessage(
          { [TAG]: true, kind: 'res', id: d.id, error: String((err && err.message) || err) },
          '*',
        )
      }
    }
  })

  // Tell a freshly-injected iframe who to talk to.
  function init(iframeWindow: Window) {
    iframeWindow.postMessage({ [TAG]: true, kind: 'init' }, '*')
  }

  // Push a fire-and-forget event to the connected peer (e.g. "recenter").
  // Buffer until the peer is ready so early events aren't lost.
  function notify(method: string, payload?: any) {
    const msg = { [TAG]: true, kind: 'evt', method, payload }
    if (peer) peer.postMessage(msg, '*')
    else queued.push(msg)
  }

  return { init, notify }
}

// ---- client: runs inside the synapses iframe (no `logseq`) ----
export function createClient(
  { onConnect, onEvent }: { onConnect?: () => void; onEvent?: (method: string, payload: any) => void } = {},
) {
  let peer: Window | null = null
  let seq = 0
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()

  window.addEventListener('message', (e) => {
    const d = e.data
    if (!d || d[TAG] !== true) return

    if (d.kind === 'init') {
      peer = e.source as Window
      peer.postMessage({ [TAG]: true, kind: 'ready' }, '*')
      onConnect && onConnect()
      return
    }

    if (d.kind === 'evt') {
      onEvent && onEvent(d.method, d.payload)
      return
    }

    if (d.kind === 'res') {
      const p = pending.get(d.id)
      if (!p) return
      pending.delete(d.id)
      if (d.error) p.reject(new Error(d.error))
      else p.resolve(d.result)
    }
  })

  function call(method: string, ...args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!peer) return reject(new Error('synapses bridge not connected'))
      const id = ++seq
      pending.set(id, { resolve, reject })
      peer.postMessage({ [TAG]: true, kind: 'req', id, method, args }, '*')
    })
  }

  return { call, isConnected: () => !!peer }
}

// ---- typed SynapsesBackend serve/proxy layer ----

export const BACKEND_METHODS = [
  'getActivePage', 'getTheme', 'getUiMode', 'buildGraph', 'nodeAdjacency', 'rebuildIndex', 'histState', 'histPush', 'histJump',
  'histRemove', 'histRemoveMissing',
  'navigate', 'createChild', 'createParent', 'createJump', 'linkExisting', 'removeLink', 'searchPages',
  'getSize', 'setSize',
] as const satisfies readonly Exclude<keyof SynapsesBackend, 'on'>[]

// Compile-time completeness: every SynapsesBackend method (except `on`) MUST be listed above.
// If a method is added to SynapsesBackend but not to BACKEND_METHODS, this line fails to compile.
type _BackendMethodsAreComplete =
  Exclude<keyof SynapsesBackend, 'on'> extends (typeof BACKEND_METHODS)[number] ? true : never
const _backendMethodsAreComplete: _BackendMethodsAreComplete = true
void _backendMethodsAreComplete

export const BACKEND_EVENTS = ['recenter', 'theme', 'refresh', 'uimode'] as const satisfies readonly BackendEvent[]

export function buildHandlerMap(backend: SynapsesBackend, methods: readonly (keyof SynapsesBackend)[]) {
  const map: Record<string, (...a: any[]) => any> = {}
  for (const m of methods) map[m as string] = (...args: any[]) => (backend[m] as any)(...args)
  return map
}

export function buildProxy(
  call: (method: string, ...args: any[]) => Promise<any>,
  onEventRegister: (handler: (m: string, p: any) => void) => void,
  methods: readonly (keyof SynapsesBackend)[],
  events: readonly BackendEvent[],
): SynapsesBackend {
  const listeners = new Map<BackendEvent, Set<(p?: any) => void>>(events.map((e) => [e, new Set()]))
  onEventRegister((m, p) => { const s = listeners.get(m as BackendEvent); if (s) s.forEach((fn) => fn(p)) })
  const proxy: any = {
    on(event: BackendEvent, handler: (p?: any) => void) { listeners.get(event)!.add(handler); return () => listeners.get(event)!.delete(handler) },
  }
  for (const m of methods) proxy[m] = (...args: any[]) => call(m as string, ...args)
  return proxy as SynapsesBackend
}

// High-level helpers used by the Logseq wrapper:
export function serveBackend(backend: SynapsesBackend) {
  const server = startServer(buildHandlerMap(backend, BACKEND_METHODS))
  for (const evt of BACKEND_EVENTS) backend.on(evt, (payload) => server.notify(evt, payload))
  return server // exposes { init, notify }
}

export function createBackendProxy(
  opts: { onConnect?: () => void } = {},
): { backend: SynapsesBackend; client: ReturnType<typeof createClient> } {
  let emit: (m: string, p: any) => void = () => {}
  // The proxy can't take calls until the postMessage handshake completes; surface
  // `onConnect` so the caller can defer its first calls until the bridge is live.
  const client = createClient({ onConnect: opts.onConnect, onEvent: (m, p) => emit(m, p) })
  const backend = buildProxy((method, ...args) => client.call(method, ...args), (h) => { emit = h }, BACKEND_METHODS, BACKEND_EVENTS)
  return { backend, client }
}

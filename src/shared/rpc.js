// Minimal postMessage RPC shared by the plugin main context (server) and the
// plex iframe (client). The injected iframe has no `logseq` global, so it calls
// back to the main context, which performs every Logseq read/write.

const TAG = '__plex_rpc__'

// ---- server: runs in the plugin main context (has `logseq`) ----
export function startServer(handlers) {
  let peer = null
  let queued = [] // events fired before the iframe finished its handshake

  window.addEventListener('message', async (e) => {
    const d = e.data
    if (!d || d[TAG] !== true) return

    if (d.kind === 'ready') {
      peer = e.source
      for (const msg of queued) peer.postMessage(msg, '*')
      queued = []
      return
    }

    if (d.kind === 'req') {
      const fn = handlers[d.method]
      try {
        if (typeof fn !== 'function') throw new Error('unknown method: ' + d.method)
        const result = await fn(...(d.args || []))
        e.source.postMessage({ [TAG]: true, kind: 'res', id: d.id, result }, '*')
      } catch (err) {
        e.source.postMessage(
          { [TAG]: true, kind: 'res', id: d.id, error: String((err && err.message) || err) },
          '*',
        )
      }
    }
  })

  // Tell a freshly-injected iframe who to talk to.
  function init(iframeWindow) {
    iframeWindow.postMessage({ [TAG]: true, kind: 'init' }, '*')
  }

  // Push a fire-and-forget event to the connected peer (e.g. "recenter").
  // Buffer until the peer is ready so early events aren't lost.
  function notify(method, payload) {
    const msg = { [TAG]: true, kind: 'evt', method, payload }
    if (peer) peer.postMessage(msg, '*')
    else queued.push(msg)
  }

  return { init, notify }
}

// ---- client: runs inside the plex iframe (no `logseq`) ----
export function createClient({ onConnect, onEvent } = {}) {
  let peer = null
  let seq = 0
  const pending = new Map()

  window.addEventListener('message', (e) => {
    const d = e.data
    if (!d || d[TAG] !== true) return

    if (d.kind === 'init') {
      peer = e.source
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

  function call(method, ...args) {
    return new Promise((resolve, reject) => {
      if (!peer) return reject(new Error('plex bridge not connected'))
      const id = ++seq
      pending.set(id, { resolve, reject })
      peer.postMessage({ [TAG]: true, kind: 'req', id, method, args }, '*')
    })
  }

  return { call, isConnected: () => !!peer }
}

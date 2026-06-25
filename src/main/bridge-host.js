import { startServer } from '../shared/rpc.js'

// The RPC server lives in the plugin main context (M), which holds `logseq`.
// We inject the plex iframe into the sidebar slot, then hand its window to the
// server so it can complete the handshake.

let server = null

export function startBridge(handlers) {
  if (server) return server
  server = startServer(handlers)
  return server
}

export function connectIframe(iframeEl) {
  if (!server || !iframeEl) return
  const send = () => {
    try {
      if (iframeEl.contentWindow) server.init(iframeEl.contentWindow)
    } catch (e) {
      /* cross-frame access can momentarily throw; the load handler retries */
    }
  }
  iframeEl.addEventListener('load', send)
  send() // in case the iframe is already loaded
}

export function notifyPeer(method, payload) {
  if (server) server.notify(method, payload)
}

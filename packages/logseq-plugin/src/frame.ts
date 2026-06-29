import { createBackendProxy, mountSynapses, createLogger } from '@logseq-synapses/core'
import '@logseq-synapses/core/styles.css'

// The backend proxy reaches the plugin host over postMessage; its calls only work
// once the iframe `init` handshake has completed. Mount AFTER the bridge connects,
// so the initial theme + restore calls don't race ahead of it and fail with
// "synapses bridge not connected" (which also left the UI stuck on the light theme).
let mounted = false
const { backend, client } = createBackendProxy({
  onConnect: () => {
    if (mounted) return
    mounted = true
    // logger is initialized synchronously below; onConnect fires asynchronously
    // (after the postMessage handshake), so it is always defined by then.
    mountSynapses(document.body, backend, logger)
  },
})

// The iframe (P) can't write files; forward every record to the plugin main context
// (M), which owns the log file and decides — via its setting — whether to persist.
const logger = createLogger((line) => client.post('log', line), { ctx: 'P', enabled: true })

// The view swallows the wheel (panzoom calls preventDefault to kill zoom/host
// scroll-chaining), so the cross-origin iframe would otherwise trap every scroll
// gesture and the Logseq right sidebar couldn't scroll while the cursor is over
// us. Forward the delta to M (host context), which scrolls the sidebar directly.
// Pixel-normalize first: deltaMode line/page rarely occurs but would scroll wrong.
window.addEventListener(
  'wheel',
  (e) => {
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
    client.post('hostScroll', { dx: e.deltaX * k, dy: e.deltaY * k })
  },
  { passive: true },
)

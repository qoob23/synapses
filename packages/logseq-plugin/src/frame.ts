import { createBackendProxy, mountSynapses } from '@logseq-synapses/core'
import '@logseq-synapses/core/styles.css'

// The backend proxy reaches the plugin host over postMessage; its calls only work
// once the iframe `init` handshake has completed. Mount AFTER the bridge connects,
// so the initial theme + restore calls don't race ahead of it and fail with
// "synapses bridge not connected" (which also left the UI stuck on the light theme).
let mounted = false
const { backend } = createBackendProxy({
  onConnect: () => {
    if (mounted) return
    mounted = true
    mountSynapses(document.body, backend)
  },
})

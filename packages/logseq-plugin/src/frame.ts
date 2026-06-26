import { createBackendProxy, mountSynapses } from '@logseq-synapses/core'
import '@logseq-synapses/core/styles.css'

const { backend } = createBackendProxy() // connects over postMessage; client handshake on init
mountSynapses(document.body, backend)

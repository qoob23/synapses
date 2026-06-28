import '@logseq/libs'
import { createCoreBackend, serveBackend } from '@logseq-synapses/core'
import { createLogseqDataSource } from './datasource'
import { createLogseqServices } from './services'
import { renderSynapsesSlot, openSynapsesSidebar, synapsesFrameStyle } from './sidebar'

const settingsSchema = [
  { key: 'parentFields', type: 'string', default: 'parent, parents, up', title: 'Parent property names', description: 'Comma-separated property names treated as "parent".' },
  { key: 'childFields', type: 'string', default: 'child, children, down', title: 'Child property names', description: 'Comma-separated property names treated as "child".' },
  { key: 'jumpFields', type: 'string', default: 'jump, jumps, friend, friends', title: 'Jump property names', description: 'Comma-separated property names treated as "jump".' },
  { key: 'mobileMode', type: 'boolean', default: false, title: 'Mobile mode (testing)', description: 'Force the mobile layout & interactions even on desktop, for testing.' },
  { key: 'primaryColorLight', type: 'string', default: '', title: 'Primary connector color (light)', description: 'Color for parent/child connectors in light mode (any CSS color). Blank = auto-derive from the theme.' },
  { key: 'primaryColorDark', type: 'string', default: '', title: 'Primary connector color (dark)', description: 'Color for parent/child connectors in dark mode (any CSS color). Blank = auto-derive from the theme.' },
  { key: 'secondaryColorLight', type: 'string', default: '', title: 'Secondary connector color (light)', description: 'Color for jump/sibling connectors in light mode (any CSS color). Blank = auto-derive from the theme.' },
  { key: 'secondaryColorDark', type: 'string', default: '', title: 'Secondary connector color (dark)', description: 'Color for jump/sibling connectors in dark mode (any CSS color). Blank = auto-derive from the theme.' },
]

async function main() {
  ;(logseq as any).useSettingsSchema(settingsSchema)
  const backend = createCoreBackend(createLogseqDataSource(), createLogseqServices())
  const server = serveBackend(backend)

  ;(logseq as any).provideStyle(synapsesFrameStyle())
  ;(logseq as any).App.onMacroRendererSlotted(({ slot, payload }: any) => {
    const args = (payload && payload.arguments) || []
    if (String(args[0] || '').trim() !== ':synapses') return
    renderSynapsesSlot(slot, (el: HTMLIFrameElement) => connectIframe(server, el))
  })

  ;(logseq as any).Editor.registerSlashCommand('Synapses: open in sidebar', async () => { await openSynapsesSidebar() })
  ;(logseq as any).provideModel({ openSynapses() { openSynapsesSidebar() } })
  ;(logseq as any).App.registerUIItem('toolbar', { key: 'synapses-open', template: '<a class="button" data-on-click="openSynapses" title="Open Synapses"><span style="font-size:18px">🧠</span></a>' })
  console.log('[synapses] plugin ready')
}

// bridge-host.connectIframe, folded in: hand the freshly-injected iframe's window
// to the RPC server so it can complete the handshake (on load + immediately, in
// case the iframe is already loaded).
function connectIframe(server: { init: (w: Window) => void }, iframeEl: HTMLIFrameElement) {
  const send = () => { try { if (iframeEl.contentWindow) server.init(iframeEl.contentWindow) } catch {} }
  iframeEl.addEventListener('load', send); send()
}

;(logseq as any).ready(main).catch(console.error)

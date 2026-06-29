import '@logseq/libs'
import { createCoreBackend, serveBackend } from '@logseq-synapses/core'
import { createLogseqDataSource } from './datasource'
import { createLogseqServices } from './services'
import { renderSynapsesSlot, openSynapsesSidebar, synapsesFrameStyle, scrollSidebarForFrame } from './sidebar'
import type { SettingSchemaDesc } from './logseq-types'

const settingsSchema: SettingSchemaDesc[] = [
  { key: 'parentFields', type: 'string', default: 'parent, parents, up', title: 'Parent property names', description: 'Comma-separated property names treated as "parent".' },
  { key: 'childFields', type: 'string', default: 'child, children, down', title: 'Child property names', description: 'Comma-separated property names treated as "child".' },
  { key: 'jumpFields', type: 'string', default: 'jump, jumps, friend, friends', title: 'Jump property names', description: 'Comma-separated property names treated as "jump".' },
  { key: 'mobileMode', type: 'boolean', default: false, title: 'Mobile mode (testing)', description: 'Force the mobile layout & interactions even on desktop, for testing.' },
]

async function main() {
  logseq.useSettingsSchema(settingsSchema)
  const backend = createCoreBackend(createLogseqDataSource(), createLogseqServices())
  const server = serveBackend(backend, (method, payload, source) => {
    if (method === 'hostScroll') scrollSidebarForFrame(source, payload as { dx: number; dy: number })
  })

  logseq.provideStyle(synapsesFrameStyle())
  logseq.App.onMacroRendererSlotted(({ slot, payload }) => {
    const args = payload.arguments || []
    if (String(args[0] || '').trim() !== ':synapses') return
    renderSynapsesSlot(slot, (el) => connectIframe(server, el))
  })

  logseq.Editor.registerSlashCommand('Synapses: open in sidebar', async () => { await openSynapsesSidebar() })
  logseq.provideModel({ openSynapses() { void openSynapsesSidebar() } })
  logseq.App.registerUIItem('toolbar', { key: 'synapses-open', template: '<a class="button" data-on-click="openSynapses" title="Open Synapses"><span style="font-size:18px">🧠</span></a>' })
  console.log('[synapses] plugin ready')
}

// bridge-host.connectIframe, folded in: hand the freshly-injected iframe's window
// to the RPC server so it can complete the handshake (on load + immediately, in
// case the iframe is already loaded).
function connectIframe(server: { init: (w: Window) => void }, iframeEl: HTMLIFrameElement) {
  const send = () => { try { if (iframeEl.contentWindow) server.init(iframeEl.contentWindow) } catch {} }
  iframeEl.addEventListener('load', send); send()
}

logseq.ready(main).catch(console.error)

import '@logseq/libs'
import { createCoreBackend, serveBackend, log, createLogger, createBufferedSink, wrapBackendWithLogging, wrapDataSource } from '@synapses/core'
import { createLogseqDataSource } from './datasource'
import { createLogseqServices } from './services'
import { renderSynapsesSlot, openSynapsesSidebar, synapsesFrameStyle, scrollSidebarForFrame } from './sidebar'
import type { SettingSchemaDesc } from './logseq-types'

const settingsSchema: SettingSchemaDesc[] = [
  { key: 'parentFields', type: 'string', default: 'parent, parents, up', title: 'Parent property names', description: 'Comma-separated property names treated as "parent".' },
  { key: 'childFields', type: 'string', default: 'child, children, down', title: 'Child property names', description: 'Comma-separated property names treated as "child".' },
  { key: 'jumpFields', type: 'string', default: 'jump, jumps, friend, friends', title: 'Jump property names', description: 'Comma-separated property names treated as "jump".' },
  { key: 'mobileMode', type: 'boolean', default: false, title: 'Mobile mode', description: 'Force the mobile layout & interactions even on desktop.' },
  { key: 'fileLogging', type: 'boolean', default: false, title: 'Debug file logging', description: 'Write a JSONL interaction log for troubleshooting communication problems. The log file path is printed to the developer console.' },
]

const fileLoggingOn = (): boolean => !!(logseq.settings as { fileLogging?: boolean } | undefined)?.fileLogging

async function announceLogPath() {
  try {
    const graph = await logseq.App.getCurrentGraph()
    const id = 'logseq-synapses'
    const base = graph?.path ? `${graph.path}/assets/storages/${id}` : `assets/storages/${id}`
    log.info(`debug file logging on → ${base}/synapses-log.jsonl`)
  } catch {
    log.info('debug file logging on → <graph>/assets/storages/logseq-synapses/synapses-log.jsonl')
  }
}

async function main() {
  logseq.useSettingsSchema(settingsSchema)

  const logStore = logseq.Assets.makeSandboxStorage()
  const logSink = createBufferedSink({
    load: () => logStore.getItem('synapses-log.jsonl').then((v) => v ?? null),
    persist: (t) => logStore.setItem('synapses-log.jsonl', t),
  })
  const logger = createLogger((line) => logSink.write(line), { ctx: 'M', enabled: fileLoggingOn(), mirror: (s) => console.log('[synapses]', s) })

  // A logging session starts fresh: clear any prior on-disk log when recording is on.
  const startRecording = () => {
    logSink.clear()
    void announceLogPath()
    void logseq.UI.showMsg('Synapses: debug recording is running', 'warning', { timeout: 4000 })
  }

  const backend = wrapBackendWithLogging(
    createCoreBackend(wrapDataSource(createLogseqDataSource(), logger), createLogseqServices(), logger),
    logger,
  )
  const server = serveBackend(backend, (method, payload, source) => {
    if (method === 'hostScroll') scrollSidebarForFrame(source, payload as { dx: number; dy: number })
    else if (method === 'log' && typeof payload === 'string') logger.ingest(payload)
  })

  logseq.provideStyle(synapsesFrameStyle())
  logseq.App.onMacroRendererSlotted(({ slot, payload }) => {
    const args = payload.arguments || []
    if (String(args[0] || '').trim() !== ':synapses') return
    renderSynapsesSlot(slot, (el) => connectIframe(server, el))
  })

  logseq.Editor.registerSlashCommand('Synapses: Open in sidebar', async () => { await openSynapsesSidebar() })
  logseq.provideModel({
    openSynapses() { void openSynapsesSidebar() },
  })
  logseq.App.registerUIItem('toolbar', { key: 'synapses-open', template: '<a class="button" data-on-click="openSynapses" title="Open Synapses"><span style="font-size:18px">🧠</span></a>' })

  if (fileLoggingOn()) startRecording()
  let logWasOn = fileLoggingOn()
  logseq.onSettingsChanged(() => {
    const on = fileLoggingOn()
    logger.setEnabled(on)
    if (on && !logWasOn) startRecording()
    logWasOn = on
  })
}

// bridge-host.connectIframe, folded in: hand the freshly-injected iframe's window
// to the RPC server so it can complete the handshake (on load + immediately, in
// case the iframe is already loaded).
function connectIframe(server: { init: (w: Window) => void }, iframeEl: HTMLIFrameElement) {
  const send = () => { try { if (iframeEl.contentWindow) server.init(iframeEl.contentWindow) } catch {} }
  iframeEl.addEventListener('load', send); send()
}

logseq.ready(main).catch((e) => log.error('init failed', e))

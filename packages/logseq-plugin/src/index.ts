import '@logseq/libs'
import { createCoreBackend, serveBackend, log, createLogger, createBufferedSink, wrapBackendWithLogging, wrapDataSource } from '@logseq-synapses/core'
import { createLogseqDataSource } from './datasource'
import { createLogseqServices } from './services'
import { renderSynapsesSlot, openSynapsesSidebar, synapsesFrameStyle, scrollSidebarForFrame } from './sidebar'
import type { SettingSchemaDesc } from './logseq-types'

const settingsSchema: SettingSchemaDesc[] = [
  { key: 'parentFields', type: 'string', default: 'parent, parents, up', title: 'Parent property names', description: 'Comma-separated property names treated as "parent".' },
  { key: 'childFields', type: 'string', default: 'child, children, down', title: 'Child property names', description: 'Comma-separated property names treated as "child".' },
  { key: 'jumpFields', type: 'string', default: 'jump, jumps, friend, friends', title: 'Jump property names', description: 'Comma-separated property names treated as "jump".' },
  { key: 'symmetricLinks', type: 'boolean', default: false, title: 'Symmetric links', description: 'Write each link on both connected notes. Enabling runs a one-time repair across your whole graph — your notes will be modified.' },
  { key: 'mobileMode', type: 'boolean', default: false, title: 'Mobile mode', description: 'Force the mobile layout & interactions even on desktop.' },
  { key: 'fileLogging', type: 'boolean', default: false, title: 'Debug file logging', description: 'Write a JSONL interaction log for troubleshooting communication problems. The log file path is printed to the developer console.' },
]

const fileLoggingOn = (): boolean => !!(logseq.settings as { fileLogging?: boolean } | undefined)?.fileLogging
const symmetricOn = (): boolean => !!(logseq.settings as { symmetricLinks?: boolean } | undefined)?.symmetricLinks

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

let pendingSymmetryConfirm: ((ok: boolean) => void) | null = null
const SYMMETRY_CONFIRM_KEY = 'synapses-symmetry-confirm'

function clearSymmetryConfirm() {
  logseq.provideUI({ key: SYMMETRY_CONFIRM_KEY, path: 'body', template: '' })
}

function resolveSymmetryConfirm(ok: boolean) {
  const cb = pendingSymmetryConfirm
  pendingSymmetryConfirm = null
  clearSymmetryConfirm()
  if (cb) cb(ok)
}

function confirmSymmetricEnable(accent: string): Promise<boolean> {
  // The overlay lives in the main Logseq DOM where --synapses-* don't resolve, so the
  // user's chosen primary connector color is passed in; otherwise use the editor accent.
  const actionBg = accent || 'var(--ls-active-primary-color)'
  return new Promise((resolve) => {
    if (pendingSymmetryConfirm) resolveSymmetryConfirm(false)
    pendingSymmetryConfirm = resolve
    logseq.provideUI({
      key: SYMMETRY_CONFIRM_KEY,
      path: 'body',
      template: `
        <div style="position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45)">
          <div style="max-width:420px;background:var(--ls-primary-background-color,#fff);color:var(--ls-primary-text-color,#222);border-radius:8px;padding:20px 22px;box-shadow:0 8px 32px rgba(0,0,0,0.35);font-size:14px;line-height:1.5">
            <div style="font-weight:600;font-size:15px;margin-bottom:10px">Enable symmetric links?</div>
            <div style="margin-bottom:18px">This will modify your notes. Symmetric links are written on both connected notes, and enabling now runs a one-time repair across your whole graph to normalize existing links. Continue?</div>
            <div style="display:flex;gap:10px;justify-content:flex-end">
              <button data-on-click="synapsesSymmetryCancel" style="padding:6px 14px;border-radius:6px;border:1px solid var(--ls-border-color,#ccc);background:transparent;color:inherit;cursor:pointer">Cancel</button>
              <button data-on-click="synapsesSymmetryApprove" style="padding:6px 14px;border-radius:6px;border:none;background:${actionBg};color:#fff;cursor:pointer">Enable &amp; repair</button>
            </div>
          </div>
        </div>`,
    })
  })
}

async function main() {
  logseq.useSettingsSchema(settingsSchema)

  const logStore = logseq.Assets.makeSandboxStorage()
  const logSink = createBufferedSink({
    load: () => logStore.getItem('synapses-log.jsonl').then((v) => v ?? null),
    persist: (t) => logStore.setItem('synapses-log.jsonl', t),
  })
  const logger = createLogger((line) => logSink.write(line), { ctx: 'M', enabled: fileLoggingOn() })

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
    synapsesSymmetryApprove() { resolveSymmetryConfirm(true) },
    synapsesSymmetryCancel() { resolveSymmetryConfirm(false) },
  })
  logseq.App.registerUIItem('toolbar', { key: 'synapses-open', template: '<a class="button" data-on-click="openSynapses" title="Open Synapses"><span style="font-size:18px">🧠</span></a>' })

  if (fileLoggingOn()) startRecording()
  let logWasOn = fileLoggingOn()
  let symmetricWasOn = symmetricOn()
  logseq.onSettingsChanged(() => {
    const on = fileLoggingOn()
    logger.setEnabled(on)
    if (on && !logWasOn) startRecording()
    logWasOn = on

    const sym = symmetricOn()
    if (sym && !symmetricWasOn) {
      symmetricWasOn = true
      void (async () => {
        // Tint the action like the view does: the user's primary connector color for the
        // current theme mode, falling back to the editor's own accent (never a hardcoded color).
        let accent = ''
        try {
          const [palette, colors] = await Promise.all([backend.getTheme(), backend.getConnectorColors()])
          accent = ((palette.mode === 'dark' ? colors.primaryDark : colors.primaryLight) || palette.accent) || ''
        } catch { /* fall back to the editor accent var */ }
        const ok = await confirmSymmetricEnable(accent)
        if (ok) {
          const n = await backend.repairSymmetry()
          void logseq.UI.showMsg(`Synapses: symmetric links on — normalized ${n} link(s)`, 'success', { timeout: 4000 })
        } else {
          logseq.updateSettings({ symmetricLinks: false })
          symmetricWasOn = false
        }
      })()
    } else {
      symmetricWasOn = sym
    }
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

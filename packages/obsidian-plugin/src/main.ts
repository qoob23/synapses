import { createCoreBackend, createLogger, createBufferedSink, wrapBackendWithLogging, wrapDataSource, log, type SynapsesBackend, type Logger, type BufferedSink } from '@logseq-synapses/core'
import { Plugin, Notice, FileSystemAdapter } from 'obsidian'
import '@logseq-synapses/core/styles.css'
import { createObsidianDataSource } from './datasource'
import { isDataviewEnabled } from './dataview'
import { createObsidianServices } from './services'
import { type SynapsesSettings, DEFAULT_SETTINGS, SynapsesSettingTab } from './settings'
import { SynapsesView, VIEW_TYPE_SYNAPSES } from './view'
import type { WorkspaceLeaf } from 'obsidian'

// Shape of the plugin's persisted `data.json`.
export interface PersistedData {
  settings?: Partial<SynapsesSettings>
  persist?: Record<string, string>
}

export default class SynapsesPlugin extends Plugin {
  settings: SynapsesSettings = DEFAULT_SETTINGS
  backend: SynapsesBackend | null = null
  logger: Logger | null = null
  private logSink: BufferedSink | null = null
  private logPath = ''
  private settingsListeners: (() => void)[] = []
  // Every data.json write funnels through this chain so concurrent read-modify-writes
  // (settings + the persistence saves below) can't clobber each other: each waits for
  // the previous, then re-reads the freshest data, mutates, and writes.
  private writeQueue: Promise<void> = Promise.resolve()

  async onload() {
    await this.loadSettings()
    const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`
    this.logPath = `${dir}/synapses-log.jsonl`
    this.logSink = createBufferedSink({
      load: () => this.app.vault.adapter.read(this.logPath).then((t) => t).catch(() => null),
      persist: (t) => this.app.vault.adapter.write(this.logPath, t),
    })
    const sink = this.logSink
    this.logger = createLogger((line) => sink.write(line), { ctx: 'main', enabled: this.settings.fileLogging })
    if (this.settings.fileLogging) { this.logSink.clear(); this.announceLogPath() }
    this.addSettingTab(new SynapsesSettingTab(this.app, this))
    this.registerView(VIEW_TYPE_SYNAPSES, (leaf) => new SynapsesView(leaf, this))
    this.addRibbonIcon('brain', 'Open Synapses', () => void this.activateView())
    this.addCommand({ id: 'open-in-sidebar', name: 'Open in sidebar', callback: () => void this.activateView() })
  }

  onunload() { this.logSink?.dispose() }

  // Durable backend, built once, gated on Dataview. Persists across view open/close.
  getBackend(): SynapsesBackend | null {
    if (this.backend) return this.backend
    if (!isDataviewEnabled(this.app)) { new Notice('Synapses requires the Dataview plugin to be installed and enabled.'); return null }
    const logger = this.logger ?? createLogger(() => {}, { ctx: 'main', enabled: false })
    this.backend = wrapBackendWithLogging(
      createCoreBackend(wrapDataSource(createObsidianDataSource(this.app), logger), createObsidianServices(this.app, this), logger),
      logger,
    )
    return this.backend
  }

  onSettingsChanged(cb: () => void) { this.settingsListeners.push(cb) }

  // Serialized read-modify-write of data.json; shared by settings + EditorServices persistence.
  persistData(mutate: (data: PersistedData) => void): Promise<void> {
    const run = this.writeQueue.then(async () => {
      const data: PersistedData = ((await this.loadData()) as PersistedData | null) ?? {}
      mutate(data)
      await this.saveData(data)
    })
    this.writeQueue = run.catch(() => {}) // keep the chain alive past a failed write
    return run
  }

  async loadSettings() {
    const data: PersistedData = ((await this.loadData()) as PersistedData | null) ?? {}
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings ?? {})
  }
  async saveSettings() {
    const wasOn = this.logger?.enabled() ?? false
    await this.persistData((data) => { data.settings = this.settings })
    this.logger?.setEnabled(this.settings.fileLogging)
    if (this.settings.fileLogging && !wasOn) { this.logSink?.clear(); this.announceLogPath() }
    this.settingsListeners.forEach((cb) => cb())
  }

  private announceLogPath() {
    const adapter = this.app.vault.adapter
    const abs = adapter instanceof FileSystemAdapter ? adapter.getFullPath(this.logPath) : this.logPath
    log.info(`debug file logging on → ${abs}`)
  }

  async activateView() {
    const { workspace } = this.app
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_SYNAPSES)[0] ?? null
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)
      await leaf?.setViewState({ type: VIEW_TYPE_SYNAPSES, active: true })
    }
    if (leaf) await workspace.revealLeaf(leaf)
  }
}

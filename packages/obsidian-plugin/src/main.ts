import { Plugin, Notice, WorkspaceLeaf } from 'obsidian'
import { createCoreBackend, type SynapsesBackend } from '@logseq-synapses/core'
import '@logseq-synapses/core/styles.css'
import { type SynapsesSettings, DEFAULT_SETTINGS, SynapsesSettingTab } from './settings'
import { createObsidianDataSource } from './datasource'
import { createObsidianServices } from './services'
import { SynapsesView, VIEW_TYPE_SYNAPSES } from './view'

export default class SynapsesPlugin extends Plugin {
  settings: SynapsesSettings = DEFAULT_SETTINGS
  backend: SynapsesBackend | null = null
  private settingsListeners: (() => void)[] = []

  async onload() {
    await this.loadSettings()
    this.addSettingTab(new SynapsesSettingTab(this.app, this))
    this.registerView(VIEW_TYPE_SYNAPSES, (leaf) => new SynapsesView(leaf, this))
    this.addRibbonIcon('brain', 'Open Synapses', () => void this.activateView())
    this.addCommand({ id: 'open-in-sidebar', name: 'Open in sidebar', callback: () => void this.activateView() })
  }

  // Durable backend, built once, gated on Dataview. Persists across view open/close.
  getBackend(): SynapsesBackend | null {
    if (this.backend) return this.backend
    const dv = (this.app as any).plugins?.plugins?.dataview
    if (!dv) { new Notice('Synapses requires the Dataview plugin to be installed and enabled.'); return null }
    this.backend = createCoreBackend(createObsidianDataSource(this.app), createObsidianServices(this.app, this))
    return this.backend
  }

  onSettingsChanged(cb: () => void) { this.settingsListeners.push(cb) }

  async loadSettings() {
    const data = (await this.loadData()) || {}
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {})
  }
  async saveSettings() {
    const data = (await this.loadData()) || {}
    data.settings = this.settings
    await this.saveData(data)
    this.settingsListeners.forEach((cb) => cb())
  }

  async activateView() {
    const { workspace } = this.app
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_SYNAPSES)[0] ?? null
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)
      await leaf?.setViewState({ type: VIEW_TYPE_SYNAPSES, active: true })
    }
    if (leaf) workspace.revealLeaf(leaf)
  }
}

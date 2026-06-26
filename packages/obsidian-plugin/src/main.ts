import { Plugin } from 'obsidian'
import type { SynapsesBackend } from '@logseq-synapses/core'
import { type SynapsesSettings, DEFAULT_SETTINGS, SynapsesSettingTab } from './settings'

export default class SynapsesPlugin extends Plugin {
  settings: SynapsesSettings = DEFAULT_SETTINGS
  backend: SynapsesBackend | null = null
  private settingsListeners: (() => void)[] = []

  async onload() {
    await this.loadSettings()
    this.addSettingTab(new SynapsesSettingTab(this.app, this))
    // Task 6 adds: registerView, ribbon, command.
  }

  getBackend(): SynapsesBackend | null {
    // Task 6 fills this in (Dataview gate + create-once createCoreBackend).
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
}

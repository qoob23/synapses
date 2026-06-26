import { App, PluginSettingTab, Setting } from 'obsidian'
import type SynapsesPlugin from './main'

export interface SynapsesSettings {
  parentFields: string
  childFields: string
  jumpFields: string
}

export const DEFAULT_SETTINGS: SynapsesSettings = {
  parentFields: 'parent, parents, up',
  childFields: 'child, children, down',
  jumpFields: 'jump, jumps, friend, friends',
}

export class SynapsesSettingTab extends PluginSettingTab {
  plugin: SynapsesPlugin
  constructor(app: App, plugin: SynapsesPlugin) { super(app, plugin); this.plugin = plugin }
  display(): void {
    const { containerEl } = this
    containerEl.empty()
    const field = (name: string, desc: string, key: keyof SynapsesSettings) =>
      new Setting(containerEl).setName(name).setDesc(desc).addText((t) =>
        t.setValue(this.plugin.settings[key]).onChange(async (v) => {
          this.plugin.settings[key] = v
          await this.plugin.saveSettings()
        }),
      )
    field('Parent property names', 'Comma-separated fields treated as "parent".', 'parentFields')
    field('Child property names', 'Comma-separated fields treated as "child".', 'childFields')
    field('Jump property names', 'Comma-separated fields treated as "jump".', 'jumpFields')
  }
}

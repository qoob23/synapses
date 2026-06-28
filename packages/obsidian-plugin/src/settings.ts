import { App, PluginSettingTab, Setting } from 'obsidian'
import type SynapsesPlugin from './main'

export interface SynapsesSettings {
  parentFields: string
  childFields: string
  jumpFields: string
  mobileMode: boolean
  // Connector color overrides (any CSS color); blank => auto-derive from the theme.
  primaryColorLight: string
  primaryColorDark: string
  secondaryColorLight: string
  secondaryColorDark: string
}

export const DEFAULT_SETTINGS: SynapsesSettings = {
  parentFields: 'parent, parents, up',
  childFields: 'child, children, down',
  jumpFields: 'jump, jumps, friend, friends',
  mobileMode: false,
  primaryColorLight: '',
  primaryColorDark: '',
  secondaryColorLight: '',
  secondaryColorDark: '',
}

export class SynapsesSettingTab extends PluginSettingTab {
  plugin: SynapsesPlugin
  constructor(app: App, plugin: SynapsesPlugin) { super(app, plugin); this.plugin = plugin }
  display(): void {
    const { containerEl } = this
    containerEl.empty()
    type StringKey = { [K in keyof SynapsesSettings]: SynapsesSettings[K] extends string ? K : never }[keyof SynapsesSettings]
    const field = (name: string, desc: string, key: StringKey, placeholder?: string) =>
      new Setting(containerEl).setName(name).setDesc(desc).addText((t) => {
        if (placeholder) t.setPlaceholder(placeholder)
        t.setValue(this.plugin.settings[key]).onChange(async (v) => {
          this.plugin.settings[key] = v
          await this.plugin.saveSettings()
        })
      })
    field('Parent property names', 'Comma-separated fields treated as "parent".', 'parentFields')
    field('Child property names', 'Comma-separated fields treated as "child".', 'childFields')
    field('Jump property names', 'Comma-separated fields treated as "jump".', 'jumpFields')
    new Setting(containerEl).setName('Mobile mode (testing)').setDesc('Force the mobile layout & interactions even on desktop, for testing.').addToggle((t) => t.setValue(this.plugin.settings.mobileMode).onChange(async (v) => { this.plugin.settings.mobileMode = v; await this.plugin.saveSettings() }))
    const auto = 'auto-derive from theme'
    field('Primary connector color (light)', 'Parent/child connectors in light mode (any CSS color).', 'primaryColorLight', auto)
    field('Primary connector color (dark)', 'Parent/child connectors in dark mode (any CSS color).', 'primaryColorDark', auto)
    field('Secondary connector color (light)', 'Jump/sibling connectors in light mode (any CSS color).', 'secondaryColorLight', auto)
    field('Secondary connector color (dark)', 'Jump/sibling connectors in dark mode (any CSS color).', 'secondaryColorDark', auto)
  }
}

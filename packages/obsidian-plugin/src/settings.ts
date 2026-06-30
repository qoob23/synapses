import { Modal, Notice, PluginSettingTab, Setting } from 'obsidian'
import type SynapsesPlugin from './main'
import type { App } from 'obsidian'

export interface SynapsesSettings {
  parentFields: string
  childFields: string
  jumpFields: string
  symmetricLinks: boolean
  mobileMode: boolean
  fileLogging: boolean
}

export const DEFAULT_SETTINGS: SynapsesSettings = {
  parentFields: 'parent, parents, up',
  childFields: 'child, children, down',
  jumpFields: 'jump, jumps, friend, friends',
  symmetricLinks: false,
  mobileMode: false,
  fileLogging: false,
}

class ConfirmModal extends Modal {
  private opts: { title: string; body: string; confirmText: string; accent?: string; onResolve: (ok: boolean) => void }
  private resolved = false
  constructor(app: App, opts: { title: string; body: string; confirmText: string; accent?: string; onResolve: (ok: boolean) => void }) {
    super(app)
    this.opts = opts
  }
  onOpen() {
    const { contentEl, opts } = this
    contentEl.createEl('h3', { text: opts.title })
    contentEl.createEl('p', { text: opts.body })
    new Setting(contentEl)
      .addButton((b) => b.setButtonText('Cancel').onClick(() => { this.resolved = true; opts.onResolve(false); this.close() }))
      .addButton((b) => {
        b.setButtonText(opts.confirmText).setCta().onClick(() => { this.resolved = true; opts.onResolve(true); this.close() })
        // Tint with the resolved primary/accent; when absent, keep setCta's editor accent.
        if (opts.accent) b.buttonEl.style.backgroundColor = opts.accent
      })
  }
  onClose() {
    this.contentEl.empty()
    if (!this.resolved) { this.resolved = true; this.opts.onResolve(false) }
  }
}

export class SynapsesSettingTab extends PluginSettingTab {
  plugin: SynapsesPlugin
  constructor(app: App, plugin: SynapsesPlugin) { super(app, plugin); this.plugin = plugin }
  display(): void {
    const { containerEl } = this
    containerEl.empty()
    const field = (name: string, desc: string, key: 'parentFields' | 'childFields' | 'jumpFields') =>
      new Setting(containerEl).setName(name).setDesc(desc).addText((t) =>
        t.setValue(this.plugin.settings[key]).onChange(async (v) => {
          this.plugin.settings[key] = v
          await this.plugin.saveSettings()
        }),
      )
    field('Parent property names', 'Comma-separated fields treated as "parent".', 'parentFields')
    field('Child property names', 'Comma-separated fields treated as "child".', 'childFields')
    field('Jump property names', 'Comma-separated fields treated as "jump".', 'jumpFields')
    new Setting(containerEl)
      .setName('Symmetric links')
      .setDesc('Write each link on both connected notes. Enabling runs a one-time repair across your whole vault — your notes will be modified.')
      .addToggle((t) => {
        t.setValue(this.plugin.settings.symmetricLinks).onChange(async (v) => {
          if (v) {
            // Tint the action like the view does: the user's primary connector color for the
            // current theme mode, falling back to the editor's own accent (never a hardcoded color).
            let accent: string | undefined
            try {
              const be = this.plugin.getBackend()
              if (be) {
                const [palette, colors] = await Promise.all([be.getTheme(), be.getConnectorColors()])
                const primaryEdge = palette.mode === 'dark' ? colors.primaryDark : colors.primaryLight
                accent = primaryEdge || palette.accent || undefined
              }
            } catch { /* fall back to the editor accent (setCta) */ }
            const confirm = (): Promise<boolean> => new Promise((resolve) => {
              new ConfirmModal(this.app, {
                title: 'Enable symmetric links?',
                body: 'This will modify your notes. Symmetric links are written on both connected notes, and enabling now runs a one-time repair across your whole vault to normalize existing links. Continue?',
                confirmText: 'Enable & repair',
                accent,
                onResolve: resolve,
              }).open()
            })
            const ok = await confirm()
            if (ok) {
              this.plugin.settings.symmetricLinks = true
              await this.plugin.saveSettings()
              const be = this.plugin.getBackend()
              if (be) {
                const n = await be.repairSymmetry()
                new Notice(`Synapses: symmetric links on — normalized ${n} link(s)`)
              }
            } else {
              t.setValue(false)
            }
          } else {
            this.plugin.settings.symmetricLinks = false
            await this.plugin.saveSettings()
          }
        })
      })
    new Setting(containerEl).setName('Mobile mode').setDesc('Force the mobile layout & interactions even on desktop.').addToggle((t) => t.setValue(this.plugin.settings.mobileMode).onChange(async (v) => { this.plugin.settings.mobileMode = v; await this.plugin.saveSettings() }))
    new Setting(containerEl).setName('Debug file logging').setDesc('Write a JSONL interaction log for troubleshooting communication problems. The log file path is printed to the developer console.').addToggle((t) => t.setValue(this.plugin.settings.fileLogging).onChange(async (v) => { this.plugin.settings.fileLogging = v; await this.plugin.saveSettings() }))
  }
}

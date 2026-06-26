import { App, Plugin } from 'obsidian'
import type { EditorServices, Palette, OntologyConfig, Persistence } from '@logseq-synapses/core'
import { buildOntology } from '@logseq-synapses/core'
import type { SynapsesSettings } from './settings'

type SettingsPlugin = Plugin & { settings: SynapsesSettings; onSettingsChanged(cb: () => void): void }

const VARS: Record<Exclude<keyof Palette, 'mode'>, string> = {
  bg: '--background-primary',
  bg2: '--background-secondary',
  text: '--text-normal',
  text2: '--text-muted',
  border: '--background-modifier-border',
  accent: '--interactive-accent',
}

function readPalette(): Palette {
  const mode: 'light' | 'dark' = document.body.classList.contains('theme-dark') ? 'dark' : 'light'
  const out: Palette = { mode }
  try {
    const cs = getComputedStyle(document.body)
    for (const k of Object.keys(VARS) as (keyof typeof VARS)[]) {
      const v = cs.getPropertyValue(VARS[k]).trim()
      if (v) (out as any)[k] = v
    }
  } catch { /* ignore */ }
  return out
}

export function createObsidianServices(app: App, plugin: SettingsPlugin): EditorServices {
  const persistence: Persistence = {
    async load(key) { const d = (await plugin.loadData()) || {}; return d.persist?.[key] ?? null },
    async save(key, value) {
      const d = (await plugin.loadData()) || {}
      d.persist = { ...(d.persist || {}), [key]: value }
      await plugin.saveData(d)
    },
  }
  return {
    getActivePageName() { return app.workspace.getActiveFile()?.basename ?? null },
    onActivePageChange(cb) {
      const fire = () => cb(app.workspace.getActiveFile()?.basename ?? null)
      plugin.registerEvent(app.workspace.on('active-leaf-change', fire))
      plugin.registerEvent(app.workspace.on('file-open', fire))
    },
    async navigateTo(name) { await app.workspace.openLinkText(name, '', false) },
    getTheme() { return readPalette() },
    onThemeChange(cb) { plugin.registerEvent(app.workspace.on('css-change', () => cb(readPalette()))) },
    // RAW forward — the 400ms debounce lives in createCoreBackend.
    onGraphChange(cb) {
      plugin.registerEvent(app.metadataCache.on('changed', () => cb()))
      plugin.registerEvent((app.metadataCache as any).on('dataview:index-ready', () => cb()))
      plugin.registerEvent((app.metadataCache as any).on('dataview:metadata-change', () => cb()))
    },
    getOntology(): OntologyConfig {
      const s = plugin.settings
      return buildOntology({ parent: s.parentFields, child: s.childFields, jump: s.jumpFields })
    },
    onOntologyChange(cb) { plugin.onSettingsChanged(cb) },
    persistence,
  }
}

import { buildOntology } from '@synapses/core'
import { Platform } from 'obsidian'
import type { PersistedData } from './main'
import type { SynapsesSettings } from './settings'
import type { EditorServices, Palette, OntologyConfig, Persistence, UiMode } from '@synapses/core'
import type { App, EventRef, Plugin } from 'obsidian'

type SettingsPlugin = Plugin & {
  settings: SynapsesSettings
  onSettingsChanged(cb: () => void): void
  persistData(mutate: (data: PersistedData) => void): Promise<void>
}

// Dataview fires these on Obsidian's metadataCache, which doesn't type them.
interface DvCacheEvents {
  on(name: 'dataview:index-ready' | 'dataview:metadata-change', cb: () => unknown): EventRef
}

const VARS: Record<'bg' | 'bg2' | 'text' | 'text2' | 'border' | 'accent', string> = {
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
      if (v) out[k] = v
    }
  } catch { /* ignore */ }
  return out
}

export function createObsidianServices(app: App, plugin: SettingsPlugin): EditorServices {
  const persistence: Persistence = {
    async load(key) {
      const d: PersistedData = ((await plugin.loadData()) as PersistedData | null) ?? {}
      return d.persist?.[key] ?? null
    },
    // Funnel through the plugin's serialized writer so saves never clobber settings.
    save(key, value) {
      return plugin.persistData((d) => {
        d.persist = { ...(d.persist ?? {}), [key]: value }
      })
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
    getUiMode(): UiMode { return { mobile: Platform.isMobile || !!plugin.settings.mobileMode } },
    onUiModeChange(cb) { plugin.onSettingsChanged(cb) },
    // RAW forward — the 400ms debounce lives in createCoreBackend.
    onGraphChange(cb) {
      plugin.registerEvent(app.metadataCache.on('changed', () => cb()))
      const dvEvents = app.metadataCache as unknown as DvCacheEvents
      plugin.registerEvent(dvEvents.on('dataview:index-ready', () => cb()))
      plugin.registerEvent(dvEvents.on('dataview:metadata-change', () => cb()))
    },
    getOntology(): OntologyConfig {
      const s = plugin.settings
      return buildOntology({ parent: s.parentFields, child: s.childFields, jump: s.jumpFields })
    },
    onOntologyChange(cb) { plugin.onSettingsChanged(cb) },
    persistence,
  }
}

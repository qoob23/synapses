import '@logseq/libs'
import { type EditorServices, type OntologyConfig, type Persistence, type UiMode, buildOntology } from '@logseq-synapses/core'
import { readPalette, watchTheme } from './theme'
import type { PageEntity, BlockEntity } from './logseq-types'

// The settings keys this plugin reads. `logseq.settings` is typed as an opaque
// Record<string, unknown>, so we project it through this shape at the read sites.
interface SynapsesSettings {
  parentFields?: string
  childFields?: string
  jumpFields?: string
  mobileMode?: boolean
}
function settings(): SynapsesSettings {
  return (logseq.settings ?? {}) as SynapsesSettings
}

// getCurrentPage returns a page, or — when the cursor sits in a block — a block whose
// `page` ref carries the name. The lib's BlockEntity index signature types every field
// as `unknown` (defeating `in` narrowing), so read the name fields through a narrow shape.
function pageNameOf(p: PageEntity | BlockEntity | null): string | null {
  if (!p) return null
  const o = p as unknown as { originalName?: string; name?: string; page?: { originalName?: string; name?: string } }
  return o.originalName || o.name || o.page?.originalName || o.page?.name || null
}

export function createLogseqServices(): EditorServices {
  const persistence: Persistence = (() => {
    const store = logseq.Assets.makeSandboxStorage()
    return {
      load: async (k) => (await store.getItem(k).catch(() => null)) ?? null,
      save: (k, v) => store.setItem(k, v),
    }
  })()
  return {
    async getActivePageName() { return pageNameOf(await logseq.Editor.getCurrentPage()) },
    onActivePageChange(cb) { logseq.App.onRouteChanged(async () => cb(pageNameOf(await logseq.Editor.getCurrentPage()))) },
    async navigateTo(name) { await logseq.App.pushState('page', { name }) },
    getTheme() { return readPalette() },
    onThemeChange(cb) { watchTheme(cb) },
    getUiMode(): UiMode { return { mobile: !!settings().mobileMode } },
    onUiModeChange(cb) { logseq.onSettingsChanged(() => cb()) },
    // Raw forward — the debounce lives in createCoreBackend, not here.
    onGraphChange(cb) { logseq.DB.onChanged(() => cb()) },
    getOntology(): OntologyConfig { const s = settings(); return buildOntology({ parent: s.parentFields, child: s.childFields, jump: s.jumpFields }) },
    // Raw forward — the debounce lives in createCoreBackend, not here.
    onOntologyChange(cb) { logseq.onSettingsChanged(() => cb()) },
    persistence,
  }
}

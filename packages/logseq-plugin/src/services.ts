import '@logseq/libs'
import { type EditorServices, type OntologyConfig, type Persistence, type UiMode, buildOntology } from '@logseq-synapses/core'
import { readPalette, watchTheme } from './theme'

function pageNameOf(p: any): string | null {
  if (!p) return null
  if (p.originalName || p.name) return p.originalName || p.name
  if (p.page) return p.page.originalName || p.page.name
  return null
}

export function createLogseqServices(): EditorServices {
  const persistence: Persistence = (() => {
    const store = (logseq as any).Assets.makeSandboxStorage()
    return { load: (k) => store.getItem(k).catch(() => null), save: (k, v) => store.setItem(k, v) }
  })()
  return {
    async getActivePageName() { return pageNameOf(await (logseq as any).Editor.getCurrentPage()) },
    onActivePageChange(cb) { (logseq as any).App.onRouteChanged(async () => cb(pageNameOf(await (logseq as any).Editor.getCurrentPage()))) },
    async navigateTo(name) { await (logseq as any).App.pushState('page', { name }) },
    getTheme() { return readPalette() },
    onThemeChange(cb) { watchTheme(cb) },
    getUiMode(): UiMode { const s = (logseq as any).settings || {}; return { mobile: !!s.mobileMode } },
    onUiModeChange(cb) { (logseq as any).onSettingsChanged(() => cb()) },
    // Raw forward — the debounce lives in createCoreBackend, not here.
    onGraphChange(cb) { (logseq as any).DB.onChanged(() => cb()) },
    getOntology(): OntologyConfig { const s = (logseq as any).settings || {}; return buildOntology({ parent: s.parentFields, child: s.childFields, jump: s.jumpFields }) },
    // Raw forward — the debounce lives in createCoreBackend, not here.
    onOntologyChange(cb) { (logseq as any).onSettingsChanged(() => cb()) },
    persistence,
  }
}

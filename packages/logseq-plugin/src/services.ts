import '@logseq/libs'
import type { EditorServices, Palette, OntologyConfig, Persistence } from '@logseq-synapses/core'
import { buildOntology } from '@logseq-synapses/core'

// Read Logseq's theme CSS variables from the host document so the synapses iframe
// (which does NOT inherit Logseq CSS) can match the active theme.
const VARS: Record<string, string> = {
  bg: '--ls-primary-background-color',
  bg2: '--ls-secondary-background-color',
  text: '--ls-primary-text-color',
  text2: '--ls-secondary-text-color',
  border: '--ls-border-color',
  accent: '--ls-active-primary-color',
}

function currentMode(): 'light' | 'dark' {
  try {
    const html = parent.document.documentElement
    if (html.classList.contains('dark') || html.getAttribute('data-theme') === 'dark') return 'dark'
  } catch (e) {
    /* ignore */
  }
  return 'light'
}

export function readPalette(mode?: string): Palette {
  const out: Palette = { mode: (mode as 'light' | 'dark') || currentMode() }
  try {
    const cs = getComputedStyle(parent.document.documentElement)
    for (const k of Object.keys(VARS)) {
      const v = cs.getPropertyValue(VARS[k]).trim()
      if (v) (out as any)[k] = v
    }
    // accent fallback
    if (!out.accent) {
      const link = cs.getPropertyValue('--ls-link-text-color').trim()
      if (link) out.accent = link
    }
  } catch (e) {
    /* ignore */
  }
  return out
}

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
    onThemeChange(cb) { (logseq as any).App.onThemeModeChanged((e: any) => cb(readPalette(e?.mode))) },
    // Raw forward — the debounce lives in createCoreBackend, not here.
    onGraphChange(cb) { (logseq as any).DB.onChanged(() => cb()) },
    getOntology(): OntologyConfig { const s = (logseq as any).settings || {}; return buildOntology({ parent: s.parentFields, child: s.childFields, jump: s.jumpFields }) },
    // Raw forward — the debounce lives in createCoreBackend, not here.
    onOntologyChange(cb) { (logseq as any).onSettingsChanged(() => cb()) },
    persistence,
  }
}

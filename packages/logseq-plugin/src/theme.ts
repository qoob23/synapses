import '@logseq/libs'
import { type Palette, isDarkColor, isOpaqueColor, mixColors } from '@logseq-synapses/core'

// Logseq theme CSS variables, read from the HOST document so the synapses iframe
// (which doesn't inherit Logseq CSS) matches the active theme — including
// custom/community themes that scope --ls-* overrides to body/app containers
// rather than :root. See docs/superpowers/specs/2026-06-28-logseq-theme-adaptation-design.md.
const VARS: Record<Exclude<keyof Palette, 'mode'>, string[]> = {
  bg: ['--ls-primary-background-color'],
  bg2: ['--ls-secondary-background-color'],
  text: ['--ls-primary-text-color'],
  text2: ['--ls-secondary-text-color'],
  border: ['--ls-border-color'],
  accent: ['--ls-active-primary-color', '--ls-link-text-color', '--ls-page-ref-color'],
}

// Deepest first: a body descendant inherits BOTH html- and body-scoped --ls-*
// overrides a theme may define (e.g. qoob23 sets some vars in `html[...] body {}`).
const HOST_SELECTORS = ['.cp__sidebar-main-layout', '#main-content-container', 'body']

function hostDoc(): Document | null {
  try { return parent.document } catch { return null }
}

// The HOST window's getComputedStyle — the iframe's own function on a host-document
// element is a cross-document call that returns empty values.
function cssOf(el: Element | null): CSSStyleDeclaration | null {
  if (!el) return null
  try { return (parent as Window).getComputedStyle(el) } catch { return null }
}

function themedHost(doc: Document): HTMLElement {
  for (const sel of HOST_SELECTORS) {
    const el = doc.querySelector<HTMLElement>(sel)
    if (el) return el
  }
  return doc.documentElement
}

function firstVar(cs: CSSStyleDeclaration, names: string[]): string | undefined {
  for (const n of names) {
    const v = cs.getPropertyValue(n).trim()
    if (v) return v
  }
  return undefined
}

// Climb ancestors returning the first non-transparent background-color (an
// element's own background is often transparent, painted by an ancestor).
function resolvedBg(el: Element | null): string | undefined {
  let node: Element | null = el
  while (node) {
    const bg = cssOf(node)?.backgroundColor
    if (bg && isOpaqueColor(bg)) return bg
    node = node.parentElement
  }
  return undefined
}

function hasDarkMarker(el: Element | null): boolean {
  let n: Element | null = el
  while (n) {
    if (n.getAttribute('data-theme') === 'dark') return true
    if (n.classList.contains('dark') || n.classList.contains('dark-theme')) return true
    n = n.parentElement
  }
  return false
}

export function readPalette(modeHint?: 'light' | 'dark'): Palette {
  const doc = hostDoc()
  if (!doc) return { mode: modeHint || 'light' }
  const host = themedHost(doc)
  const cs = cssOf(host)
  if (!cs) return { mode: modeHint || 'light' }

  const out: Palette = { mode: 'light' }
  // Background is RENDERED-FIRST: --ls-primary-background-color can resolve darker
  // than the actual painted editor surface (some themes paint the visible bg via a
  // body-level rule, leaving the primary var at a darker default). Sample what's
  // really on screen so the view matches the editor; fall back to the var.
  out.bg = resolvedBg(doc.querySelector('#main-content-container') || host) || firstVar(cs, VARS.bg)
  // Secondary surface (toolbar/cards): the var is a sensible distinct shade; else
  // sample the sidebar, else reuse bg.
  out.bg2 = firstVar(cs, VARS.bg2)
    || resolvedBg(doc.querySelector('#right-sidebar, .cp__right-sidebar-inner'))
    || out.bg
  out.text = firstVar(cs, VARS.text) || cs.color || undefined
  out.accent = firstVar(cs, VARS.accent)
  // Subtle slots: --ls-* var, else derive from text+bg as concrete rgb (canvas-safe).
  out.text2 = firstVar(cs, VARS.text2) || mixColors(out.text, out.bg, 0.45)
  out.border = firstVar(cs, VARS.border) || mixColors(out.bg, out.text, 0.18)

  out.mode = modeHint
    || (hasDarkMarker(host) || hasDarkMarker(doc.documentElement) ? 'dark'
      : isDarkColor(out.bg) ? 'dark' : 'light')

  // Drop unresolved keys so applyTheme keeps core defaults for them.
  for (const k of Object.keys(out) as (keyof Palette)[]) {
    if (out[k] == null) delete (out as Record<keyof Palette, unknown>)[k]
  }
  return out
}

export function watchTheme(cb: (p: Palette) => void): void {
  try { (logseq as any).App.onThemeModeChanged((e: any) => cb(readPalette(e?.mode))) } catch { /* ignore */ }

  const doc = hostDoc()
  if (!doc || typeof MutationObserver === 'undefined') return
  const targets = new Set<Element>([doc.documentElement])
  if (doc.body) targets.add(doc.body)
  const layout = doc.querySelector('.cp__sidebar-main-layout')
  if (layout) targets.add(layout)

  let timer: ReturnType<typeof setTimeout> | undefined
  const obs = new MutationObserver(() => {
    if (timer) return
    timer = setTimeout(() => { timer = undefined; cb(readPalette()) }, 50)
  })
  for (const t of targets) {
    obs.observe(t, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-color', 'style'] })
  }
}

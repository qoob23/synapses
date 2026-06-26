// Read Logseq's theme CSS variables from the host document so the synapses iframe
// (which does NOT inherit Logseq CSS) can match the active theme.

const VARS = {
  bg: '--ls-primary-background-color',
  bg2: '--ls-secondary-background-color',
  text: '--ls-primary-text-color',
  text2: '--ls-secondary-text-color',
  border: '--ls-border-color',
  accent: '--ls-active-primary-color',
}

function currentMode() {
  try {
    const html = parent.document.documentElement
    if (html.classList.contains('dark') || html.getAttribute('data-theme') === 'dark') return 'dark'
  } catch (e) {
    /* ignore */
  }
  return 'light'
}

export function readPalette(mode) {
  const out = { mode: mode || currentMode() }
  try {
    const cs = getComputedStyle(parent.document.documentElement)
    for (const k in VARS) {
      const v = cs.getPropertyValue(VARS[k]).trim()
      if (v) out[k] = v
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

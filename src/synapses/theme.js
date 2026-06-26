// Apply a palette (read from Logseq by the main context) onto the iframe's CSS
// variables, and return edge colors for the canvas layer.
export function applyTheme(palette) {
  const fallback = { edge: 'rgba(127,127,127,0.55)', jumpEdge: 'rgba(127,127,127,0.32)' }
  if (!palette) return fallback

  const r = document.documentElement
  const map = {
    '--synapses-bg': palette.bg,
    '--synapses-bg2': palette.bg2,
    '--synapses-text': palette.text,
    '--synapses-text2': palette.text2,
    '--synapses-border': palette.border,
    '--synapses-accent': palette.accent,
  }
  for (const k in map) {
    if (map[k]) r.style.setProperty(k, map[k])
  }
  document.body.classList.toggle('synapses-dark', palette.mode === 'dark')

  return {
    edge: palette.border || fallback.edge,
    jumpEdge: palette.text2 || fallback.jumpEdge,
  }
}

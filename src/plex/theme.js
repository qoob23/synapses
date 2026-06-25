// Apply a palette (read from Logseq by the main context) onto the iframe's CSS
// variables, and return edge colors for the canvas layer.
export function applyTheme(palette) {
  const fallback = { edge: 'rgba(127,127,127,0.55)', jumpEdge: 'rgba(127,127,127,0.32)' }
  if (!palette) return fallback

  const r = document.documentElement
  const map = {
    '--plex-bg': palette.bg,
    '--plex-bg2': palette.bg2,
    '--plex-text': palette.text,
    '--plex-text2': palette.text2,
    '--plex-border': palette.border,
    '--plex-accent': palette.accent,
  }
  for (const k in map) {
    if (map[k]) r.style.setProperty(k, map[k])
  }
  document.body.classList.toggle('plex-dark', palette.mode === 'dark')

  return {
    edge: palette.border || fallback.edge,
    jumpEdge: palette.text2 || fallback.jumpEdge,
  }
}

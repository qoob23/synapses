import type { Palette } from '../types'

// Apply a palette (read from the editor by the main context) onto the root
// container's CSS variables, and return edge colors for the canvas layer.
export function applyTheme(root: HTMLElement, palette: Palette) {
  const fallback = { edge: 'rgba(127,127,127,0.55)', jumpEdge: 'rgba(127,127,127,0.32)' }
  if (!palette) return fallback

  const map: Record<string, string | undefined> = {
    '--synapses-bg': palette.bg,
    '--synapses-bg2': palette.bg2,
    '--synapses-text': palette.text,
    '--synapses-text2': palette.text2,
    '--synapses-border': palette.border,
    '--synapses-accent': palette.accent,
  }
  for (const k in map) {
    if (map[k]) root.style.setProperty(k, map[k] as string)
  }
  root.classList.toggle('synapses-dark', palette.mode === 'dark')

  return {
    edge: palette.border || fallback.edge,
    jumpEdge: palette.text2 || fallback.jumpEdge,
  }
}

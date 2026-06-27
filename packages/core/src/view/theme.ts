import type { Palette } from '../types'
import { clampColorAlpha } from './color'

// Apply a palette (read from the editor by the main context) onto the root
// container's CSS variables, and return edge colors for the canvas layer.
// Theme colors are passed through clampColorAlpha so translucent values (e.g.
// Obsidian's --background-modifier-border) can't fade borders/connectors out of
// sight — transparency is capped at 50% (opacity >= 0.5).
export function applyTheme(root: HTMLElement, palette: Palette) {
  const fallback = { edge: 'rgba(127,127,127,0.55)', jumpEdge: 'rgba(127,127,127,0.32)' }
  if (!palette) return fallback

  const map: Record<string, string | undefined> = {
    '--synapses-bg': clampColorAlpha(palette.bg),
    '--synapses-bg2': clampColorAlpha(palette.bg2),
    '--synapses-text': clampColorAlpha(palette.text),
    '--synapses-text2': clampColorAlpha(palette.text2),
    '--synapses-border': clampColorAlpha(palette.border),
    '--synapses-accent': clampColorAlpha(palette.accent),
  }
  for (const k in map) {
    if (map[k]) root.style.setProperty(k, map[k] as string)
  }
  root.classList.toggle('synapses-dark', palette.mode === 'dark')

  return {
    edge: map['--synapses-border'] || fallback.edge,
    jumpEdge: map['--synapses-text2'] || fallback.jumpEdge,
  }
}

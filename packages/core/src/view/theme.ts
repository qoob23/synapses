import type { Palette } from '../types'
import { clampColorAlpha, mixColors } from './color'

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

  // Connector colors are DERIVED from bg→text rather than taken from the theme's
  // border/muted-text vars: a UI border color is often too dim to see as a line,
  // and muted text can be brighter than the border — which inverted the intended
  // "direct links read stronger than jumps" ordering. Mixing toward text by a
  // fixed amount guarantees both visibility and ordering (direct > jump) in any
  // theme, light or dark. Concrete rgb() (mixColors) keeps them valid as canvas
  // strokeStyle. Falls back to the border/muted vars, then the static grays.
  return {
    edge: mixColors(palette.bg, palette.text, 0.55) || map['--synapses-border'] || fallback.edge,
    jumpEdge: mixColors(palette.bg, palette.text, 0.33) || map['--synapses-text2'] || fallback.jumpEdge,
  }
}

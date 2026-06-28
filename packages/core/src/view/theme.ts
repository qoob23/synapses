import type { Palette } from '../types'
import { clampColorAlpha, mixColors } from './color'

// Resolve the canvas connector colors for a palette. Precedence, per kind:
//   1. the user's configured override (palette.primaryEdge / .secondaryEdge),
//   2. a color DERIVED from bg→text — a UI border color is often too dim to see
//      as a line, and muted text can be brighter than the border, which inverted
//      the intended "direct links read stronger than jumps" ordering; mixing
//      toward text by a fixed amount guarantees visibility AND ordering
//      (direct > jump) in any theme, light or dark,
//   3. the theme's border / muted-text vars, then 4. static grays.
// Everything passes through clampColorAlpha so a too-translucent value (incl. a
// user override) can't fade the connectors out of sight. mixColors yields a
// concrete rgb() so the result is valid as a <canvas> strokeStyle.
export function connectorColors(palette: Palette): { edge: string; jumpEdge: string } {
  const fallback = { edge: 'rgba(127,127,127,0.55)', jumpEdge: 'rgba(127,127,127,0.32)' }
  if (!palette) return fallback
  return {
    edge: clampColorAlpha(palette.primaryEdge)
      || mixColors(palette.bg, palette.text, 0.55)
      || clampColorAlpha(palette.border)
      || fallback.edge,
    jumpEdge: clampColorAlpha(palette.secondaryEdge)
      || mixColors(palette.bg, palette.text, 0.33)
      || clampColorAlpha(palette.text2)
      || fallback.jumpEdge,
  }
}

// Apply a palette (read from the editor by the main context) onto the root
// container's CSS variables, and return the connector colors for the canvas layer.
// Theme colors are passed through clampColorAlpha so translucent values (e.g.
// Obsidian's --background-modifier-border) can't fade borders out of sight —
// transparency is capped at 50% (opacity >= 0.5).
export function applyTheme(root: HTMLElement, palette: Palette) {
  if (!palette) return connectorColors(palette)

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

  return connectorColors(palette)
}

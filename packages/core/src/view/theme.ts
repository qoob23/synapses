import type { Palette } from '../types'
import { clampColorAlpha, mixColors, fadeAlpha, withAlpha } from './color'

// Connections are always shades of GRAY, never the picked color; transparency
// distinguishes the link kinds: direct (parent/child) links draw the gray at the
// base alpha (75%), jump/sibling links at half that. The picked color (else the
// theme accent) is reserved for the HOVERED connection — drawn opaque, so a hover
// reads as bold + bright. The gray base is, in order:
//   1. a color mixed from bg→text (a UI border is often too dim to see as a line;
//      mixing toward text guarantees visibility in any theme), else
//   2. the theme border var, else 3. a static gray.
// mixColors yields a concrete rgb() so the result is valid as a <canvas> strokeStyle.
const FALLBACK_BASE = 'rgb(127, 127, 127)'
const JUMP_FACTOR = 0.5 // jump/sibling connectors = the gray at half opacity
const DEFAULT_ALPHA = 0.75 // resting connectors render softened to this, not solid

export function connectorColors(palette: Palette): { edge: string; jumpEdge: string; highlight: string } {
  const grayBase = (palette && (
    mixColors(palette.bg, palette.text, 0.55)
    || clampColorAlpha(palette.border)
  )) || FALLBACK_BASE
  const edge = withAlpha(grayBase, DEFAULT_ALPHA) as string
  const highlightBase = (palette && (palette.primaryEdge || palette.accent)) || grayBase
  return {
    edge,
    jumpEdge: fadeAlpha(edge, JUMP_FACTOR) as string,
    highlight: withAlpha(highlightBase, 1) as string,
  }
}

// Apply a palette (read from the editor by the main context) onto the root
// container's CSS variables, and return the connector colors for the canvas layer.
// Most colors pass through clampColorAlpha so translucent values (e.g. Obsidian's
// --background-modifier-border) can't fade out — transparency is capped at 50%.
// The default border is the exception: it's SET to 75% opacity (softer chrome +
// card outlines). An explicit primary override (--synapses-primary) stays full.
export function applyTheme(root: HTMLElement, palette: Palette) {
  if (!palette) return connectorColors(palette)

  const map: Record<string, string | undefined> = {
    '--synapses-bg': clampColorAlpha(palette.bg),
    '--synapses-bg2': clampColorAlpha(palette.bg2),
    '--synapses-text': clampColorAlpha(palette.text),
    '--synapses-text2': clampColorAlpha(palette.text2),
    '--synapses-border': withAlpha(palette.border, 0.75),
    '--synapses-accent': clampColorAlpha(palette.accent),
  }
  for (const k in map) {
    if (map[k]) root.style.setProperty(k, map[k] as string)
  }
  root.classList.toggle('synapses-dark', palette.mode === 'dark')

  // The picked color is a HIGHLIGHT, used (at full strength) only for the active
  // card and the current history crumb — via --synapses-primary, which those rules
  // fall back FROM to the theme accent when it's absent. Resting cards/crumbs and
  // the connectors never use it. Cleared (not just unset) so resetting reverts them.
  const primary = clampColorAlpha(palette.primaryEdge)
  if (primary) root.style.setProperty('--synapses-primary', primary)
  else root.style.removeProperty('--synapses-primary')

  return connectorColors(palette)
}

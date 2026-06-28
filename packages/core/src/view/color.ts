// Theme colors can arrive very translucent (e.g. Obsidian's
// --background-modifier-border), which makes connectors and borders fade to
// invisible. clampColorAlpha caps transparency: any color with an explicit alpha
// below `minOpacity` is rewritten up to that floor; opaque colors (and formats
// without an alpha channel, like named colors) pass through unchanged.
export const MIN_OPACITY = 0.5

// Format the floored alpha for functional notation (e.g. 0.5 -> "0.5").
function fmtAlpha(a: number): string {
  return String(Number(a.toFixed(4)))
}

// Two-digit hex for a 0..1 alpha (0.5 -> "80").
function alphaToHex(a: number): string {
  return Math.round(a * 255).toString(16).padStart(2, '0')
}

export function clampColorAlpha(color: string | undefined, minOpacity = MIN_OPACITY): string | undefined {
  if (!color) return color
  const c = color.trim()

  // #rgb / #rgba / #rrggbb / #rrggbbaa
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c)
  if (hex) {
    const h = hex[1]
    if (h.length === 3 || h.length === 6) return c // no alpha channel -> opaque
    if (h.length === 4) {
      const rgb = h.slice(0, 3).split('').map((n) => n + n).join('') // expand to rrggbb
      const alpha = parseInt(h[3] + h[3], 16) / 255
      return alpha >= minOpacity ? c : '#' + rgb + alphaToHex(minOpacity)
    }
    // length 8
    const alpha = parseInt(h.slice(6, 8), 16) / 255
    return alpha >= minOpacity ? c : '#' + h.slice(0, 6) + alphaToHex(minOpacity)
  }

  // rgb()/rgba()/hsl()/hsla(), comma or modern slash syntax
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/i.exec(c)
  if (fn) {
    const name = fn[1]
    const body = fn[2]
    const parseAlpha = (raw: string): number => {
      const t = raw.trim()
      return t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t)
    }
    if (body.includes('/')) {
      const slash = body.indexOf('/')
      const alpha = parseAlpha(body.slice(slash + 1))
      if (isNaN(alpha) || alpha >= minOpacity) return c
      return `${name}(${body.slice(0, slash).trim()} / ${fmtAlpha(minOpacity)})`
    }
    const parts = body.split(',')
    if (parts.length < 4) return c // no alpha component -> opaque
    const alpha = parseAlpha(parts[3])
    if (isNaN(alpha) || alpha >= minOpacity) return c
    return `${name}(${parts.slice(0, 3).map((p) => p.trim()).join(', ')}, ${fmtAlpha(minOpacity)})`
  }

  // Named colors / keywords / unsupported formats: no alpha to clamp.
  return c
}

export interface Rgb { r: number; g: number; b: number; a: number }

// Parse the formats getComputedStyle returns (rgb/rgba) and that themes use in
// --ls-* vars (hex). Returns null for formats we don't blend (named colors, hsl,
// color-mix) so callers fall back gracefully.
export function parseColorToRgb(color?: string): Rgb | null {
  if (!color) return null
  const c = color.trim()
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = h.split('').map((n) => n + n).join('')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return { r, g, b, a }
  }
  const fn = /^rgba?\(([^)]*)\)$/i.exec(c)
  if (fn) {
    const body = fn[1]
    const slash = body.indexOf('/')
    let comps: string[]
    let alphaRaw: string | undefined
    if (slash >= 0) {
      comps = body.slice(0, slash).trim().split(/[\s,]+/)
      alphaRaw = body.slice(slash + 1).trim()
    } else {
      const parts = body.split(',').map((p) => p.trim())
      comps = parts.slice(0, 3)
      alphaRaw = parts[3]
    }
    const chan = (raw: string) => {
      const t = (raw || '').trim()
      return t.endsWith('%') ? (parseFloat(t) / 100) * 255 : parseFloat(t)
    }
    const r = Math.round(chan(comps[0]))
    const g = Math.round(chan(comps[1]))
    const b = Math.round(chan(comps[2]))
    if ([r, g, b].some((n) => isNaN(n))) return null
    const a = alphaRaw == null || alphaRaw === '' ? 1
      : alphaRaw.endsWith('%') ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw)
    return { r, g, b, a: isNaN(a) ? 1 : a }
  }
  return null
}

// Opaque = not the `transparent` keyword and alpha > 0. Unparseable named colors
// are assumed opaque (getComputedStyle returns rgb/rgba, so this only affects
// hand-written values).
export function isOpaqueColor(color?: string): boolean {
  if (!color) return false
  const c = color.trim().toLowerCase()
  if (c === '' || c === 'transparent') return false
  const rgb = parseColorToRgb(c)
  return rgb ? rgb.a > 0 : true
}

// Perceived-luminance test (Rec. 601 on 0..255). Mode fallback when no
// data-theme / .dark marker is present.
export function isDarkColor(color?: string): boolean {
  const rgb = parseColorToRgb(color)
  if (!rgb) return false
  return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b < 128
}

// Convert any parseable color to #rrggbb for an <input type="color"> (which only
// accepts 6-digit hex). Alpha is dropped. Returns undefined if unparseable.
export function rgbToHex(color?: string): string | undefined {
  const rgb = parseColorToRgb(color)
  if (!rgb) return undefined
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return '#' + h(rgb.r) + h(rgb.g) + h(rgb.b)
}

// Linear blend; `t` is the weight toward c2 (0 => c1, 1 => c2). Returns concrete
// rgb(...) so the result is valid as a <canvas> strokeStyle (color-mix() is not
// reliably accepted there). Falls back to whichever input parses.
export function mixColors(c1: string | undefined, c2: string | undefined, t: number): string | undefined {
  const a = parseColorToRgb(c1)
  const b = parseColorToRgb(c2)
  if (!a && !b) return c1 ?? c2
  if (!a) return c2
  if (!b) return c1
  const k = Math.min(1, Math.max(0, t))
  const mix = (x: number, y: number) => Math.round(x + (y - x) * k)
  return `rgb(${mix(a.r, b.r)}, ${mix(a.g, b.g)}, ${mix(a.b, b.b)})`
}

// Format a clamped 0..1 alpha without trailing-zero noise (0.5 -> "0.5").
function clampAlpha(a: number): number {
  return Number(Math.max(0, Math.min(1, a)).toFixed(4))
}

// Multiply a color's existing alpha by `factor`, returning rgba(...). Used to
// derive the faded jump/sibling connector from the primary connector color —
// transparency (not a second color) distinguishes the two link kinds, so the
// fade is proportional and stays distinct whatever the primary's own alpha is.
// Returns the input unchanged if it can't be parsed.
export function fadeAlpha(color: string | undefined, factor: number): string | undefined {
  const rgb = parseColorToRgb(color)
  if (!rgb) return color
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clampAlpha(rgb.a * factor)})`
}

// Set a color's alpha to an absolute value, returning rgba(...). Used for the
// hover highlight (full opacity so a hovered link reads brighter than its
// resting state). Returns the input unchanged if it can't be parsed.
export function withAlpha(color: string | undefined, alpha: number): string | undefined {
  const rgb = parseColorToRgb(color)
  if (!rgb) return color
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clampAlpha(alpha)})`
}

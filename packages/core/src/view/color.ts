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

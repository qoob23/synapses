import { describe, it, expect } from 'vitest'
import { clampColorAlpha, parseColorToRgb, isOpaqueColor, isDarkColor, mixColors, rgbToHex, fadeAlpha, withAlpha } from './color'

describe('clampColorAlpha', () => {
  // The bug: theme borders (e.g. Obsidian's --background-modifier-border) come in
  // very translucent and make connectors/borders disappear. Cap transparency at 50%
  // (opacity >= 0.5) so colors always stay visible.

  it('raises a too-transparent rgba to the 0.5 opacity floor', () => {
    expect(clampColorAlpha('rgba(0,0,0,0.1)')).toBe('rgba(0, 0, 0, 0.5)')
  })

  it('leaves an rgba already opaque enough untouched', () => {
    expect(clampColorAlpha('rgba(10, 20, 30, 0.9)')).toBe('rgba(10, 20, 30, 0.9)')
  })

  it('leaves an alpha exactly at the floor untouched', () => {
    expect(clampColorAlpha('rgba(0,0,0,0.5)')).toBe('rgba(0,0,0,0.5)')
  })

  it('leaves an opaque rgb() (no alpha) untouched', () => {
    expect(clampColorAlpha('rgb(10,20,30)')).toBe('rgb(10,20,30)')
  })

  it('raises a too-transparent hsla', () => {
    expect(clampColorAlpha('hsla(210, 50%, 50%, 0.2)')).toBe('hsla(210, 50%, 50%, 0.5)')
  })

  it('raises a too-transparent rgb() in slash syntax', () => {
    expect(clampColorAlpha('rgb(10 20 30 / 0.1)')).toBe('rgb(10 20 30 / 0.5)')
  })

  it('parses a percentage alpha in slash syntax', () => {
    expect(clampColorAlpha('rgb(10 20 30 / 10%)')).toBe('rgb(10 20 30 / 0.5)')
  })

  it('leaves an opaque 6-digit hex untouched', () => {
    expect(clampColorAlpha('#aabbcc')).toBe('#aabbcc')
  })

  it('raises a too-transparent 8-digit hex (0.5 -> 0x80)', () => {
    expect(clampColorAlpha('#aabbcc40')).toBe('#aabbcc80')
  })

  it('leaves an 8-digit hex already opaque enough untouched', () => {
    expect(clampColorAlpha('#aabbccff')).toBe('#aabbccff')
  })

  it('expands and raises a too-transparent 4-digit hex', () => {
    expect(clampColorAlpha('#abc4')).toBe('#aabbcc80')
  })

  it('leaves an opaque 3-digit hex untouched', () => {
    expect(clampColorAlpha('#abc')).toBe('#abc')
  })

  it('honors a custom minimum opacity', () => {
    expect(clampColorAlpha('rgba(0,0,0,0.5)', 0.9)).toBe('rgba(0, 0, 0, 0.9)')
  })

  it('leaves named colors untouched', () => {
    expect(clampColorAlpha('red')).toBe('red')
  })

  it('passes through empty / undefined input', () => {
    expect(clampColorAlpha('')).toBe('')
    expect(clampColorAlpha(undefined)).toBe(undefined)
  })
})

describe('parseColorToRgb', () => {
  it('parses #rrggbb', () => { expect(parseColorToRgb('#334455')).toEqual({ r: 51, g: 68, b: 85, a: 1 }) })
  it('parses #rgb shorthand', () => { expect(parseColorToRgb('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 }) })
  it('parses #rrggbbaa alpha', () => { expect(parseColorToRgb('#00000080')!.a).toBeCloseTo(0.5, 2) })
  it('parses rgb()', () => { expect(parseColorToRgb('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 }) })
  it('parses rgba() with alpha', () => { expect(parseColorToRgb('rgba(10, 20, 30, 0.4)')).toEqual({ r: 10, g: 20, b: 30, a: 0.4 }) })
  it('parses modern slash rgb', () => { expect(parseColorToRgb('rgb(10 20 30 / 0.4)')).toEqual({ r: 10, g: 20, b: 30, a: 0.4 }) })
  it('returns null for unsupported formats', () => {
    expect(parseColorToRgb('white')).toBeNull()
    expect(parseColorToRgb('hsl(0,0%,0%)')).toBeNull()
    expect(parseColorToRgb(undefined)).toBeNull()
  })
})

describe('isOpaqueColor', () => {
  it('false for transparent / zero alpha / empty', () => {
    expect(isOpaqueColor('transparent')).toBe(false)
    expect(isOpaqueColor('rgba(0,0,0,0)')).toBe(false)
    expect(isOpaqueColor(undefined)).toBe(false)
  })
  it('true for opaque and semi-transparent', () => {
    expect(isOpaqueColor('rgb(1,2,3)')).toBe(true)
    expect(isOpaqueColor('rgba(1,2,3,0.2)')).toBe(true)
  })
  it('assumes unparseable named colors are opaque', () => { expect(isOpaqueColor('white')).toBe(true) })
})

describe('isDarkColor', () => {
  it('true for dark backgrounds', () => {
    expect(isDarkColor('#222222')).toBe(true)
    expect(isDarkColor('rgb(20,20,20)')).toBe(true)
  })
  it('false for light backgrounds', () => {
    expect(isDarkColor('#eeeeee')).toBe(false)
    expect(isDarkColor('white')).toBe(false)
  })
})

describe('rgbToHex', () => {
  it('converts rgb()/rgba() to #rrggbb (dropping alpha)', () => {
    expect(rgbToHex('rgb(255, 0, 0)')).toBe('#ff0000')
    expect(rgbToHex('rgba(0, 128, 255, 0.4)')).toBe('#0080ff')
  })
  it('normalizes hex shorthand and passes 6-digit hex through', () => {
    expect(rgbToHex('#abc')).toBe('#aabbcc')
    expect(rgbToHex('#0080ff')).toBe('#0080ff')
  })
  it('returns undefined for unparseable input', () => {
    expect(rgbToHex('white')).toBeUndefined()
    expect(rgbToHex(undefined)).toBeUndefined()
  })
})

describe('mixColors', () => {
  it('blends toward c2 by t', () => { expect(mixColors('rgb(0,0,0)', 'rgb(100,100,100)', 0.5)).toBe('rgb(50, 50, 50)') })
  it('t=0 returns c1, t=1 returns c2 (as rgb)', () => {
    expect(mixColors('#000000', '#ffffff', 0)).toBe('rgb(0, 0, 0)')
    expect(mixColors('#000000', '#ffffff', 1)).toBe('rgb(255, 255, 255)')
  })
  it('falls back to whichever input parses', () => {
    expect(mixColors('white', '#000000', 0.5)).toBe('#000000')
    expect(mixColors('#ffffff', 'nope', 0.5)).toBe('#ffffff')
  })
})

describe('fadeAlpha', () => {
  it('halves the alpha of an opaque color', () => {
    expect(fadeAlpha('rgb(140, 140, 140)', 0.5)).toBe('rgba(140, 140, 140, 0.5)')
    expect(fadeAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)')
  })
  it('is proportional to the existing alpha (stays distinct from the source)', () => {
    expect(fadeAlpha('rgba(127, 127, 127, 0.55)', 0.5)).toBe('rgba(127, 127, 127, 0.275)')
  })
  it('returns unparseable input unchanged', () => {
    expect(fadeAlpha('white', 0.5)).toBe('white')
    expect(fadeAlpha(undefined, 0.5)).toBeUndefined()
  })
})

describe('withAlpha', () => {
  it('sets an absolute alpha', () => {
    expect(withAlpha('rgb(140, 140, 140)', 1)).toBe('rgba(140, 140, 140, 1)')
    expect(withAlpha('rgba(255, 0, 0, 0.2)', 1)).toBe('rgba(255, 0, 0, 1)')
  })
  it('clamps out-of-range alpha', () => {
    expect(withAlpha('#000000', 2)).toBe('rgba(0, 0, 0, 1)')
  })
  it('returns unparseable input unchanged', () => {
    expect(withAlpha('white', 1)).toBe('white')
    expect(withAlpha(undefined, 1)).toBeUndefined()
  })
})

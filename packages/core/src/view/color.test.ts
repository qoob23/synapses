import { describe, it, expect } from 'vitest'
import { clampColorAlpha } from './color'

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

import { describe, it, expect } from 'vitest'
import { clampMenuPosition } from './context-menu'

describe('clampMenuPosition', () => {
  const box = { w: 160, h: 80 }
  const vp = { w: 1000, h: 800 }
  it('anchors the menu top-left at the point when it fits', () => {
    expect(clampMenuPosition({ x: 500, y: 400 }, box, vp)).toEqual({ left: 500, top: 400 })
  })
  it('clamps a near-edge point so the menu stays on-screen', () => {
    expect(clampMenuPosition({ x: 990, y: 790 }, box, vp)).toEqual({ left: 840, top: 720 })
  })
  it('clamps a top-left point to >= 0', () => {
    expect(clampMenuPosition({ x: -5, y: -5 }, box, vp)).toEqual({ left: 0, top: 0 })
  })
})

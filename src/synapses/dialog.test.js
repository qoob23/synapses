import { describe, it, expect } from 'vitest'
import { clampDialogPosition } from './dialog.js'

describe('clampDialogPosition', () => {
  const box = { w: 420, h: 200 }
  const vp = { w: 1000, h: 800 }
  it('centers the box horizontally on the point and keeps it on-screen', () => {
    expect(clampDialogPosition({ x: 500, y: 400 }, box, vp)).toEqual({ left: 290, top: 400 })
  })
  it('clamps a near-edge point so the box never overflows', () => {
    expect(clampDialogPosition({ x: 990, y: 790 }, box, vp)).toEqual({ left: 580, top: 600 })
  })
  it('clamps a top-left point to >= 0', () => {
    expect(clampDialogPosition({ x: 0, y: 0 }, box, vp)).toEqual({ left: 0, top: 0 })
  })
})

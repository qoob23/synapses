import { describe, it, expect } from 'vitest'
import { worldToScreen, screenToWorld } from './panzoom'

// Zoom was removed, so `s` is always 1 in practice — but the transform helpers stay
// general (and back edge hit-testing / the unlink anchor), so they're tested with s≠1.
describe('coordinate transforms', () => {
  const t = { s: 2, tx: 100, ty: 50 }
  it('maps world -> screen with scale + translate', () => {
    expect(worldToScreen(t, 10, 10)).toEqual({ x: 120, y: 70 })
  })
  it('round-trips screen -> world -> screen', () => {
    const w = screenToWorld(t, 120, 70)
    expect(w).toEqual({ x: 10, y: 10 })
    expect(worldToScreen(t, w.x, w.y)).toEqual({ x: 120, y: 70 })
  })
  it('is pure translation at s=1 (the live pan transform)', () => {
    const pan = { s: 1, tx: 300, ty: 200 }
    expect(worldToScreen(pan, 0, 0)).toEqual({ x: 300, y: 200 }) // world origin → panel center
    expect(screenToWorld(pan, 300, 200)).toEqual({ x: 0, y: 0 })
  })
})

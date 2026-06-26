import { describe, it, expect } from 'vitest'
import { worldToScreen, screenToWorld } from './panzoom'

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
})

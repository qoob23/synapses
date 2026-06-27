import { describe, it, expect } from 'vitest'
import { worldToScreen, screenToWorld, computeFit } from './panzoom'

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

describe('computeFit', () => {
  const vp = { w: 1000, h: 800 }
  // bbox chosen so the raw fit-scale is the vertical bound:
  //   (h/2 - padY)/maxY = (400 - 52)/696 = 0.5  (sx = (500 - 16)/200 = 2.42 is looser)
  const bbox = { minX: 0, minY: 0, maxX: 200, maxY: 696 }

  it('no remembered scale → returns the fit-scale (everything fits)', () => {
    expect(computeFit(bbox, vp).s).toBeCloseTo(0.5, 6)
    expect(computeFit(bbox, vp, null).s).toBeCloseTo(0.5, 6)
  })

  it('remembered smaller than fit → keeps remembered (no zoom-in)', () => {
    expect(computeFit(bbox, vp, 0.3).s).toBeCloseTo(0.3, 6)
  })

  it('remembered larger than fit (overflow) → overrides down to fit-scale', () => {
    expect(computeFit(bbox, vp, 2.0).s).toBeCloseTo(0.5, 6)
  })

  it('always centers on the viewport center', () => {
    for (const remembered of [null, 0.3, 2.0] as Array<number | null>) {
      const r = computeFit(bbox, vp, remembered)
      expect(r.tx).toBe(vp.w / 2)
      expect(r.ty).toBe(vp.h / 2)
    }
  })

  it('clamps the result to [0.25, 2.5]', () => {
    // A very tall bbox pushes the fit-scale below 0.25; it is clamped up.
    const tall = { minX: 0, minY: 0, maxX: 200, maxY: 2000 }
    expect(computeFit(tall, vp).s).toBe(0.25)
  })
})

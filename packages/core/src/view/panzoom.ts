export interface Transform {
  s: number
  tx: number
  ty: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// Pure transform helpers. `t` is the panzoom transform { s, tx, ty }. Screen
// coords are relative to the stage's top-left.
export function worldToScreen(t: Transform, x: number, y: number) {
  return { x: x * t.s + t.tx, y: y * t.s + t.ty }
}
export function screenToWorld(t: Transform, x: number, y: number) {
  return { x: (x - t.tx) / t.s, y: (y - t.ty) / t.s }
}

// Pure fit math: center on the ACTIVE THOUGHT (world origin 0,0) and pick a
// scale. The computed fit-scale (so the farthest card still fits) is treated as a
// CEILING over the user's remembered wheel-zoom:
//   - no remembered scale → auto-fit (today's behavior).
//   - remembered smaller than fit → keep it (don't zoom in to fill the panel).
//   - remembered larger than fit (would overflow) → clamp down to the fit-scale.
// Always centers (tx,ty = viewport center); manual pan is never remembered.
export function computeFit(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  viewport: { w: number; h: number },
  rememberedScale?: number | null,
): Transform {
  // padX/padY are the screen-px margins left between the farthest card edge and
  // the panel edge. padX is kept tight so the (typically wide) graph fills the
  // working space horizontally; padX just needs to clear the cards' left handles.
  const padX = 16
  const padY = 52
  const maxX = Math.max(Math.abs(bbox.minX), Math.abs(bbox.maxX), 1)
  const maxY = Math.max(Math.abs(bbox.minY), Math.abs(bbox.maxY), 1)
  const sx = (viewport.w / 2 - padX) / maxX
  const sy = (viewport.h / 2 - padY) / maxY
  const fitScale = clamp(Math.min(sx, sy, 1.15), 0.25, 2.5)
  const effective = rememberedScale == null ? fitScale : Math.min(rememberedScale, fitScale)
  return { s: clamp(effective, 0.25, 2.5), tx: viewport.w / 2, ty: viewport.h / 2 }
}

// Wheel-zoom (around the cursor) + drag-to-pan on the stage. Calls onChange with
// the current {s, tx, ty} whenever it changes. `opts.onZoomChange` fires with the
// new scale after a wheel gesture, so the view can persist the user's zoom.
export function attachPanzoom(
  stage: HTMLElement,
  onChange: (t: Transform) => void,
  opts?: { onZoomChange?: (s: number) => void },
) {
  let s = 1
  let tx = 0
  let ty = 0
  // The user's last wheel-zoom scale, applied as a ceiling on the next recenter/
  // resize (see computeFit). null until they zoom (or a saved value is restored).
  let rememberedScale: number | null = null
  let dragging = false
  let lastX = 0
  let lastY = 0

  const apply = () => onChange({ s, tx, ty })

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const rect = stage.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const ns = clamp(s * Math.exp(-e.deltaY * 0.0015), 0.25, 2.5)
      // keep the world point under the cursor fixed
      tx = mx - (mx - tx) * (ns / s)
      ty = my - (my - ty) * (ns / s)
      s = ns
      // Remember the live gesture's scale; the ceiling (computeFit) is applied on
      // the next recenter/resize, so zooming into a card to read it stays unclamped.
      rememberedScale = ns
      opts?.onZoomChange?.(ns)
      apply()
    },
    { passive: false },
  )

  stage.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('.synapses-node')) return // the card handles its own clicks
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    try {
      stage.setPointerCapture(e.pointerId)
    } catch (err) {
      /* ignore */
    }
    stage.classList.add('grabbing')
  })
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return
    tx += e.clientX - lastX
    ty += e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    apply()
  })
  const end = () => {
    dragging = false
    stage.classList.remove('grabbing')
  }
  stage.addEventListener('pointerup', end)
  stage.addEventListener('pointercancel', end)

  function set(ns: number, ntx: number, nty: number) {
    s = ns
    tx = ntx
    ty = nty
    apply()
  }

  // Keep the ACTIVE THOUGHT (world origin 0,0) centered in the viewport and scale
  // so the farthest card in any direction still fits, honoring the user's
  // remembered zoom as a ceiling (computeFit). Centering on the active thought
  // (not the bounding box) avoids the graph drifting to one side when links are
  // lopsided.
  function fit(bbox: { minX: number; minY: number; maxX: number; maxY: number }, viewport: { w: number; h: number }) {
    const f = computeFit(bbox, viewport, rememberedScale)
    set(f.s, f.tx, f.ty)
  }

  return {
    getTransform: () => ({ s, tx, ty }),
    set,
    fit,
    setRememberedScale: (ns: number | null) => { rememberedScale = ns },
  }
}

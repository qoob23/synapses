export interface Transform {
  s: number
  tx: number
  ty: number
}

// Pure transform helpers. `t` is the pan transform { s, tx, ty }. Zoom was removed, so
// `s` is always 1 and these are pure translation — but the helpers stay general (and
// keep edge hit-testing / the unlink anchor math working unchanged). Screen coords are
// relative to the stage's top-left.
export function worldToScreen(t: Transform, x: number, y: number) {
  return { x: x * t.s + t.tx, y: y * t.s + t.ty }
}
export function screenToWorld(t: Transform, x: number, y: number) {
  return { x: (x - t.tx) / t.s, y: (y - t.ty) / t.s }
}

// Drag-to-pan on the stage (no zoom). Calls onChange with the current {s, tx, ty}
// whenever it changes. `s` stays 1; `center(viewport)` puts the active note (world
// origin) at the panel center and resets any pan. A wheel over the stage is made inert
// (preventDefault, no zoom) so a trackpad scroll doesn't scroll the host page.
export function attachPanzoom(stage: HTMLElement, onChange: (t: Transform) => void) {
  let s = 1
  let tx = 0
  let ty = 0
  let dragging = false
  let lastX = 0
  let lastY = 0

  const apply = () => onChange({ s, tx, ty })

  stage.addEventListener('wheel', (e) => e.preventDefault(), { passive: false })

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

  // Center the ACTIVE NOTE (world origin 0,0) in the viewport at scale 1, dropping any
  // live pan offset. Played on each recenter/resize.
  function center(viewport: { w: number; h: number }) {
    set(1, viewport.w / 2, viewport.h / 2)
  }

  return {
    getTransform: () => ({ s, tx, ty }),
    set,
    center,
  }
}

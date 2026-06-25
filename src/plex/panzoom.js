function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

// Pure transform helpers. `t` is the panzoom transform { s, tx, ty }. Screen
// coords are relative to the stage's top-left.
export function worldToScreen(t, x, y) {
  return { x: x * t.s + t.tx, y: y * t.s + t.ty }
}
export function screenToWorld(t, x, y) {
  return { x: (x - t.tx) / t.s, y: (y - t.ty) / t.s }
}

// Wheel-zoom (around the cursor) + drag-to-pan on the stage. Calls onChange with
// the current {s, tx, ty} whenever it changes.
export function attachPanzoom(stage, onChange) {
  let s = 1
  let tx = 0
  let ty = 0
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
      apply()
    },
    { passive: false },
  )

  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.plex-node')) return // node handles its own clicks
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

  function set(ns, ntx, nty) {
    s = ns
    tx = ntx
    ty = nty
    apply()
  }

  // Keep the FOCUS (world origin 0,0) centered in the viewport
  // and scale so the farthest node in any direction still fits. Centering on the
  // focus (not the bounding box) avoids the graph drifting to one side when links
  // are lopsided.
  function fit(bbox, viewport) {
    const pad = 52
    const maxX = Math.max(Math.abs(bbox.minX), Math.abs(bbox.maxX), 1)
    const maxY = Math.max(Math.abs(bbox.minY), Math.abs(bbox.maxY), 1)
    const sx = (viewport.w / 2 - pad) / maxX
    const sy = (viewport.h / 2 - pad) / maxY
    const ns = clamp(Math.min(sx, sy, 1.15), 0.25, 1.15)
    set(ns, viewport.w / 2, viewport.h / 2)
  }

  return { getTransform: () => ({ s, tx, ty }), set, fit }
}

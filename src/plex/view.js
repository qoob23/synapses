import { computeLayout, NODE } from './layout.js'
import { computeEdges, drawEdges, gatePoint } from './edges.js'
import { attachPanzoom, worldToScreen, screenToWorld } from './panzoom.js'
import { hitTest } from './edge-hit.js'
import { nodeHandleStates } from './handles.js'

const TRANSITION_MS = 320

function defaultTheme() {
  return { edge: 'rgba(127,127,127,0.55)', jumpEdge: 'rgba(127,127,127,0.32)' }
}

// Renders the plex: HTML <div> nodes in a transformed world + a <canvas> edge
// layer. Node elements are keyed by name and reused across graphs so positions
// animate (the clicked neighbor glides to the center on recenter).
const DRAG_THRESHOLD = 6

export function createView({ world, canvas, stage, onNavigate, onOpenMain, onRemoveLink, onLinkExisting, onCreateAt }) {
  const ctx = canvas.getContext('2d')
  // Single source of truth for node box size: the layout math (NODE) drives the
  // CSS variables too, so changing NODE keeps the rendered box and the edge
  // endpoints/bbox in agreement (styles.css falls back to matching literals).
  document.documentElement.style.setProperty('--plex-node-w', NODE.W + 'px')
  document.documentElement.style.setProperty('--plex-node-h', NODE.H + 'px')
  const elements = new Map() // nameLower -> element
  let layout = null
  let theme = defaultTheme()
  let dpr = window.devicePixelRatio || 1
  let raf = 0
  let animUntil = 0
  let lastEdges = []
  let pending = null

  const panzoom = attachPanzoom(stage, (t) => {
    applyTransform(t)
    scheduleDraw()
  })

  function applyTransform(t) {
    world.style.transform = `translate(${t.tx}px, ${t.ty}px) scale(${t.s})`
  }

  function viewport() {
    const r = stage.getBoundingClientRect()
    return { w: r.width, h: r.height }
  }

  function resizeCanvas() {
    dpr = window.devicePixelRatio || 1
    const vp = viewport()
    canvas.width = Math.max(1, Math.round(vp.w * dpr))
    canvas.height = Math.max(1, Math.round(vp.h * dpr))
    canvas.style.width = vp.w + 'px'
    canvas.style.height = vp.h + 'px'
    // keep content framed when the panel is resized
    if (layout) {
      panzoom.fit(layout.bbox, vp)
      applyTransform(panzoom.getTransform())
    }
    scheduleDraw()
  }
  const ro = new ResizeObserver(resizeCanvas)
  ro.observe(stage)

  function setTheme(t) {
    theme = { ...defaultTheme(), ...(t || {}) }
    scheduleDraw()
  }

  function setGraph(graph) {
    layout = computeLayout(graph)
    const present = new Set()

    for (const node of layout.nodes) {
      const key = node.name.toLowerCase()
      present.add(key)
      let el = elements.get(key)
      if (!el) {
        el = makeNode()
        world.appendChild(el)
        elements.set(key, el)
        positionEl(el, { x: 0, y: 0 }) // new nodes fan out from the center
        void el.offsetWidth // force reflow so the move below transitions
      }
      updateNode(el, node)
      positionEl(el, node)
    }

    // remove nodes no longer present
    for (const [key, el] of elements) {
      if (present.has(key)) continue
      el.classList.add('leaving')
      const dead = el
      setTimeout(() => dead.remove(), TRANSITION_MS)
      elements.delete(key)
    }

    panzoom.fit(layout.bbox, viewport())
    applyTransform(panzoom.getTransform())
    animateFor(TRANSITION_MS + 40)
  }

  // Map each handle direction to the gate side on the node.
  const DIR_SIDE = { parent: 'top', child: 'bottom', jump: 'left' }

  // Get the current world-center of a node element from its live CSS transform.
  function liveCenterOf(el) {
    const t = getComputedStyle(el).transform
    if (t && t !== 'none') {
      try {
        const m = new DOMMatrixReadOnly(t)
        // positionEl uses translate(x,y) translate(-50%,-50%), so m.m41/m.m42 is
        // the translate-to-center offset; add half NODE dims to get the center.
        return { x: m.m41 + NODE.W / 2, y: m.m42 + NODE.H / 2 }
      } catch (e) { /* fall through */ }
    }
    return { x: 0, y: 0 }
  }

  // Attach drag-to-connect behaviour to a handle element `h` belonging to node `el`.
  function attachHandleDrag(h, el) {
    // Prevent sub-threshold taps from bubbling to the node's click→recenter.
    h.addEventListener('click', (e) => e.stopPropagation())

    let drag = null

    h.addEventListener('pointerdown', (e) => {
      e.stopPropagation() // unconditional — prevents panzoom drag starting
      h.setPointerCapture(e.pointerId)
      const center = liveCenterOf(el)
      const anchorWorld = gatePoint(center, DIR_SIDE[h._dir])
      drag = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        fromNode: el._name,
        dir: h._dir,
        anchorWorld,
        moved: false,
      }
    })

    h.addEventListener('pointermove', (e) => {
      if (!drag) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (!drag.moved && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return
      drag.moved = true
      // Re-read rect on every move (spec requirement).
      const rect = stage.getBoundingClientRect()
      const worldB = screenToWorld(panzoom.getTransform(), e.clientX - rect.left, e.clientY - rect.top)
      pending = { a: drag.anchorWorld, b: worldB, zone: drag.dir }
      scheduleDraw()
    })

    h.addEventListener('pointerup', (e) => {
      if (!drag) return
      const wasMoved = drag.moved
      const fromNode = drag.fromNode
      const dir = drag.dir
      drag = null
      pending = null
      scheduleDraw()

      if (!wasMoved) {
        // Sub-threshold tap → open centered create dialog for THIS node (not focus).
        if (onCreateAt) onCreateAt(fromNode, dir, null)
        return
      }

      // Resolve drop target via LIVE DOM (nodes may be mid-transition).
      const tgt = document.elementFromPoint(e.clientX, e.clientY)
      const nodeEl = tgt && tgt.closest('.plex-node')
      const toName = nodeEl && nodeEl._name
      if (toName && toName !== fromNode) {
        if (onLinkExisting) onLinkExisting(fromNode, toName, dir)
      } else {
        if (onCreateAt) onCreateAt(fromNode, dir, { x: e.clientX, y: e.clientY })
      }
    })

    h.addEventListener('pointercancel', () => {
      drag = null
      pending = null
      scheduleDraw()
    })
  }

  function makeNode() {
    const el = document.createElement('div')
    el.className = 'plex-node'
    const label = document.createElement('span')
    label.className = 'plex-node-label'
    el.appendChild(label)
    el._label = label
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      if (el._zone === 'focus') onOpenMain(el._name)
      else onNavigate(el._name)
    })
    el._handles = {}
    for (const [dir, side] of [['parent', 'top'], ['child', 'bottom'], ['jump', 'left']]) {
      const h = document.createElement('div')
      h.className = 'plex-handle handle-' + side + ' handle-empty'
      h._dir = dir
      el.appendChild(h)
      el._handles[dir] = h
      attachHandleDrag(h, el)
    }
    el._handleStates = { parent: 'empty', child: 'empty', jump: 'empty' }
    return el
  }

  function updateNode(el, node) {
    el._name = node.name
    el._zone = node.zone
    el._label.textContent = node.name
    el.title =
      node.zone === 'focus' ? `Open "${node.name}" in the main pane` : `Recenter on "${node.name}"`
    el.className = 'plex-node zone-' + node.zone
  }

  function positionEl(el, p) {
    el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`
  }

  function getRenderedNames() {
    return new Set(elements.keys())
  }

  function setHandles(adjacency, renderedNames) {
    for (const [key, el] of elements) {
      if (!el._handles) continue
      const states = nodeHandleStates(adjacency[key], renderedNames)
      if (el._handleStates && states.parent === el._handleStates.parent &&
          states.child === el._handleStates.child && states.jump === el._handleStates.jump) continue
      el._handleStates = states
      for (const dir of ['parent', 'child', 'jump']) {
        const h = el._handles[dir]
        h.classList.remove('handle-empty', 'handle-shown', 'handle-more')
        h.classList.add('handle-' + states[dir])
      }
    }
  }

  // Read each node's CURRENT (mid-transition) world position from its computed
  // transform, so edges follow nodes during the recenter glide instead of
  // snapping to the final layout.
  function liveLayout() {
    if (!layout) return null
    const nodes = layout.nodes.map((n) => {
      let x = n.x
      let y = n.y
      const el = elements.get(n.name.toLowerCase())
      if (el) {
        const t = getComputedStyle(el).transform
        if (t && t !== 'none') {
          try {
            const m = new DOMMatrixReadOnly(t)
            x = m.m41 + NODE.W / 2 // undo the translate(-50%,-50%) to get the center
            y = m.m42 + NODE.H / 2
          } catch (e) {
            /* keep layout coords */
          }
        }
      }
      return { name: n.name, zone: n.zone, x, y, via: n.via }
    })
    return { focus: layout.focus, nodes }
  }

  function draw() {
    lastEdges = computeEdges(liveLayout())
    drawEdges(ctx, lastEdges, panzoom.getTransform(), theme, dpr, pending)
  }
  function scheduleDraw() {
    if (!raf) raf = requestAnimationFrame(loop)
  }
  function loop() {
    raf = 0
    draw()
    if (performance.now() < animUntil) scheduleDraw()
  }
  function animateFor(ms) {
    animUntil = performance.now() + ms
    scheduleDraw()
  }

  resizeCanvas()

  // Floating remove/cancel controls for the connection under the cursor
  // (parent/child/jump edges only; siblings are computed). They live in the
  // stage, positioned in screen coords from the hovered edge's midpoint. The
  // first click on "×" arms a "Remove?" confirm and reveals a "Cancel" button
  // alongside it, so the user can dismiss without leaving the iframe.
  const removeActions = document.createElement('div')
  removeActions.className = 'plex-edge-actions'
  const removeBtn = document.createElement('button')
  removeBtn.className = 'plex-edge-remove'
  removeBtn.textContent = '×'
  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'plex-edge-cancel'
  cancelBtn.textContent = 'Cancel'
  removeActions.append(removeBtn, cancelBtn)
  removeActions.style.display = 'none'
  removeActions.addEventListener('pointerdown', (e) => e.stopPropagation()) // don't let a click start a stage pan
  stage.appendChild(removeActions)
  let hoveredEdge = null

  function hideRemove() {
    removeActions.style.display = 'none'
    removeActions.classList.remove('confirm')
    removeBtn.textContent = '×'
    hoveredEdge = null
  }

  stage.addEventListener('mousemove', (e) => {
    if (pending) { hideRemove(); return } // suppress while a handle drag is live
    if (removeActions.classList.contains('confirm')) return // frozen while confirming
    const rect = stage.getBoundingClientRect()
    const t = panzoom.getTransform()
    const worldPt = screenToWorld(t, e.clientX - rect.left, e.clientY - rect.top)
    const edge = hitTest(worldPt, lastEdges, 10)
    if (!edge) {
      if (hoveredEdge) hideRemove()
      return
    }
    hoveredEdge = edge
    const midWorld = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 }
    const midScreen = worldToScreen(t, midWorld.x, midWorld.y)
    removeActions.style.left = midScreen.x + 'px'
    removeActions.style.top = midScreen.y + 'px'
    removeActions.style.display = 'flex'
  })

  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (!hoveredEdge) return
    if (!removeActions.classList.contains('confirm')) {
      removeActions.classList.add('confirm') // first click: arm the confirm + reveal Cancel
      removeBtn.textContent = 'Remove?'
      return
    }
    const edge = hoveredEdge
    hideRemove()
    if (onRemoveLink) onRemoveLink(edge.neighbor, edge.role)
  })
  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    hideRemove()
  })
  stage.addEventListener('mouseleave', hideRemove)

  return {
    setGraph,
    setTheme,
    setHandles,
    getRenderedNames,
    redraw: scheduleDraw,
    getEdges: () => lastEdges,
    destroy() {
      ro.disconnect()
    },
  }
}

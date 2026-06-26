import { computeLayout, NODE } from './layout.js'
import { computeEdges, drawEdges, gatePoint, edgeKey } from './edges.js'
import { attachPanzoom, worldToScreen, screenToWorld } from './panzoom.js'
import { hitTest, pointOnEdge } from './edge-hit.js'
import { nodeHandleStates } from './handles.js'

const TRANSITION_MS = 840

// How far along an edge (focus → neighbor) the unlink control sits: biased toward
// the non-focus card so the controls of fanned-out edges don't pile up at center.
const UNLINK_T = 0.78

function defaultTheme() {
  return { edge: 'rgba(127,127,127,0.55)', jumpEdge: 'rgba(127,127,127,0.32)', highlight: 'rgba(240,190,30,0.95)' }
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
  let hoveredKey = null // identity of the edge under the cursor, for the hover highlight

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
    hideRemove() // drop any stale hover highlight / unlink control from the old graph
    const prevFocus = layout ? layout.focus : null
    layout = computeLayout(graph)
    const present = new Set()

    // Newly-appearing cards emerge FROM the activating card (the new focus) at
    // its current on-screen position, so new relations grow out of the card you
    // just clicked. Captured BEFORE the loop below moves it to the center.
    const activatingEl = elements.get(String(graph.focus).toLowerCase())
    const enterFrom = activatingEl ? liveCenterOf(activatingEl) : { x: 0, y: 0 }

    // Disappearing cards collapse INTO the OLD focus card at its NEW position —
    // it usually demotes to a parent/jump/sibling and slides there — so a
    // dropped relation fades into the card it belonged to, not the new center.
    // Falls back to the center if the old focus is gone too.
    let exitInto = { x: 0, y: 0 }
    if (prevFocus) {
      const moved = layout.nodes.find((n) => n.name.toLowerCase() === prevFocus.toLowerCase())
      if (moved) exitInto = { x: moved.x, y: moved.y }
    }

    for (const node of layout.nodes) {
      const key = node.name.toLowerCase()
      present.add(key)
      let el = elements.get(key)
      if (el) {
        // Reused card: glide directly from its current spot to the new one.
        updateNode(el, node)
        positionEl(el, node)
        continue
      }
      // New card: fade in while moving out from the activating card's position.
      el = makeNode()
      world.appendChild(el)
      elements.set(key, el)
      updateNode(el, node)
      el.classList.add('appearing') // opacity:0 until faded in below
      positionEl(el, enterFrom)
      void el.offsetWidth // force reflow so the move + fade below transition
      el.classList.remove('appearing')
      positionEl(el, node)
    }

    // Dropped cards: fade out while collapsing into the old focus's new spot.
    for (const [key, el] of elements) {
      if (present.has(key)) continue
      const dead = el
      dead.classList.add('leaving') // opacity:0
      positionEl(dead, exitInto)
      setTimeout(() => dead.remove(), TRANSITION_MS)
      elements.delete(key)
    }

    panzoom.fit(layout.bbox, viewport())
    applyTransform(panzoom.getTransform())
    animateFor(TRANSITION_MS + 40)
  }

  // Map each handle direction to the gate side on the node. Jump-position cards
  // sit to the LEFT of the focus, so their jump edge meets their RIGHT side —
  // put the jump handle there too so it visually connects to its link.
  const DIR_SIDE = { parent: 'top', child: 'bottom', jump: 'left' }
  const jumpSide = (zone) => (zone === 'jump' ? 'right' : 'left')

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
      const anchorWorld = gatePoint(center, h._side || DIR_SIDE[h._dir])
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
      h._side = side // current gate side; the jump handle flips per zone (updateNode)
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
    // Keep the jump handle on the side its link actually meets (right for cards
    // shown at jump position, left otherwise).
    const jh = el._handles && el._handles.jump
    const side = jumpSide(node.zone)
    if (jh && jh._side !== side) {
      jh.classList.remove('handle-' + jh._side)
      jh.classList.add('handle-' + side)
      jh._side = side
    }
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
    drawEdges(ctx, lastEdges, panzoom.getTransform(), theme, dpr, pending, hoveredKey)
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
    if (hoveredKey) { hoveredKey = null; scheduleDraw() } // clear the hover highlight
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
    const key = edgeKey(edge)
    if (key !== hoveredKey) { hoveredKey = key; scheduleDraw() } // highlight the hovered link
    // Anchor the control toward the non-focus card (UNLINK_T along the curve).
    const at = pointOnEdge(edge, UNLINK_T)
    const atScreen = worldToScreen(t, at.x, at.y)
    removeActions.style.left = atScreen.x + 'px'
    removeActions.style.top = atScreen.y + 'px'
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
    if (onRemoveLink && edge.remove) onRemoveLink(edge.remove)
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

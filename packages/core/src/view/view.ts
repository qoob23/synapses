import { computeLayout, NODE } from './layout'
import { computeEdges, computeSecondaryEdges, drawEdges, gatePoint, edgeKey } from './edges'
import type { Edge, EdgeRemove } from './edges'
import type { Adjacency } from '../types'
import { attachPanzoom, worldToScreen, screenToWorld } from './panzoom'
import { hitTest, pointAtDistanceFromEnd } from './edge-hit'
import { nodeHandleStates } from './handles'
import type { Graph } from '../types'

const TRANSITION_MS = 840

// Gap (screen px) between the non-active card's gate and the unlink control,
// measured along the connector — keeps the × near that card and on the link,
// not in the gap between cards and not over a card.
const UNLINK_GAP = 52

function defaultTheme() {
  // `highlight` = the hovered-connector accent; a muted gold (not a glaring yellow).
  return { edge: 'rgba(127,127,127,0.55)', jumpEdge: 'rgba(127,127,127,0.32)', highlight: 'rgba(206,170,92,0.9)' }
}

// A card <div> with the ad-hoc bookkeeping props the view attaches at runtime.
interface CardEl extends HTMLDivElement {
  _name: string
  _zone: string
  _label: HTMLElement
  _handles: Record<string, HandleEl>
  _handleStates: Record<string, string>
  _clamped: boolean // label is truncated (full title shown via the hover tooltip)
}
interface HandleEl extends HTMLDivElement {
  _dir: string
  _side: string
}

type Pt = { x: number; y: number }

// Renders the synapses: HTML <div> cards in a transformed world + a <canvas> connector
// layer. Card elements are keyed by name and reused across graphs so positions
// animate (the clicked card glides to the center on recenter).
const DRAG_THRESHOLD = 6

export function createView({
  root,
  world,
  canvas,
  stage,
  onNavigate,
  onOpenMain,
  onRemoveLink,
  onLinkExisting,
  onCreateAt,
  initialSize,
  onSizeChange,
}: {
  root: HTMLElement
  world: HTMLElement
  canvas: HTMLCanvasElement
  stage: HTMLElement
  onNavigate: (name: string) => void
  onOpenMain: (name: string) => void
  onRemoveLink?: (remove: EdgeRemove) => void
  onLinkExisting?: (from: string, to: string, role: string) => void
  onCreateAt?: (fromNode: string, dir: string, at: Pt | null) => void
  initialSize?: number | null
  onSizeChange?: (level: number) => void
}) {
  const ctx = canvas.getContext('2d')!

  // Discrete size level (replaces zoom): scales card + text together via CSS vars, and
  // feeds the live card height into the layout. The spacing then re-fills the panel
  // around the new card size (see relayout). Persisted via onSizeChange.
  const SIZE_FACTORS = [0.8, 0.9, 1.0, 1.15, 1.3]
  const BASE_FONT_PX = 16 // matches styles.css --synapses-node-font fallback (px everywhere)
  const BASE_MAXW = 480 // matches styles.css --synapses-node-maxw fallback
  const clampLevel = (l: number) => Math.max(0, Math.min(SIZE_FACTORS.length - 1, Math.round(l)))
  let sizeLevel = initialSize == null ? SIZE_FACTORS.indexOf(1.0) : clampLevel(initialSize)
  const sizeFactor = () => SIZE_FACTORS[sizeLevel]
  const cardHpx = () => Math.round(NODE.H * sizeFactor())
  // Card WIDTH is content-sized (fit-content) up to a level-scaled cap; past it the
  // label clamps and gets a tooltip. HEIGHT/FONT/CAP all scale with the size level.
  function applySizeVars() {
    const f = sizeFactor()
    root.style.setProperty('--synapses-node-h', cardHpx() + 'px')
    root.style.setProperty('--synapses-node-font', Math.round(BASE_FONT_PX * f) + 'px')
    root.style.setProperty('--synapses-node-maxw', Math.round(BASE_MAXW * f) + 'px')
  }
  applySizeVars()

  const elements = new Map<string, CardEl>() // nameLower -> element
  let lastGraph: Graph | null = null // retained so relayout() can recompute on resize / size step
  let layout: any = null
  let theme: { edge: string; jumpEdge: string; highlight: string } = defaultTheme()
  let dpr = window.devicePixelRatio || 1
  let raf = 0
  let animUntil = 0
  let lastEdges: Edge[] = []
  let adjacency: Adjacency = {} // full per-card links, for connectors between non-active cards
  let pending: { a: Pt; b: Pt; zone: string } | null = null
  let hoveredKey: string | null = null // identity of the edge under the cursor, for the hover highlight

  const panzoom = attachPanzoom(stage, (t) => {
    applyTransform(t)
    scheduleDraw()
  })

  function applyTransform(t: { s: number; tx: number; ty: number }) {
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
    // Re-distribute spacing to the new panel size (zoom is gone — only the gaps change).
    // Snap (no glide) so cards don't chase a continuous drag-resize.
    if (lastGraph) relayout(false)
    else scheduleDraw()
  }
  const ro = new ResizeObserver(resizeCanvas)
  ro.observe(stage)

  function setTheme(t: any) {
    theme = { ...defaultTheme(), ...(t || {}) }
    scheduleDraw()
  }

  // Read each present card's rendered width (cards live in the scaled world, so
  // offsetWidth is already in world units) and whether its label is clamped (full
  // title then shown via the hover tooltip). Returns a name→width map for the layout.
  function measureWidths(): Record<string, number> {
    const widths: Record<string, number> = {}
    for (const [key, el] of elements) {
      widths[key] = el.offsetWidth || NODE.W
      el._clamped = el._label.scrollWidth > el._label.clientWidth + 1
      el.title = el._clamped ? '' : hintFor(el) // clamped → rely on the custom tooltip
    }
    return widths
  }

  function setGraph(graph: Graph) {
    hideRemove() // drop any stale hover highlight / unlink control from the old graph
    hideTooltip()
    lastGraph = graph
    const prevFocus = layout ? layout.focus : null

    // Identity pass: dedup + zones come from a width-agnostic layout. We need the
    // elements present (with their text set) before we can measure widths, so create
    // /update them first, then lay out for real against the measured widths.
    const ids = computeLayout(graph)
    const present = new Set<string>()
    const created = new Set<string>()
    for (const node of ids.nodes) {
      const key = node.name.toLowerCase()
      present.add(key)
      let el = elements.get(key)
      if (!el) {
        el = makeNode()
        world.appendChild(el)
        elements.set(key, el)
        created.add(key)
      }
      updateNode(el, node) // sets the label text (required before measuring)
    }
    layout = computeLayout(graph, measureWidths(), { viewport: viewport(), cardH: cardHpx() })

    // Newly-appearing cards emerge FROM the activating card (the new active thought) at
    // its current on-screen position, so new links grow out of the card you just
    // clicked. Captured BEFORE the loop below moves anything to the center.
    const activatingEl = elements.get(String(graph.focus).toLowerCase())
    const enterFrom = activatingEl ? liveCenterOf(activatingEl) : { x: 0, y: 0 }

    // Disappearing cards collapse INTO the OLD active thought's card at its NEW position —
    // it usually demotes to a parent/jump/sibling and slides there — so a
    // dropped card fades into the card it belonged to, not the new center.
    // Falls back to the center if the old active thought is gone too.
    let exitInto: Pt = { x: 0, y: 0 }
    if (prevFocus) {
      const moved = layout.nodes.find((n: any) => n.name.toLowerCase() === prevFocus.toLowerCase())
      if (moved) exitInto = { x: moved.x, y: moved.y }
    }

    for (const node of layout.nodes) {
      const key = node.name.toLowerCase()
      const el = elements.get(key)!
      if (!created.has(key)) {
        // Reused card: glide directly from its current spot to the new one.
        positionEl(el, node)
        continue
      }
      // New card: fade in while moving out from the activating card's position.
      el.classList.add('appearing') // opacity:0 until faded in below
      positionEl(el, enterFrom)
      void el.offsetWidth // force reflow so the move + fade below transition
      el.classList.remove('appearing')
      positionEl(el, node)
    }

    // Dropped cards: fade out while collapsing into the old active thought's new spot.
    for (const [key, el] of elements) {
      if (present.has(key)) continue
      const dead = el
      dead.classList.add('leaving') // opacity:0
      positionEl(dead, exitInto)
      setTimeout(() => dead.remove(), TRANSITION_MS)
      elements.delete(key)
    }

    panzoom.center(viewport())
    applyTransform(panzoom.getTransform())
    animateFor(TRANSITION_MS + 40)
  }

  // Recompute the layout for the SAME graph against the current panel size + size level
  // and reposition the present cards. Used on panel resize (animate=false → snap) and on
  // a size step (animate=true → grow/shrink glide). No enter/exit: the card set is
  // unchanged, only spacing/size moves.
  function relayout(animate: boolean) {
    if (!lastGraph) return
    applySizeVars()
    layout = computeLayout(lastGraph, measureWidths(), { viewport: viewport(), cardH: cardHpx() })
    if (!animate) world.classList.add('synapses-static') // suppress the CSS transition
    for (const node of layout.nodes) {
      const el = elements.get(node.name.toLowerCase())
      if (el) positionEl(el, node)
    }
    panzoom.center(viewport())
    applyTransform(panzoom.getTransform())
    if (!animate) {
      void world.offsetWidth // commit the transition-less move before re-enabling glides
      world.classList.remove('synapses-static')
    }
    if (animate) animateFor(TRANSITION_MS + 40)
    else scheduleDraw()
  }

  // Step the card/text size up (+1) or down (−1). Re-fills spacing around the new size
  // and persists the level (onSizeChange). Clamped to the available levels.
  function stepSize(delta: number) {
    const next = clampLevel(sizeLevel + delta)
    if (next === sizeLevel) return
    sizeLevel = next
    relayout(true)
    onSizeChange?.(sizeLevel)
  }

  // Map each handle direction to the gate side on the card. Jump-position cards
  // sit to the LEFT of the active thought, so their jump connector meets their RIGHT side —
  // put the jump handle there too so it visually connects to its link.
  const DIR_SIDE: Record<string, string> = { parent: 'top', child: 'bottom', jump: 'left' }
  const jumpSide = (zone: string) => (zone === 'jump' ? 'right' : 'left')

  // Get the current world-center (+ width) of a card element from its live CSS
  // transform. Width comes from offsetWidth since cards are content-sized.
  function liveCenterOf(el: any): Pt & { w: number } {
    const w = el.offsetWidth || NODE.W
    const h = el.offsetHeight || cardHpx() // height scales with the size level
    const t = getComputedStyle(el).transform
    if (t && t !== 'none') {
      try {
        const m = new DOMMatrixReadOnly(t)
        // positionEl uses translate(x,y) translate(-50%,-50%), so m.m41/m.m42 is
        // the translate-to-center offset; add half the box dims to get the center.
        return { x: m.m41 + w / 2, y: m.m42 + h / 2, w }
      } catch (e) { /* fall through */ }
    }
    return { x: 0, y: 0, w }
  }

  // Attach drag-to-connect behaviour to a handle element `h` belonging to card `el`.
  function attachHandleDrag(h: HandleEl, el: CardEl) {
    // Prevent sub-threshold taps from bubbling to the card's click→activate.
    h.addEventListener('click', (e) => e.stopPropagation())

    let drag: any = null

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
        // Sub-threshold tap → open centered create dialog for THIS card (not the active thought).
        if (onCreateAt) onCreateAt(fromNode, dir, null)
        return
      }

      // Resolve drop target via LIVE DOM (cards may be mid-transition).
      const tgt = document.elementFromPoint(e.clientX, e.clientY)
      const nodeEl = (tgt && tgt.closest('.synapses-node')) as CardEl | null
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

  // Full-title tooltip for clamped cards. Lives in screen space (appended to root,
  // not the zoomed world) so it stays crisp; shown after a hover delay, hidden on
  // leave / pan / zoom / navigation.
  const TOOLTIP_DELAY_MS = 500
  const tooltip = document.createElement('div')
  tooltip.className = 'synapses-tooltip'
  root.appendChild(tooltip)
  let tooltipTimer: ReturnType<typeof setTimeout> | undefined
  function hideTooltip() {
    if (tooltipTimer) { clearTimeout(tooltipTimer); tooltipTimer = undefined }
    tooltip.classList.remove('shown')
  }
  function showTooltipFor(el: CardEl) {
    tooltip.textContent = el._name
    tooltip.classList.add('shown') // make it laid out so offsetHeight is real
    const rootRect = root.getBoundingClientRect()
    const cardRect = el.getBoundingClientRect()
    const cx = cardRect.left - rootRect.left + cardRect.width / 2
    let top = cardRect.top - rootRect.top - tooltip.offsetHeight - 8
    if (top < 4) top = cardRect.bottom - rootRect.top + 8 // flip below if no room above
    tooltip.style.left = Math.round(cx) + 'px'
    tooltip.style.top = Math.round(top) + 'px'
  }
  function scheduleTooltip(el: CardEl) {
    if (tooltipTimer) clearTimeout(tooltipTimer)
    tooltipTimer = setTimeout(() => showTooltipFor(el), TOOLTIP_DELAY_MS)
  }

  function makeNode(): CardEl {
    const el = document.createElement('div') as CardEl
    el.className = 'synapses-node'
    const label = document.createElement('span')
    label.className = 'synapses-node-label'
    el.appendChild(label)
    el._label = label
    el._clamped = false
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      if (el._zone === 'focus') onOpenMain(el._name)
      else onNavigate(el._name)
    })
    el.addEventListener('pointerenter', () => { if (el._clamped) scheduleTooltip(el) })
    el.addEventListener('pointerleave', hideTooltip)
    el._handles = {}
    for (const [dir, side] of [['parent', 'top'], ['child', 'bottom'], ['jump', 'left']]) {
      const h = document.createElement('div') as HandleEl
      h.className = 'synapses-handle handle-' + side + ' handle-empty'
      h._dir = dir
      h._side = side // current gate side; the jump handle flips per zone (updateNode)
      el.appendChild(h)
      el._handles[dir] = h
      attachHandleDrag(h, el)
    }
    el._handleStates = { parent: 'empty', child: 'empty', jump: 'empty' }
    return el
  }

  // Native action-hint tooltip text. Suppressed on clamped cards (measureWidths)
  // so it doesn't compete with the custom full-title tooltip.
  function hintFor(el: CardEl): string {
    return el._zone === 'focus' ? `Open "${el._name}" in the main pane` : `Recenter on "${el._name}"`
  }

  function updateNode(el: CardEl, node: any) {
    el._name = node.name
    el._zone = node.zone
    el._label.textContent = node.name
    el.title = hintFor(el)
    el.className = 'synapses-node zone-' + node.zone
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

  function positionEl(el: CardEl, p: Pt) {
    el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`
  }

  function getRenderedNames() {
    return new Set(elements.keys())
  }

  function setHandles(adj: Adjacency, renderedNames: Set<string>) {
    // Retain the full adjacency so draw() can add connectors between non-active
    // cards; it arrives async (after setGraph), so redraw once it lands.
    adjacency = adj || {}
    scheduleDraw()
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

  // Read each card's CURRENT (mid-transition) world position from its computed
  // transform, so connectors follow cards during the recenter glide instead of
  // snapping to the final layout.
  function liveLayout() {
    if (!layout) return null
    const nodes = layout.nodes.map((n: any) => {
      let x = n.x
      let y = n.y
      let w = n.w
      let h = cardHpx() // height scales with the size level; connectors meet the actual edge
      const el = elements.get(n.name.toLowerCase())
      if (el) {
        w = el.offsetWidth || n.w // content-sized; connectors meet the actual edge
        h = el.offsetHeight || h
        const t = getComputedStyle(el).transform
        if (t && t !== 'none') {
          try {
            const m = new DOMMatrixReadOnly(t)
            x = m.m41 + w / 2 // undo the translate(-50%,-50%) to get the center
            y = m.m42 + h / 2
          } catch (e) {
            /* keep layout coords */
          }
        }
      }
      return { name: n.name, zone: n.zone, x, y, w, h, via: n.via }
    })
    return { focus: layout.focus, nodes }
  }

  function draw() {
    const live = liveLayout()
    lastEdges = computeEdges(live)
    // Connectors between visible cards that don't touch the active thought — drawn
    // faded and display-only (NOT added to lastEdges, so hover/unlink ignore them).
    const secondary = computeSecondaryEdges(live, adjacency, lastEdges)
    drawEdges(ctx, lastEdges, panzoom.getTransform(), theme, dpr, pending, hoveredKey, secondary)
  }
  function scheduleDraw() {
    if (!raf) raf = requestAnimationFrame(loop)
  }
  function loop() {
    raf = 0
    draw()
    if (performance.now() < animUntil) scheduleDraw()
  }
  function animateFor(ms: number) {
    animUntil = performance.now() + ms
    scheduleDraw()
  }

  resizeCanvas()

  // Floating remove/cancel controls for the connector under the cursor
  // (parent/child/jump edges only; siblings are computed). They live in the
  // stage, positioned in screen coords from the hovered edge's midpoint. The
  // first click on "×" arms a "Remove?" confirm and reveals a "Cancel" button
  // alongside it, so the user can dismiss without leaving the iframe.
  const removeActions = document.createElement('div')
  removeActions.className = 'synapses-edge-actions'
  const removeBtn = document.createElement('button')
  removeBtn.className = 'synapses-edge-remove'
  removeBtn.textContent = '×'
  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'synapses-edge-cancel'
  cancelBtn.textContent = 'Cancel'
  removeActions.append(removeBtn, cancelBtn)
  removeActions.style.display = 'none'
  removeActions.addEventListener('pointerdown', (e) => e.stopPropagation()) // don't let a click start a stage pan
  stage.appendChild(removeActions)
  let hoveredEdge: Edge | null = null

  function hideRemove() {
    removeActions.style.display = 'none'
    removeActions.classList.remove('confirm')
    removeBtn.textContent = '×'
    hoveredEdge = null
    if (hoveredKey) { hoveredKey = null; scheduleDraw() } // clear the hover highlight
  }

  const onStageMove = (e: MouseEvent) => {
    if (pending) { hideRemove(); return } // suppress while a handle drag is live
    if (removeActions.classList.contains('confirm')) return // frozen while confirming
    // Don't hit-test connectors while the cursor is over a card — a card sits on
    // top of its own connectors' endpoints, so hovering it would otherwise light
    // up (and arm removal of) a link the user isn't aiming at.
    const tgt: any = e.target
    if (tgt && tgt.closest && tgt.closest('.synapses-node')) {
      if (hoveredEdge) hideRemove()
      return
    }
    const rect = stage.getBoundingClientRect()
    const t = panzoom.getTransform()
    const worldPt = screenToWorld(t, e.clientX - rect.left, e.clientY - rect.top)
    const edge = hitTest(worldPt, lastEdges, 10) as Edge | null
    if (!edge) {
      if (hoveredEdge) hideRemove()
      return
    }
    hoveredEdge = edge
    const key = edgeKey(edge)
    if (key !== hoveredKey) { hoveredKey = key; scheduleDraw() } // highlight the hovered link
    // Anchor the control a fixed gap back from the non-active card, along the
    // connector (UNLINK_GAP is screen px → divide by zoom for world units).
    const at = pointAtDistanceFromEnd(edge, UNLINK_GAP / t.s)
    const atScreen = worldToScreen(t, at.x, at.y)
    removeActions.style.left = atScreen.x + 'px'
    removeActions.style.top = atScreen.y + 'px'
    removeActions.style.display = 'flex'
  }
  stage.addEventListener('mousemove', onStageMove)

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

  // A pan (pointerdown) or zoom (wheel) moves cards under the cursor → drop the tooltip.
  const onStageTooltipHide = () => hideTooltip()
  stage.addEventListener('pointerdown', onStageTooltipHide)
  stage.addEventListener('wheel', onStageTooltipHide, { passive: true })

  // Current size level + how many there are, so the toolbar can disable −/+ at the ends.
  function sizeInfo() {
    return { level: sizeLevel, count: SIZE_FACTORS.length }
  }

  return {
    setGraph,
    setTheme,
    setHandles,
    getRenderedNames,
    redraw: scheduleDraw,
    stepSize,
    sizeInfo,
    getEdges: () => lastEdges,
    destroy() {
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
      hideTooltip()
      stage.removeEventListener('mousemove', onStageMove)
      stage.removeEventListener('mouseleave', hideRemove)
      stage.removeEventListener('pointerdown', onStageTooltipHide)
      stage.removeEventListener('wheel', onStageTooltipHide)
    },
  }
}

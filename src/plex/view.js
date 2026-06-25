import { computeLayout, NODE } from './layout.js'
import { computeEdges, drawEdges } from './edges.js'
import { attachPanzoom } from './panzoom.js'

const TRANSITION_MS = 320

function defaultTheme() {
  return { edge: 'rgba(127,127,127,0.55)', jumpEdge: 'rgba(127,127,127,0.32)' }
}

// Renders the plex: HTML <div> nodes in a transformed world + a <canvas> edge
// layer. Node elements are keyed by name and reused across graphs so positions
// animate (the clicked neighbor glides to the center on recenter).
export function createView({ world, canvas, stage, onNavigate, onOpenMain, onCreate }) {
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
    return el
  }

  function updateNode(el, node) {
    el._name = node.name
    el._zone = node.zone
    el._label.textContent = node.name
    el.title =
      node.zone === 'focus' ? `Open "${node.name}" in the main pane` : `Recenter on "${node.name}"`
    el.className = 'plex-node zone-' + node.zone + (el.classList.contains('has-more') ? ' has-more' : '')
    el.querySelectorAll('.plex-gate').forEach((g) => g.remove())
    if (node.zone === 'focus') addFocusGates(el)
  }

  function addFocusGates(el) {
    const gates = [
      ['top', 'parent'],
      ['bottom', 'child'],
      ['left', 'jump'],
    ]
    for (const [side, role] of gates) {
      const g = document.createElement('div')
      g.className = 'plex-gate gate-' + side
      g.title = 'Add ' + role
      g.addEventListener('click', (e) => {
        e.stopPropagation()
        onCreate(role)
      })
      el.appendChild(g)
    }
  }

  function positionEl(el, p) {
    el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`
  }

  function markMore(moreMap) {
    for (const el of elements.values()) {
      if (el._zone === 'focus') continue
      el.classList.toggle('has-more', !!(moreMap && moreMap[el._name]))
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

  return {
    setGraph,
    setTheme,
    markMore,
    redraw: scheduleDraw,
    getEdges: () => lastEdges,
    destroy() {
      ro.disconnect()
    },
  }
}

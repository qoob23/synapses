import { createClient } from '../shared/rpc.js'
import { createView } from './view.js'
import { openCreateDialog } from './dialog.js'
import { applyTheme } from './theme.js'
import './styles.css'

const els = {
  toolbar: document.getElementById('plex-toolbar'),
  stage: document.getElementById('plex-stage'),
  world: document.getElementById('plex-world'),
  canvas: document.getElementById('plex-canvas'),
  flash: document.getElementById('plex-flash'),
  breadcrumb: document.getElementById('plex-breadcrumb'),
  dialogRoot: document.getElementById('plex-dialog-root'),
}

// History is owned by the main context (durable). We keep the last snapshot here
// only to render the toolbar/breadcrumb.
let lastHist = { list: [], index: -1 }
let focus = null
let navToken = 0
let lastRenderKey = null

// Identity of a rendered graph — used to skip redundant re-renders (the reconcile
// after a write usually produces the same graph, which would otherwise flicker).
function graphKey(g) {
  const s = (a) => (a || []).map((x) => x.toLowerCase()).sort().join(',')
  return [g.focus.toLowerCase(), s(g.parents), s(g.children), s(g.jumps), s(g.siblings)].join('|')
}

const client = createClient({
  onConnect: async () => {
    await loadTheme()
    await restore()
  },
  onEvent: (method, payload) => {
    if (method === 'recenter' && payload && payload.page) {
      // ignore the route-change echo of a navigation we initiated ourselves
      if (!focus || payload.page.toLowerCase() !== focus.toLowerCase()) {
        goto(payload.page, { fromLogseq: true })
      }
    } else if (method === 'theme') {
      view.setTheme(applyTheme(payload))
    } else if (method === 'refresh') {
      if (focus) goto(focus, { noHistory: true, fromLogseq: true, ifChanged: true })
    }
  },
})

const view = createView({
  world: els.world,
  canvas: els.canvas,
  stage: els.stage,
  onNavigate: (name) => goto(name),
  onOpenMain: (name) => client.call('navigate', name).catch(() => {}),
  onCreate: (role) => create(role),
  onRemoveLink: (neighbor, role) =>
    client
      .call('removeLink', focus, neighbor, role)
      .then(() => goto(focus, { noHistory: true }))
      .catch(() => {}),
})

// Restore the previous focus + history (e.g. after the iframe was re-injected),
// otherwise fall back to the currently open Logseq page.
async function restore() {
  try {
    const st = await client.call('histState')
    if (st && st.list && st.list.length) {
      lastHist = st
      goto(st.list[st.index], { noHistory: true, fromLogseq: true })
      return
    }
  } catch (e) {
    /* ignore */
  }
  try {
    const active = await client.call('getActivePage')
    if (active) goto(active, { fromLogseq: true })
    else flash('Open a page in Logseq to see its plex.')
  } catch (e) {
    flash('⚠ ' + ((e && e.message) || e))
  }
}

async function goto(name, opts = {}) {
  if (!name) return
  const mine = ++navToken
  focus = name

  try {
    lastHist = opts.noHistory ? await client.call('histState') : await client.call('histPush', name)
  } catch (e) {
    /* keep previous history snapshot */
  }
  renderToolbar()
  renderBreadcrumb()

  let graph
  try {
    graph = await client.call('buildGraph', name)
  } catch (e) {
    flash('⚠ ' + ((e && e.message) || e))
    return
  }
  if (mine !== navToken) return // superseded by a newer navigation

  hideFlash()
  // Skip the re-render if nothing visually changed (avoids reconcile flicker).
  const key = graphKey(graph)
  if (!(opts.ifChanged && key === lastRenderKey)) {
    view.setGraph(graph)
    lastRenderKey = key
  }

  const names = [...graph.parents, ...graph.children, ...graph.jumps, ...graph.siblings]
  client
    .call('nodeDegrees', names)
    .then((m) => {
      if (mine === navToken) view.markMore(m || {})
    })
    .catch(() => {})

  // Mirror focus into the main pane unless this navigation came FROM Logseq.
  if (!opts.fromLogseq) client.call('navigate', name).catch(() => {})
}

async function jumpToIndex(i) {
  try {
    const st = await client.call('histJump', i)
    if (st && st.name) {
      lastHist = { list: st.list, index: st.index }
      goto(st.name, { noHistory: true })
    }
  } catch (e) {
    /* ignore */
  }
}

async function create(role) {
  if (!focus) return
  const changed = await openCreateDialog({ root: els.dialogRoot, role, focus, client })
  if (changed) goto(focus, { noHistory: true })
}

function renderToolbar() {
  els.toolbar.innerHTML = ''
  const back = btn('◀', 'Back', () => jumpToIndex(lastHist.index - 1))
  back.disabled = lastHist.index <= 0
  const fwd = btn('▶', 'Forward', () => jumpToIndex(lastHist.index + 1))
  fwd.disabled = lastHist.index >= lastHist.list.length - 1

  const title = document.createElement('div')
  title.className = 'plex-title'
  title.textContent = focus || ''
  title.title = focus || ''

  const add = document.createElement('div')
  add.className = 'plex-add-group'
  add.append(
    btn('＋child', 'Add child', () => create('child')),
    btn('＋parent', 'Add parent', () => create('parent')),
    btn('＋jump', 'Add jump', () => create('jump')),
  )

  const open = btn('↗', 'Open this note in the main pane', () => {
    if (focus) client.call('navigate', focus).catch(() => {})
  })

  els.toolbar.append(back, fwd, title, add, open)
}

function renderBreadcrumb() {
  els.breadcrumb.innerHTML = ''
  lastHist.list.forEach((name, i) => {
    const c = document.createElement('button')
    c.className = 'plex-crumb' + (i === lastHist.index ? ' current' : '')
    c.textContent = name
    c.title = name
    c.addEventListener('click', () => jumpToIndex(i))
    els.breadcrumb.appendChild(c)
  })
  els.breadcrumb.scrollLeft = els.breadcrumb.scrollWidth
}

async function loadTheme() {
  try {
    const p = await client.call('getTheme')
    view.setTheme(applyTheme(p))
  } catch (e) {
    /* keep defaults */
  }
}

function btn(label, title, onClick) {
  const b = document.createElement('button')
  b.className = 'plex-btn'
  b.textContent = label
  b.title = title
  b.addEventListener('click', onClick)
  return b
}

function flash(msg) {
  els.flash.textContent = msg
  els.flash.style.display = 'flex'
}
function hideFlash() {
  els.flash.style.display = 'none'
}

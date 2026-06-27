import { createView } from './view/view'
import { openCreateDialog } from './view/dialog'
import { openContextMenu } from './view/context-menu'
import { applyTheme } from './view/theme'
import type { SynapsesBackend, Graph, HistoryState, Role } from './types'

interface GotoOpts {
  noHistory?: boolean
  fromLogseq?: boolean
  ifChanged?: boolean
}

// Mount the synapses UI inside `container`, wired to an already-connected
// `backend`. Builds the DOM subtree that the old `synapses.html` provided,
// stamps `.synapses-root` on the container, runs an initial restore, and returns
// a teardown that unsubscribes from backend events and clears the container.
export function mountSynapses(container: HTMLElement, backend: SynapsesBackend): () => void {
  container.classList.add('synapses-root')
  container.innerHTML = `
    <div id="synapses-app">
      <div id="synapses-toolbar"></div>
      <div id="synapses-stage">
        <canvas id="synapses-canvas"></canvas>
        <div id="synapses-world"></div>
        <div id="synapses-flash" class="synapses-flash"></div>
      </div>
      <div id="synapses-breadcrumb"></div>
    </div>
    <div id="synapses-dialog-root"></div>`

  const els = {
    toolbar: container.querySelector('#synapses-toolbar') as HTMLElement,
    stage: container.querySelector('#synapses-stage') as HTMLElement,
    world: container.querySelector('#synapses-world') as HTMLElement,
    canvas: container.querySelector('#synapses-canvas') as HTMLCanvasElement,
    flash: container.querySelector('#synapses-flash') as HTMLElement,
    breadcrumb: container.querySelector('#synapses-breadcrumb') as HTMLElement,
    dialogRoot: container.querySelector('#synapses-dialog-root') as HTMLElement,
  }

  // History is owned by the main context (durable). We keep the last snapshot here
  // only to render the toolbar/breadcrumb.
  let lastHist: HistoryState = { list: [], index: -1 }

  const same = (a?: string | null, b?: string | null) =>
    !!a && !!b && a.toLowerCase() === b.toLowerCase()
  let focus: string | null = null
  let navToken = 0
  let lastRenderKey: string | null = null

  // Identity of a rendered graph — used to skip redundant re-renders (the reconcile
  // after a write usually produces the same graph, which would otherwise flicker).
  function graphKey(g: Graph): string {
    const s = (a: string[]) => (a || []).map((x) => x.toLowerCase()).sort().join(',')
    return [g.focus.toLowerCase(), s(g.parents), s(g.children), s(g.jumps), s(g.siblings)].join('|')
  }

  // The view is built in boot() below, AFTER the remembered size level is loaded, so
  // cards render at the user's chosen size from the first frame. `view!` is assigned
  // before any function that touches it runs (they all run after boot()).
  let view!: ReturnType<typeof createView>

  // Restore the previous active thought + history (e.g. after the view was re-mounted),
  // otherwise fall back to the currently open page in the editor.
  async function restore() {
    try {
      let st = await backend.histState()
      if (st && st.list && st.list.length) {
        try {
          st = (await backend.histRemoveMissing(st.list)).state
        } catch (e) {
          /* keep the unswept state if the existence check fails */
        }
        if (st.list.length) {
          lastHist = st
          goto(st.list[st.index], { noHistory: true, fromLogseq: true })
          return
        }
      }
    } catch (e) {
      /* ignore */
    }
    try {
      const active = await backend.getActivePage()
      if (active) goto(active, { fromLogseq: true })
      else flash('Open a page in Logseq to see its synapses.')
    } catch (e: any) {
      flash('⚠ ' + ((e && e.message) || e))
    }
  }

  async function goto(name: string | null | undefined, opts: GotoOpts = {}) {
    if (!name) return
    const mine = ++navToken
    focus = name

    try {
      lastHist = opts.noHistory ? await backend.histState() : await backend.histPush(name)
    } catch (e) {
      /* keep previous history snapshot */
    }
    renderToolbar()
    renderBreadcrumb()

    let graph: Graph
    try {
      graph = await backend.buildGraph(name)
    } catch (e: any) {
      flash('⚠ ' + ((e && e.message) || e))
      return
    }
    if (mine !== navToken) return // superseded by a newer navigation

    // An activated thought that renders unlinked may be a file that was deleted on disk.
    // Only emptiness + a failed existence check prunes — a genuinely-unlinked existing note stays.
    const unlinked = !(
      graph.parents.length || graph.children.length || graph.jumps.length || graph.siblings.length
    )
    if (unlinked) {
      try {
        const { removed } = await backend.histRemoveMissing([name])
        if (mine !== navToken) return
        if (removed.length) {
          lastHist = await backend.histState()
          renderToolbar()
          renderBreadcrumb()
          const active = await backend.getActivePage()
          if (active && !same(active, name)) {
            goto(active, { fromLogseq: true })
            return
          }
          flash('This note no longer exists.')
          return
        }
      } catch (e) {
        /* fall through and render the empty graph */
      }
    }

    hideFlash()
    // Skip the re-render if nothing visually changed (avoids reconcile flicker).
    const key = graphKey(graph)
    if (!(opts.ifChanged && key === lastRenderKey)) {
      view.setGraph(graph)
      lastRenderKey = key
    }

    const names = view.getRenderedNames()
    backend
      .nodeAdjacency([...names])
      .then((adj) => { if (mine === navToken) view.setHandles(adj || {}, names) })
      .catch(() => {})

    // Mirror the active thought into the main pane unless this navigation came FROM the editor.
    if (!opts.fromLogseq) backend.navigate(name).catch(() => {})
  }

  async function jumpToIndex(i: number) {
    try {
      const st = await backend.histJump(i)
      if (st && st.name) {
        lastHist = { list: st.list, index: st.index }
        goto(st.name, { noHistory: true })
      }
    } catch (e) {
      /* ignore */
    }
  }

  async function removeFromHistory(name: string) {
    const wasActive = same(name, focus)
    try {
      lastHist = await backend.histRemove(name)
    } catch (e) {
      return
    }
    renderToolbar()
    renderBreadcrumb()
    if (!wasActive) return
    // The removed crumb was the active thought: land on the new current entry and
    // open it in the editor too (goto without `fromLogseq` runs the navigate mirror).
    if (lastHist.list.length) {
      goto(lastHist.list[lastHist.index], { noHistory: true })
      return
    }
    try {
      const active = await backend.getActivePage()
      if (active) {
        goto(active, { fromLogseq: true })
        return
      }
    } catch (e) {
      /* ignore */
    }
    flash('Open a page to see its synapses.')
  }

  // Toolbar "rebuild" action — the escape hatch for wedged internal state. Throws
  // away the whole in-memory index + pending patches and rebuilds it purely from the
  // editor, then forces a full re-render (lastRenderKey reset) so the skip-if-unchanged
  // path can't suppress the redraw.
  async function hardRefresh() {
    flash('Rebuilding from editor…')
    try {
      await backend.rebuildIndex()
    } catch (e: any) {
      flash('⚠ ' + ((e && e.message) || e))
      return
    }
    lastRenderKey = null
    if (focus) {
      hideFlash()
      goto(focus, { noHistory: true, fromLogseq: true })
    } else {
      restore() // no active thought yet: re-run the initial restore (manages its own flash)
    }
  }

  async function create(role: Role) {
    const src = focus
    if (!src) return
    const changed = await openCreateDialog({ root: els.dialogRoot, role, sourcePage: src, backend })
    if (changed) goto(focus, { noHistory: true })
  }

  async function createAt(fromNode: string, role: Role, at: { x: number; y: number } | null) {
    const changed = await openCreateDialog({ root: els.dialogRoot, role, sourcePage: fromNode, backend, at })
    if (changed) goto(focus, { noHistory: true })
  }

  function renderToolbar() {
    els.toolbar.innerHTML = ''
    const back = btn('◀', 'Back', () => jumpToIndex(lastHist.index - 1))
    back.disabled = lastHist.index <= 0
    const fwd = btn('▶', 'Forward', () => jumpToIndex(lastHist.index + 1))
    fwd.disabled = lastHist.index >= lastHist.list.length - 1
    const refresh = btn('↻', 'Rebuild from editor', () => hardRefresh())
    refresh.classList.add('synapses-btn-refresh') // bumps the thin glyph up to the triangles' weight

    const title = document.createElement('div')
    title.className = 'synapses-title'
    title.textContent = focus || ''
    title.title = focus || ''

    const add = document.createElement('div')
    add.className = 'synapses-add-group'
    add.append(
      btn('＋child', 'Add child', () => create('child')),
      btn('＋parent', 'Add parent', () => create('parent')),
      btn('＋jump', 'Add jump', () => create('jump')),
    )

    // −/+ step the card + text size (zoom was removed; layout fills the panel either way).
    const { level, count } = view.sizeInfo()
    const minus = btn('−', 'Smaller cards & text', () => { view.stepSize(-1); renderToolbar() })
    minus.disabled = level <= 0
    const plus = btn('+', 'Larger cards & text', () => { view.stepSize(1); renderToolbar() })
    plus.disabled = level >= count - 1

    // (No explicit "open in main pane" button — clicking the centred active card already
    // opens it in the main pane.)
    els.toolbar.append(back, fwd, refresh, title, add, minus, plus)
  }

  function renderBreadcrumb() {
    els.breadcrumb.innerHTML = ''
    lastHist.list.forEach((name, i) => {
      const c = document.createElement('button')
      c.className = 'synapses-crumb' + (i === lastHist.index ? ' current' : '')
      c.textContent = name
      c.title = name
      // Clicking a crumb re-activates the thought (move-to-rightmost via histPush),
      // not a pointer-move like back/forward — so the activated thought lands at the
      // most-recent (right-most) breadcrumb slot instead of highlighting in place.
      c.addEventListener('click', () => goto(name))
      c.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        openContextMenu({
          root: els.dialogRoot,
          at: { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY },
          items: [{ label: 'Remove from history', onSelect: () => removeFromHistory(name) }],
        })
      })
      els.breadcrumb.appendChild(c)
    })
    // Breadcrumb head-right invariant: most-recent entry is always right-most and visible.
    els.breadcrumb.scrollLeft = els.breadcrumb.scrollWidth
  }

  async function loadTheme() {
    try {
      const p = await backend.getTheme()
      view.setTheme(applyTheme(container, p))
    } catch (e) {
      /* keep defaults */
    }
  }

  function btn(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.className = 'synapses-btn'
    b.textContent = label
    // Custom hover tooltip (.synapses-btn[data-tip]) instead of the native `title`, which
    // has an inconsistent delay + OS styling. aria-label carries the accessible name.
    b.setAttribute('aria-label', title)
    b.dataset.tip = title
    b.addEventListener('click', onClick)
    return b
  }

  function flash(msg: string) {
    els.flash.textContent = msg
    els.flash.style.display = 'flex'
  }
  function hideFlash() {
    els.flash.style.display = 'none'
  }

  // Contract: the caller passes a backend that is ready to take calls. Obsidian's
  // in-process backend always is; the Logseq proxy is mounted from its onConnect,
  // after the postMessage handshake. boot() loads the remembered zoom, builds the
  // view, registers event handlers (same bodies as the old onEvent switch), and
  // runs the initial restore (the old onConnect body).
  const unsubs: Array<() => void> = []
  let disposed = false

  async function init() {
    await loadTheme()
    await restore()
  }

  async function boot() {
    // Restore the user's remembered size level before building the view so cards render
    // at their chosen size from the first frame. getSize is a fast persistence read and
    // the stage DOM is already mounted, so nothing flashes; an event arriving in this gap
    // is harmless — init() re-syncs theme + page.
    let initialSize: number | null = null
    try { initialSize = await backend.getSize() } catch (e) { /* ignore */ }
    if (disposed) return

    view = createView({
      root: container,
      world: els.world,
      canvas: els.canvas,
      stage: els.stage,
      onNavigate: goto,
      onOpenMain: (name) => backend.navigate(name).catch(() => {}),
      onRemoveLink: ({ from, to, role }) =>
        backend
          .removeLink(from, to, role as Role)
          .then(() => goto(focus, { noHistory: true }))
          .catch(() => {}),
      onLinkExisting: (fromNode, toNode, role) =>
        backend
          .linkExisting(fromNode, toNode, role as Role)
          .then(() => goto(focus, { noHistory: true }))
          .catch(() => {}),
      onCreateAt: (fromNode, dir, at) => createAt(fromNode, dir as Role, at),
      initialSize,
      onSizeChange: (level) => { backend.setSize(level).catch(() => {}) },
    })

    unsubs.push(
      backend.on('recenter', (payload) => {
        if (payload && payload.page) {
          // ignore the route-change echo of a navigation we initiated ourselves
          if (!focus || payload.page.toLowerCase() !== focus.toLowerCase()) {
            goto(payload.page, { fromLogseq: true })
          }
        }
      }),
      backend.on('theme', (payload) => {
        view.setTheme(applyTheme(container, payload))
      }),
      backend.on('refresh', () => {
        if (focus) goto(focus, { noHistory: true, fromLogseq: true, ifChanged: true })
      }),
    )

    await init()
  }
  void boot()

  return () => {
    disposed = true
    for (const u of unsubs) u()
    if (view) view.destroy()
    container.innerHTML = ''
    container.classList.remove('synapses-root')
  }
}

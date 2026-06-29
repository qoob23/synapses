import { graphKey, sameName as same, isUnlinked } from './app-logic'
import { errText } from './errText'
import { noopLogger, type Logger } from './logger'
import { openColorsPopover } from './view/colors'
import { openContextMenu } from './view/context-menu'
import { openCreateDialog } from './view/dialog'
import { applyTheme, connectorColors } from './view/theme'
import { createView } from './view/view'
import type { SynapsesBackend, Graph, HistoryState, Role, Palette } from './types'

interface GotoOpts {
  noHistory?: boolean
  fromLogseq?: boolean
  ifChanged?: boolean
}

// Mount the synapses UI inside `container`, wired to an already-connected
// `backend`. Builds the DOM subtree that the old `synapses.html` provided,
// stamps `.synapses-root` on the container, runs an initial restore, and returns
// a teardown that unsubscribes from backend events and clears the container.
export function mountSynapses(container: HTMLElement, backend: SynapsesBackend, logger: Logger = noopLogger): () => void {
  container.classList.add('synapses-root')
  container.innerHTML = `
    <div id="synapses-app">
      <div id="synapses-spinner" class="synapses-spinner" aria-hidden="true"></div>
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
    spinner: container.querySelector('#synapses-spinner') as HTMLElement,
    breadcrumb: container.querySelector('#synapses-breadcrumb') as HTMLElement,
    dialogRoot: container.querySelector('#synapses-dialog-root') as HTMLElement,
  }

  // History is owned by the main context (durable). We keep the last snapshot here
  // only to render the toolbar/breadcrumb.
  let lastHist: HistoryState = { list: [], index: -1 }

  let focus: string | null = null
  let mobile = false
  let navToken = 0
  let lastRenderKey: string | null = null

  // The view is built in boot() below, AFTER the remembered size level is loaded, so
  // cards render at the user's chosen size from the first frame. `view!` is assigned
  // before any function that touches it runs (they all run after boot()).
  let view!: ReturnType<typeof createView>

  // Restore the previous active note + history (e.g. after the view was re-mounted),
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
          void goto(st.list[st.index], { noHistory: true, fromLogseq: true })
          return
        }
      }
    } catch {
      /* ignore */
    }
    try {
      const active = await backend.getActivePage()
      if (active) void goto(active, { fromLogseq: true })
      else flash('Open a page in Logseq to see its links.')
    } catch (e) {
      flashError(e)
    }
  }

  async function goto(name: string | null | undefined, opts: GotoOpts = {}) {
    if (!name) return
    const mine = ++navToken
    focus = name
    logger.log('user', 'activate', { name, fromEditor: !!opts.fromLogseq, noHistory: !!opts.noHistory })

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
    } catch (e) {
      flashError(e)
      return
    }
    if (mine !== navToken) return // superseded by a newer navigation

    // An activated note that renders unlinked may be a file deleted on disk; pruneIfMissing
    // decides (and returns true when it has handled/redirected navigation, so we stop here).
    // Only guard editor-originated / history-restore navigations (opts.fromLogseq): a deliberate
    // forward click on a card — including a child/sibling that's merely *referenced* and not yet
    // created (no backing file) — must fall through and render, then mirror-navigate to open/create
    // it in the editor (like clicking a [[link]]). Otherwise the deleted-page guard bounces every
    // not-yet-created referenced page back to the current page.
    if (opts.fromLogseq && isUnlinked(graph) && (await pruneIfMissing(name, mine))) return

    hideFlash()
    // Skip the re-render if nothing visually changed (avoids reconcile flicker).
    const key = graphKey(graph)
    if (!(opts.ifChanged && key === lastRenderKey)) {
      logger.log('ui', 'render', { focus: name, p: graph.parents.length, c: graph.children.length, j: graph.jumps.length, s: graph.siblings.length })
      view.setGraph(graph)
      lastRenderKey = key
    } else {
      logger.log('ui', 'render', { focus: name, skipped: true })
    }

    const names = view.getRenderedNames()
    backend
      .nodeAdjacency([...names])
      .then((adj) => { if (mine === navToken) view.setHandles(adj || {}, names) })
      .catch(() => {})

    // Mirror the active note into the main pane unless this navigation came FROM the editor.
    // On mobile we never mirror — switching the editor page closes the mobile drawer.
    if (!opts.fromLogseq && !mobile) backend.navigate(name).catch(() => {})
  }

  // An unlinked active note may be a file deleted on disk. Prune it via the editor's
  // existence check; returns true when it has handled navigation (redirected to the
  // current editor page or flashed "no longer exists") so goto() stops, false to render
  // the (possibly genuinely-empty) graph. navToken re-checks preserve the supersession guard.
  async function pruneIfMissing(name: string, mine: number): Promise<boolean> {
    try {
      const { removed } = await backend.histRemoveMissing([name])
      if (mine !== navToken) return true // superseded by a newer navigation
      if (!removed.length) return false // note exists → render it
      lastHist = await backend.histState()
      renderToolbar()
      renderBreadcrumb()
      const active = await backend.getActivePage()
      if (active && !same(active, name)) {
        void goto(active, { fromLogseq: true })
        return true
      }
      flash('This note no longer exists.')
      return true
    } catch {
      return false // existence check failed → fall through and render the empty graph
    }
  }

  async function removeFromHistory(name: string) {
    const wasActive = same(name, focus)
    try {
      lastHist = await backend.histRemove(name)
    } catch {
      return
    }
    renderToolbar()
    renderBreadcrumb()
    if (!wasActive) return
    // The removed crumb was the active note: land on the new current entry and
    // open it in the editor too (goto without `fromLogseq` runs the navigate mirror).
    if (lastHist.list.length) {
      void goto(lastHist.list[lastHist.index], { noHistory: true })
      return
    }
    try {
      const active = await backend.getActivePage()
      if (active) {
        void goto(active, { fromLogseq: true })
        return
      }
    } catch {
      /* ignore */
    }
    flash('Open a note to see its links.')
  }

  // Toolbar "refresh" action — re-read straight from the editor and force a full re-render
  // (lastRenderKey reset) so the skip-if-unchanged path can't suppress the redraw. There is
  // no in-memory index to discard anymore; this just re-fetches the focus note's neighborhood.
  function hardRefresh() {
    logger.log('user', 'refresh')
    clearWait()
    lastRenderKey = null
    if (focus) {
      hideFlash()
      void goto(focus, { noHistory: true, fromLogseq: true })
    } else {
      void restore() // no active note yet: re-run the initial restore (manages its own flash)
    }
  }

  // The dialog performs the writes itself; on success we wait for the editor's 'refresh'
  // to render (beginWait), rather than re-reading optimistically.
  async function create(role: Role) {
    logger.log('user', 'create', { role })
    const src = focus
    if (!src) return
    const changed = await openCreateDialog({ root: els.dialogRoot, role, sourcePage: src, backend })
    if (changed) beginWait()
  }

  async function createAt(fromNode: string, role: Role, at: { x: number; y: number } | null) {
    logger.log('user', 'createAt', { from: fromNode, role })
    const changed = await openCreateDialog({ root: els.dialogRoot, role, sourcePage: fromNode, backend, at })
    if (changed) beginWait()
  }

  function renderToolbar() {
    els.toolbar.innerHTML = ''
    const refresh = btn('↻', 'Refresh from editor', () => { hardRefresh() })
    refresh.classList.add('synapses-btn-refresh') // bumps the thin glyph up to the triangles' weight

    const add = document.createElement('div')
    add.className = 'synapses-add-group'
    add.append(
      btn('＋child', 'Add child', () => { void create('child') }),
      btn('＋parent', 'Add parent', () => { void create('parent') }),
      btn('＋jump', 'Add jump', () => { void create('jump') }),
    )

    // −/+ step the card + text size (zoom was removed; layout fills the panel either way).
    const { level, count } = view.sizeInfo()
    const minus = btn('−', 'Smaller cards & text', () => { view.stepSize(-1); renderToolbar() })
    minus.disabled = level <= 0
    const plus = btn('+', 'Larger cards & text', () => { view.stepSize(1); renderToolbar() })
    plus.disabled = level >= count - 1

    const colors = btn('◑', 'Highlight color', () => { void openColors(colors) })

    // (No explicit "open in main pane" button — clicking the centred active card already
    // opens it in the main pane.) The add group is mobile-only; on desktop the handles +
    // the editor cover creation, so the toolbar stays ↻ − + ◑.
    els.toolbar.append(refresh, ...(mobile ? [add] : []), minus, plus, colors)
  }

  function renderBreadcrumb() {
    els.breadcrumb.innerHTML = ''
    lastHist.list.forEach((name, i) => {
      const c = document.createElement('button')
      c.className = 'synapses-crumb' + (i === lastHist.index ? ' current' : '')
      c.textContent = name
      c.title = name
      // Clicking a crumb re-activates the note (move-to-rightmost via histPush),
      // not a pointer-move like back/forward — so the activated note lands at the
      // most-recent (right-most) breadcrumb slot instead of highlighting in place.
      c.addEventListener('click', () => { void goto(name) })
      c.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        openContextMenu({
          root: els.dialogRoot,
          at: { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY },
          items: [{ label: 'Remove from history', onSelect: () => { void removeFromHistory(name) } }],
        })
      })
      els.breadcrumb.appendChild(c)
    })
    // Breadcrumb head-right invariant: most-recent entry is always right-most and visible.
    els.breadcrumb.scrollLeft = els.breadcrumb.scrollWidth
  }

  // Merge the user's persisted connector-color overrides (resolved for the
  // palette's current mode) onto the theme, then apply. Shared by the initial
  // load, the editor 'theme' event, and color edits.
  async function applyThemeWithOverrides(p: Palette) {
    try {
      const o = await backend.getConnectorColors()
      p.primaryEdge = (p.mode === 'dark' ? o.primaryDark : o.primaryLight) || undefined
    } catch (e) { /* ignore overrides; fall back to auto-derived */ }
    view.setTheme(applyTheme(container, p))
  }

  async function loadTheme() {
    try {
      await applyThemeWithOverrides(await backend.getTheme())
    } catch (e) {
      /* keep defaults */
    }
  }

  // Open the connector-color picker for the current mode, anchored under its button.
  async function openColors(anchor: HTMLElement) {
    let palette: Palette
    let overrides
    try { palette = await backend.getTheme(); overrides = await backend.getConnectorColors() }
    catch (e) { return }
    const dark = palette.mode === 'dark'
    const field = dark ? 'primaryDark' : 'primaryLight'
    // The picked color highlights the active card / current crumb / hovered connector;
    // with none set that highlight is the theme accent — shown in the swatch as the
    // auto value (connectorColors().highlight, with the override cleared).
    const derived = connectorColors({ ...palette, primaryEdge: undefined })
    const rect = anchor.getBoundingClientRect()
    openColorsPopover({
      root: els.dialogRoot,
      at: { x: rect.left, y: rect.bottom + 4 },
      title: `Highlight color · ${dark ? 'Dark' : 'Light'}`,
      rows: [
        {
          label: 'Color',
          value: overrides[field],
          fallback: derived.highlight,
          onChange: async (value) => {
            const cur = await backend.getConnectorColors()
            if (value == null) delete cur[field]
            else cur[field] = value
            await backend.setConnectorColors(cur)
            await loadTheme()
          },
        },
      ],
    })
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
    els.flash.classList.add('is-shown')
  }
  function flashError(e: unknown) {
    flash('⚠ ' + errText(e))
  }
  function hideFlash() {
    els.flash.classList.remove('is-shown')
  }

  // Pending-write feedback. We no longer render optimistically: after a write we wait for the
  // editor to report the change (the 'refresh' event), then re-render from confirmed state. The
  // spinner shows during that wait; a watchdog covers the case where the editor never reports it
  // (e.g. a silently-failed write) — we flash a warning and render best-effort.
  const WATCHDOG_MS = 2000
  let pending = 0
  let watchdog: ReturnType<typeof setTimeout> | undefined
  function showSpinner(on: boolean) { els.spinner.classList.toggle('is-shown', on) }
  function armWatchdog() {
    if (watchdog) clearTimeout(watchdog)
    watchdog = setTimeout(onWatchdog, WATCHDOG_MS)
  }
  function beginWait() {
    pending++
    showSpinner(true)
    armWatchdog()
  }
  // One pending write was confirmed (a refresh arrived) or failed: drop it. If others are
  // still in flight, keep the spinner up and re-arm the watchdog for the remainder; only
  // tear everything down once the last one resolves. (One logical write can emit several
  // editor events, so this is approximate — but it never clears the whole batch on the
  // first refresh, and the watchdog still fires if the remainder never lands.)
  function decWait() {
    if (pending > 0) pending--
    if (pending > 0) armWatchdog()
    else clearWait()
  }
  // Full teardown — no pending writes remain (watchdog timeout, hard refresh, dispose).
  function clearWait() {
    pending = 0
    if (watchdog) { clearTimeout(watchdog); watchdog = undefined }
    showSpinner(false)
  }
  function onWatchdog() {
    logger.log('ui', 'watchdog')
    clearWait()
    flash('⚠ The editor didn\'t report the change. Showing the latest state.')
    if (focus) { lastRenderKey = null; void goto(focus, { noHistory: true, fromLogseq: true }) }
  }
  // A write threw outright (vs. just lagging) — drop that one and surface the error.
  function failWait(e: unknown) {
    decWait()
    flashError(e)
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
      onNavigate: (name) => { void goto(name) },
      onOpenMain: (name) => { void backend.navigate(name).catch(() => {}) },
      // No optimistic re-render: write, then wait for the editor's 'refresh' to render
      // confirmed state (the spinner shows meanwhile; the watchdog covers a silent failure).
      onRemoveLink: ({ from, to, role }) => {
        logger.log('user', 'unlink', { from, to, role })
        beginWait()
        void backend.removeLink(from, to, role as Role).catch(failWait)
      },
      onLinkExisting: (fromNode, toNode, role) => {
        logger.log('user', 'link', { from: fromNode, to: toNode, role })
        beginWait()
        void backend.linkExisting(fromNode, toNode, role as Role).catch(failWait)
      },
      onCreateAt: (fromNode, dir, at) => { void createAt(fromNode, dir as Role, at) },
      initialSize,
      onSizeChange: (level) => { backend.setSize(level).catch(() => {}) },
    })

    // Load the mobile flag before init() so the first renderToolbar/setGraph already
    // reflect mobile mode (mobile-only add group, no editor-mirror on activate).
    try { mobile = !!(await backend.getUiMode()).mobile } catch (e) { /* ignore */ }
    view.setMobile(mobile)

    unsubs.push(
      backend.on('recenter', (payload) => {
        if (payload.page) {
          // ignore the route-change echo of a navigation we initiated ourselves
          if (!focus || payload.page.toLowerCase() !== focus.toLowerCase()) {
            void goto(payload.page, { fromLogseq: true })
          }
        }
      }),
      backend.on('theme', (payload) => {
        void applyThemeWithOverrides(payload)
      }),
      backend.on('refresh', () => {
        // If we were waiting on our own write, the editor has now applied it: stop the spinner
        // and render unconditionally (the change should show). Otherwise it's an external edit —
        // re-render only if the graph actually changed (anti-flicker).
        const wasWaiting = pending > 0
        if (wasWaiting) decWait()
        if (focus) void goto(focus, { noHistory: true, fromLogseq: true, ifChanged: !wasWaiting })
      }),
      backend.on('uimode', () => {
        void (async () => {
          try { mobile = !!(await backend.getUiMode()).mobile } catch { /* ignore */ }
          view.setMobile(mobile)
          renderToolbar()
        })()
      }),
    )

    await init()
  }
  void boot()

  return () => {
    disposed = true
    if (watchdog) clearTimeout(watchdog)
    for (const u of unsubs) u()
    if (view) view.destroy()
    container.innerHTML = ''
    container.classList.remove('synapses-root')
  }
}

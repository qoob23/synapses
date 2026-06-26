// Owns the right-sidebar embedding: a dedicated host page holds one block with
// `{{renderer :synapses}}`; opening that block in the right sidebar fires
// onMacroRendererSlotted, where we inject the synapses iframe into the slot.

const HOST_PAGE = 'synapses'
const MACRO = '{{renderer :synapses}}'

async function ensureHostBlock() {
  let page = await logseq.Editor.getPage(HOST_PAGE)
  if (!page) {
    page = await logseq.Editor.createPage(
      HOST_PAGE,
      {},
      { redirect: false, createFirstBlock: true, journal: false },
    )
  }
  let tree = await logseq.Editor.getPageBlocksTree(HOST_PAGE)
  let block = tree && tree[0]
  if (!block) {
    block = await logseq.Editor.appendBlockInPage(HOST_PAGE, MACRO)
  } else if (!String(block.content || '').includes(':synapses')) {
    await logseq.Editor.updateBlock(block.uuid, MACRO)
  }
  tree = await logseq.Editor.getPageBlocksTree(HOST_PAGE)
  return tree && tree[0]
}

export async function openSynapsesSidebar() {
  const block = await ensureHostBlock()
  if (!block) return
  await logseq.Editor.openInRightSidebar(block.uuid)
  try {
    await logseq.App.setRightSidebarVisible(true)
  } catch (e) {
    /* older API shapes; best-effort */
  }
}

export function synapsesFrameStyle() {
  return [
    // width:calc(100% + 40px) + negative right margin bleeds the synapses ~40px into
    // the sidebar block's right gutter so it reaches the true panel edge.
    '.synapses-frame{width:calc(100% + 40px);margin-right:-40px;min-width:0;height:78vh;' +
      'min-height:420px;border:0;display:block;' +
      'background:var(--ls-secondary-background-color,#fff)}',
    // The macro renderer nests the iframe in INLINE spans, where width:100% is
    // ignored and the iframe falls back to its ~300px intrinsic size. Force the
    // nearest wrapper ancestors to block-level + full width. Using :has() (CSS)
    // — not JS — so it RE-APPLIES on every re-render and survives a Logseq reload
    // (imperative inline styles get wiped when the sidebar re-renders). Class-
    // independent (the 3 nearest ancestors) so it works regardless of wrapper
    // class names.
    '*:has(> iframe.synapses-frame),' +
      '*:has(> * > iframe.synapses-frame),' +
      '*:has(> * > * > iframe.synapses-frame)' +
      '{display:block!important;width:100%!important;max-width:none!important}',
    // Strip the host block's bullet/indent, scoped to the synapses sidebar item only.
    '.sidebar-item:has(.synapses-frame) .bullet-container,' +
      '.sidebar-item:has(.synapses-frame) .block-control-wrap{display:none!important}',
    '.sidebar-item:has(.synapses-frame) .ls-block,' +
      '.sidebar-item:has(.synapses-frame) .block-content,' +
      '.sidebar-item:has(.synapses-frame) .block-content-wrapper{' +
      'margin-left:0!important;padding-left:0!important;padding-right:0!important;' +
      'max-width:none!important}',
  ].join('\n')
}

// Inject our iframe into the macro slot. We prefer the right-sidebar instance,
// but never hard-block on an unknown sidebar container id: only skip a slot we
// can positively identify as the main-area duplicate.
export function renderSynapsesSlot(slot, connect) {
  const host = parent.document.getElementById(slot)
  if (host) {
    const inMain = host.closest('#main-content-container, #center-content-container')
    const inSidebar = host.closest('#right-sidebar, #right-sidebar-container, .sidebar-item-list')
    if (inMain && !inSidebar) return // the host page is open in the main area; ignore it
    if (host.querySelector('iframe.synapses-frame')) return // already injected; avoid reload on re-fire
  }

  const elId = 'synapses-iframe-' + slot
  // Inject WITHOUT a src so DOMPurify has no URL to sanitize away (a plugin may
  // be served over a non-http scheme); set .src via the DOM API, which isn't
  // sanitized, once we locate the element.
  logseq.provideUI({
    key: 'synapses-ui-' + slot,
    slot,
    reset: true,
    template: `<iframe id="${elId}" class="synapses-frame"></iframe>`,
  })

  const synapsesUrl = new URL('synapses.html', location.href).href
  let tries = 0
  const tick = () => {
    const el = parent.document.getElementById(elId)
    if (el) {
      if (!el.src) el.src = synapsesUrl
      connect(el)
      installDragPassthrough()
      console.log('[synapses] iframe injected; src =', el.src)
      return
    }
    if (tries++ < 60) setTimeout(tick, 50)
  }
  setTimeout(tick, 30)
}

// While the user drags the sidebar resize handle and the cursor crosses our
// iframe, the iframe would swallow the mouse events — making the resize lag and
// "stick" after release (the parent never gets mouseup). When a gesture starts
// OUTSIDE the synapses (pointerdown inside the iframe never reaches the parent
// document), disable the iframe's pointer events until release so the parent
// keeps receiving move/up. Installed once, targets all synapses iframes.
let dragPassthroughInstalled = false
function installDragPassthrough() {
  if (dragPassthroughInstalled) return
  dragPassthroughInstalled = true
  const pdoc = parent.document
  const setPE = (val) => {
    pdoc.querySelectorAll('iframe.synapses-frame').forEach((f) => {
      f.style.pointerEvents = val
    })
  }
  const restore = () => setPE('')
  pdoc.addEventListener('pointerdown', () => setPE('none'), true)
  pdoc.addEventListener('pointerup', restore, true)
  pdoc.addEventListener('pointercancel', restore, true)
  pdoc.addEventListener('mouseup', restore, true)
  try {
    parent.addEventListener('blur', restore)
  } catch (e) {
    /* ignore */
  }
}

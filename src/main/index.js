import '@logseq/libs'
import { startBridge, connectIframe, notifyPeer } from './bridge-host.js'
import { renderPlexSlot, openPlexSidebar, plexFrameStyle } from './sidebar.js'
import { buildGraph, nodeDegrees, rebuildIndex } from './graph.js'
import { readPalette } from './theme.js'
import { createChild, createParent, createJump, linkExisting, searchPages } from './mutations.js'

function pageNameOf(p) {
  if (!p) return null
  if (p.originalName || p.name) return p.originalName || p.name
  if (p.page) return p.page.originalName || p.page.name
  return null
}

async function getActivePage() {
  const p = await logseq.Editor.getCurrentPage()
  return pageNameOf(p)
}

// Navigation history lives here (durable) so it survives the plex iframe being
// re-injected when Logseq re-renders the sidebar block.
const history = { stack: [], idx: -1 }
const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
function histState() {
  return { list: history.stack.slice(), index: history.idx }
}
function histPush(name) {
  if (!(history.idx >= 0 && sameName(history.stack[history.idx], name))) {
    history.stack.splice(history.idx + 1)
    history.stack.push(name)
    history.idx = history.stack.length - 1
  }
  return histState()
}
function histJump(i) {
  if (i >= 0 && i < history.stack.length) history.idx = i
  return { name: history.stack[history.idx] || null, ...histState() }
}

// Methods callable from the plex iframe over RPC.
const handlers = {
  getActivePage,
  getTheme: () => readPalette(),
  buildGraph: (name) => buildGraph(name),
  nodeDegrees: (names) => nodeDegrees(names),
  histState: () => histState(),
  histPush: (name) => histPush(name),
  histJump: (i) => histJump(i),
  navigate: async (name) => {
    await logseq.App.pushState('page', { name })
    return true
  },
  createChild: async (focus, name) => {
    await createChild(focus, name)
    return true
  },
  createParent: async (focus, name) => {
    await createParent(focus, name)
    return true
  },
  createJump: async (focus, name) => {
    await createJump(focus, name)
    return true
  },
  linkExisting: async (focus, name, role) => {
    await linkExisting(focus, name, role)
    return true
  },
  searchPages: (q) => searchPages(q),
}

const settingsSchema = [
  {
    key: 'parentFields',
    type: 'string',
    default: 'parent, parents, up',
    title: 'Parent property names',
    description: 'Comma-separated property names treated as "parent".',
  },
  {
    key: 'childFields',
    type: 'string',
    default: 'child, children, down',
    title: 'Child property names',
    description: 'Comma-separated property names treated as "child".',
  },
  {
    key: 'jumpFields',
    type: 'string',
    default: 'jump, jumps, friend, friends',
    title: 'Jump property names',
    description: 'Comma-separated property names treated as "jump".',
  },
]

function main() {
  logseq.useSettingsSchema(settingsSchema)
  logseq.provideStyle(plexFrameStyle())
  startBridge(handlers)

  logseq.App.onMacroRendererSlotted(({ slot, payload }) => {
    const args = (payload && payload.arguments) || []
    if (String(args[0] || '').trim() !== ':plex') return
    renderPlexSlot(slot, connectIframe)
  })

  // Keep the plex focused on whatever page the user is viewing.
  logseq.App.onRouteChanged(async () => {
    const name = await getActivePage()
    if (name) notifyPeer('recenter', { page: name })
  })

  // Push theme changes to the iframe (it can't read Logseq CSS vars itself).
  logseq.App.onThemeModeChanged((e) => {
    notifyPeer('theme', readPalette(e && e.mode))
  })

  // Reconcile the index when the graph changes (external edits, new links).
  // Debounced so getPage().properties has settled before we re-read (an immediate
  // re-read can be stale and would clobber a just-applied patch).
  let refreshTimer = 0
  logseq.DB.onChanged(() => {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(async () => {
      refreshTimer = 0
      try {
        await rebuildIndex()
      } catch (e) {
        /* ignore */
      }
      notifyPeer('refresh')
    }, 400)
  })

  // Rebuild when the ontology (property-name) settings change.
  logseq.onSettingsChanged(async () => {
    try {
      await rebuildIndex()
    } catch (e) {
      /* ignore */
    }
    notifyPeer('refresh')
  })

  logseq.Editor.registerSlashCommand('Plex: open in sidebar', async () => {
    await openPlexSidebar()
  })

  logseq.provideModel({
    openPlex() {
      openPlexSidebar()
    },
  })
  logseq.App.registerUIItem('toolbar', {
    key: 'plex-open',
    template:
      '<a class="button" data-on-click="openPlex" title="Open Plex">' +
      '<span style="font-size:18px">🧠</span></a>',
  })

  console.log('[plex] plugin ready')
}

logseq.ready(main).catch(console.error)

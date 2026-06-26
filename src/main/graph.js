import { getOntology, roleForKey } from './ontology.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Property values that are wiki-links come back as page-name strings (or arrays);
// strip any stray [[ ]] just in case.
export function toNames(val) {
  if (val == null) return []
  const arr = Array.isArray(val) ? val : [val]
  return arr
    .map((v) => String(v).replace(/^\[\[/, '').replace(/\]\]$/, '').trim())
    .filter(Boolean)
}

function collect(props, role, ont) {
  const out = []
  for (const key of Object.keys(props || {})) {
    if (roleForKey(key, ont) === role) out.push(...toNames(props[key]))
  }
  return out
}

// Page properties live on the first (pre-)block; some Logseq versions surface
// them on the page entity, others only on the block.
export async function getPageProps(name) {
  try {
    const page = await logseq.Editor.getPage(name)
    if (page && page.properties) return page.properties
  } catch (e) {
    /* fall through */
  }
  try {
    const tree = await logseq.Editor.getPageBlocksTree(name)
    if (tree && tree[0] && tree[0].properties) return tree[0].properties
  } catch (e) {
    /* fall through */
  }
  return {}
}

// ---------------------------------------------------------------------------
// Pure index build + query (unit-tested without Logseq)
// ---------------------------------------------------------------------------

const SIBLING_CAP = 50

function emptyNode() {
  return { parents: new Set(), children: new Set(), jumps: new Set() }
}

// entries: [{ name, props }]. Returns { pages: Map<lower, entry>, display: Map<lower, original> }
// with reciprocals already applied (declaring one side fills the other).
export function buildIndex(entries, ont) {
  const pages = new Map()
  const display = new Map()

  const see = (name) => {
    const l = String(name).toLowerCase()
    if (!display.has(l)) display.set(l, name)
    if (!pages.has(l)) pages.set(l, emptyNode())
    return l
  }
  const link = (aName, bName, role) => {
    const a = see(aName)
    const b = see(bName)
    if (a === b) return
    if (role === 'parent') {
      pages.get(a).parents.add(b)
      pages.get(b).children.add(a)
    } else if (role === 'child') {
      pages.get(a).children.add(b)
      pages.get(b).parents.add(a)
    } else {
      pages.get(a).jumps.add(b)
      pages.get(b).jumps.add(a)
    }
  }

  for (const { name, props } of entries) {
    see(name)
    for (const p of collect(props, 'parent', ont)) link(name, p, 'parent')
    for (const c of collect(props, 'child', ont)) link(name, c, 'child')
    for (const j of collect(props, 'jump', ont)) link(name, j, 'jump')
  }

  return { pages, display }
}

export function queryGraph(index, focusName) {
  const { pages, display } = index
  const f = String(focusName).toLowerCase()
  const disp = (l) => display.get(l) || l
  const e = pages.get(f) || emptyNode()

  // Siblings = children of my parents minus self / my own parents+children.
  const siblings = new Set()
  const siblingParent = {}
  for (const p of e.parents) {
    const pe = pages.get(p)
    if (!pe) continue
    for (const c of pe.children) {
      if (c === f || e.parents.has(c) || e.children.has(c) || siblings.has(c)) continue
      siblings.add(c)
      siblingParent[disp(c)] = disp(p)
    }
  }
  const sib = [...siblings]

  return {
    focus: disp(f),
    parents: [...e.parents].map(disp),
    children: [...e.children].map(disp),
    jumps: [...e.jumps].map(disp),
    siblings: sib.slice(0, SIBLING_CAP).map(disp),
    siblingsTruncated: sib.length > SIBLING_CAP,
    siblingParent,
  }
}

// ---------------------------------------------------------------------------
// Live index (runtime) — built from page properties, NOT datascript refs (which
// lag until a re-index). Patched immediately on writes, rebuilt on graph change.
// ---------------------------------------------------------------------------

let liveIndex = { pages: new Map(), display: new Map() }
let built = false
let building = null

// Local writes are applied to the index immediately and recorded here. Every
// rebuild re-applies the ones a fresh read hasn't confirmed yet — because
// getPage().properties lags after a write, a plain rebuild would otherwise drop
// a just-added edge (it would briefly appear, then vanish). A patch is dropped
// once a read confirms it, or after a short settle window so a later external
// removal still wins.
const pendingPatches = []
const PATCH_TTL_MS = 4000

export function applyEdge(index, focusName, role, targetName) {
  const see = (name) => {
    const l = String(name).toLowerCase()
    if (!index.display.has(l)) index.display.set(l, name)
    if (!index.pages.has(l)) index.pages.set(l, emptyNode())
    return l
  }
  const a = see(focusName)
  const b = see(targetName)
  if (a === b) return
  if (role === 'parent') {
    index.pages.get(a).parents.add(b)
    index.pages.get(b).children.add(a)
  } else if (role === 'child') {
    index.pages.get(a).children.add(b)
    index.pages.get(b).parents.add(a)
  } else {
    index.pages.get(a).jumps.add(b)
    index.pages.get(b).jumps.add(a)
  }
}

export function removeEdge(index, focusName, role, targetName) {
  const a = String(focusName).toLowerCase()
  const b = String(targetName).toLowerCase()
  const ea = index.pages.get(a)
  const eb = index.pages.get(b)
  if (role === 'parent') {
    if (ea) ea.parents.delete(b)
    if (eb) eb.children.delete(a)
  } else if (role === 'child') {
    if (ea) ea.children.delete(b)
    if (eb) eb.parents.delete(a)
  } else {
    if (ea) ea.jumps.delete(b)
    if (eb) eb.jumps.delete(a)
  }
}

export function hasEdge(index, focusName, role, targetName) {
  const e = index.pages.get(String(focusName).toLowerCase())
  if (!e) return false
  const t = String(targetName).toLowerCase()
  if (role === 'parent') return e.parents.has(t)
  if (role === 'child') return e.children.has(t)
  return e.jumps.has(t)
}

async function gatherEntries() {
  let list = []
  try {
    list = await logseq.Editor.getAllPages()
  } catch (e) {
    console.warn('[synapses] getAllPages failed', e)
    list = []
  }
  // Always read via getPageProps — getAllPages' inline properties can be stale.
  const entries = await Promise.all(
    (list || []).map(async (p) => {
      const name = p && (p.originalName || p.name)
      if (!name) return null
      return { name, props: await getPageProps(name) }
    }),
  )
  return entries.filter(Boolean)
}

// Pure: re-apply the patches a fresh read hasn't confirmed yet onto `fresh`,
// dropping ones the read now confirms or that have outlived the settle window.
// Mutates `fresh` (adds the surviving edges) and returns the patches to keep.
// Kept pure (no module state, `now`/`ttl` injected) so this replay loop — the
// exact logic behind the "edge appears then disappears" race — is unit-testable.
export function reconcilePatches(fresh, patches, now, ttl) {
  const keep = []
  for (const op of patches) {
    const present = hasEdge(fresh, op.focus, op.role, op.target)
    if (op.kind === 'remove') {
      if (!present) continue // read confirms the removal
      if (now - op.ts > ttl) continue // settled — let a re-add win
      removeEdge(fresh, op.focus, op.role, op.target)
      keep.push(op)
    } else {
      if (present) continue // confirmed by read
      if (now - op.ts > ttl) continue // settled — let external edits win
      applyEdge(fresh, op.focus, op.role, op.target)
      keep.push(op)
    }
  }
  return keep
}

export async function rebuildIndex() {
  const entries = await gatherEntries()
  const fresh = buildIndex(entries, getOntology())

  // Re-apply local patches the fresh read hasn't caught up to (avoids the
  // "appears then disappears" flash); drop confirmed or settled ones. The swap
  // below MUST stay synchronous after this replay (no await) or the race returns.
  const keep = reconcilePatches(fresh, pendingPatches, Date.now(), PATCH_TTL_MS)
  pendingPatches.length = 0
  pendingPatches.push(...keep)

  liveIndex = fresh
  built = true
}

// Build the index once (lazily). We deliberately do NOT rebuild on demand here:
// right after a write, getPage().properties can still be stale, so an immediate
// rebuild would clobber a fresh patch with old data. Instead the index is kept
// current by patchIndex() (immediate, for plugin writes) and a debounced
// rebuildIndex() (for graph changes that have had time to settle).
async function ensureBuilt() {
  if (built) return
  if (!building) building = rebuildIndex().finally(() => (building = null))
  await building
}

export async function buildGraph(focusName) {
  await ensureBuilt()
  return queryGraph(liveIndex, focusName)
}

// Apply a freshly-written link to the live index right away, so the synapses
// reflects it before Logseq finishes its own indexing. Recorded so subsequent
// rebuilds don't drop it until a read confirms it.
export function patchIndex(focusName, role, targetName) {
  if (String(focusName).toLowerCase() === String(targetName).toLowerCase()) return
  applyEdge(liveIndex, focusName, role, targetName)
  pendingPatches.push({ focus: focusName, role, target: targetName, ts: Date.now(), kind: 'add' })
}

// Apply a freshly-removed link to the live index right away (mirror of
// patchIndex) so the synapses reflects the removal before Logseq re-indexes.
export function patchRemove(focusName, role, targetName) {
  if (String(focusName).toLowerCase() === String(targetName).toLowerCase()) return
  removeEdge(liveIndex, focusName, role, targetName)
  pendingPatches.push({ focus: focusName, role, target: targetName, ts: Date.now(), kind: 'remove' })
}

// Per-thought arrays of linked thoughts from an index (pure). Keyed by LOWERCASED name;
// values are DISPLAY-cased. Names absent from the index are omitted.
export function getAdjacency(index, names) {
  const out = {}
  for (const name of names || []) {
    const l = String(name).toLowerCase()
    const e = index.pages.get(l)
    if (!e) continue
    const disp = (s) => index.display.get(s) || s
    out[l] = {
      parents: [...e.parents].map(disp),
      children: [...e.children].map(disp),
      jumps: [...e.jumps].map(disp),
    }
  }
  return out
}

// RPC: per-thought adjacency for the live index (raw, UNCAPPED).
export async function nodeAdjacency(names) {
  await ensureBuilt()
  return getAdjacency(liveIndex, names)
}

// Off-screen-link affordance: connected to more than just the active thought?
export async function nodeDegrees(names) {
  await ensureBuilt()
  const out = {}
  for (const n of names || []) {
    const e = liveIndex.pages.get(String(n).toLowerCase())
    out[n] = e ? e.parents.size + e.children.size + e.jumps.size > 1 : false
  }
  return out
}

import { getPageProps, toNames, patchIndex } from './graph.js'

// All edits are written to the FOCUS page's first block as page properties, so a
// single page changes per action and the relationship is immediately visible.

async function ensurePage(name) {
  let p = await logseq.Editor.getPage(name)
  if (!p) {
    p = await logseq.Editor.createPage(
      name,
      {},
      { redirect: false, createFirstBlock: true, journal: false },
    )
  }
  return p
}

async function firstBlockUuid(name) {
  const tree = await logseq.Editor.getPageBlocksTree(name)
  return tree && tree[0] && tree[0].uuid
}

async function addPropLink(pageName, propKey, target) {
  await ensurePage(pageName)
  const uuid = await firstBlockUuid(pageName)
  if (!uuid) return
  const props = await getPageProps(pageName)
  const links = toNames(props[propKey]).map((s) => `[[${s}]]`)
  const link = `[[${target}]]`
  if (!links.some((l) => l.toLowerCase() === link.toLowerCase())) links.push(link)
  await logseq.Editor.upsertBlockProperty(uuid, propKey, links.join(', '))
}

export async function createChild(focus, name) {
  await ensurePage(name)
  await addPropLink(focus, 'child', name)
  patchIndex(focus, 'child', name)
}

export async function createParent(focus, name) {
  await ensurePage(name)
  await addPropLink(focus, 'parent', name)
  patchIndex(focus, 'parent', name)
}

export async function createJump(focus, name) {
  await ensurePage(name)
  await addPropLink(focus, 'jump', name)
  patchIndex(focus, 'jump', name)
}

export async function linkExisting(focus, name, role) {
  const key = role === 'parent' ? 'parent' : role === 'jump' ? 'jump' : 'child'
  await addPropLink(focus, key, name)
  patchIndex(focus, key, name)
}

export async function searchPages(q) {
  const query = String(q || '').toLowerCase().trim()
  if (!query) return []
  let pages = []
  try {
    pages = await logseq.Editor.getAllPages()
  } catch (e) {
    pages = []
  }
  const out = []
  for (const p of pages || []) {
    const nm = p.originalName || p.name
    if (!nm) continue
    const lower = nm.toLowerCase()
    if (lower.startsWith('plex/')) continue // hide the plugin's internal host page
    if (lower.includes(query)) out.push(nm)
    if (out.length >= 20) break
  }
  return out
}

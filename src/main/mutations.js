import { getPageProps, toNames, patchIndex, patchRemove } from './graph.js'
import { getOntology, roleForKey } from './ontology.js'

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

// Pure: drop `target` (case-insensitive) from a list of link names.
export function removeFromLinkList(names, target) {
  const t = String(target).toLowerCase()
  return names.filter((n) => n.toLowerCase() !== t)
}

// Remove `target` from every property on `pageName` that maps to `role` (alias-
// aware), deleting the property entirely if it becomes empty.
async function removeRoleLinks(pageName, role, target) {
  const uuid = await firstBlockUuid(pageName)
  if (!uuid) return
  const props = await getPageProps(pageName)
  const ont = getOntology()
  for (const key of Object.keys(props || {})) {
    if (roleForKey(key, ont) !== role) continue
    const current = toNames(props[key])
    const remaining = removeFromLinkList(current, target)
    if (remaining.length === current.length) continue // target wasn't here
    if (remaining.length) {
      await logseq.Editor.upsertBlockProperty(uuid, key, remaining.map((s) => `[[${s}]]`).join(', '))
    } else {
      await logseq.Editor.removeBlockProperty(uuid, key)
    }
  }
}

// Remove a relationship regardless of which side declared it (reciprocity is
// inferred): strip focus's `role` keys AND the neighbor's reciprocal-role keys.
export async function removeLink(focus, target, role) {
  const recip = role === 'parent' ? 'child' : role === 'child' ? 'parent' : 'jump'
  await removeRoleLinks(focus, role, target)
  await removeRoleLinks(target, recip, focus)
  patchRemove(focus, role, target)
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

import '@logseq/libs'
import { toNames } from '@logseq-synapses/core'
import type { PageEntity } from './logseq-types'
import type { DataSource, PropMap } from '@logseq-synapses/core'

// Page properties live on the first (pre-)block; some Logseq versions surface
// them on the page entity, others only on the block. Raw wiki-link values are
// mapped to plain target names via core's `toNames`, yielding the ontology-
// agnostic PropMap the core link index consumes.
async function getPagePropsRaw(name: string, page?: PageEntity | null): Promise<PropMap> {
  let props: Record<string, unknown> = {}
  try {
    if (page === undefined) page = await logseq.Editor.getPage(name)
    if (page?.properties) props = page.properties
  } catch {}
  if (!Object.keys(props).length) {
    try { const tree = await logseq.Editor.getPageBlocksTree(name); if (tree?.[0]?.properties) props = tree[0].properties } catch {}
  }
  const out: PropMap = {}
  for (const k of Object.keys(props || {})) { const names = toNames(props[k]); if (names.length) out[k] = names }
  return out
}

async function firstBlockUuid(name: string): Promise<string | undefined> {
  const tree = await logseq.Editor.getPageBlocksTree(name)
  return tree?.[0]?.uuid
}

// Resolve the block to write page properties onto, creating one when needed.
// Page properties live on the page's first (pre-)block, but that block may already
// hold the user's own content — we must not pollute it. Reuse the first block only
// when it is already a properties block (has parsed properties) or is blank;
// otherwise insert a fresh pre-block BEFORE it so the existing content stays
// untouched. (`prependBlockInPage` with empty content lands the block LAST in
// Logseq, so we use `insertBlock` with `before`+`sibling` against the first block.)
// When there is no first block at all (a referenced-but-not-yet-created page keeps
// a lingering datascript entity, so `getPage` is truthy and `ensurePage` skips
// `createPage`, yet no block exists), `appendBlockInPage` both materializes the
// page and returns the new block's uuid directly — avoiding the post-write
// stale-read race and the silent-drop that broke the symmetric two-sided link.
async function propertyBlockUuid(name: string): Promise<string | undefined> {
  const first = (await logseq.Editor.getPageBlocksTree(name))?.[0]
  if (!first) return (await logseq.Editor.appendBlockInPage(name, ''))?.uuid
  const hasProps = Object.keys(first.properties ?? {}).length > 0
  if (hasProps || first.content.trim() === '') return first.uuid
  const created = await logseq.Editor.insertBlock(first.uuid, '', { before: true, sibling: true })
  return created?.uuid
}

export function createLogseqDataSource(): DataSource {
  return {
    getPageProps: (name) => getPagePropsRaw(name),
    async ensurePage(name) {
      const p = await logseq.Editor.getPage(name)
      if (!p) await logseq.Editor.createPage(name, {}, { redirect: false, createFirstBlock: true, journal: false })
    },
    async setPropertyLinks(name, key, targets) {
      const uuid = await propertyBlockUuid(name); if (!uuid) return
      await logseq.Editor.upsertBlockProperty(uuid, key, targets.map((t) => `[[${t}]]`).join(', '))
    },
    async removePropertyKey(name, key) {
      const uuid = await firstBlockUuid(name); if (!uuid) return
      await logseq.Editor.removeBlockProperty(uuid, key)
    },
    async searchPages(q) {
      const query = String(q || '').toLowerCase().trim(); if (!query) return []
      let pages: PageEntity[] = []; try { pages = (await logseq.Editor.getAllPages()) || [] } catch {}
      const out: string[] = []
      for (const p of pages) {
        const nm = p.originalName || p.name; if (!nm) continue
        const lower = nm.toLowerCase()
        if (lower === 'synapses') continue
        if (lower.includes(query)) out.push(nm)
        if (out.length >= 20) break
      }
      return out
    },
  }
}

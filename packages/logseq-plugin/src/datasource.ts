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

// Resolve the first-block uuid to write page properties onto, MATERIALIZING the
// page when it has none. A referenced-but-not-yet-created page surfaces a
// lingering datascript entity (so `getPage` is truthy and `ensurePage` skips
// `createPage`) yet has no first block — `firstBlockUuid` would then be undefined
// and the write would be silently dropped, breaking the symmetric two-sided link.
// `appendBlockInPage` both creates the page (if absent) and returns the new
// block's uuid directly, avoiding the post-write stale-read race.
async function ensureFirstBlockUuid(name: string): Promise<string | undefined> {
  const existing = await firstBlockUuid(name)
  if (existing) return existing
  const block = await logseq.Editor.appendBlockInPage(name, '')
  return block?.uuid
}

export function createLogseqDataSource(): DataSource {
  return {
    getPageProps: (name) => getPagePropsRaw(name),
    async ensurePage(name) {
      const p = await logseq.Editor.getPage(name)
      if (!p) await logseq.Editor.createPage(name, {}, { redirect: false, createFirstBlock: true, journal: false })
    },
    async setPropertyLinks(name, key, targets) {
      const uuid = await ensureFirstBlockUuid(name); if (!uuid) return
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

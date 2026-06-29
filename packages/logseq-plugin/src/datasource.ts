import '@logseq/libs'
import { toNames, isInLogseqFolder, log } from '@logseq-synapses/core'
import type { PageEntity } from './logseq-types'
import type { DataSource, PageEntry, PropMap } from '@logseq-synapses/core'

// Best-effort path of a page's backing file. The published type models `file` as an
// entity ref (`{ id }`, no path — then we can't tell, and Logseq doesn't list those
// files as pages anyway), but some Logseq versions surface a `{ path }`/string we can
// inspect — the one spot the runtime outruns the types, so we widen it locally.
function pageFilePath(page: PageEntity | null | undefined): string {
  const f = page?.file as string | { id?: number; path?: string } | undefined
  if (!f) return ''
  return typeof f === 'string' ? f : (f.path || '')
}

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

export function createLogseqDataSource(): DataSource {
  return {
    async listPages(): Promise<PageEntry[]> {
      let list: PageEntity[] = []
      try { list = (await logseq.Editor.getAllPages()) || [] } catch (e) { log.warn('getAllPages failed', e) }
      const entries = await Promise.all(list.map(async (p) => {
        const name = p?.originalName || p?.name
        if (!name) return null
        // Only file-backed pages are real. After an .md file is deleted, Logseq keeps a
        // phantom datascript page entity — including its stale property blocks — so
        // getAllPages still lists it and its declared links re-enter the index, resurrecting
        // connections that no longer exist on disk (surviving plugin refresh AND restart
        // until a manual Logseq re-index). Gating on `page.file` keeps the on-disk markdown
        // the sole source of truth; the fetched entity is reused for props (no extra call).
        let page: PageEntity | null
        try { page = await logseq.Editor.getPage(name) } catch { return null }
        if (!page || !page.file) return null
        // Never surface Logseq's own logseq/ folder (its bak/recycle markdown backups of
        // real pages) as notes — when a path is resolvable. No-op when file is a bare ref.
        if (isInLogseqFolder(pageFilePath(page))) return null
        return { name, props: await getPagePropsRaw(name, page) }
      }))
      return entries.filter(Boolean) as PageEntry[]
    },
    getPageProps: (name) => getPagePropsRaw(name),
    async ensurePage(name) {
      const p = await logseq.Editor.getPage(name)
      if (!p) await logseq.Editor.createPage(name, {}, { redirect: false, createFirstBlock: true, journal: false })
    },
    async setPropertyLinks(name, key, targets) {
      const uuid = await firstBlockUuid(name); if (!uuid) return
      await logseq.Editor.upsertBlockProperty(uuid, key, targets.map((t) => `[[${t}]]`).join(', '))
    },
    async removePropertyKey(name, key) {
      const uuid = await firstBlockUuid(name); if (!uuid) return
      await logseq.Editor.removeBlockProperty(uuid, key)
    },
    async pageExists(name) {
      // A deleted .md file can leave a lingering datascript page entity behind — Logseq
      // keeps referenced pages in the DB without a backing file — so getPage() alone
      // reports phantom existence, the history pruner never fires, and navigating the
      // dead entry re-materialises an empty file. Treat a page as existing only if it has
      // a backing file, or failing that any blocks on disk.
      try {
        const page = await logseq.Editor.getPage(name)
        if (!page) return false
        if (page.file) return true
        const tree = await logseq.Editor.getPageBlocksTree(name)
        return Array.isArray(tree) && tree.length > 0
      } catch { return false }
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

import '@logseq/libs'
import type { DataSource, PageEntry, PropMap } from '@logseq-synapses/core'
import { toNames } from '@logseq-synapses/core'

// Page properties live on the first (pre-)block; some Logseq versions surface
// them on the page entity, others only on the block. Raw wiki-link values are
// mapped to plain target names via core's `toNames`, yielding the ontology-
// agnostic PropMap the core link index consumes.
async function getPagePropsRaw(name: string): Promise<PropMap> {
  let props: any = {}
  try { const page = await (logseq as any).Editor.getPage(name); if (page?.properties) props = page.properties } catch {}
  if (!Object.keys(props).length) {
    try { const tree = await (logseq as any).Editor.getPageBlocksTree(name); if (tree?.[0]?.properties) props = tree[0].properties } catch {}
  }
  const out: PropMap = {}
  for (const k of Object.keys(props || {})) { const names = toNames(props[k]); if (names.length) out[k] = names }
  return out
}

async function firstBlockUuid(name: string): Promise<string | undefined> {
  const tree = await (logseq as any).Editor.getPageBlocksTree(name)
  return tree?.[0]?.uuid
}

export function createLogseqDataSource(): DataSource {
  return {
    async listPages(): Promise<PageEntry[]> {
      let list: any[] = []
      try { list = (await (logseq as any).Editor.getAllPages()) || [] } catch (e) { console.warn('[synapses] getAllPages failed', e) }
      const entries = await Promise.all(list.map(async (p) => {
        const name = p?.originalName || p?.name
        return name ? { name, props: await getPagePropsRaw(name) } : null
      }))
      return entries.filter(Boolean) as PageEntry[]
    },
    getPageProps: (name) => getPagePropsRaw(name),
    async ensurePage(name) {
      const p = await (logseq as any).Editor.getPage(name)
      if (!p) await (logseq as any).Editor.createPage(name, {}, { redirect: false, createFirstBlock: true, journal: false })
    },
    async setPropertyLinks(name, key, targets) {
      const uuid = await firstBlockUuid(name); if (!uuid) return
      await (logseq as any).Editor.upsertBlockProperty(uuid, key, targets.map((t) => `[[${t}]]`).join(', '))
    },
    async removePropertyKey(name, key) {
      const uuid = await firstBlockUuid(name); if (!uuid) return
      await (logseq as any).Editor.removeBlockProperty(uuid, key)
    },
    async pageExists(name) {
      // A deleted .md file can leave a lingering datascript page entity behind — Logseq
      // keeps referenced pages in the DB without a backing file — so getPage() alone
      // reports phantom existence, the history pruner never fires, and navigating the
      // dead entry re-materialises an empty file. Treat a page as existing only if it has
      // a backing file, or failing that any blocks on disk.
      try {
        const page: any = await (logseq as any).Editor.getPage(name)
        if (!page) return false
        if (page.file) return true
        const tree = await (logseq as any).Editor.getPageBlocksTree(name)
        return Array.isArray(tree) && tree.length > 0
      } catch { return false }
    },
    async searchPages(q) {
      const query = String(q || '').toLowerCase().trim(); if (!query) return []
      let pages: any[] = []; try { pages = (await (logseq as any).Editor.getAllPages()) || [] } catch {}
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

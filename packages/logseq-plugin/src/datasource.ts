import '@logseq/libs'
import { toNames } from '@logseq-synapses/core'
import type { BlockEntity, BlockUUIDTuple, PageEntity } from './logseq-types'
import type { DataSource, PageEntry, PropMap } from '@logseq-synapses/core'

// Flatten a page's block tree (depth-first) into a flat list of real blocks,
// skipping the ['uuid', …] tuple form Logseq can nest in `children`.
function flattenBlocks(blocks: Array<BlockEntity | BlockUUIDTuple> | null | undefined): BlockEntity[] {
  const out: BlockEntity[] = []
  for (const b of blocks ?? []) {
    if (!b || Array.isArray(b)) continue
    out.push(b)
    if (b.children?.length) out.push(...flattenBlocks(b.children))
  }
  return out
}

// Read a page's link properties from its LIVE block tree — the authoritative,
// per-page source straight from Logseq's datascript (no whole-graph reindex).
// We deliberately do NOT trust `getPage().properties`: that page-entity field is
// a CACHE that lags the file, so a removed link kept reappearing (and an added
// one vanished) even across restarts. We scan EVERY block (not just the first),
// so a property declared on any block is honored. A block surfaces a link list
// as the raw unparsed "[[A]], [[B]]" string; core's `toNames` normalizes both
// that and the pre-split array form to plain target names. Only when the page
// has no blocks at all (a referenced-but-uncreated entity) do we fall back to
// the page-entity cache.
async function getPagePropsRaw(name: string, page?: PageEntity | null): Promise<PropMap> {
  let blocks: BlockEntity[] = []
  try { blocks = (await logseq.Editor.getPageBlocksTree(name)) ?? [] } catch {}

  const out: PropMap = {}
  const add = (k: string, names: string[]) => { if (names.length) out[k] = (out[k] ?? []).concat(names) }

  if (blocks.length) {
    for (const b of flattenBlocks(blocks)) {
      const props: Record<string, unknown> | undefined = b.properties
      if (!props) continue
      for (const k of Object.keys(props)) add(k, toNames(props[k]))
    }
    return out
  }

  try {
    if (page === undefined) page = await logseq.Editor.getPage(name)
    const props: Record<string, unknown> | undefined = page?.properties
    if (props) for (const k of Object.keys(props)) add(k, toNames(props[k]))
  } catch {}
  return out
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

// Remove `key` from every block on the page (optionally except `keepUuid`), so
// no straggler declaration survives the all-blocks read in `getPagePropsRaw`.
async function clearKeyFromBlocks(name: string, key: string, keepUuid?: string): Promise<void> {
  let blocks: BlockEntity[] = []
  try { blocks = (await logseq.Editor.getPageBlocksTree(name)) ?? [] } catch {}
  for (const b of flattenBlocks(blocks)) {
    if (b.uuid === keepUuid) continue
    if (b.properties && Object.prototype.hasOwnProperty.call(b.properties, key)) {
      await logseq.Editor.removeBlockProperty(b.uuid, key)
    }
  }
}

export function createLogseqDataSource(): DataSource {
  return {
    getPageProps: (name) => getPagePropsRaw(name),
    async getBacklinks(name) {
      let refs: Array<[PageEntity, BlockEntity[]]> = []
      try { refs = (await logseq.Editor.getPageLinkedReferences(name)) ?? [] } catch {}
      const out: PageEntry[] = []
      const seen = new Set<string>()
      for (const [page] of refs) {
        const nm = page?.originalName ?? page?.name
        if (!nm) continue
        const lower = nm.toLowerCase()
        if (lower === name.toLowerCase() || lower === 'synapses' || seen.has(lower)) continue
        seen.add(lower)
        out.push({ name: nm, props: await getPagePropsRaw(nm, page) })
      }
      return out
    },
    async ensurePage(name) {
      const p = await logseq.Editor.getPage(name)
      if (!p) await logseq.Editor.createPage(name, {}, { redirect: false, createFirstBlock: true, journal: false })
    },
    async setPropertyLinks(name, key, targets) {
      const uuid = await propertyBlockUuid(name); if (!uuid) return
      await logseq.Editor.upsertBlockProperty(uuid, key, targets.map((t) => `[[${t}]]`).join(', '))
      // Keep exactly one declaration: drop the same key from any OTHER block so
      // the all-blocks read can't merge in a stale straggler.
      await clearKeyFromBlocks(name, key, uuid)
    },
    async removePropertyKey(name, key) {
      // Clear the key from EVERY block that carries it — a straggler on another
      // block would otherwise be resurrected by the all-blocks read.
      await clearKeyFromBlocks(name, key)
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

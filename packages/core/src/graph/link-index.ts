import { buildIndex, queryGraph, applyEdge, removeEdge, getAdjacency, reconcilePatches } from './index-pure'
import type { LinkGraphIndex, Patch } from './index-pure'
import type { DataSource, OntologyConfig, Graph, Adjacency, Role } from '../types'

export const PATCH_TTL_MS = 4000

export interface LinkIndex {
  rebuild(): Promise<void>
  buildGraph(name: string): Promise<Graph>
  nodeAdjacency(names: string[]): Promise<Adjacency>
  patchIndex(focus: string, role: Role, target: string): void
  patchRemove(focus: string, role: Role, target: string): void
}

export function createLinkIndex(dataSource: DataSource, getOntology: () => OntologyConfig): LinkIndex {
  let liveIndex: LinkGraphIndex = { pages: new Map(), display: new Map() }
  let built = false
  let building: Promise<void> | null = null
  const pendingPatches: Patch[] = []

  async function rebuild(): Promise<void> {
    const entries = await dataSource.listPages()
    const fresh = buildIndex(entries, getOntology())
    // MUST stay synchronous from here to the swap (no await) — see invariants.
    const keep = reconcilePatches(fresh, pendingPatches, Date.now(), PATCH_TTL_MS)
    pendingPatches.length = 0
    pendingPatches.push(...keep)
    liveIndex = fresh
    built = true
  }

  async function ensureBuilt(): Promise<void> {
    if (built) return
    if (!building) building = rebuild().finally(() => (building = null))
    await building
  }

  function same(a: string, b: string) { return a.toLowerCase() === b.toLowerCase() }

  return {
    rebuild,
    async buildGraph(name) { await ensureBuilt(); return queryGraph(liveIndex, name) },
    async nodeAdjacency(names) { await ensureBuilt(); return getAdjacency(liveIndex, names) },
    patchIndex(focus, role, target) {
      if (same(focus, target)) return
      applyEdge(liveIndex, focus, role, target)
      pendingPatches.push({ focus, role, target, ts: Date.now(), kind: 'add' })
    },
    patchRemove(focus, role, target) {
      if (same(focus, target)) return
      removeEdge(liveIndex, focus, role, target)
      pendingPatches.push({ focus, role, target, ts: Date.now(), kind: 'remove' })
    },
  }
}

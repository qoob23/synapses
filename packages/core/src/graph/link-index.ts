import { buildIndex, queryGraph, applyEdge, removeEdge, getAdjacency, reconcilePatches, rolesBetween } from './index-pure'
import type { LinkGraphIndex, Patch } from './index-pure'
import type { DataSource, OntologyConfig, Graph, Adjacency, Role } from '../types'

export const PATCH_TTL_MS = 4000

export interface LinkIndex {
  rebuild(): Promise<void>
  hardReset(): Promise<void>
  buildGraph(name: string): Promise<Graph>
  nodeAdjacency(names: string[]): Promise<Adjacency>
  rolesBetween(focus: string, target: string): Promise<Role[]>
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

  // Escape hatch for wedged index state: drop EVERY pending patch and the live
  // index, then rebuild straight from the editor's current pages. Unlike rebuild(),
  // which replays unconfirmed patches (so a write isn't clobbered by a stale read),
  // hardReset trusts the editor unconditionally — used by the toolbar refresh button
  // to recover when a stuck patch keeps a link from clearing after a manual edit.
  async function hardReset(): Promise<void> {
    pendingPatches.length = 0
    liveIndex = { pages: new Map(), display: new Map() }
    built = false
    building = null
    await rebuild()
  }

  function same(a: string, b: string) { return a.toLowerCase() === b.toLowerCase() }

  return {
    rebuild,
    hardReset,
    async buildGraph(name) { await ensureBuilt(); return queryGraph(liveIndex, name) },
    async nodeAdjacency(names) { await ensureBuilt(); return getAdjacency(liveIndex, names) },
    // Reads the LIVE index (pending patches already applied), so it sees an unconfirmed
    // write before the editor would — the right source of truth for the retype check.
    async rolesBetween(focus, target) { await ensureBuilt(); return rolesBetween(liveIndex, focus, target) },
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

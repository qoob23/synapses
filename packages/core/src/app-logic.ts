// Pure orchestration helpers extracted from mountSynapses (app.ts) so the load-bearing
// navigation/anti-flicker logic can be unit-tested without a live editor or DOM.
import type { Graph } from './types'

// Case-insensitive name equality; both names must be non-empty.
export function sameName(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

// Identity of a rendered graph, used to skip redundant re-renders (the reconcile after a
// write usually rebuilds the same graph, which would otherwise flicker). Case-insensitive
// and order-independent within each link list, so reordering alone is not a "change".
export function graphKey(g: Graph): string {
  const s = (a: string[]) => (a || []).map((x) => x.toLowerCase()).sort().join(',')
  return [g.focus.toLowerCase(), s(g.parents), s(g.children), s(g.jumps), s(g.siblings)].join('|')
}

import { roleForKey } from '../ontology'
import type { Role, Graph, Adjacency, OntologyConfig, PropMap } from '../types'

// ---------------------------------------------------------------------------
// Pure graph queries over page properties.
//
// There is no in-memory index anymore: the editor is the index engine. Links
// are written symmetrically on BOTH pages (parent↔child, jump↔jump), so a note's
// own properties are its complete adjacency — we render a focus note's
// neighborhood by reading its props (plus each parent's props for siblings) on
// demand. Everything here is pure and unit-tested without an editor.
// ---------------------------------------------------------------------------

// Link property values arrive in two shapes depending on the Logseq read path:
//   - getPage().properties pre-splits a link list into an array (["A","B"]);
//   - a block's own .properties gives the RAW string ("[[A]], [[B]]").
// Normalize both to plain target names. For a raw string we extract every
// [[wiki-link]] (non-greedy, so a page name containing a comma survives),
// falling back to a comma split for plain values. Array elements are already
// split, so we only strip their brackets — never re-split them (a name may
// itself contain a comma).
export function toNames(val: unknown): string[] {
  if (val == null) return []
  if (Array.isArray(val)) return val.map((v) => stripBrackets(String(v))).filter(Boolean)
  if (typeof val !== 'string') return [] // link values are arrays (above) or strings
  const s = val.trim()
  if (!s) return []
  const refs = [...s.matchAll(/\[\[(.+?)\]\]/g)].map((m) => m[1].trim())
  if (refs.length) return refs.filter(Boolean)
  return s.split(',').map((v) => stripBrackets(v)).filter(Boolean)
}

function stripBrackets(v: string): string {
  return v.replace(/^\[\[/, '').replace(/\]\]$/, '').trim()
}

// Property values arrive pre-parsed as plain name arrays (the DataSource applies
// `toNames`), so we read them directly rather than re-parsing here. Collects every
// value across all keys that map to `role` under the ontology (alias-aware).
export function collect(props: PropMap, role: Role, ont: OntologyConfig): string[] {
  const out: string[] = []
  for (const key of Object.keys(props || {})) {
    if (roleForKey(key, ont) === role) out.push(...props[key])
  }
  return out
}

// Case-insensitive dedupe that drops `selfLower` and anything `exclude` rejects,
// preserving first-seen display casing and order.
export function uniqNames(names: string[], selfLower: string, exclude?: (lower: string) => boolean): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of names) {
    const l = n.toLowerCase()
    if (l === selfLower || seen.has(l) || exclude?.(l)) continue
    seen.add(l)
    out.push(n)
  }
  return out
}

export const SIBLING_CAP = 50

// A note's own adjacency (parents / children / jumps) read straight from its props.
// Under symmetric writes this is the complete picture — reciprocals are explicit on
// the page, not inferred.
export function adjacencyFromProps(
  name: string,
  props: PropMap,
  ont: OntologyConfig,
): { parents: string[]; children: string[]; jumps: string[] } {
  const f = String(name).toLowerCase()
  return {
    parents: uniqNames(collect(props, 'parent', ont), f),
    children: uniqNames(collect(props, 'child', ont), f),
    jumps: uniqNames(collect(props, 'jump', ont), f),
  }
}

// Build the focus note's full Graph from its own props plus its parents' props.
// `parentsProps` is keyed by LOWERCASED parent name. Siblings = children of my
// parents minus self / my own parents+children, capped at SIBLING_CAP.
export function queryGraphFromProps(
  focusName: string,
  focusProps: PropMap,
  parentsProps: Record<string, PropMap>,
  ont: OntologyConfig,
): Graph {
  const f = String(focusName).toLowerCase()
  const { parents, children, jumps } = adjacencyFromProps(focusName, focusProps, ont)

  const parentSet = new Set(parents.map((p) => p.toLowerCase()))
  const childSet = new Set(children.map((c) => c.toLowerCase()))

  const siblings: string[] = []
  const sibSeen = new Set<string>()
  const siblingParent: Record<string, string> = {}
  for (const p of parents) {
    const pProps = parentsProps[p.toLowerCase()]
    if (!pProps) continue
    for (const c of collect(pProps, 'child', ont)) {
      const l = c.toLowerCase()
      if (l === f || parentSet.has(l) || childSet.has(l) || sibSeen.has(l)) continue
      sibSeen.add(l)
      siblings.push(c)
      siblingParent[c] = p
    }
  }

  return {
    focus: focusName,
    parents,
    children,
    jumps,
    siblings: siblings.slice(0, SIBLING_CAP),
    siblingsTruncated: siblings.length > SIBLING_CAP,
    siblingParent,
  }
}

// Per-note adjacency map for a set of names (pure). Keyed by LOWERCASED name;
// values are read from each note's own props (symmetric → complete).
export function adjacencyFor(
  entries: Array<{ name: string; props: PropMap }>,
  ont: OntologyConfig,
): Adjacency {
  const out: Adjacency = {}
  for (const { name, props } of entries) {
    out[String(name).toLowerCase()] = adjacencyFromProps(name, props, ont)
  }
  return out
}

import { roleForKey } from '../ontology'
import type { Role, Graph, Adjacency, OntologyConfig, PageEntry, PropMap } from '../types'

// ---------------------------------------------------------------------------
// Internal index shapes
// ---------------------------------------------------------------------------

export interface NodeEntry {
  parents: Set<string>
  children: Set<string>
  jumps: Set<string>
}

export interface LinkGraphIndex {
  pages: Map<string, NodeEntry>
  display: Map<string, string>
}

export interface Patch {
  focus: string
  role: Role
  target: string
  ts: number
  kind: 'add' | 'remove'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Property values that are wiki-links come back as page-name strings (or arrays);
// strip any stray [[ ]] just in case. Kept here for the Logseq DataSource, which
// pre-parses raw property values into the plain name arrays the index consumes.
export function toNames(val: unknown): string[] {
  if (val == null) return []
  const arr = Array.isArray(val) ? val : [val]
  return arr
    .map((v) => String(v).replace(/^\[\[/, '').replace(/\]\]$/, '').trim())
    .filter(Boolean)
}

// Property values arrive pre-parsed as plain name arrays (the DataSource applies
// `toNames`), so we read them directly rather than re-parsing here.
function collect(props: PropMap, role: Role, ont: OntologyConfig): string[] {
  const out: string[] = []
  for (const key of Object.keys(props || {})) {
    if (roleForKey(key, ont) === role) out.push(...props[key])
  }
  return out
}

// ---------------------------------------------------------------------------
// Pure index build + query (unit-tested without Logseq)
// ---------------------------------------------------------------------------

export const SIBLING_CAP = 50

function emptyNode(): NodeEntry {
  return { parents: new Set(), children: new Set(), jumps: new Set() }
}

// entries: [{ name, props }]. Returns { pages: Map<lower, entry>, display: Map<lower, original> }
// with reciprocals already applied (declaring one side fills the other).
export function buildIndex(entries: PageEntry[], ont: OntologyConfig): LinkGraphIndex {
  const pages = new Map<string, NodeEntry>()
  const display = new Map<string, string>()

  const see = (name: string): string => {
    const l = String(name).toLowerCase()
    if (!display.has(l)) display.set(l, name)
    if (!pages.has(l)) pages.set(l, emptyNode())
    return l
  }
  const link = (aName: string, bName: string, role: Role): void => {
    const a = see(aName)
    const b = see(bName)
    if (a === b) return
    if (role === 'parent') {
      pages.get(a)!.parents.add(b)
      pages.get(b)!.children.add(a)
    } else if (role === 'child') {
      pages.get(a)!.children.add(b)
      pages.get(b)!.parents.add(a)
    } else {
      pages.get(a)!.jumps.add(b)
      pages.get(b)!.jumps.add(a)
    }
  }

  for (const { name, props } of entries) {
    see(name)
    for (const p of collect(props, 'parent', ont)) link(name, p, 'parent')
    for (const c of collect(props, 'child', ont)) link(name, c, 'child')
    for (const j of collect(props, 'jump', ont)) link(name, j, 'jump')
  }

  return { pages, display }
}

export function queryGraph(index: LinkGraphIndex, focusName: string): Graph {
  const { pages, display } = index
  const f = String(focusName).toLowerCase()
  const disp = (l: string): string => display.get(l) || l
  const e = pages.get(f) || emptyNode()

  // Siblings = children of my parents minus self / my own parents+children.
  const siblings = new Set<string>()
  const siblingParent: Record<string, string> = {}
  for (const p of e.parents) {
    const pe = pages.get(p)
    if (!pe) continue
    for (const c of pe.children) {
      if (c === f || e.parents.has(c) || e.children.has(c) || siblings.has(c)) continue
      siblings.add(c)
      siblingParent[disp(c)] = disp(p)
    }
  }
  const sib = [...siblings]

  return {
    focus: disp(f),
    parents: [...e.parents].map(disp),
    children: [...e.children].map(disp),
    jumps: [...e.jumps].map(disp),
    siblings: sib.slice(0, SIBLING_CAP).map(disp),
    siblingsTruncated: sib.length > SIBLING_CAP,
    siblingParent,
  }
}

// ---------------------------------------------------------------------------
// Edge mutations (pure — operate on a passed-in index)
// ---------------------------------------------------------------------------

export function applyEdge(index: LinkGraphIndex, focusName: string, role: Role, targetName: string): void {
  const see = (name: string): string => {
    const l = String(name).toLowerCase()
    if (!index.display.has(l)) index.display.set(l, name)
    if (!index.pages.has(l)) index.pages.set(l, emptyNode())
    return l
  }
  const a = see(focusName)
  const b = see(targetName)
  if (a === b) return
  if (role === 'parent') {
    index.pages.get(a)!.parents.add(b)
    index.pages.get(b)!.children.add(a)
  } else if (role === 'child') {
    index.pages.get(a)!.children.add(b)
    index.pages.get(b)!.parents.add(a)
  } else {
    index.pages.get(a)!.jumps.add(b)
    index.pages.get(b)!.jumps.add(a)
  }
}

export function removeEdge(index: LinkGraphIndex, focusName: string, role: Role, targetName: string): void {
  const a = String(focusName).toLowerCase()
  const b = String(targetName).toLowerCase()
  const ea = index.pages.get(a)
  const eb = index.pages.get(b)
  if (role === 'parent') {
    if (ea) ea.parents.delete(b)
    if (eb) eb.children.delete(a)
  } else if (role === 'child') {
    if (ea) ea.children.delete(b)
    if (eb) eb.parents.delete(a)
  } else {
    if (ea) ea.jumps.delete(b)
    if (eb) eb.jumps.delete(a)
  }
}

export function hasEdge(index: LinkGraphIndex, focusName: string, role: Role, targetName: string): boolean {
  const e = index.pages.get(String(focusName).toLowerCase())
  if (!e) return false
  const t = String(targetName).toLowerCase()
  if (role === 'parent') return e.parents.has(t)
  if (role === 'child') return e.children.has(t)
  return e.jumps.has(t)
}

// Which roles currently connect `focus` to `target`, read from `focus`'s adjacency
// (already reciprocal-resolved by buildIndex/applyEdge). Normally one role, but a pair
// in the buggy multi-role state returns several — the caller collapses them. [] when the
// pair is unconnected or `focus` is absent from the index.
export function rolesBetween(index: LinkGraphIndex, focusName: string, targetName: string): Role[] {
  const e = index.pages.get(String(focusName).toLowerCase())
  if (!e) return []
  const t = String(targetName).toLowerCase()
  const out: Role[] = []
  if (e.parents.has(t)) out.push('parent')
  if (e.children.has(t)) out.push('child')
  if (e.jumps.has(t)) out.push('jump')
  return out
}

// Pure: re-apply the patches a fresh read hasn't confirmed yet onto `fresh`,
// dropping ones the read now confirms or that have outlived the settle window.
// Mutates `fresh` (adds the surviving edges) and returns the patches to keep.
// Kept pure (no module state, `now`/`ttl` injected) so this replay loop — the
// exact logic behind the "edge appears then disappears" race — is unit-testable.
export function reconcilePatches(fresh: LinkGraphIndex, patches: Patch[], now: number, ttl: number): Patch[] {
  const keep: Patch[] = []
  for (const op of patches) {
    const present = hasEdge(fresh, op.focus, op.role, op.target)
    if (op.kind === 'remove') {
      if (!present) continue // read confirms the removal
      if (now - op.ts > ttl) continue // settled — let a re-add win
      removeEdge(fresh, op.focus, op.role, op.target)
      keep.push(op)
    } else {
      if (present) continue // confirmed by read
      if (now - op.ts > ttl) continue // settled — let external edits win
      applyEdge(fresh, op.focus, op.role, op.target)
      keep.push(op)
    }
  }
  return keep
}

// Per-thought arrays of linked thoughts from an index (pure). Keyed by LOWERCASED name;
// values are DISPLAY-cased. Names absent from the index are omitted.
export function getAdjacency(index: LinkGraphIndex, names: string[]): Adjacency {
  const out: Adjacency = {}
  for (const name of names || []) {
    const l = String(name).toLowerCase()
    const e = index.pages.get(l)
    if (!e) continue
    const disp = (s: string): string => index.display.get(s) || s
    out[l] = {
      parents: [...e.parents].map(disp),
      children: [...e.children].map(disp),
      jumps: [...e.jumps].map(disp),
    }
  }
  return out
}

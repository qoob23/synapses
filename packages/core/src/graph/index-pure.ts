import { roleForKey } from '../ontology'
import type { Role, Graph, Adjacency, OntologyConfig, PropMap, PageEntry } from '../types'

// ---------------------------------------------------------------------------
// Pure graph queries over page properties.
//
// There is no in-memory index anymore: the editor is the index engine. Writes
// are single-sided (the link is declared only on the note the user touched), so
// a note's own props are NOT its full adjacency on their own — incoming links are
// merged back in at read time by `reconcileNoteAdjacency` (below). We render a
// focus note's neighborhood by reconciling its props with its backlinks (plus
// each parent's for siblings) on demand. Everything here is pure and unit-tested
// without an editor.
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

export type NoteAdjacency = { parents: string[]; children: string[]; jumps: string[] }

// A note's own adjacency (parents / children / jumps) read straight from its props.
// This is the OUTGOING half only; incoming links are merged in by reconcileNoteAdjacency.
export function adjacencyFromProps(
  name: string,
  props: PropMap,
  ont: OntologyConfig,
): NoteAdjacency {
  const f = String(name).toLowerCase()
  return {
    parents: uniqNames(collect(props, 'parent', ont), f),
    children: uniqNames(collect(props, 'child', ont), f),
    jumps: uniqNames(collect(props, 'jump', ont), f),
  }
}

// Assemble the focus note's Graph from its own reconciled adjacency plus its
// reconciled parents' adjacencies. `parentsAdj` keyed by LOWERCASED parent name.
// Siblings = children of my parents minus self / own parents+children, capped at SIBLING_CAP.
export function assembleGraph(
  focusName: string,
  focusAdj: NoteAdjacency,
  parentsAdj: Record<string, NoteAdjacency>,
): Graph {
  const f = String(focusName).toLowerCase()
  const { parents, children, jumps } = focusAdj
  const parentSet = new Set(parents.map((p) => p.toLowerCase()))
  const childSet = new Set(children.map((c) => c.toLowerCase()))
  const siblings: string[] = []
  const sibSeen = new Set<string>()
  const siblingParent: Record<string, string> = {}
  for (const p of parents) {
    const pAdj = parentsAdj[p.toLowerCase()]
    if (!pAdj) continue
    for (const c of pAdj.children) {
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

// Build the focus note's full Graph from its own props plus its parents' props.
// `parentsProps` is keyed by LOWERCASED parent name. Delegates to assembleGraph.
export function queryGraphFromProps(
  focusName: string,
  focusProps: PropMap,
  parentsProps: Record<string, PropMap>,
  ont: OntologyConfig,
): Graph {
  const focusAdj = adjacencyFromProps(focusName, focusProps, ont)
  const parentsAdj: Record<string, NoteAdjacency> = {}
  for (const [k, props] of Object.entries(parentsProps)) {
    parentsAdj[k.toLowerCase()] = adjacencyFromProps(k, props, ont)
  }
  return assembleGraph(focusName, focusAdj, parentsAdj)
}

// Per-note adjacency map for a set of names (pure). Keyed by LOWERCASED name;
// values are each note's own (outgoing) props — incoming links are not merged here.
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

// ---------------------------------------------------------------------------
// Read-time link reconciliation.
//
// Writes are single-sided, so a connection may be declared on only one of the two
// notes. To render the full picture we merge each note's own props with its
// backlinks: every declared link (in either direction) is collected into pairs,
// and each pair is resolved to ONE winning role — structural (parent/child) beats
// jump; opposing structural directions resolve to the alphabetically-first page's
// claim. The result is symmetric adjacency derived purely from what's on disk.
// ---------------------------------------------------------------------------

const ROLES: Role[] = ['parent', 'child', 'jump']

// One structural claim: page `by` asserts that `parent` is the parent of the pair.
interface StructClaim { by: string; parent: string }
interface PairClaims { members: [string, string]; hasJump: boolean; struct: StructClaim[] }
type DesiredRoles = Record<Role, Map<string, string>> // role -> (lower target -> display target)

// When both pages assert conflicting structural directions, pick a parent by priority:
// the alphabetically-first page's assertion, then the second page's, then a fallback.
function pickStructuralParent(members: [string, string], struct: StructClaim[]): string {
  const [m0, m1] = members
  const first = m0 < m1 ? m0 : m1
  const second = first === m0 ? m1 : m0
  const firstAssert = new Set(struct.filter((s) => s.by === first).map((s) => s.parent))
  const secondAssert = new Set(struct.filter((s) => s.by === second).map((s) => s.parent))
  if (firstAssert.size === 1) return [...firstAssert][0]
  if (secondAssert.size === 1) return [...secondAssert][0]
  return first
}

// Collapse a pair's competing claims to one winner. Structural beats jump; on opposing
// structural directions the alphabetically-first page's assertion wins.
function resolvePair(p: PairClaims): { role: 'jump' } | { role: 'struct'; parent: string; child: string } | null {
  const structParents = new Set(p.struct.map((s) => s.parent))
  if (structParents.size === 0) return p.hasJump ? { role: 'jump' } : null
  const parent = structParents.size === 1 ? [...structParents][0] : pickStructuralParent(p.members, p.struct)
  const [m0, m1] = p.members
  return { role: 'struct', parent, child: parent === m0 ? m1 : m0 }
}

function getOrCreatePair(pairs: Map<string, PairClaims>, a: string, b: string): PairClaims {
  const [x, y] = a < b ? [a, b] : [b, a]
  const key = `${x} ${y}`
  let e = pairs.get(key)
  if (!e) { e = { members: [x, y], hasJump: false, struct: [] }; pairs.set(key, e) }
  return e
}

function recordLink(
  aLower: string, role: Role, target: string,
  pairs: Map<string, PairClaims>, display: Map<string, string>,
): void {
  const tLower = target.toLowerCase()
  if (tLower === aLower) return
  if (!display.has(tLower)) display.set(tLower, target) // referenced-but-uncreated
  const pair = getOrCreatePair(pairs, aLower, tLower)
  if (role === 'jump') pair.hasJump = true
  else pair.struct.push({ by: aLower, parent: role === 'parent' ? tLower : aLower })
}

// Scan every page's declared links and build a map of unique pairs.
// Mutates `display` to register referenced-but-uncreated targets.
function buildPairMap(pages: PageEntry[], display: Map<string, string>, ont: OntologyConfig): Map<string, PairClaims> {
  const pairs = new Map<string, PairClaims>()
  for (const p of pages) {
    const aLower = p.name.toLowerCase()
    for (const role of ROLES) {
      for (const target of collect(p.props, role, ont)) recordLink(aLower, role, target, pairs, display)
    }
  }
  return pairs
}

// Resolve each pair to a single winning role and record the desired target sets
// for every page that appears in at least one pair.
function buildDesiredRoles(pairs: Map<string, PairClaims>, display: Map<string, string>): Map<string, DesiredRoles> {
  const desired = new Map<string, DesiredRoles>()
  const emptyRoles = (): DesiredRoles => ({ parent: new Map(), child: new Map(), jump: new Map() })
  const bucket = (lower: string): DesiredRoles => {
    let e = desired.get(lower)
    if (!e) { e = emptyRoles(); desired.set(lower, e) }
    return e
  }
  const keep = (pageLower: string, role: Role, targetLower: string) =>
    bucket(pageLower)[role].set(targetLower, display.get(targetLower) ?? targetLower)
  for (const pair of pairs.values()) {
    const win = resolvePair(pair)
    if (!win) continue
    const [m0, m1] = pair.members
    bucket(m0); bucket(m1) // ensure both sides reconcile removal-only roles too
    if (win.role === 'jump') { keep(m0, 'jump', m1); keep(m1, 'jump', m0) }
    else { keep(win.parent, 'child', win.child); keep(win.child, 'parent', win.parent) }
  }
  return desired
}

// Reconcile a set of pages (no disk writes): resolve each connected pair to a
// single winning role and return a map of NoteAdjacency (one per lowercased page
// name that appears in any pair).
export function reconcileGraph(pages: PageEntry[], ont: OntologyConfig): Map<string, NoteAdjacency> {
  const display = new Map<string, string>()
  for (const p of pages) {
    const l = p.name.toLowerCase()
    if (!display.has(l)) display.set(l, p.name)
  }
  const pairs = buildPairMap(pages, display, ont)
  const desired = buildDesiredRoles(pairs, display)
  const out = new Map<string, NoteAdjacency>()
  for (const [lower, roles] of desired) {
    out.set(lower, {
      parents: [...roles.parent.values()],
      children: [...roles.child.values()],
      jumps: [...roles.jump.values()],
    })
  }
  return out
}

// Reconcile a single focus note against its backlinkers. Returns the focus's
// adjacency seen from both directions merged (empty if it has no pairs).
export function reconcileNoteAdjacency(
  name: string,
  ownProps: PropMap,
  backlinkers: PageEntry[],
  ont: OntologyConfig,
): NoteAdjacency {
  const map = reconcileGraph([{ name, props: ownProps }, ...backlinkers], ont)
  return map.get(name.toLowerCase()) ?? { parents: [], children: [], jumps: [] }
}

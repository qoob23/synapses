import { collect, type NoteAdjacency } from './graph/index-pure'
import { log } from './log'
import { normalizeKey, roleForKey } from './ontology'
import type { DataSource, OntologyConfig, PageEntry, PropMap, Role } from './types'

const ROLES: Role[] = ['parent', 'child', 'jump']

// A single property mutation the migration applies to one page's key.
export type RepairOp =
  | { kind: 'set'; page: string; key: string; targets: string[] }
  | { kind: 'remove'; page: string; key: string }

// One structural claim: page `by` asserts that `parent` is the parent of the pair.
interface StructClaim { by: string; parent: string }
interface PairClaims { members: [string, string]; hasJump: boolean; struct: StructClaim[] }
type DesiredRoles = Record<Role, Map<string, string>> // role -> (lower target -> display target)

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

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

// Phase 1 → Phase 2: scan every page's declared links and build a map of unique pairs.
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

// Phase 3: resolve each pair to a single winning role and record the desired target sets
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

// Phase 4: diff the desired target sets against what is currently on disk and emit the
// minimal set of mutations (only changed roles; alias keys for a changed role are removed).
function buildRepairOps(
  desired: Map<string, DesiredRoles>,
  propsByName: Map<string, PropMap>,
  display: Map<string, string>,
  ont: OntologyConfig,
): RepairOp[] {
  const ops: RepairOp[] = []
  for (const [pLower, roles] of desired) {
    const props = propsByName.get(pLower) ?? {}
    const pageDisplay = display.get(pLower) ?? pLower
    for (const role of ROLES) {
      const desiredMap = roles[role]
      const desiredSet = new Set(desiredMap.keys())
      const currentSet = new Set(collect(props, role, ont).map((n) => n.toLowerCase()))
      if (sameSet(desiredSet, currentSet)) continue
      for (const k of Object.keys(props)) {
        if (roleForKey(k, ont) === role && normalizeKey(k) !== role) ops.push({ kind: 'remove', page: pageDisplay, key: k })
      }
      const targets = [...desiredMap.values()]
      if (targets.length) ops.push({ kind: 'set', page: pageDisplay, key: role, targets })
      else ops.push({ kind: 'remove', page: pageDisplay, key: role })
    }
  }
  return ops
}

// Pure. Normalize the link graph so every connected pair has exactly ONE symmetric
// connection. Returns the MINIMAL set of mutations: consistent pages are left untouched;
// only pages/roles whose target set actually changes are rewritten (canonical role-named
// key written, that role's alias keys dropped).
export function computeSymmetryRepairs(pages: PageEntry[], ont: OntologyConfig): RepairOp[] {
  const propsByName = new Map<string, PropMap>()
  const display = new Map<string, string>()
  for (const p of pages) {
    const l = p.name.toLowerCase()
    propsByName.set(l, p.props)
    if (!display.has(l)) display.set(l, p.name)
  }
  const pairs = buildPairMap(pages, display, ont)
  const desired = buildDesiredRoles(pairs, display)
  return buildRepairOps(desired, propsByName, display, ont)
}

// Read-time reconciliation for a set of pages (no disk writes). Same pair
// resolution as computeSymmetryRepairs but returns a map of NoteAdjacency
// (one per lowercased page name that appears in any pair) rather than repair ops.
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

// Reconcile single focus note against backlinkers. Returns focus's
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

// Impure runner: enumerate, compute, apply. Returns the number of ops applied.
export async function runSymmetryRepair(ds: DataSource, ont: OntologyConfig): Promise<number> {
  if (!ds.listAllPages) return 0
  const pages = await ds.listAllPages()
  const ops = computeSymmetryRepairs(pages, ont)
  for (const op of ops) {
    try {
      if (op.kind === 'set') { await ds.ensurePage(op.page); await ds.setPropertyLinks(op.page, op.key, op.targets) }
      else await ds.removePropertyKey(op.page, op.key)
    } catch (e) { log.warn('symmetry repair op failed', op.page, op.key, e) }
  }
  return ops.length
}

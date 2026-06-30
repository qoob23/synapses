# Show All Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the view show every connection a note participates in — including links declared only on the *other* note — by reconciling each note's own properties with its backlinks at read time.

**Architecture:** Writes stay single-sided. Reads reconcile: for any note we read its own props plus its backlinks (notes pointing at it) and resolve each pair to one kind using the existing migration precedence (`resolvePair` in `migrate.ts`). The focus's reconciled adjacency equals what the migration would have written, without touching disk. A new optional `DataSource.getBacklinks` seam supplies the incoming references; absence falls back to today's own-props-only behavior.

**Tech Stack:** TypeScript (strict, `verbatimModuleSyntax`), vitest, ESLint type-aware. Logseq `@logseq/libs`, Obsidian + Dataview.

## Global Constraints

- `packages/core` stays editor-agnostic: no `@logseq/libs`, no `from 'obsidian'`, no `from 'node:'`.
- No `any` outside `transport.ts`; model external types.
- Type-only imports use `import { type X }` (`verbatimModuleSyntax`).
- No caching / no in-memory index — reads are on-demand.
- Conflict resolution is the existing migration precedence: structural beats jump; opposing structural → alphabetically-first page wins; one connector per pair.
- Per-package fast checks: `npx tsc -b packages/<pkg>`, `npx eslint packages/<pkg>/src/<file>`, `npx vitest run <file>`. Full gate before final commit: `npm run typecheck && npm test && npm run lint && npm run knip && npm run build`.

---

### Task 1: Extract `assembleGraph` (reconciled-adjacency → Graph)

Pull the sibling-assembly logic out of `queryGraphFromProps` so it can run on *reconciled* adjacencies (not just raw props). `queryGraphFromProps` is re-implemented on top of it — behavior unchanged, existing tests stay green.

**Files:**
- Modify: `packages/core/src/graph/index-pure.ts`
- Test: `packages/core/src/graph/index-pure.test.ts` (add a case; keep existing green)

**Interfaces:**
- Consumes: existing `adjacencyFromProps`, `uniqNames`, `SIBLING_CAP`, types `Graph`, `Adjacency`, `OntologyConfig`, `PropMap`.
- Produces: `assembleGraph(focusName: string, focusAdj: NoteAdjacency, parentsAdj: Record<string, NoteAdjacency>): Graph` where `type NoteAdjacency = { parents: string[]; children: string[]; jumps: string[] }`. `parentsAdj` is keyed by **lowercased** parent name.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/graph/index-pure.test.ts`:

```ts
import { assembleGraph } from './index-pure'

it('assembleGraph computes siblings from reconciled parent adjacencies', () => {
  const g = assembleGraph(
    'A',
    { parents: ['P'], children: [], jumps: [] },
    { p: { parents: [], children: ['A', 'B'], jumps: [] } },
  )
  expect(g.parents).toEqual(['P'])
  expect(g.siblings).toEqual(['B'])
  expect(g.siblingParent).toEqual({ B: 'P' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/graph/index-pure.test.ts -t assembleGraph`
Expected: FAIL — `assembleGraph` is not exported / not a function.

- [ ] **Step 3: Implement `assembleGraph` and delegate `queryGraphFromProps` to it**

In `packages/core/src/graph/index-pure.ts`, add the exported type and function, and rewrite `queryGraphFromProps` to build adjacencies then call `assembleGraph`. Use the existing sibling logic verbatim (dedupe against self + own parents/children, cap at `SIBLING_CAP`, set `siblingParent`, `siblingsTruncated`):

```ts
export type NoteAdjacency = { parents: string[]; children: string[]; jumps: string[] }

// Assemble a focus note's Graph from its own reconciled adjacency plus its
// reconciled parents' adjacencies. `parentsAdj` keyed by LOWERCASED parent name.
// Siblings = children of my parents minus self / my own parents+children, capped.
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
  const siblingParent: Record<string, string> = {}
  const sibSeen = new Set<string>()
  for (const p of parents) {
    const kids = parentsAdj[p.toLowerCase()]?.children ?? []
    for (const c of kids) {
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
```

Remove the now-dead inline sibling code that previously lived in `queryGraphFromProps` (the old `parentSet`/`childSet`/`siblings` block) — it has moved into `assembleGraph`.

- [ ] **Step 4: Run tests to verify pass (new + existing)**

Run: `npx vitest run packages/core/src/graph/index-pure.test.ts`
Expected: PASS — the new `assembleGraph` test and all pre-existing `queryGraphFromProps` tests.

Run: `npx tsc -b packages/core && npx eslint packages/core/src/graph/index-pure.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/graph/index-pure.ts packages/core/src/graph/index-pure.test.ts
git commit -m "refactor(core): extract assembleGraph from queryGraphFromProps"
```

---

### Task 2: Pure `reconcileGraph` / `reconcileNoteAdjacency`

Expose the migration's pair-resolution machinery as a read-time adjacency reconciler. Reuses `buildPairMap` + `buildDesiredRoles` (already in `migrate.ts`), so there is no duplicate precedence logic.

**Files:**
- Modify: `packages/core/src/migrate.ts`
- Test: `packages/core/src/migrate.test.ts` (add cases)

**Interfaces:**
- Consumes: existing module-private `buildPairMap`, `buildDesiredRoles`; types `PageEntry`, `OntologyConfig`, `PropMap`. The `NoteAdjacency` type from Task 1 (import it: `import { type NoteAdjacency } from './graph/index-pure'`).
- Produces:
  - `reconcileGraph(pages: PageEntry[], ont: OntologyConfig): Map<string, NoteAdjacency>` — per-page reconciled adjacency keyed by **lowercased** name, values are **display**-name arrays. Pages with no pairs are absent from the map.
  - `reconcileNoteAdjacency(name: string, ownProps: PropMap, backlinkers: PageEntry[], ont: OntologyConfig): NoteAdjacency` — convenience wrapper returning the focus's bucket or `{ parents: [], children: [], jumps: [] }`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/migrate.test.ts`:

```ts
import { reconcileNoteAdjacency } from './migrate'

const ONT = { parent: ['parent'], child: ['child'], jump: ['jump'] }

it('reconcileNoteAdjacency surfaces an incoming-only parent', () => {
  // B declares A as its child; A declares nothing. A should see B as a parent.
  const adj = reconcileNoteAdjacency('A', {}, [{ name: 'B', props: { child: ['A'] } }], ONT)
  expect(adj.parents).toEqual(['B'])
  expect(adj.children).toEqual([])
})

it('reconcileNoteAdjacency: structural beats an opposing jump (migration precedence)', () => {
  // A says jump:: B; B says child:: A (=> A is B's child => A sees B as parent). Structural wins.
  const adj = reconcileNoteAdjacency('A', { jump: ['B'] }, [{ name: 'B', props: { child: ['A'] } }], ONT)
  expect(adj.parents).toEqual(['B'])
  expect(adj.jumps).toEqual([])
})

it('reconcileNoteAdjacency: incoming-only jump appears', () => {
  const adj = reconcileNoteAdjacency('A', {}, [{ name: 'B', props: { jump: ['A'] } }], ONT)
  expect(adj.jumps).toEqual(['B'])
})

it('reconcileNoteAdjacency: no pairs => empty adjacency', () => {
  expect(reconcileNoteAdjacency('A', {}, [], ONT)).toEqual({ parents: [], children: [], jumps: [] })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/src/migrate.test.ts -t reconcileNoteAdjacency`
Expected: FAIL — `reconcileNoteAdjacency` is not exported.

- [ ] **Step 3: Implement the reconcilers in `migrate.ts`**

Add near the top (after imports): `import { type NoteAdjacency } from './graph/index-pure'`.
Add these exported functions (place them after `buildDesiredRoles`, before `buildRepairOps`):

```ts
// Read-time reconciliation: resolve every pair among `pages` to one winning role
// (same precedence as the symmetry migration) and return each page's adjacency.
// Keyed by lowercased name; values are display-name arrays. Pages with no pairs absent.
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
// adjacency as seen with both directions merged (empty if it has no pairs).
export function reconcileNoteAdjacency(
  name: string,
  ownProps: PropMap,
  backlinkers: PageEntry[],
  ont: OntologyConfig,
): NoteAdjacency {
  const map = reconcileGraph([{ name, props: ownProps }, ...backlinkers], ont)
  return map.get(name.toLowerCase()) ?? { parents: [], children: [], jumps: [] }
}
```

- [ ] **Step 4: Run tests + checks**

Run: `npx vitest run packages/core/src/migrate.test.ts`
Expected: PASS — new `reconcileNoteAdjacency` cases and all existing `computeSymmetryRepairs` cases.

Run: `npx tsc -b packages/core && npx eslint packages/core/src/migrate.ts`
Expected: no errors. (If `import/no-cycle` flags the `index-pure` import: `migrate.ts` already imports `collect` from `./graph/index-pure`, so the type-only import adds no new cycle — confirm eslint is clean.)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/migrate.ts packages/core/src/migrate.test.ts
git commit -m "feat(core): reconcileGraph/reconcileNoteAdjacency read-time link reconciliation"
```

---

### Task 3: Wire reconciliation into the backend + `getBacklinks` seam

Add the optional seam method to `DataSource`, and make `buildGraph` / `nodeAdjacency` reconcile. Fall back to own-props-only when `getBacklinks` is absent.

**Files:**
- Modify: `packages/core/src/types.ts` (add `getBacklinks?`)
- Modify: `packages/core/src/backend.ts` (`buildGraph`, `nodeAdjacency`)
- Test: `packages/core/src/backend.test.ts` (extend `fakes`, add cases)

**Interfaces:**
- Consumes: `reconcileNoteAdjacency` (Task 2), `assembleGraph` + `NoteAdjacency` (Task 1).
- Produces: `DataSource.getBacklinks?(name: string): Promise<PageEntry[]>` — referencing notes (name + link props). Backend behavior: when undefined, reconciliation receives `[]` backlinkers (identity → today's behavior).

- [ ] **Step 1: Write the failing tests**

First extend the `fakes` helper in `packages/core/src/backend.test.ts` so the fake `ds` derives backlinks from its in-memory map (any page whose props reference `name`). Add inside the `ds` object literal (after `searchPages`):

```ts
    getBacklinks: async (name: string) => {
      const target = name.toLowerCase()
      const out: PageEntry[] = []
      for (const p of map.values()) {
        if (p.name.toLowerCase() === target) continue
        const refs = Object.values(p.props).flat().map((v) => v.toLowerCase())
        if (refs.includes(target)) out.push(p)
      }
      return out
    },
```

Then add these cases to the `describe('createCoreBackend', …)` block:

```ts
it('buildGraph surfaces an asymmetric incoming link (declared only on the other note)', async () => {
  // B says child:: A; A declares nothing. A should still see B as a parent.
  const { ds, services } = fakes([
    { name: 'A', props: {} },
    { name: 'B', props: { child: ['A'] } },
  ])
  const be = createCoreBackend(ds, services)
  expect((await be.buildGraph('A')).parents).toEqual(['B'])
})

it('buildGraph: fully-reconciled siblings (sibling declares parent only on its own side)', async () => {
  // P has child A. B says parent:: P but P does NOT list B. B must still be A's sibling.
  const { ds, services } = fakes([
    { name: 'P', props: { child: ['A'] } },
    { name: 'A', props: { parent: ['P'] } },
    { name: 'B', props: { parent: ['P'] } },
  ])
  const be = createCoreBackend(ds, services)
  expect((await be.buildGraph('A')).siblings).toEqual(['B'])
})

it('nodeAdjacency reconciles incoming links', async () => {
  const { ds, services } = fakes([
    { name: 'A', props: {} },
    { name: 'B', props: { child: ['A'] } },
  ])
  const be = createCoreBackend(ds, services)
  const adj = await be.nodeAdjacency(['A'])
  expect(adj.a.parents).toEqual(['B'])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/src/backend.test.ts -t "asymmetric incoming"`
Expected: FAIL — `buildGraph('A').parents` is `[]` (current code reads A's own props only).

- [ ] **Step 3: Add the seam type**

In `packages/core/src/types.ts`, inside `interface DataSource`, add after `searchPages`:

```ts
  // Notes that reference `name` (via any link), each with its link-valued props.
  // Read-path uses this to surface links declared only on the OTHER note. Optional:
  // when absent the backend reconciles against no backlinks (own-props-only behavior).
  getBacklinks?(name: string): Promise<PageEntry[]>
```

- [ ] **Step 4: Reconcile in the backend**

In `packages/core/src/backend.ts`:

Update imports — replace the `index-pure` import line with:

```ts
import { assembleGraph, collect, reconcileNoteAdjacency, uniqNames } from './graph/index-pure'
```

Wait — `reconcileNoteAdjacency` lives in `./migrate`, and `assembleGraph` in `./graph/index-pure`. Use two imports:

```ts
import { assembleGraph, collect, uniqNames } from './graph/index-pure'
import { runSymmetryRepair, reconcileNoteAdjacency } from './migrate'
```

(`queryGraphFromProps` / `adjacencyFromProps` are no longer used by the backend — drop them from the import.)

Replace `buildGraph` and `nodeAdjacency` with reconciling versions:

```ts
  // On-demand reconciled neighborhood reads (no in-memory index). A note's links =
  // its own props reconciled with its backlinks (notes pointing at it), so links
  // declared only on the OTHER note still show. Siblings need each parent fully
  // reconciled too, so we backlink-read each parent. Conflict resolution = the
  // symmetry-migration precedence (structural beats jump; opposing → alphabetical).
  async function reconcile(name: string): Promise<{ parents: string[]; children: string[]; jumps: string[] }> {
    const ont = getOntology()
    const [own, back] = await Promise.all([
      dataSource.getPageProps(name),
      dataSource.getBacklinks ? dataSource.getBacklinks(name) : Promise.resolve([]),
    ])
    return reconcileNoteAdjacency(name, own, back, ont)
  }
  async function buildGraph(name: string) {
    const focusAdj = await reconcile(name)
    const parentsAdj: Record<string, { parents: string[]; children: string[]; jumps: string[] }> = {}
    await Promise.all(focusAdj.parents.map(async (p) => { parentsAdj[p.toLowerCase()] = await reconcile(p) }))
    return assembleGraph(name, focusAdj, parentsAdj)
  }
  async function nodeAdjacency(names: string[]): Promise<Adjacency> {
    const out: Adjacency = {}
    await Promise.all((names || []).map(async (n) => { out[n.toLowerCase()] = await reconcile(n) }))
    return out
  }
```

If `collect` / `uniqNames` are now unused in `backend.ts` after this change, remove them from the import to satisfy lint/knip. (Verify with the eslint run in Step 6.)

- [ ] **Step 5: Run the backend tests**

Run: `npx vitest run packages/core/src/backend.test.ts`
Expected: PASS — the three new cases plus all pre-existing ones (the original symmetric-write tests still hold: when both sides are written, reconciliation is idempotent).

- [ ] **Step 6: Typecheck + lint core**

Run: `npx tsc -b packages/core && npx eslint packages/core/src/backend.ts packages/core/src/types.ts`
Expected: no errors, no unused-import warnings.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/backend.ts packages/core/src/backend.test.ts
git commit -m "feat(core): reconcile own props with backlinks in buildGraph/nodeAdjacency"
```

---

### Task 4: Logseq `getBacklinks` implementation

**Files:**
- Modify: `packages/logseq-plugin/src/datasource.ts`

**Interfaces:**
- Consumes: `DataSource.getBacklinks` (Task 3); existing `getPagePropsRaw`.
- Produces: a Logseq `getBacklinks` reading `logseq.Editor.getPageLinkedReferences`.

- [ ] **Step 1: Implement `getBacklinks`**

In `packages/logseq-plugin/src/datasource.ts`, add to the object returned by `createLogseqDataSource()` (after `getPageProps`):

```ts
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
```

`getPageLinkedReferences` is typed as `Promise<Array<[PageEntity, BlockEntity[]]> | null>` in `@logseq/libs`; the existing `BlockEntity` / `PageEntity` imports cover the tuple. `getPagePropsRaw` already re-reads the live block tree, so a page that only mentions `name` in body text yields no link property and is harmlessly ignored by reconciliation.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc -b packages/logseq-plugin && npx eslint packages/logseq-plugin/src/datasource.ts`
Expected: no errors.

> No unit test: the Logseq datasource needs a live editor (per CLAUDE.md, no headless harness). Verified by typecheck/lint here and manual load in Task 6's gate.

- [ ] **Step 3: Commit**

```bash
git add packages/logseq-plugin/src/datasource.ts
git commit -m "feat(logseq): getBacklinks via getPageLinkedReferences"
```

---

### Task 5: Obsidian `getBacklinks` implementation

**Files:**
- Modify: `packages/obsidian-plugin/src/datasource.ts`
- Modify: `packages/obsidian-plugin/src/dataview-map.ts` (extend `DvPage.file` with `inlinks`)

**Interfaces:**
- Consumes: `DataSource.getBacklinks` (Task 3); existing `readProps`, `isIgnoredPath`, `linkPathToBasename`.
- Produces: an Obsidian `getBacklinks` reading Dataview `file.inlinks`.

- [ ] **Step 1: Extend the Dataview page type**

In `packages/obsidian-plugin/src/dataview-map.ts`, change the `DvPage.file` shape to include inbound links (a DataArray is iterable; each element is a Link with `.path`):

```ts
export interface DvPage {
  file?: { path?: string; name?: string; inlinks?: Iterable<unknown> }
```

(Leave the rest of the interface unchanged.)

- [ ] **Step 2: Implement `getBacklinks`**

In `packages/obsidian-plugin/src/datasource.ts`, import the basename helper:

```ts
import { pageToPropMap, linkPathToBasename } from './dataview-map'
```

Add to the returned object (after `getPageProps`):

```ts
    async getBacklinks(name) {
      const api = dv(); if (!api) return []
      const file = resolveFile(name)
      const page = file ? api.page(file.path) : api.page(name)
      const inlinks = page?.file?.inlinks
      if (!inlinks) return []
      const out: PageEntry[] = []
      const seen = new Set<string>()
      for (const link of inlinks) {
        const path = (link as { path?: string })?.path
        if (typeof path !== 'string' || isIgnoredPath(path)) continue
        const base = linkPathToBasename(path)
        const lower = base.toLowerCase()
        if (lower === name.toLowerCase() || seen.has(lower)) continue
        seen.add(lower)
        out.push({ name: base, props: await readProps(base) })
      }
      return out
    },
```

A `link` from Dataview is a Link object carrying a full vault `path`; `linkPathToBasename` reduces it to the note name, and `readProps` reads its inline/frontmatter link fields — so a body-only `[[mention]]` contributes no property and is dropped by reconciliation.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc -b packages/obsidian-plugin && npx eslint packages/obsidian-plugin/src/datasource.ts packages/obsidian-plugin/src/dataview-map.ts`
Expected: no errors.

> No unit test: the Obsidian datasource needs a live Dataview-enabled vault. Verified by typecheck/lint here and manual load in Task 6's gate.

- [ ] **Step 4: Commit**

```bash
git add packages/obsidian-plugin/src/datasource.ts packages/obsidian-plugin/src/dataview-map.ts
git commit -m "feat(obsidian): getBacklinks via Dataview inlinks"
```

---

### Task 6: Full gate + journal

**Files:**
- Modify: `WORKJOURNAL.md` (only on explicit user request — otherwise print a summary)

- [ ] **Step 1: Run the full verification gate**

Run: `npm run typecheck && npm test && npm run lint && npm run knip && npm run build`
Expected: all green. Investigate any `knip` unused-export hit on the new functions (`assembleGraph`, `reconcileGraph`, `reconcileNoteAdjacency`) — they are used by backend/tests, so knip should be satisfied; if `reconcileGraph` is flagged (only `reconcileNoteAdjacency` is consumed), either inline it into `reconcileNoteAdjacency` or keep it exported and add a direct `reconcileGraph` test in `migrate.test.ts`.

- [ ] **Step 2: Manual smoke (per CLAUDE.md dev loop), if a live editor is available**

Obsidian: build, ensure the symlinked plugin + Dataview are loaded; create note B with `parent:: [[A]]` and leave A bare; open Synapses on A → B appears as a parent. Logseq: same with `parent:: [[A]]` on B, reload the plugin, activate A.

- [ ] **Step 3: Work summary / journal**

Print a concise work summary. Only if the user explicitly asks, add a WORKJOURNAL.md entry (≤120 chars/line) such as:
`- **Show all connections** — reads reconcile own props with backlinks (getPageLinkedReferences / Dataview inlinks); migration precedence resolves conflicts; siblings fully reconciled.`

---

## Self-Review

- **Spec coverage:** seam method (Tasks 4–5), pure reconciliation reusing migration precedence (Task 2), `buildGraph`/`nodeAdjacency` wiring + fallback (Task 3), fully-reconciled siblings (Task 3 sibling test), conflict precedence (Task 2 tests), always-on/no-setting (no setting added anywhere). ✓
- **Placeholders:** none — every code step shows complete code. ✓
- **Type consistency:** `NoteAdjacency` defined in Task 1, imported in Tasks 2–3; `getBacklinks` signature identical across types.ts (Task 3) and both adapters (Tasks 4–5); `reconcileNoteAdjacency` signature consistent between definition (Task 2) and call site (Task 3). ✓

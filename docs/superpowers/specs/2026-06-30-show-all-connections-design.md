# Show all connections — read-time link reconciliation

**Date:** 2026-06-30
**Status:** Approved

## Problem

Symmetric writes are opt-in (default off), so a link is normally declared only on the
note the user interacted with. The view reads only the focus note's own properties
(`buildGraph` in `packages/core/src/backend.ts`), so a connection declared solely on the
*other* note is invisible from the focus. Users want the view to show **all** connections
a note participates in, regardless of which side declared them.

## Decisions (settled in brainstorming)

- **Always on.** Reads always reconcile both directions; no setting. The view shows the
  true graph regardless of how writes are configured.
- **Conflict resolution = migration precedence.** When the focus and an incoming note
  declare different kinds for the same pair, reuse the existing `repairSymmetry` rule:
  structural (parent/child) beats jump; opposing structural directions → the
  alphabetically-first page's assertion wins. One connector per pair, consistent viewed
  from either end.
- **Fully reconciled siblings.** Siblings are computed from the focus's *reconciled* parent
  set, and each parent's children are themselves reconciled (a backlink query per parent),
  so a sibling that declares `parent:: P` only on its own side still appears.

## Architecture

Writes stay single-sided. **Reads** reconcile: for any note, read its own props **plus its
backlinks** (notes pointing at it) and resolve each pair to one kind. The focus's reconciled
adjacency equals exactly what the migration would have written — without touching disk.

### 1. New seam method — `DataSource.getBacklinks(name): Promise<PageEntry[]>`

Optional. When absent, the backend falls back to today's own-props-only behavior, so the
seam degrades gracefully and no editor is forced to implement it in lockstep.

Returns the notes that reference `name` (via any link), each with its link-valued props.
Body-only `[[mentions]]` are harmless: reconciliation only counts a referencing note if its
*properties* declare the focus, so plain prose mentions contribute nothing.

- **Logseq** (`packages/logseq-plugin/src/datasource.ts`): `logseq.Editor.getPageLinkedReferences(name)`
  → referencing pages → re-read each via the existing `getPagePropsRaw`. Filter the `synapses`
  host page and any non-real entity, mirroring `listAllPages`.
- **Obsidian** (`packages/obsidian-plugin/src/datasource.ts`): Dataview `dv.page(name).file.inlinks`
  → source notes → existing `readProps`. Apply the same `isIgnoredPath` (logseq/ + user ignore
  filters) used by `listAllPages`/`searchPages`.

### 2. New pure core reconciliation

Extract the pair machinery already in `packages/core/src/migrate.ts` (`buildPairMap`,
`resolvePair`, `buildDesiredRoles`) into a shared:

```
reconcileGraph(pages: PageEntry[], ont: OntologyConfig): Map<lower, { parents, children, jumps }>
```

returning per-page reconciled adjacency with **display** names. `computeSymmetryRepairs` is
refactored to consume `reconcileGraph` and diff against disk — **no behavior change**, verified
by its existing tests. A thin wrapper for the read path:

```
reconcileNoteAdjacency(name, ownProps: PropMap, backlinkers: PageEntry[], ont): { parents, children, jumps }
```

builds `[{name, props: ownProps}, ...backlinkers]`, runs `reconcileGraph`, and returns the
focus's bucket (empty adjacency if the focus has no pairs).

### 3. `backend.buildGraph`

1. `focusProps = getPageProps(focus)`; `focusBack = getBacklinks?.(focus) ?? []`.
2. `focusAdj = reconcileNoteAdjacency(focus, focusProps, focusBack, ont)`.
3. For each parent `P` in `focusAdj.parents`: read `P` props + `getBacklinks(P)`, reconcile →
   `reconciledP.children` are the sibling candidates.
4. Compose the `Graph` (parents/children/jumps from `focusAdj`; siblings via the same
   children-of-parents / minus-self-and-own logic as `queryGraphFromProps`, capped at
   `SIBLING_CAP`).

The current `queryGraphFromProps` raw-props path is replaced by reconciled adjacencies. The
sibling assembly (dedupe, exclusions, `siblingParent`, cap, truncation flag) is preserved —
factor it so both the old shape and the reconciled shape share it, or have `buildGraph`
assemble siblings directly from reconciled parent adjacencies.

### 4. `backend.nodeAdjacency`

Reconcile each rendered card (own props + backlinks) so the per-card handle "has more links"
state (`empty|shown|more`) reflects incoming links too — otherwise a card shows "no more"
while it actually has incoming connections.

## Conflict handling

Entirely the migration precedence (`resolvePair`): structural beats jump; opposing structural
→ alphabetically-first page wins. Self-references dropped (`recordLink` ignores `target ==
self`). Ghost (referenced-but-uncreated) targets keep their display name via the `display` map.

## Cost

No caching (consistent with the on-demand model):
- `buildGraph` ≈ `1 + 2·(parent count)` backlink/prop reads.
- `nodeAdjacency` ≈ `2` reads per rendered card.

Accepted per the "fully reconciled" decision.

## Testing

- **Pure** (`packages/core`): `reconcileGraph` / `reconcileNoteAdjacency` — incoming-only
  parent, incoming-only child, incoming-only jump; jump-vs-structural conflict; opposing
  structural (alphabetical winner); ghost target display name; self-reference dropped.
- **Backend** (`backend.test.ts`): with a stub `getBacklinks`, an asymmetric incoming link
  (declared only on the other page) appears in `buildGraph` and in `nodeAdjacency` handle
  counts; a parent-only-on-sibling-side sibling appears.
- **Regression:** `migrate.test.ts` (existing) must stay green after the `reconcileGraph`
  refactor.

## Invariants preserved

- `packages/core` stays editor-agnostic (no `@logseq/libs` / `obsidian` imports).
- No `any` outside `transport.ts`; `verbatimModuleSyntax` type-only imports.
- On-demand reads, no in-memory index, no caching.
- `graphKey` still absorbs duplicate refresh events.

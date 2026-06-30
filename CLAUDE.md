# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`logseq-synapses` — a **Logseq + Obsidian** plugin (UI name: **Synapses**) that lays notes out spatially
in the **right sidebar**: active note centered, parents above, children below, jumps left, siblings right;
click a card to activate. Logseq target is the **0.10.x Markdown/file graph**, NOT the DB version
(different properties + datascript schema). Plain **TypeScript**, no React/SVG/d3 by design.

## Repo layout (TypeScript monorepo)

> Pre-monorepo paths (`src/main/*`, `src/synapses/*`, `src/shared/rpc.js`) are **gone** — code lives in
> `packages/`. Some prose/symbols keep older names.

- **`packages/core` (`@synapses/core`)** — editor-agnostic engine + view:
  - graph: `graph/index-pure.ts` (on-demand reads, no in-memory index — `collect`, `adjacencyFor`,
    `queryGraphFromProps`, `toNames`, `SIBLING_CAP`; read-time backlink merge `reconcileGraph` /
    `reconcileNoteAdjacency` / `assembleGraph`), `mutations.ts` (single-sided writes; `unlink` clears both
    pages), `history.ts`, `ontology.ts`, `ignore.ts`.
  - plumbing: `transport.ts` (generic postMessage bridge), `backend.ts` (`createCoreBackend`), `logger.ts`
    (opt-in JSONL logging), utils `errText.ts` / `log.ts`.
  - view: `view/` (`view.ts`, `edges.ts`, `layout.ts`, `panzoom.ts`, `dialog.ts`, `context-menu.ts`,
    `colors.ts`, `theme.ts`, `color.ts`, `curve.ts`, `handles.ts`, `edge-hit.ts`, `styles.css`);
    `app.ts` = `mountSynapses` (pure helpers in `app-logic.ts`).
- **`packages/logseq-plugin`** — Logseq adapter (two contexts): M entry `src/index.ts` (has `logseq`),
  P iframe `frame.ts`; `sidebar.ts`, `datasource.ts`, `services.ts`, `theme.ts`, `logseq-types.ts`.
- **`packages/obsidian-plugin`** — Obsidian adapter, **in-process `ItemView` (no iframe)**: `main.ts`,
  `view.ts`, `datasource.ts`, `services.ts`, `dataview.ts`, `inline-fields.ts`, `dataview-map.ts`,
  `write-target.ts`, `paths.ts`, `settings.ts`.

**Two-seam architecture:** the view consumes a `SynapsesBackend`; each editor supplies a `DataSource`
(read/write properties + change events) + `EditorServices` (theme/assets/nav/ontology). `createCoreBackend`
implements on-demand reads, mutations, and history once. **A new editor = those two adapters.**

### Cross-editor invariants
- **Keep `packages/core` editor-agnostic:** `grep -rE "@logseq/libs|from 'obsidian'|from 'node:'" packages/core/src`
  must be empty (`obsidian`/`obsidian-dataview` live only in `packages/obsidian-plugin`).
- **Logseq mounts only after the postMessage bridge connects** (`frame.ts` → `createBackendProxy({ onConnect })`);
  calling the proxy first rejects "synapses bridge not connected" and leaves the theme stuck light.
  Obsidian's backend is in-process (always ready).
- **`verbatimModuleSyntax` is on** → type-only imports must use `import { type X }`.
- **Build artifacts are gitignored/rebuildable:** `packages/obsidian-plugin/{main.js,styles.css}` (esbuild
  renames `main.css`→`styles.css`), `packages/logseq-plugin/dist/`.
- **Mobile mode flows through the seam** (`EditorServices.getUiMode()` + `onUiModeChange` → `'uimode'` event;
  `app.ts` → `view.setMobile`). On mobile, activating a card recenters but does NOT mirror to the editor
  (`navigate` gated on `!mobile` — would close the drawer); handles inert, connector × is tap-revealed.
  Detection: Obsidian `Platform.isMobile || settings.mobileMode`; Logseq has no mobile runtime, so the
  in-settings toggle is the only signal.

## Terminology

Canonical vocabulary — use in docs/comments/UI. Many **code symbols predate this glossary**; mappings noted.

- **Note** — user content (Logseq page/journal or Obsidian note), backed by a file. The central noun.
  (*Page* = the editor substrate: page properties, first block, `getPage`.)
- **Card** — the on-screen box for a note. (Code: *node* — `NODE`, `nodeAdjacency`, the `<div>`s.)
- **Link** — a connection between two notes; each **kind** is many-to-many, written **single-sided** on the
  interacted note (`setLink`); incoming links merged at read time. Read on demand from page properties,
  no index. (Historically the *relationship index*.)
- **Connector** — the `<canvas>` line for a link. (Code: *edge* — `view/edges.ts`, `computeEdges` /
  `drawEdges`, `edge-hit.ts`.)
- **Active note** — the centered note; only its links show. (Code: *focus*.)
- **Activate** — make a note active: click its card, open its page, or create it. (Older prose:
  *navigate* / *follow*.)
- **Recenter** — the camera glide on activation.

The four **link kinds** (named by card position relative to the active note):

| Kind | Position | Detail |
|------|----------|-------|
| **Parent** | above | declared on the interacted note (A parent of B → A gets `child:: B`); reverse `parent::` surfaces via read-time backlink reconciliation |
| **Child** | below, 2 columns | mirror of Parent |
| **Jump** | left | association — `jump::` on the interacted note; reverse surfaces at read time |
| **Sibling** | right | computed — children of the active note's parents (never declared) |

## Commands

- **`npm run build`** — all 3 packages (core `tsc -b`; logseq `vite`→`dist/`; obsidian `esbuild`→
  `{main.js,styles.css}`). `-w <pkg>` builds one; `npm run dev -w <pkg>` watches (reload the plugin after).
- **`npm run typecheck`** — tsc across all. **`npm test`** — vitest. Single: `npx vitest run <file>` or
  `-t "<substring>"`.
- **`npm run lint`** (`lint:fix`) — type-aware ESLint (`eslint.config.js`) + import (`no-cycle`) + sonarjs.
  **Policy:** no-floating/misused-promises + the whole `any` cascade are ERROR everywhere; only `transport.ts`
  (reflective bridge) is a WARN allowlist — so **no `any` outside `transport.ts`** (model external types:
  `@logseq/libs` via `logseq-types.ts`, Dataview via `obsidian-plugin/dataview.ts`).
- **`npm run knip`** — unused files/exports/deps guard.
- Only the view + editor seams need a live editor; pure graph/ontology/history/mutations/transport/geometry
  are unit-tested in `packages/core`.

## Loading & dev loop (no headless harness)

- **Obsidian** (needs the **Dataview** plugin): build, symlink `packages/obsidian-plugin` →
  `<vault>/.obsidian/plugins/synapses`; open via 🧠 ribbon or "Synapses: open in sidebar".
  `../test_logseq_graph` doubles as a vault.
- **Logseq (0.10.x):** Developer mode → **Load unpacked plugin** → `packages/logseq-plugin`
  (`logseq.main` → `dist/index.html`). Build first, **reload the plugin** (toggle off/on) after each build.
  Trigger via 🧠 toolbar or `/Synapses: open in sidebar`.
- **Release:** push a version tag → `.github/workflows/release-obsidian.yml` publishes a GitHub Release
  (`manifest.json`/`main.js`/`styles.css`); BRAT installs from it.

## Architecture — the Logseq two-document split

Logseq-specific (Obsidian's `ItemView` is in-process). The Logseq plugin runs in **two browser documents**
bridged by postMessage:

```
M  packages/logseq-plugin/src/index.ts   plugin "main" context, registered → HAS `logseq`.
P  packages/logseq-plugin/src/frame.ts   the UI (mountSynapses), injected as an <iframe> → NO `logseq`.
   packages/core/src/transport.ts        the generic postMessage bridge.
```

- **Why two:** a manually-injected iframe isn't a registered plugin, so `@logseq/libs` won't connect inside
  it. So **all Logseq reads/writes happen in M**; P is a pure view calling M over the transport (must wait
  for `onConnect`).
- **Sidebar embedding (`sidebar.ts`):** no plugin-sidebar API — a host page holds `{{renderer :synapses}}`;
  `openInRightSidebar` fires `onMacroRendererSlotted`, where M `provideUI`s the `<iframe>` (`src` set via DOM
  so DOMPurify can't strip it). Full width via `:has()` CSS.
- **Rendering (`view/`):** `view.ts` positions `<div>` cards (keyed by name so positions tween) over a
  `<canvas>` connector layer; `layout.ts` is banded arithmetic; `panzoom.ts` centers on the focus. `app.ts`
  orchestrates (nav, history, create dialog, theme, pending-write spinner + ~2s watchdog:
  `beginWait`/`decWait`/`clearWait`/`onWatchdog`/`failWait`, `#synapses-spinner`).
- **History is durable** (`history.ts` reducer, persisted via `EditorServices.persistence`) — survives the
  iframe being re-injected on sidebar re-render.

## Critical invariants & gotchas

Non-obvious; caused real bugs. (Several Logseq-specific; Obsidian seams: `obsidian-plugin/src/{datasource,services}.ts`.)

- **After a write, do NOT re-read immediately** — Logseq `getPage().properties` and Obsidian's Dataview
  index both lag. Model: mutate and return; re-render only on the editor's `refresh` event. A corner spinner
  (`#synapses-spinner`) shows while waiting; a ~2s watchdog (`onWatchdog`) flashes + renders best-effort if
  no event fires. No optimistic patch layer.
- **Read Logseq link props from the live block tree, NEVER `getPage().properties`.** `getPagePropsRaw`
  (`logseq-plugin/datasource.ts`) scans all **top-level** blocks of `getPageBlocksTree(name)` via `toNames`.
  `getPage().properties` is a cache that lags the file and persists stale across restarts (removed links
  reappeared); use only as a no-blocks fallback. Blocks surface a link list as a raw `"[[A]], [[B]]"` string
  (not the pre-split array), which `toNames` also parses. Writes/removal go through `clearKeyFromBlocks`
  (strip from every block, keep one on the pre-block) so no straggler resurrects. Nested blocks not scanned —
  keep link props at the page top level.
- **A deleted `.md` leaves a lingering datascript entity** (Logseq) — `getPage()` may report a page whose
  file is gone. Caught at the focus boundary: `DataSource.pageExists` requires a backing file
  (`pruneIfMissing`). The index no longer scans all pages (`listPages` removed); the toolbar ↻ is a plain
  "Refresh from editor" (`hardRefresh`).
- **`logseq/` backups as phantom search results** — the index doesn't scan all pages, so they can't inject
  phantom links, but they can appear in `searchPages`. Both adapters filter `logseq/` + user ignores
  (Obsidian also honours native `userIgnoreFilters`) via `isInLogseqFolder` / `matchesIgnoreFilters`
  (`core/ignore.ts`).
- **One connection per pair — route every write through `setLink`/`unlink` (`mutations.ts`).** Writes are
  **single-sided**: `setLink` writes only on `focus` (reciprocal NOT written — it surfaces at read time);
  `unlink` clears **both** pages so no half resurrects. Reconnecting a linked pair **retypes**: `setLink`
  reads `rolesBetween` and `unlink`s every pre-existing role (either direction) first. Writing a property
  directly leaves duplicate/stale declarations.
- **Menus/modals use the full-bleed overlay pattern, never fixed-position or native** (`view/dialog.ts`,
  `context-menu.ts`, `colors.ts`): an overlay over the stage + an absolutely-positioned clamped child
  (`clampDialogPosition` / `clampMenuPosition`). `prompt`/`alert` are blocked in the sandboxed iframe;
  `position:fixed` lands off-screen against Obsidian's transformed pane; a Logseq dismisser tears a native
  menu down between mousedown and mouseup.
- **An iframe in an inline wrapper falls back to ~300px**, ignoring `width:100%`. Fix with persistent
  `:has()` CSS (`synapsesFrameStyle`, `sidebar.ts`), not JS — JS mutations are wiped on sidebar re-render.
- **The Logseq iframe swallows mouse events during a sidebar resize drag** — `installDragPassthrough`
  toggles `pointer-events:none` while an outside-started drag is in flight.
- **`onMacroRendererSlotted` fires repeatedly with new slot ids** — `renderSynapsesSlot` dedupes + filters to
  the sidebar instance. Keep state in M or P's module scope, never tied to a slot id.
- **Logseq page properties live on the first block** — the `DataSource` resolves
  `getPageBlocksTree(name)[0].uuid` before `upsertBlockProperty`.
- **Skip re-render when the graph key is unchanged** (`graphKey`, `app.ts`) — with no debounce, a multi-page
  write (e.g. `unlink` clearing both sides) emits rapid `refresh` events; `graphKey` absorbs the duplicates.
- **Theme colors clamped to opacity ≥ 0.5** (`clampColorAlpha`, `view/color.ts`) before `applyTheme` —
  Obsidian's translucent `--background-modifier-border` otherwise renders parent/child connectors invisible.

## Debug file logging (opt-in, off by default)

Per-editor **"Debug file logging"** setting writes a JSONL interaction trace across the seams. Machinery in
`core/logger.ts`; each adapter supplies a file sink + the setting.

- **Records** = one compact JSON per line `{t, ctx, cat, act, ...}`. Five `cat`s trace one interaction:
  `user` (view action) · `call` (backend method + ok|err + ms) · `edit` (DataSource write) · `editor`
  (change event) · `ui` (render). Keep small — array args collapse to a count, never log full graphs.
- **Injection (all in core):** `createCoreBackend(ds, services, logger?)` logs `editor`;
  `mountSynapses(container, backend, logger?)` logs `user`/`ui`. Adapters wrap seams: `wrapDataSource`
  (edits) + `wrapBackendWithLogging` (calls). Both default to `noopLogger` (fully removable).
- **`ctx` tags the origin** — P (the iframe) can't write files, so it forwards `user`/`ui` to M over the
  transport (`method:'log'`); **M owns the file and gates on the setting**. A `user` line in P with no
  matching `call` in M = a dropped bridge message. Obsidian is single-context (`ctx:'main'`).
- **Sink** = `createBufferedSink` (lazy-load to seed across reloads, ~1 MB rolling cap, debounced whole-file
  rewrite). Files: Obsidian `<vault>/.obsidian/plugins/synapses/synapses-log.jsonl`; Logseq
  `<graph>/assets/storages/logseq-synapses/synapses-log.jsonl`. Written lazily (setting on + one
  interaction); absolute path printed to console.

## Pointers

- `README.md` — user-facing setup/validation.
- @WORKJOURNAL.md — dated build log. **Writing entries:** dense, one line per session (nested list only when
  needed; **no line > 120 chars**); capture changes + decisions, not behaviour-walkthroughs or code; omit
  state readable from code (paddings, counts) and process (worktrees, agents) but keep decisions even when
  they name a value/tool. **Write only on explicit request**; otherwise remind + print a work summary.
- Ontology (property names → parent/child/jump) is user-configurable per editor (Logseq schema in
  `logseq-plugin/src/index.ts`; Obsidian tab in `obsidian-plugin/src/settings.ts`); parser/defaults =
  `buildOntology` (`core/ontology.ts`).

<!-- headroom:learn:start -->
## Headroom Learned Patterns
*Auto-generated by `headroom learn` on 2026-06-29 — do not edit manually*

### Editing gotchas
*~8,000 tokens/session saved*
`packages/core/src/app.ts` (and `view/dialog.ts`, `view/view.ts`) contain Unicode glyphs in user-facing strings — curly quotes (`'` `'`), `⚠`, `✕`/`×`. Edit's exact-match silently fails on these (agents burned multiple calls doing `python3` byte-dumps to find them). Copy the glyph verbatim from a fresh Read; do not retype quotes as ASCII.

### File sizes / read scopes
*~5,000 tokens/session saved*
Largest source files (read targeted ranges, not whole): `packages/core/src/view/view.ts` (~31 KB), `packages/core/src/app.ts` (~20 KB). Logseq API types live in `node_modules/@logseq/libs/dist/LSPlugin.d.ts` — grep it for `appendBlockInPage`/`getPageBlocksTree`/`IAsyncStorage` etc. rather than guessing the API.

### Commands
*~4,000 tokens/session saved*
Verify ONE package fast instead of the full `npm run build`/`npm run typecheck`: `npx tsc -b packages/<pkg>` (typecheck), `npx eslint packages/<pkg>/src/<file>` (lint), `npm run build -w packages/<pkg>`. Run the full `npm run typecheck && npm test && npm run lint && npm run knip && npm run build` gate only before committing.

### Worktree builds
*~3,000 tokens/session saved*
Worktrees under `.claude/worktrees/` have no `node_modules` — symlink the repo's: `ln -s <repo>/node_modules <worktree>/node_modules` before tsc/eslint. esbuild (Obsidian build) still won't resolve from a symlink; verify worktree edits with `tsc`/`eslint` only and build after merge.

<!-- headroom:learn:end -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`logseq-synapses` — a **Logseq + Obsidian** plugin that lays out notes spatially (rendered here as
**Synapses**): the active note centered, with parents above, children below, jumps to the left and
siblings to the right, and click-a-card-to-activate navigation, rendered in the **right sidebar**. The
Logseq target is the **0.10.x Markdown/file graph** — NOT the DB version (the DB version reworked
properties and the datascript schema). Plain **TypeScript** (no React, no SVG, no d3) by design.

## Repo layout (TypeScript monorepo)

> Some prose/code below uses older names; **the pre-monorepo `src/main/*` / `src/synapses/*` /
> `src/shared/rpc.js` paths are gone** — code now lives in npm workspaces under `packages/`.

- `packages/core` (`@logseq-synapses/core`) — editor-agnostic engine + view: pure on-demand graph
  query helpers (`graph/index-pure.ts` — `collect`, `uniqNames`, `adjacencyFromProps`,
  `queryGraphFromProps`, `adjacencyFor`, `toNames`, `SIBLING_CAP`; no in-memory index),
  `mutations.ts` (symmetric two-sided writes), `history.ts`, `ontology.ts`,
  `ignore.ts` (folder/ignore-filter exclusion), the generic postMessage `transport.ts`, the small
  utils `errText.ts` + `log.ts`, the view (`view/` — `view.ts`, `edges.ts`, `layout.ts`, `panzoom.ts`,
  `dialog.ts`, `context-menu.ts`, `colors.ts` (in-iframe connector-color popover), `theme.ts`,
  `color.ts`, `curve.ts` (shared bezier control points), `handles.ts`, `edge-hit.ts`, `styles.css`),
  `app.ts` = `mountSynapses` (pure helpers in `app-logic.ts`), `backend.ts` = `createCoreBackend`,
  `logger.ts` (opt-in JSONL debug logging — `createLogger` / `createBufferedSink` / `wrapBackendWithLogging`
  / `wrapDataSource`).
- `packages/logseq-plugin` — Logseq adapter: M entry `src/index.ts` (has `logseq`), P iframe entry
  `src/frame.ts`, `sidebar.ts`, `datasource.ts`, `services.ts`, `theme.ts`, `logseq-types.ts`.
- `packages/obsidian-plugin` — Obsidian adapter, **in-process `ItemView` (no iframe)**: `main.ts`,
  `view.ts`, `datasource.ts`, `services.ts`, `dataview.ts` (typed Dataview live-accessor),
  `inline-fields.ts`, `dataview-map.ts`, `write-target.ts`, `paths.ts`, `settings.ts`.

**Two-seam architecture:** the view consumes a high-level `SynapsesBackend`; each editor supplies a
`DataSource` (read/write properties + change events) + `EditorServices` (theme/assets/nav/ontology);
`createCoreBackend` implements on-demand graph reads, mutations, and history once. A new editor
= those two adapters.

### Cross-editor invariants
- **Keep `packages/core` editor-agnostic:** `grep -rE "@logseq/libs|from 'obsidian'|from 'node:'" packages/core/src`
  must be empty; `obsidian`/`obsidian-dataview` live only under `packages/obsidian-plugin`.
- **Logseq mounts only after the postMessage bridge connects** (`frame.ts` → `createBackendProxy({ onConnect })`).
  Calling the proxy backend before the handshake rejects "synapses bridge not connected" and leaves the
  theme stuck light. Obsidian's backend is in-process (always ready); `mountSynapses`'s caller must pass a
  connected backend.
- **`verbatimModuleSyntax` is on** → type-only imports must use `import { type X }`.
- **Build artifacts are gitignored/rebuildable:** `packages/obsidian-plugin/{main.js,styles.css}` (esbuild
  renames `main.css`→`styles.css`), `packages/logseq-plugin/dist/`.
- **Mobile mode flows through the seam, not just the view.** `EditorServices.getUiMode()`
  (`UiMode.mobile`) + an `onUiModeChange` → `'uimode'` backend event; `app.ts` reads `mobile` before
  `init()` and re-reads it on the event, then calls `view.setMobile`. On mobile, activating a card
  recenters but does **not** mirror to the editor main pane (`navigate` is gated on `!mobile` —
  switching pages would close the mobile drawer); handles go inert and the connector × is tap- (not
  hover-) revealed. Detection differs per editor: Obsidian = `Platform.isMobile || settings.mobileMode`;
  Logseq has no mobile plugin runtime, so the in-settings "Mobile mode" toggle is the only signal.

## Terminology

Canonical vocabulary for this project — use these terms in docs, comments, and UI copy. Many
**code symbols predate this glossary and keep their old names**; the mapping is called out so you can
connect prose to code.

- **Note** — a piece of the user's content: a Logseq page/journal or an Obsidian note, backed by a
  file on disk. The central noun. ("Page" refers to the editor substrate — page properties,
  the page's first block, `getPage`.)
- **Card** — the on-screen box that represents a note. (Code says *node*: `NODE` geometry,
  `nodeAdjacency`, the `<div>` elements.)
- **Link** — a connection between two notes. Each link **kind** is a many-to-many relationship,
  written **symmetrically on both pages** (`setLink`/`unlink` in `mutations.ts`); siblings are
  computed. There is no in-memory index — relationships are read **on demand** from page properties
  via `queryGraphFromProps` / `adjacencyFor` (`packages/core/src/graph/index-pure.ts`;
  historically the *relationship index* / `src/main/graph.js`).
- **Connector** — the line drawn on the `<canvas>` for a link. (Code says *edge*: `view/edges.ts`,
  `computeEdges`/`drawEdges`, `view/edge-hit.ts`.) Link is to connector as note is to card — the
  relation vs. its drawing.
- **Active note** — the note currently centered; only the active note's links are shown. (Code
  says *focus*: the `focus` field on `Graph`/layout, `GATES[zone].focus`.)
- **Activate** — to make a note the active one: click its card, open its page in the editor, or
  create a new note. (Older prose says *navigate* / *follow*.)
- **Recenter** — the camera glide that plays when you activate a different note (the motion, not the
  action).

The four **link kinds**, named by where their cards sit relative to the active note:

| Kind | Position | Detail |
|------|----------|-------|
| **Parent** | above | written on both pages: A parent of B → A gets `child:: B`, B gets `parent:: A` |
| **Child** | below, in two columns | symmetric with Parent |
| **Jump** | left | association link — written on both pages: both get `jump::` the other |
| **Sibling** | right | computed — the children of the active note's parents (never declared directly) |

## Commands

- `npm run build` — builds all 3 packages (core `tsc -b`; logseq `vite` → `packages/logseq-plugin/dist/`;
  obsidian `esbuild` → `packages/obsidian-plugin/{main.js,styles.css}`). Add `-w <pkg>` to build one;
  `npm run dev -w <pkg>` to watch (reload the plugin in the editor to pick up the new bundle).
- `npm run typecheck` — tsc across all 3 packages. `npm test` — runs the vitest suite (the count isn't
  pinned here; run it to get the current number before relying on it). Single test:
  `npx vitest run <file>` or filter by name with `-t "<substring>"`.
- `npm run lint` (`lint:fix` to autofix) — ESLint flat config (`eslint.config.js`), **type-aware**
  (typescript-eslint `recommendedTypeChecked` via `projectService`) + `eslint-plugin-import`
  (`import/no-cycle`) + `sonarjs` (cognitive-complexity). **Policy (see the header comment in
  `eslint.config.js`): no-floating/misused-promises + the whole `any` cascade (no-explicit-any,
  no-unsafe-*) are ERROR everywhere; `transport.ts` (the reflective postMessage bridge) is the one
  documented WARN allowlist.** So there is effectively no `any` outside `transport.ts` — model
  external types instead (`@logseq/libs` via `logseq-types.ts`; Dataview via `obsidian-plugin/dataview.ts`).
  A few rules stay WARN (FP-prone / style): await-thenable, no-confusing-void, no-unnecessary-type-assertion,
  unbound-method, require-await, prefer-nullish, restrict-*, sonarjs.
- `npm run knip` — unused files / exports / dependencies guard (`knip.json`; `ignoreExportsUsedInFile`).
- The view + the editor seams (datasource/services/iframe) need a live editor; the pure graph helpers,
  ontology, history, mutations, transport, and view geometry are unit-tested in `packages/core`.

## Loading & dev loop (no headless harness for either editor)

- **Obsidian** (requires the **Dataview** plugin): build, then symlink `packages/obsidian-plugin` →
  `<vault>/.obsidian/plugins/synapses`; open via the 🧠 ribbon or "Synapses: open in sidebar".
  `../test_logseq_graph` doubles as an Obsidian vault (Logseq's first-block `key:: [[X]]` properties are
  the inline fields Dataview reads).
- **Logseq (0.10.x):** Settings → Advanced → **Developer mode** on → Plugins → **Load unpacked plugin** →
  select **`packages/logseq-plugin`** (its `package.json` `logseq.main` → `dist/index.html`). Build first;
  **reload the plugin** (toggle off/on) after each build. Trigger via the 🧠 toolbar button or
  `/Synapses: open in sidebar`.
- **Distribute to Obsidian/BRAT:** push a version tag → `.github/workflows/release-obsidian.yml` builds +
  publishes a GitHub Release with `manifest.json`/`main.js`/`styles.css` as assets; BRAT installs from them.

## Architecture — the Logseq two-document split

Logseq-specific (Obsidian's `ItemView` runs **in-process**, no iframe/bridge). The Logseq plugin runs in
**two separate browser documents** bridged by postMessage:

```
M  packages/logseq-plugin/src/index.ts   plugin "main" context, registered by Logseq → HAS `logseq`.
P  packages/logseq-plugin/src/frame.ts   the synapses UI (core's mountSynapses + synapses.html), injected
                                          as an <iframe> into a right-sidebar slot → NO `logseq` global.
   packages/core/src/transport.ts        the generic postMessage bridge (startServer / createClient / proxy).
```

- **Why two contexts:** a manually-injected iframe is not a registered plugin, so `@logseq/libs` will not
  connect inside it. Therefore **all Logseq reads/writes happen in M** (the `DataSource`/`EditorServices`);
  P is a pure view that calls M over the transport. P must wait for `onConnect` before its first call (see
  Cross-editor invariants).
- **Sidebar embedding (`packages/logseq-plugin/src/sidebar.ts`):** Logseq has no plugin-sidebar API. A
  dedicated host page holds one block `{{renderer :synapses}}`; opening it via `openInRightSidebar` fires
  `onMacroRendererSlotted`, where M `provideUI`s an `<iframe>` (its `src` is set via the DOM, not the
  template, so DOMPurify can't strip it). Full-sidebar width is enforced with `:has()` **CSS** in
  `synapsesFrameStyle()`.
- **On-demand graph reads (`packages/core/src/graph/index-pure.ts`) — no in-memory index.** A note's
  links come from page **properties** (`parent:: / child:: / jump::`), written symmetrically on both
  pages; siblings are computed. `backend.ts` calls `queryGraphFromProps` / `adjacencyFor` on demand
  via the `DataSource` — reading the focus's own properties plus each parent's properties for siblings.
  No caching, no rebuild lifecycle, no debounce, no patch replay.
- **Rendering (`packages/core/src/view/`):** `view.ts` manages absolutely-positioned `<div>` cards (keyed
  by name so positions tween) over a `<canvas>` connector layer (`edges.ts`); `layout.ts` is banded
  arithmetic; `panzoom.ts` centers on the **active note** (the `focus` in code). `app.ts`
  (`mountSynapses`) is the orchestrator (navigation, history, create dialog, theme, and the
  pending-write spinner + ~2s watchdog: `beginWait`/`decWait`/`clearWait`/`onWatchdog`/`failWait`,
  `#synapses-spinner`).
- **History is durable** (`history.ts` reducer, persisted via each editor's `EditorServices.persistence`),
  so it survives the Logseq iframe being re-injected when the sidebar re-renders.

## Critical invariants & gotchas

These are non-obvious and caused real bugs; respect them. (Several are Logseq-specific; Obsidian's seams
are `packages/obsidian-plugin/src/{datasource,services}.ts`.)

- **After a write, do NOT re-read immediately.** Logseq's `getPage().properties` and Obsidian's Dataview
  index both lag after a write. The new model: mutations write and return; the UI re-renders only when the
  editor reports the change via the `refresh` event (triggering a fresh on-demand read). A corner spinner
  (`#synapses-spinner`) shows while waiting; a ~2s watchdog (`onWatchdog`) flashes a warning + best-effort
  render if the editor never fires. There is no optimistic patch layer.
- **A deleted `.md` leaves a lingering datascript entity** (Logseq): `getPage()` may still report a
  referenced page whose file is gone. Caught at the focus boundary — `DataSource.pageExists` requires a
  backing file (`pruneIfMissing` in `backend.ts`), and history prunes missing entries. `listPages` was
  removed; the index no longer scans all pages. The toolbar ↻ is now a plain "Refresh from editor"
  (`hardRefresh` in `app.ts`) — re-reads and re-renders the focus, no index reset needed.
- **Markdown backups under `logseq/` as phantom search results.** The index no longer scans all pages, so
  backups can't inject phantom links. They can still appear in `searchPages` results — both adapters filter
  `logseq/` + user ignores; Obsidian also honours its native `userIgnoreFilters`. Pure helpers
  `isInLogseqFolder` / `matchesIgnoreFilters` live in `packages/core/src/ignore.ts` (used by
  `searchPages`).
- **One connection per pair — route every link write through `setLink`/`unlink` (`mutations.ts`).**
  Writes are **symmetric**: `setLink` writes the appropriate property on **both** pages; `unlink` clears
  it on both. Connecting an already-linked pair **retypes** it: `setLink` reads `rolesBetween` from the
  focus page's own props and `unlink`s every differing role on both sides before writing. Writing a
  property directly instead leaves asymmetric or duplicate declarations (breaks parent↔child flips /
  legacy multi-role self-heal).
- **Menus and modals use the full-bleed overlay pattern, never fixed-position or native.**
  `view/dialog.ts`, `view/context-menu.ts`, and `view/colors.ts` each render an overlay covering the
  stage with an absolutely-positioned child clamped on-screen (`clampDialogPosition` /
  `clampMenuPosition`). `window.prompt`/`alert` are blocked in the sandboxed
  Logseq iframe; a `position:fixed` menu resolves against Obsidian's transformed pane (lands off-screen)
  and a Logseq dismisser tears it down between mousedown and mouseup.
- **An iframe in an inline wrapper falls back to its ~300px intrinsic width**, ignoring `width:100%`. Fix
  width with persistent **CSS** (`:has()` in `synapsesFrameStyle`, `packages/logseq-plugin/src/sidebar.ts`),
  not imperative JS — JS mutations get wiped when Logseq re-renders the sidebar.
- **The Logseq iframe swallows mouse events during a sidebar resize drag**; `installDragPassthrough`
  (`sidebar.ts`) toggles `pointer-events:none` while a drag started outside the iframe is in flight.
- **`onMacroRendererSlotted` fires repeatedly and with new slot ids**; `renderSynapsesSlot` (`sidebar.ts`)
  dedupes and filters to the sidebar instance. Keep synapses state in M or in P's module scope, never tied
  to a slot id.
- **Logseq page properties live on the page's first block** — the Logseq `DataSource` resolves
  `getPageBlocksTree(name)[0].uuid` before writing with `upsertBlockProperty`.
- The synapses skips re-rendering when the graph key is unchanged — see `graphKey` in
  `packages/core/src/app.ts`. This is now **more central**: with no debounce, a two-sided write emits
  two rapid `refresh` events; `graphKey` absorbs the duplicate and prevents a double render.
- **Theme colors are clamped to opacity ≥ 0.5** (`clampColorAlpha`, `view/color.ts`) before `applyTheme`
  sets CSS vars and edge colors — Obsidian's translucent `--background-modifier-border` otherwise renders
  parent/child connectors invisible.

## Debug file logging (opt-in, off by default)

A per-editor **"Debug file logging"** setting writes a JSONL interaction trace for diagnosing
communication problems across the seams. The machinery is editor-agnostic in `packages/core/src/logger.ts`;
each adapter only supplies a file sink + the setting.

- **Records** are one compact JSON object per line: `{t, ctx, cat, act, ...}`. Five `cat`s trace one
  interaction end-to-end: `user` (view action) · `call` (backend method: args + ok|err + ms) · `edit`
  (DataSource write: page/key/targets) · `editor` (editor change event emitted) · `ui` (render: focus +
  per-zone counts). Keep records small — never log full graphs (the wrappers collapse array args to a count).
- **Two injection points, all logic in core:** `createCoreBackend(ds, services, logger?)` logs `editor`
  events; `mountSynapses(container, backend, logger?)` logs `user`/`ui`. Adapters additionally wrap their
  seams: `wrapDataSource` (edits) + `wrapBackendWithLogging` (calls). Both params default to `noopLogger`,
  so logging is fully removable.
- **`ctx` tags the origin context, which is the whole point for Logseq.** The view (P, the iframe) can't
  touch the filesystem, so its `user`/`ui` records are forwarded to M over the existing transport
  `post`/`onClientEvent` channel (`method:'log'`), and **M owns the single file and gates on the setting**.
  A `user` line in P with no matching `call` line in M pinpoints a dropped bridge message. P forwards
  unconditionally (cheap, interaction-rate); M is the gate. Obsidian is single-context (`ctx:'main'`).
- **Sink** = `createBufferedSink` (lazy load to seed across reloads, ~1 MB rolling cap dropping oldest whole
  lines, debounced whole-file rewrite — no append API needed). Files: Obsidian
  `<vault>/.obsidian/plugins/synapses/synapses-log.jsonl` (vault adapter); Logseq
  `<graph>/assets/storages/logseq-synapses/synapses-log.jsonl` (`makeSandboxStorage` roots at
  `<graph>/assets/storages/<plugin-id>/`). Written lazily — only after the setting is on and one
  interaction occurs; the resolved absolute path is printed to the console (`log.info`) when the
  setting is enabled.

## Pointers

- `README.md` — user-facing setup/validation steps.
- @WORKJOURNAL.md — dated log of what was built and why. **How to write entries:**
  - Dense, short, concise — capture key changes and decisions, nothing else.
  - One line per session (match the existing entries); use a nested list only when
    one line won't do. **No line may exceed 120 characters** — split longer content
    into nested list items rather than wrapping.
  - Document features and highlight important decisions; don't explain behaviour to
    the reader or walk through code (you can read it later).
  - Omit state readable from code (paddings, positions, test counts, etc.) and
    process (worktrees, agents used, etc.) — but keep a decision even if it names a
    value or tool (e.g. "px units throughout", "no React/SVG", "vanilla JS").
  - Write entries only on explicit user request; otherwise remind the user and print
    a work summary once the session's work is done.
- Ontology (which property names map to parent/child/jump) is user-configurable per editor (Logseq
  settings schema in `packages/logseq-plugin/src/index.ts`; Obsidian settings tab in
  `packages/obsidian-plugin/src/settings.ts`); the parser/defaults are `buildOntology` in
  `packages/core/src/ontology.ts`.

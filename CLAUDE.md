# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`logseq-synapses` — a **Logseq + Obsidian** plugin that lays out thoughts spatially (rendered here as
**Synapses**): the active thought centered, with parents above, children below, jumps to the left and
siblings to the right, and click-a-card-to-activate navigation, rendered in the **right sidebar**. The
Logseq target is the **0.10.x Markdown/file graph** — NOT the DB version (the DB version reworked
properties and the datascript schema). Plain **TypeScript** (no React, no SVG, no d3) by design.

## Repo layout (TypeScript monorepo)

> Some prose/code below uses older names; **the pre-monorepo `src/main/*` / `src/synapses/*` /
> `src/shared/rpc.js` paths are gone** — code now lives in npm workspaces under `packages/`.

- `packages/core` (`@logseq-synapses/core`) — editor-agnostic engine + view: graph link-index
  (`graph/index-pure.ts` + `graph/link-index.ts`), `mutations.ts`, `history.ts`, `ontology.ts`, the
  generic postMessage `transport.ts`, the view (`view/` — `view.ts`, `edges.ts`, `layout.ts`,
  `panzoom.ts`, `dialog.ts`, `theme.ts`, `handles.ts`, `edge-hit.ts`, `styles.css`), `app.ts` =
  `mountSynapses`, `backend.ts` = `createCoreBackend`.
- `packages/logseq-plugin` — Logseq adapter: M entry `src/index.ts` (has `logseq`), P iframe entry
  `src/frame.ts`, `sidebar.ts`, `datasource.ts`, `services.ts`.
- `packages/obsidian-plugin` — Obsidian adapter, **in-process `ItemView` (no iframe)**: `main.ts`,
  `view.ts`, `datasource.ts`, `services.ts`, `inline-fields.ts`, `dataview-map.ts`, `settings.ts`.

**Two-seam architecture:** the view consumes a high-level `SynapsesBackend`; each editor supplies a
`DataSource` (read/write properties + change events) + `EditorServices` (theme/assets/nav/ontology);
`createCoreBackend` implements the index lifecycle, mutations, history, and debounce once. A new editor
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

## Terminology

Canonical vocabulary for this project — use these terms in docs, comments, and UI copy. Many
**code symbols predate this glossary and keep their old names**; the mapping is called out so you can
connect prose to code.

- **Thought** — a piece of the user's content: a Logseq page/journal or an Obsidian note, backed by a
  file on disk. The central noun. (Older prose says *note*. "Page" still refers to the editor substrate —
  page properties, the page's first block, `getPage`.)
- **Card** — the on-screen box that represents a thought. (Code says *node*: `NODE` geometry,
  `nodeAdjacency`, the `<div>` elements.)
- **Link** — a connection between two thoughts. Each link **kind** is a many-to-many relationship,
  declared one direction via page properties; reciprocals are inferred and siblings computed. The
  in-memory index of all links is the **link index** (`packages/core/src/graph/`; historically the
  *relationship index* / `src/main/graph.js`).
- **Connector** — the line drawn on the `<canvas>` for a link. (Code says *edge*: `view/edges.ts`,
  `computeEdges`/`drawEdges`, `view/edge-hit.ts`.) Link is to connector as thought is to card — the
  relation vs. its drawing.
- **Active thought** — the thought currently centered; only the active thought's links are shown. (Code
  says *focus*: the `focus` field on `Graph`/layout, `GATES[zone].focus`.)
- **Activate** — to make a thought the active one: click its card, open its page in the editor, or
  create a new thought. (Older prose says *navigate* / *follow*.)
- **Recenter** — the camera glide that plays when you activate a different thought (the motion, not the
  action).

The four **link kinds**, named by where their cards sit relative to the active thought:

| Kind | Position | Detail |
|------|----------|-------|
| **Parent** | above | |
| **Child** | below, in two columns | |
| **Jump** | left | association link |
| **Sibling** | right | computed — the children of the active thought's parents (never declared directly) |

## Commands

- `npm run build` — builds all 3 packages (core `tsc -b`; logseq `vite` → `packages/logseq-plugin/dist/`;
  obsidian `esbuild` → `packages/obsidian-plugin/{main.js,styles.css}`). Add `-w <pkg>` to build one;
  `npm run dev -w <pkg>` to watch (reload the plugin in the editor to pick up the new bundle).
- `npm run typecheck` — tsc across all 3 packages. `npm test` — runs the vitest suite (the count isn't
  pinned here; run it to get the current number before relying on it). Single test:
  `npx vitest run <file>` or filter by name with `-t "<substring>"`.
- The view + the editor seams (datasource/services/iframe) need a live editor; the pure index, ontology,
  history, mutations, transport, and view geometry are unit-tested in `packages/core`.

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
- **Link index (`packages/core/src/graph/`) — the engine, and the source of most subtlety.** A thought's
  links come from page **properties** (`parent:: / child:: / jump::`), declared one direction; reciprocals
  (parent↔child) and symmetric jumps are inferred, siblings are computed. Built once, **patched immediately**
  on plugin writes, and **rebuilt debounced** on editor change events — the rebuild **replays unconfirmed
  patches** (`reconcilePatches` in `link-index.ts`) so a write isn't clobbered by a stale read.
- **Rendering (`packages/core/src/view/`):** `view.ts` manages absolutely-positioned `<div>` cards (keyed
  by name so positions tween) over a `<canvas>` connector layer (`edges.ts`); `layout.ts` is banded
  arithmetic; `panzoom.ts` centers on the **active thought** (the `focus` in code). `app.ts`
  (`mountSynapses`) is the orchestrator (navigation, history, create dialog, theme).
- **History is durable** (`history.ts` reducer, persisted via each editor's `EditorServices.persistence`),
  so it survives the Logseq iframe being re-injected when the sidebar re-renders.

## Critical invariants & gotchas

These are non-obvious and caused real bugs; respect them. (Several are Logseq-specific; Obsidian's seams
are `packages/obsidian-plugin/src/{datasource,services}.ts`.)

- **Editor reads can be stale right after a write.** Logseq's `getPage().properties` (and datascript
  `:block/refs`) and Obsidian's Dataview index both lag after a write. Therefore: reverse links are derived
  from page **properties**, never from datascript refs; never do an immediate index rebuild after a write —
  `reconcilePatches` replays unconfirmed `pendingPatches` onto each fresh build and only drops a patch once
  a read confirms it (or after `PATCH_TTL_MS`, so external removals eventually win). Keep the replay→swap
  synchronous (no `await` between them) or the race returns.
- **`window.prompt`/`alert` are blocked** in the sandboxed Logseq synapses iframe — use the in-iframe
  dialog (`packages/core/src/view/dialog.ts`), not native modals.
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
- The synapses skips re-rendering when the graph key is unchanged (anti-flicker on reconcile) — see
  `graphKey` in `packages/core/src/app.ts`.

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

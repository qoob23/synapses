# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`logseq-plex` — a Logseq plugin that lays out thoughts spatially: the focused note centered, with
parents above, children below, jumps/siblings to the sides, and click-to-recenter navigation, rendered
in the **right sidebar**. Target is the **Logseq 0.10.x Markdown/file graph** — NOT the DB version (the
DB version reworked properties and the datascript schema). Plain JS (no React, no SVG, no d3) by design.

## Commands

- `npm run build` — production build to `dist/` (Vite, two HTML entries).
- `npm run dev` — `vite build --watch` (rebuild on change). You still must reload the plugin in Logseq.
- `npm test` — run the vitest suite (`vitest run`).
- Single test: `npx vitest run src/main/graph.test.js` or filter by name with `-t "<substring>"`.

Only `src/main/graph.js`'s pure functions (`buildIndex`, `queryGraph`, `applyEdge`, `hasEdge`) are
unit-testable without Logseq — everything else needs the live `logseq` global.

## Loading & dev loop in Logseq (0.10.x)

1. Logseq → Settings → Advanced → **Developer mode** on.
2. Plugins → **Load unpacked plugin** → select the **project root** (the dir with `package.json`), NOT
   `dist/`. (`package.json`'s top-level `logseq.main` points at `dist/index.html`.)
3. After `npm run build`, **reload the plugin** (toggle it off/on) to pick up the new bundle.
4. Trigger the plex with the 🧠 toolbar button or the `/Plex: open in sidebar` slash command.
5. Verifying live behavior requires a real Logseq instance; there is no headless harness. A sample
   philosophy test graph is seeded in `../test_logseq_graph` (sibling dir).

## Architecture — the big picture

The plugin runs in **two separate browser documents** bridged by postMessage. Understanding this split
is essential; almost every file belongs to one side or the other.

```
M  src/main/*   plugin "main" iframe, registered by Logseq → HAS the `logseq` global.
P  src/plex/*   the plex UI, injected as an <iframe> into a right-sidebar slot → NO `logseq` global.
   src/shared/rpc.js   the postMessage bridge used by both.
```

- **Why two contexts:** a manually-injected iframe is not a registered plugin, so `@logseq/libs` will
  not connect inside it. Therefore **all Logseq reads/writes happen in M**; P is a pure view that calls
  M over RPC (`createClient`/`startServer` in `src/shared/rpc.js`). To add a capability, add an RPC
  handler in `src/main/index.js` and call it from P via `client.call('name', ...args)`.
- **Sidebar embedding (`src/main/sidebar.js`):** Logseq has no plugin-sidebar API. A dedicated host
  page `plex/host` holds one block `{{renderer :plex}}`; opening it via `openInRightSidebar` fires
  `onMacroRendererSlotted`, where M `provideUI`s an `<iframe>` (its `src` is set via the DOM, not the
  template, so DOMPurify can't strip it). Full-sidebar width is enforced with `:has()` **CSS** in
  `plexFrameStyle()`.
- **Relationship index (`src/main/graph.js`) — the core, and the source of most subtlety.** A note's
  relations come from page **properties** (`parent:: / child:: / jump::`), declared one direction;
  reciprocals (parent↔child) and symmetric jumps are inferred, siblings are computed. These live in an
  in-memory reciprocal index (`buildIndex`/`queryGraph`). The index is built once, **patched
  immediately** on plugin writes (`patchIndex`), and **rebuilt debounced** on `logseq.DB.onChanged`.
- **Rendering (`src/plex/`):** `view.js` manages absolutely-positioned `<div>` nodes (keyed by name so
  positions tween) over a `<canvas>` edge layer (`edges.js`); `layout.js` is banded arithmetic;
  `panzoom.js` centers on the **focus** (not the bounding box). `main.js` is the orchestrator
  (navigation, history, create dialog, theme).
- **History lives in M** (`histPush`/`histJump` in `index.js`), not P, so it survives the iframe being
  re-injected when Logseq re-renders the sidebar.

## Critical invariants & gotchas

These are non-obvious and caused real bugs; respect them.

- **Logseq reads are stale right after a write.** Both `:block/refs` (datascript) and
  `getPage().properties` lag for seconds after `upsertBlockProperty` until Logseq re-indexes. Therefore:
  - Reverse relationships are derived from page **properties**, never from datascript `:block/refs`.
  - Never do an immediate index rebuild after a write — it reads stale data and clobbers the patch.
    `rebuildIndex` **replays unconfirmed `pendingPatches`** onto each fresh build and only drops a patch
    once a read confirms it (or after `PATCH_TTL_MS`, so external removals eventually win). Keep
    rebuild's replay→swap synchronous (no `await` between them) or the race returns.
- **`window.prompt`/`alert` are blocked** in the sandboxed plex iframe — use the in-iframe dialog
  (`src/plex/dialog.js`), not native modals.
- **An iframe in an inline wrapper falls back to its ~300px intrinsic width**, ignoring `width:100%`.
  Fix width with persistent **CSS** (`:has()` in `plexFrameStyle`), not imperative JS — JS mutations get
  wiped when Logseq re-renders the sidebar on reload.
- **The iframe swallows mouse events during a sidebar resize drag**; `installDragPassthrough` toggles
  `pointer-events:none` while a drag started outside the iframe is in flight.
- **`onMacroRendererSlotted` fires repeatedly and with new slot ids**; `renderPlexSlot` dedupes and
  filters to the sidebar instance. Keep plex state in M or in P's module scope, never tied to a slot id.
- **Page properties live on the page's first block** — resolve `getPageBlocksTree(name)[0].uuid` before
  writing with `upsertBlockProperty`.
- The plex skips re-rendering when the graph key is unchanged (anti-flicker on reconcile) — see
  `graphKey` in `src/plex/main.js`.

## Pointers

- `README.md` — user-facing setup/validation steps.
- @WORKJOURNAL.md — dated log of what was built and why.
- Ontology (which property names map to parent/child/jump) is user-configurable via plugin settings;
  defaults are in `src/main/ontology.js`.

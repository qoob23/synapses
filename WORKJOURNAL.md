# Work Journal

## 2026-06-25
- Initial build (**logseq-plex**): TheBrain-style link UI, Logseq 0.10.15 Markdown graph; vanilla JS, no React/SVG.
    - Architecture: UI in a right-sidebar iframe over a postMessage RPC bridge to the plugin main context.
    - Data model: ExcaliBrain-style page properties (`parent:: / child:: / jump::`).
        - Declared one direction; reciprocals (parent↔child) inferred, siblings computed.
    - **Key decision:** in-memory link index built from properties, replacing the datascript `:block/refs` lookup.
        - Patched on writes; debounced rebuild replays unconfirmed patches to beat the stale-read race.
        - Settle window lets external removals still win; anti-flicker skips re-render when graph unchanged.
    - Rendering: `<div>` cards over a `<canvas>` connector layer.
        - Banded layout, active-centered fit, click-to-activate glide, pan/zoom.
    - Features: follow current page, back/forward + breadcrumb (history in the durable main context).
        - Create/link dialog with search, theme sync, live refresh.
    - Key fixes:
        - sibling edges drawn from the shared parent;
        - sidebar width via durable `:has()` CSS (iframe was stuck at intrinsic width in an inline wrapper);
        - drag passthrough so a sidebar resize isn't swallowed by the iframe.

## 2026-06-26
- **Phase 1 — monorepo + TypeScript (strict), editor-agnostic core.**
    - Two packages: `@logseq-synapses/core` (engine + view) and a thin `logseq-plugin`.
    - Two-seam: the view consumes a `SynapsesBackend`; each editor supplies a `DataSource` + `EditorServices`.
    - Shared `createCoreBackend` implements the index lifecycle, mutations, history, and debounce once.
    - Logseq's iframe/postMessage M↔P split became a generic transport in core; behaviour unchanged.
- **Phase 2 — Obsidian backend via Dataview** (proves the two-seam split: a new editor = two adapters).
    - Reads via Dataview (inline `parent::` + YAML, unified); writes inline fields after the frontmatter fence.
    - `SynapsesView extends ItemView` — in-process, no iframe; durable backend (gated on Dataview) / transient view.
    - Hardened `view.ts` `destroy()` (cancel rAF, remove stage listeners) for Obsidian's rapid mount/unmount.
- **Full BACKLOG implementation:**
    - history persisted to disk (`history.json`, pure reducer);
    - remove a link by hovering its connector (× → confirm → unlink);
        - kind-aware `reconcilePatches` so deletions aren't resurrected;
    - handles redesign — always-visible 3-state handles (`empty|shown|more`) on every card;
        - each draggable to create a link (drop on card = instant, drop on empty = dialog);
    - children in a 2-column grid; card geometry single-sourced (`NODE` → CSS vars).
- **UI polish:**
    - semi-transparent card backgrounds; larger card font;
    - spatial grouping — more space between zones than within;
    - history move-to-rightmost de-dupe; fixed iframe right-edge bleed.
- **Fluid recenter animation:**
    - appearing cards emerge from the activating card; disappearing cards collapse into the old active note;
    - respects `prefers-reduced-motion`;
    - dropped a `scale()` experiment (connectors overshot un-scaled card borders).
- **Edge/handle/unlink pass:**
    - hover-highlight the connector under the cursor; no highlight while the cursor is over a card;
    - jump-position cards put their handle on the right;
    - unlink control off the non-active card (× centered, Remove?/Cancel spread apart to avoid mis-clicks);
    - unlink a sibling from its shared parent via a pure `remove:{from,to,role}` edge descriptor.
- **Terminology pass (docs):** canonical glossary in `CLAUDE.md`.
    - note / card / link / connector / active note / activate / recenter;
    - `edge` kept as the code term; code symbols preserved verbatim; comments swept to match.

## 2026-06-27
- **Breadcrumb fixes in shared core (both editors inherit):**
    - fixed Obsidian clipping — fill the leaf container, not the viewport, so the height chain resolves;
    - crumb click re-activates (move-to-rightmost) instead of highlighting in place; arrows stay pointer-move.
- **Remember user zoom** — persist the wheel-zoom scale and reuse it on recenter (pure `computeFit`).
    - auto-fit scale is the ceiling so cards never overflow; both editors inherit it.
- **Obsidian default folder** — new notes go to the vault's configured default location, not the root.
- **Edit properties in place** — Obsidian updates a prefilled property where it already lives, not a duplicate.
    - YAML frontmatter (`processFrontMatter`) or an existing inline `key::` line; unlink clears both.
- **Layout** — dense, deterministic bands: the four directional zones grow outward from the active note.
    - horizontal fills the panel width; vertical is fixed.
- **Zoom removed** — the world only translates to center the active note (no camera scale), so text stays crisp.
    - replaced by a persisted +/− card/text size control, with drag-to-pan for overflow.
- **UI tweaks:**
    - content-sized card widths with hover tooltips for clamped titles;
    - px units throughout (no rem/pt);
    - tighter cards/handles with a small grab area to avoid accidental links;
    - toolbar button tooltips; dropped the redundant open-in-main-pane button.

## 2026-06-28
- **Toolbar ↻ "Rebuild from editor"** — hard-resets the index + pending patches and rebuilds purely from the editor.
    - real fix was Logseq-side: `listPages` gates on `page.file`, so phantom pages can't resurrect dead links;
        - phantom = deleted `.md` whose lingering property blocks used to re-enter the index without a manual re-index.
- **Color transparency floor** — clamp theme colors to opacity ≥ 0.5 (`clampColorAlpha`).
    - fixes Obsidian's translucent border rendering parent/child connectors invisible.
- **Retype an existing connection** — connecting an already-connected pair changes its type (one connection per pair).
    - new `rolesBetween` query + a `setLink`/`unlink` funnel drops every differing role on both sides before writing;
    - handles parent↔child flips and self-heals legacy multi-role pairs.
- **Ignore excluded + `logseq/` folders** — both adapters skip pages outside user content when building the index.
    - new pure `isInLogseqFolder` / `matchesIgnoreFilters` in core;
    - Obsidian honors its native `userIgnoreFilters` (which Dataview ignores) and always drops `logseq/`;
        - its `bak/` + `.recycle/` backups were indexed as phantom notes injecting phantom parent/child links;
    - Logseq datasource drops the same folder defensively when a file path is resolvable.
- **Mobile mode** — distinct touch UI behind a per-editor `mobile` flag + a "Mobile mode (testing)" toggle.
    - Obsidian auto-detects via `Platform.isMobile`; Logseq has no mobile runtime, so the toggle is the only signal;
    - handles inert — tap a connector to unlink; create via mobile-only toolbar buttons; taller touch cards;
    - title + back/forward dropped (breadcrumb is the nav);
    - activating a card recenters without switching the editor page (drawer stays open); active card opens in editor.
- **Wheel over the Logseq Synapses iframe scrolls the host right sidebar** (the view's `preventDefault` trapped it).
    - New symmetric client→server transport `post`/`onClientEvent` (mirrors `notify`); P forwards wheel deltas to M.
    - M scrolls the iframe's nearest scrollable ancestor; keeping `preventDefault` stops the browser double-scrolling.
- **Theme rework** — Logseq sidebar iframe adapts to the Logseq theme; connector colors reworked + in-view picker.

## 2026-06-29
- **Strict type-aware linter. ** typescript-eslint → `recommendedTypeChecked` via
  `projectService`; added eslint-plugin-import (`no-cycle`) + sonarjs (cognitive-complexity) + knip.
- **Two bugs fixed:**
    - Obsidian persistence lost-write race — all `data.json` writes serialize through one queue.
    - Drag-connect / connector-× unlink now surface write failures (flash) instead of swallowing them.
- **De-any to zero outside `transport.ts`:** typed backend event seam (`BackendEventPayloads`), core view
  (`LayoutResult`/`LayoutNode`/`ConnectorTheme`), and the Obsidian Dataview boundary.
- Added `errText` and a tiny `[synapses]` `log` util; dropped dev-noise console logs.
- **Deferred** (untested DOM, need live verification): createView decomposition + overlay-scaffold unification.

## 2026-06-30
- **Dropped the in-memory link index + optimistic updates — the editor is the index engine now.**
    - On-demand reads: a focus note's neighborhood = its own props + each parent's children (for siblings);
      no cache, no patch/reconcile, no debounce (`graphKey` absorbs the duplicate two-sided-write events).
    - Symmetric link properties: each kind is written on **both** pages (parent↔child, jump↔jump); reverse
      links are explicit, not inferred — no self-heal, no editor-backlink queries. Siblings stay computed.
    - No optimism: mutate, then wait for the editor's change event; corner spinner + ~2s watchdog renders
      best-effort + flashes a warning on silent failure. Toolbar ↻ is now a plain "Refresh from editor".
- **Opt-in JSONL debug file logging** (per-editor setting, off by default) to debug communication problems.
    - Five categories trace one interaction: user / call / edit / editor / ui; reads unlogged, array args
      collapsed to a count to stay terse.
    - `ctx` tags the origin context: Logseq's iframe (P) can't write files, so it forwards user/ui lines to M,
      which owns the single file + gates on the setting — a P line with no matching M `call` = dropped bridge.
    - Buffered sink: lazy-load to seed across reloads, ~1 MB rolling cap, debounced whole-file rewrite. Files:
      Obsidian `<plugin>/synapses-log.jsonl`; Logseq `<graph>/assets/storages/<id>/…`; path printed to console.
- **Removed history pruning + the missing-page guard entirely** (incl. `pageExists` / `histRemoveMissing`).
    - History is pruned only manually (right-click → Remove history); dropped the "no longer exists" flash.
    - Activating a referenced-but-not-yet-created card now renders empty + mirror-navigates, creating it in the
      editor (like clicking a [[link]]) instead of bouncing back to the current page.
- **Debug log starts fresh each session** — `BufferedSink.clear()` (guarded against a late seed) wipes the file
  when recording turns on (plugin load + enable-toggle, both editors); Logseq also `showMsg`s "recording is running".

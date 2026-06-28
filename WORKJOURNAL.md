# Work Journal

## 2026-06-25
- Built **logseq-plex**, a TheBrain-style link management for the Logseq 0.10.15 Markdown graph (Vite + vanilla JS, no React/SVG).
- **Architecture:** UI in an `<iframe>` injected into a right-sidebar `{{renderer :synapses}}` slot, talking to the plugin's main context over a postMessage RPC bridge.
- **Data model:** ExcaliBrain-style page properties (`parent:: / child:: / jump::`), one-directional declaration with reciprocal inference and computed siblings.
    - Replaced the unreliable datascript `:block/refs` reverse lookup with an **in-memory link index built from page properties** — patched on writes, debounced rebuild on `DB.onChanged` that **replays unconfirmed patches**.
    - Fixes the "edge appears then disappears" stale-read race (4s settle so external removals still win); anti-flicker skips re-render when the graph is unchanged.
- **Rendering:** HTML `<div>` cards + `<canvas>` connectors, banded layout, active-thought-centered fit, click-to-activate glide, pan/zoom.
- **Features:** follow current page, back/forward + breadcrumb (history in the durable main context), create/link dialog with search, theme sync, live refresh.
- **Key fixes:**
    - sibling edges drawn from the shared parent;
    - sidebar width via durable `:has()` CSS (iframe was stuck at ~300px intrinsic in an inline wrapper);
    - drag passthrough so sidebar resize isn't swallowed by the iframe.
- Multi-agent adversarial review of the index/race logic — clean. 10 vitest unit tests; seeded a philosophy test graph in `../test_logseq_graph`.

## 2026-06-26
- **Phase 1 — monorepo + TypeScript (strict) + editor-agnostic core.**
    - Two packages: `@logseq-synapses/core` (engine + view) and a thin `logseq-plugin`.
    - **Two-seam architecture:** the view consumes a high-level `SynapsesBackend`; each editor supplies only a `DataSource` (read/write properties, change events) + `EditorServices` (theme, assets, navigation); shared `createCoreBackend` implements the index lifecycle/mutations/history/debounce **once**.
    - Logseq's iframe/postMessage M↔P split became a generic transport in core; behaviour unchanged. Tests 77→88.
- **Phase 2 — Obsidian backend via Dataview** (proves the two-seam split: a new editor = two adapters).
    - Reads via Dataview API (inline `parent::` + YAML, unified); writes inline Dataview fields after the frontmatter fence (`vault.process`).
    - `SynapsesView extends ItemView` — **in-process, no iframe**; durable backend (gated on Dataview) / transient view, mirroring Logseq's split.
    - One core change: hardened `view.ts destroy()` (cancel rAF, remove stage listeners) for Obsidian's rapid mount/unmount. Tests 91→106.
- **Full BACKLOG implementation** (brainstorm→spec→plan→subagent TDD):
    - history **persisted to disk** (`history.json`, pure `history.js` reducer);
    - **remove a link by hovering its connector** (× → confirm → unlink, kind-aware `reconcilePatches` so deletions aren't resurrected);
    - **handles redesign** — always-visible 3-state handles (`empty|shown|more`) on every card, each **draggable to create a link** (drop on card = instant, drop on empty = dialog);
    - **children in a 2-column grid**; card geometry single-sourced (`NODE`→CSS vars). Tests 22→67.
- **UI polish:**
    - card font 1.7rem, semi-transparent backgrounds;
    - spatial grouping — more space between zones than within;
    - history **move-to-rightmost de-dupe**; iframe right-edge bleed.
- **Fluid recenter animation:**
    - grow-from / retract-to the active thought — appearing cards emerge from the activating card, disappearing cards collapse into the old active thought's new position;
    - 840ms glide + `prefers-reduced-motion`;
    - dropped a `scale()` experiment (connectors overshot un-scaled card borders).
- **Edge/handle/unlink pass:**
    - hover-highlight the connector under the cursor;
    - jump-position cards put their handle on the right;
    - unlink control anchored a fixed distance off the non-active card (centered ×, spread Remove?/Cancel to avoid accidental clicks);
    - **unlink a sibling from its shared parent** via a pure `remove:{from,to,role}` edge descriptor; no hover while over a card.
- **Terminology pass (docs):** canonical glossary in `CLAUDE.md` — thought / card / link / connector / active thought / activate / recenter; `edge` kept as code term; code symbols preserved verbatim. Comments swept to match.
- Process: heavy use of subagent-driven TDD + multi-agent adversarial reviews. Build clean throughout; tests 22→106 across the day.

## 2026-06-27
- Both breadcrumb fixes in **shared core**, so Logseq inherits them:
    - **Breadcrumb was clipped in Obsidian** — `#synapses-app { height: 100vh }` overflowed the leaf `contentEl` (a rendering, not data, bug). Fixed by filling the **container** (`height: 100%`) + `html,body{height:100%}` in `synapses.html` so the `%` chain resolves.
    - **Crumb click now re-activates** (move-to-rightmost) instead of highlighting in place; back/forward arrows stay pointer-move.
- **Remember user zoom** — persist the wheel-zoom scale (core `getZoom`/`setZoom` over the existing persistence seam) and reuse it on recenter via pure `computeFit`, with the auto-fit scale as a ceiling so cards never overflow; both editors inherit it.
- **Obsidian default folder** — new notes are created in the vault's configured "Default location for new notes" (`getNewFileParent`) instead of always at the root.
- **Edit properties in place** — Obsidian writes update a prefilled property where it already lives (YAML frontmatter via `processFrontMatter`, or an existing inline `key::` line anywhere in the note) instead of prepending a duplicate; unlink clears both; documented in README.
- **Layout:** dense, deterministic banded layout — the four directional zones sit in non-overlapping bands that grow outward from the active thought; horizontal fills the panel width, vertical is fixed.
- **Zoom:** removed entirely — the world only translates to center the active thought (no camera scale), so text stays crisp; replaced by a persisted +/− card/text size control, with drag-to-pan for overflow.
- **UI tweaks:** content-sized card widths with hover tooltips for clamped titles; px units throughout; tighter cards/handles with a small grab area to avoid accidental links; toolbar button tooltips; dropped the redundant open-in-main-pane button.

## 2026-06-28
- **Toolbar ↻ "Rebuild from editor"** — hard-resets the in-memory index + pending patches and rebuilds purely from the editor (new `link-index.hardReset` → backend `rebuildIndex`), forcing a full re-render; the real fix was Logseq-side: `listPages` now gates on `page.file`, so phantom datascript pages: deleted `.md` whose lingering property blocks resurrected dead links no longer re-enter the index without a manual re-index.
- **Color transparency floor** — theme colors are clamped to ≤50% transparency (opacity ≥ 0.5) in `applyTheme` via new pure `clampColorAlpha` (`packages/core/src/view/color.ts`), fixing Obsidian's translucent `--background-modifier-border` rendering parent/child connectors invisible.
- **Retype an existing connection** — connecting an already-connected pair now changes the connection's type (single source of truth: one connection per pair) instead of leaving both inline properties with an undefined winner: new `rolesBetween` index query + a `setLink`/`unlink` funnel in `mutations.ts` drops every differing role on both declaration sides before writing the new one (handles parent↔child flips and self-heals legacy multi-role pairs).

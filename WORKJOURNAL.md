# Work Journal

## 2026-06-25
- Built **logseq-plex**, a TheBrain-style "plex" plugin for the Logseq 0.10.15 Markdown graph (greenfield; Vite + vanilla JS, no React/SVG).
- Architecture: plex UI runs in an `<iframe>` injected into a right-sidebar `{{renderer :plex}}` slot, talking to the plugin's main context over a postMessage RPC bridge.
    - Validated the iframe-in-sidebar-slot approach end-to-end (Phase 0 GO).
- Data model: ExcaliBrain-style page properties (`parent:: / child:: / jump::`), one-directional declaration with reciprocal inference and computed siblings.
    - Replaced the unreliable datascript `:block/refs` reverse lookup with an in-memory relationship index built from page properties — patched on writes, rebuilt on `DB.onChanged` (fixes stale/late reverse relationships without re-indexing).
- Rendering: HTML `<div>` nodes + `<canvas>` connector edges, banded layout, focus-centered fit, click-to-recenter glide, pan/zoom.
- Features: follow current page, back/forward + breadcrumb (history kept in the durable main context), create/link dialog with search, theme sync, live refresh.
- Fixes this session: sibling edges drawn from the shared parent, sidebar width via durable `:has()` CSS (iframe was stuck at 300px intrinsic), drag passthrough so sidebar resize isn't swallowed by the iframe.
- 8 vitest unit tests for the relationship-index logic; seeded a philosophy test graph in `../test_logseq_graph`.
- Iteration from live testing:
    - Sidebar width: root-caused the ~300px iframe to it living in an **inline** wrapper (falls back to intrinsic width); fixed durably with `:has()` CSS (an imperative JS version worked on plugin-reload but was wiped on full Logseq reload).
    - Relationship freshness: replaced the immediate on-demand rebuild (which read still-stale `getPage().properties` after a write and clobbered patches → "edge appears then disappears") with build-once + immediate patches + a **debounced rebuild that replays unconfirmed patches** (4s settle so external removals still win).
    - Added anti-flicker: skip re-render when the graph is unchanged.
    - Ran a multi-agent **adversarial review** of the index/race logic (mocked Logseq + deterministic repros) — verified clean, no runtime bugs.
    - Confirmed in-app/plugin edits need no re-index (only external file edits do); no public re-index API.
- Tests now 10/10.

## 2026-06-26 — pre-feature checkpoint + full BACKLOG implementation
- **Checkpoint audit** (multi-agent, 8 dimensions: architecture, invariants, code quality, rendering, tests, docs, build, feature-readiness). Verdict: healthy — M/P split airtight, all critical invariants upheld. Landed 5 pre-feature cleanups: log the previously-swallowed `rebuildIndex`/`getAllPages` errors; extract the pure `reconcilePatches` replay loop out of `rebuildIndex` (+3 tests); add ontology tests (`roleForKey`/`normalizeKey`/`parseList`); single-source node geometry (`NODE` → `--plex-node-w/h` CSS vars, guarded by a test); fix the stale "Phase 0" README. Tests 10 → 22.
- **Implemented the entire BACKLOG** via brainstorm → spec → plan → subagent-driven TDD (fresh implementer per task, per-task spec+quality review, fix-loops, a final whole-branch review). Specs/plans under `docs/superpowers/`.
- Features shipped:
    - Layout/visual: iframe widened ~20px into the right gutter; node label font + box ~2× (spacing constants bumped so larger nodes don't overlap); **children in a 2-column grid** (`gridPositions`).
    - **History persisted to disk** (`history.json` via `logseq.Assets.makeSandboxStorage()`), survives Logseq restart; history state-machine extracted to a pure `src/main/history.js` (reducer + serialize/deserialize, unit-tested).
    - **Remove a link by hovering its connection line** (× → inline confirm → unlink). Backed by index `removeEdge`, a kind-aware `reconcilePatches` (`add`/`remove` patches so deletions aren't resurrected) + `patchRemove`, and an alias-aware `removeLink` mutation that strips the property from whichever page declares it.
    - **Handles redesign** (replaces the old passive dots + focus-only gates, per a mid-session BACKLOG expansion): always-visible 3-state handles on **every** node — outlined = no connection, blue-filled = all shown, green-filled = hidden links exist — computed from a new `nodeAdjacency` RPC + pure `classifyHandle`/`nodeHandleStates`. Every handle is **draggable to create a connection for its own node**: drop on a node = instant link, drop on empty = search/create dialog positioned at the drop point. Dialog param `focus`→`sourcePage` + clamped positioning; bigger remove-hover radius; breadcrumb head-right ordering confirmed.
    - Foundation refactors enabling the above: `edges.js` split into pure `computeEdges` (retained, hit-testable edge list) + `drawEdges`; pure `screen↔world` helpers in `panzoom.js`; pure `edge-hit.js` (bézier sampling + point-to-polyline distance).
- Process notes:
    - The mid-session BACKLOG expansion (draggable 4-state handles on every node) was turned into a verified task breakdown by a **multi-agent design workflow** (parallel data/state + render/interaction designs → adversarial verification of the 4-state data flow and pointer-event arbitration → synthesized T9a–T9g task plan); its 10 must-fixes (canonical `empty|shown|more` states, lowercased rendered-set, unconditional `stopPropagation`, DOM hit-test at drop, navToken guards, `screenToWorld` dependency, dialog rename) were baked into the tasks.
    - One MEDIUM defect caught in review and fixed: a sub-threshold tap on a non-focus node's handle was creating a link for the plex focus instead of that node.
    - Final whole-branch review: ready to merge, no Critical/Important findings; all five architecture invariants upheld in the assembled state.
- Tests 22 → 67; production build clean.
- **Pending:** manual validation in a live Logseq 0.10.x instance for the live-only features (handle drag end-to-end, remove-on-hover, 3-state rendering, +20px width, history-file persistence) — no headless coverage by design.

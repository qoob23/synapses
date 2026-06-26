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

## 2026-06-26 — UI nuance/polish pass (post-BACKLOG, on `main`)
- Live-tuned the look after merging the BACKLOG branch; seven requested nuances plus a spatial-tuning follow-up. Everything lands in CSS or layout/fit constants — no behavioural rewrites.
- **Cards:** label font moved to a `rem` size (settled at **1.7rem** after live iteration 2→1.5→1.7), corner radius **18→10px**, vertical padding **6→2px** + `line-height:1.1`, and **semi-transparent backgrounds** (`color-mix(… transparent)`; focus is a translucent accent tint kept legible by its border + glow + weight). Cards shortened: `NODE.H` **52→40** with the font sized so content stays under `min-height`, so cards pin to exactly `NODE.H` and the canvas edge-gates still meet their borders.
- **Handles:** dots now grow **2×** on hover (was 1.2×).
- **Spatial grouping** (more space *between* zones, less *within*): `BAND_Y` 150→210, `BAND_X` 300→360, `GAP_X` 240→224, `GAP_Y` 72→54, child-grid `rowGap` `NODE.H+28`→`+14`. Inter/intra spacing ratio went ~3×→~10× so parent/child/jump/sibling clusters read as distinct; the no-overlap floors (`GAP_X≥NODE.W`, `GAP_Y≥NODE.H`) still hold and are test-guarded.
- **Working-space margin:** split `panzoom.fit`'s single `pad=52` into `padX`/`padY`; `padX→16` so the (now wider) graph fills the panel horizontally — the `min(sx,sy,1.15)` clamp still prevents vertical overflow.
- **Edge-remove UX:** added a **Cancel** button beside "Remove?" (previously only dismissable by leaving the iframe). Restructured the floating control into a `.plex-edge-actions` wrapper, **left-anchored** so arming the confirm expands rightward instead of sliding the just-clicked button out from under the cursor.
- **History:** re-activating a note now **moves it to the right-most breadcrumb slot** (de-dupe) instead of duplicating — `pushEntry` filters the retained slice before appending; back/forward (`jumpTo`) untouched. +1 unit test.
- **iframe** right-edge bleed **20→40px**.
- Verified with a 3-lens adversarial review (coverage / regressions / CSS-geometry): 0 blockers; confirmed each change actually takes effect (e.g. `--plex-node-font` is never set in JS so the CSS fallback is authoritative; the `.confirm` reveal beats `display:none` on specificity; the history de-dupe can't corrupt `idx` or back/forward). Tests **67→68**, production build clean.
- **Pending (live-only):** eyeball the 40px bleed (could clip the right-most breadcrumb crumb / `↗` button if it overshoots the gutter) and overall density at 1.7rem.

## 2026-06-26 — fluid, role-aware card animation (on `main`)
- Reworked the plex recenter animation so card appearance/disappearance reads as *natural* and *ontology-aware*, and the whole motion feels calmer. Brainstormed first (two decisions locked with the user: **motion model = grow-from / retract-to the focus**, symmetric; **feel = gentle, all-together**, no cascade).
- **Card reuse already existed** (elements keyed by lowercased name → CSS `transform` transition glides a clicked neighbor to center). The eagerness came from *new* and *dropped* cards, which this pass fixes:
    - **New cards now grow out of the focus's gate on their own side** (parent→top, child→bottom, jump→left, sibling→right) while fading in, instead of all spawning at the dead center `{0,0}` at full opacity. Origin comes from a new pure helper **`focusGatePoint(zone)`** in `edges.js` that reuses the existing `GATES[zone].focus` mapping + `gatePoint`, so the emergence point can never drift from where the connector actually attaches.
    - **Dropped cards now retract back into the focus along their OLD direction** (`el._zone`) while fading out — the mirror of the entry — instead of fading in place.
    - **Reused cards** keep gliding directly old→new (now via an explicit early-`continue` branch in `setGraph`).
- **Softer timing:** `320→420ms`, easing `cubic-bezier(0.4,0,0.2,1)` → `(0.22,1,0.36,1)` (fast out, slow settle so the graph *unfolds*), fade `0.3s`. Added a `prefers-reduced-motion: reduce` block that drops the glide/fade entirely.
- **Adversarial review** (multi-agent, 4 lenses: state-machine, geometry/matrix-invariant, regressions/interruption, CSS; each finding refuted by two skeptics). The core invariant — that `getComputedStyle().transform`'s `m41/m42` still recover the card **center** so edges/handles/drag stay aligned — was proven to hold. The **only** confirmed issue: an early experiment added a `scale(0.9)` grow, but `gatePoint` uses *unscaled* half-dims, so the connector overshot a still-shrunken card's border by up to ~10.4px (jump/sibling) mid-tween. **Resolved by dropping the scale** — the grow-from-focus feel is fully carried by the translate-origin + fade, so removing scale eliminates the gap (connectors dock exactly every frame), keeps the approved motion, and leaves no unused `scale` param behind.
- New: `focusGatePoint` unit tests in `edges.test.js`. Tests **68→70**, production build clean.
- **Pending (live-only):** eyeball the recenter glide in a real Logseq 0.10.x instance — confirm parents/children/jumps/siblings visibly emerge from / retract toward the focus and the 420ms ease reads as "less eager." (Out of scope, possible fast-follow: the world zoom/pan re-fit still snaps instantly between focuses; smoothing it cleanly needs the canvas transform tweened in lockstep to avoid edge/node desync.)

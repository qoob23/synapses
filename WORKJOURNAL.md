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

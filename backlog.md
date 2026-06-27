# Backlog

## Card distribution should adapt to the panel aspect ratio (esp. tall/narrow panels)

**Status:** later (flagged 2026-06-27 with desired-vs-actual screenshots).

**Desired** (ExcaliBrain-style): cards spread to use the *whole* canvas — active thought
centered, parent(s) above, jumps balanced down the left, children/siblings balanced down
the right, vertical AND horizontal space filled, no overlaps.

**Actual** (Obsidian sidebar, a tall/narrow portrait panel): the four zones (parents = top
row, children = bottom grid, jumps = left column, siblings = right column) don't have
enough *horizontal* room, so:
- The left jump column (pulled in to `minBandX` on a narrow panel) and the bottom child
  grid's left column land in overlapping screen regions → **cards overlap** (e.g.
  "Nicomachean Ethics" / "Ethics" sitting on top of each other).
- The layout reads lopsided — most cards crammed left, the right half underused — instead
  of the balanced left/right fill in the desired shot.

**Insight to use:** the panel often has *more vertical than horizontal* space. The current
responsive spacing fills each axis independently but keeps the fixed top/bottom/left/right
zone assignment, which fits a landscape panel, not a portrait one.

**Fix directions (decide later):**
- Make zone placement aspect-ratio-aware: on a portrait panel, give the left/right columns
  more horizontal separation (or distribute jumps+siblings into taller, well-separated
  columns) and ensure the child grid can't collide with the side columns.
- Guarantee no cross-zone overlap (the bottom child grid vs. the side columns) — today
  only within-zone spacing is collision-checked.
- Consider matching ExcaliBrain's balanced fill more directly.

Self-contained context lives in the responsive `computeSpacing` in
`packages/core/src/view/layout.ts` (`bandX`/`bandY`/`step` clamps) — start there.

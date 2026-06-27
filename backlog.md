# Backlog

## ✅ Card distribution adapts to the panel aspect ratio — DONE (2026-06-27)

Reworked the responsive layout into **zoned vertical bands**: parents TOP, jumps/siblings
MIDDLE (centred on the focus, hugging the L/R edges), children BOTTOM. Because the four
directional zones are Y-separated, they can't overlap however wide the cards get — which
also frees the children grid to spread wide without pushing the side columns off-screen.
Children keep a 2-column grid with a responsive `childGap`. See `computeSpacing` in
`packages/core/src/view/layout.ts`; covered by the "keeps the four zones from overlapping"
tests.

### Follow-ups (smaller, later)
- Tune the constants on real graphs: `MAX_BAND_X/Y`, `MIN/MAX_VGAP`, `MIN/MAX_CHILD_GAP`,
  `PAD_X/Y`, and the `childGap = vp.w * 0.16` factor.
- Narrow panel + many wide children: the 2-column grid can exceed the panel width and rely
  on pan. If that feels bad, consider shrinking `childGap` further (or a 1-column fallback)
  below a width threshold.
- Many jumps/siblings on a short panel: `colStep` floors and the column can spill past the
  middle band (harmless at the edges, but worth revisiting if it ever reaches the children).

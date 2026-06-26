# Plex for Logseq

A Logseq plugin that lays out your thought links as a focused graph: the active thought sits in the
center with its **parents above, children below, jumps to the left, siblings to the right**; clicking a
card **activates** that thought (the plex recenters on it). Built for the **Markdown graph (Logseq 0.10.x)**.

This plugin was written with LLM assistance.

Links are declared with page properties (ExcaliBrain-style), on a page's first block:

```md
parent:: [[Philosophy]]
child:: [[Ethics]], [[Logic]]
jump:: [[Aristotle]]
```

You only declare one direction — the reciprocal (parent↔child) and symmetric jumps are inferred, and
siblings are computed.

## Status

Basic features are ready and fully functional.

## Develop

```sh
npm install      # first time
npm run build    # produces dist/  (or: npm run dev  to rebuild on change)
npm test         # run the unit tests (vitest)
```

## Load in Logseq (0.10.x)

1. Logseq → **Settings → Advanced → Developer mode** = on.
2. **Plugins → Load unpacked plugin** → select this project's **root** folder (the one with
   `package.json`, *not* `dist/`).
3. Click the **🧠** toolbar button, or run the slash command **`/Plex: open in sidebar`**.

## Inspiration & credits

- **[TheBrain](https://www.thebrain.com)** — the spatial "Plex" interface, with the active thought
  centered and its relations fanning out around it, is the inspiration for this plugin's layout.
- **[Logseq](https://logseq.com)** — the host application this plugin extends; it provides the
  Markdown graph, page properties, and plugin platform everything here is built on.

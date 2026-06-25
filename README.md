# Plex for Logseq (TheBrain-style)

A Logseq plugin that recreates **TheBrain's "Plex"** for note links: the focused note sits in the
center with its **parents above, children below, jumps to one side, siblings to the other**; clicking a
node **recenters** the plex on it. Built for the **Markdown graph (Logseq 0.10.x)**.

Relationships are declared with page properties (ExcaliBrain-style), on a page's first block:

```md
parent:: [[Philosophy]]
child:: [[Ethics]], [[Logic]]
jump:: [[Aristotle]]
```

You only declare one direction — the reciprocal (parent↔child) and symmetric jumps are inferred, and
siblings are computed.

## Status

**Phase 0 — bridge spike.** Validates the hard part: the plex renders in the **real right sidebar** as
an injected iframe talking to the plugin over a postMessage bridge. The current view is a simple HTML
"cross" layout (positioned nodes + canvas edges come in Phase 2).

## Develop

```sh
npm install      # first time
npm run build    # produces dist/  (or: npm run dev  to rebuild on change)
```

## Load in Logseq (0.10.x)

1. Logseq → **Settings → Advanced → Developer mode** = on.
2. **Plugins → Load unpacked plugin** → select this project's **root** folder (the one with
   `package.json`, *not* `dist/`).
3. Click the **🧠** toolbar button, or run the slash command **`/Plex: open in sidebar`**.

## Validate the spike

1. Create pages `Philosophy`, `Ethics`, `Logic`, `Aristotle`.
2. On `Ethics`, add `parent:: [[Philosophy]]` and `jump:: [[Aristotle]]`. On `Logic`, add
   `parent:: [[Philosophy]]`.
3. Open the plex; visit `Philosophy` → you should see `Ethics` and `Logic` as **children**.
4. Visit `Ethics` → `Philosophy` as parent, `Logic` as **sibling**, `Aristotle` as **jump**.
5. Click a node → the plex recenters and the main pane follows.
6. Use a `+ child / parent / jump` button → confirm the focus page's `.md` file gains the property.

If the iframe shows nothing, open the devtools console for messages prefixed `[plex]`.

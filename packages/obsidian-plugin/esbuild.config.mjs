import esbuild from 'esbuild'
import { copyFileSync, existsSync, renameSync } from 'node:fs'
const prod = process.argv.includes('production')

// The repo-root manifest.json is the single source of truth — Obsidian's community
// submission reads it from the repo root, so it must live there. Mirror it next to
// main.js after each build so this folder, symlinked into a vault, is a complete
// loadable plugin (the copy is gitignored). Also rename the bundled CSS: with
// `outfile: 'main.js'` esbuild emits the sibling `main.css`, but Obsidian only
// auto-loads a file literally named `styles.css`. Both fire in watch mode too.
const syncArtifacts = {
  name: 'sync-obsidian-artifacts',
  setup(build) {
    build.onEnd(() => {
      if (existsSync('main.css')) renameSync('main.css', 'styles.css')
      copyFileSync('../../manifest.json', 'manifest.json')
    })
  },
}

const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'cjs',
  target: 'es2022',
  platform: 'browser',
  outfile: 'main.js',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  external: ['obsidian', 'electron', '@codemirror/state', '@codemirror/view', '@lezer/common', 'node:*'],
  loader: { '.css': 'css' },
  plugins: [syncArtifacts],
})
if (prod) { await ctx.rebuild(); await ctx.dispose() } else { await ctx.watch() }

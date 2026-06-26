import esbuild from 'esbuild'
import { existsSync, renameSync } from 'node:fs'
const prod = process.argv.includes('production')

// With `outfile: 'main.js'`, esbuild names the bundled CSS sibling `main.css`,
// but Obsidian only auto-loads a file literally named `styles.css`. Rename it
// after every build (fires in watch mode too).
const renameCss = {
  name: 'rename-css',
  setup(build) {
    build.onEnd(() => {
      if (existsSync('main.css')) renameSync('main.css', 'styles.css')
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
  plugins: [renameCss],
})
if (prod) { await ctx.rebuild(); await ctx.dispose() } else { await ctx.watch() }

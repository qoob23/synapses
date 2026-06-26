import esbuild from 'esbuild'
const prod = process.argv.includes('production')
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
})
if (prod) { await ctx.rebuild(); await ctx.dispose() } else { await ctx.watch() }

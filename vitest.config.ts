import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    // Process CSS imports so `import x from './styles.css?raw'` returns the real
    // file text (vitest stubs CSS imports to empty by default). Lets the
    // CSS<->NODE parity guard read styles.css without node:fs, keeping core
    // source editor-agnostic / node-free at typecheck.
    css: true,
    include: ['src/**/*.test.{js,ts}', 'packages/**/src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/.claude/**', '**/dist/**'],
  },
})

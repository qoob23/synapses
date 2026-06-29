import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Flat config (ESLint 9). Non-type-checked typescript-eslint: fast, no
// parserOptions.project needed. Policy: `any` is a hard ERROR in the Logseq
// markdown plugin (so `logseq as any` can't regress), and a WARN everywhere
// else so core/obsidian's pragmatic boundary `any` stays visible but non-blocking.
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'packages/obsidian-plugin/main.js',
      'packages/obsidian-plugin/styles.css',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // TypeScript already resolves the ambient `logseq` global and every browser/DOM
    // symbol via the type system (and `npm run typecheck` enforces it); ESLint's
    // no-undef can't see types, so it would false-positive on all of them.
    files: ['**/*.ts'],
    rules: { 'no-undef': 'off' },
  },
  {
    // Build/config scripts run in Node — give them Node globals (process, etc.).
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Repo-wide default — surfaced, non-blocking.
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // The codebase uses guarded `cb && cb()` short-circuit calls; allow them
      // while still catching genuinely dead expression statements.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    },
  },
  {
    // The markdown plugin is held to a hard standard: no `any`, no dead code.
    files: ['packages/logseq-plugin/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
)

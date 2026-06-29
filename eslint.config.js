import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import sonarjs from 'eslint-plugin-sonarjs'

// Flat config (ESLint 9), TYPE-AWARE. `projectService` builds type info from each
// package's tsconfig (co-located *.test.ts are already in the src/**/*.ts include
// globs), unlocking the correctness rule surface (floating/misused promises, unsafe
// `any` flows, exhaustiveness) that non-type-checked linting cannot see.
//
// Policy:
//  - Correctness rules are a hard ERROR everywhere — these catch real bugs.
//  - The `any` cascade (no-explicit-any + no-unsafe-*) is a WARN in core/obsidian
//    (the pragmatic boundary `any` stays visible but non-blocking) and ERROR in the
//    logseq markdown plugin (already any-free; it can't regress). The plan is to
//    RATCHET these to ERROR per-package as counts hit zero — `transport.ts` is the
//    one documented allowlist (a generic reflective postMessage bridge).
//  - High-churn stylistic/type rules land as WARN so the build never breaks in one
//    shot; they are ratchet candidates.
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
  ...tseslint.configs.recommendedTypeChecked,

  // Type-aware parser. projectService auto-creates inferred projects per tsconfig;
  // no second tsconfig and no per-package wiring needed.
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    // TypeScript resolves the ambient `logseq` global and every DOM symbol via the
    // type system (and `npm run typecheck` enforces it); ESLint's no-undef can't see
    // types, so it would false-positive on all of them.
    rules: { 'no-undef': 'off' },
  },

  // import plugin — structural enforcement of the two-seam (acyclic) architecture.
  // The node resolver is taught about `.ts` so relative imports resolve for no-cycle.
  {
    files: ['**/*.ts'],
    plugins: { import: importPlugin },
    settings: {
      'import/resolver': { node: { extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'] } },
    },
    rules: {
      'import/no-cycle': ['error', { ignoreExternal: true }],
      'import/order': ['warn', {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
        alphabetize: { order: 'asc', caseInsensitive: true },
        'newlines-between': 'never',
      }],
      // import/no-unresolved intentionally OFF — typecheck already guarantees resolution.
    },
  },

  // Repo-wide rule policy (applies after the spread presets so these win).
  {
    files: ['**/*.ts'],
    plugins: { sonarjs },
    rules: {
      // --- existing policy, preserved ---
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],

      // --- correctness, locked at ERROR (already at zero violations) ---
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-for-in-array': 'error',
      // WARN (not ERROR): the autofix wrongly stripped a load-bearing `as CardEl | null`
      // (closest() returns Element) — the rule false-positives on `x && x.closest()` unions.
      // Kept on to surface genuine redundant casts, but it must not autofix-break the build.
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',

      // --- correctness, WARN now → RATCHET to ERROR in Phase 3 ---
      // These have existing violations concentrated in files the cleanup passes rewrite
      // (app.ts/dialog.ts/backend.ts/transport.ts + the logseq adapter). Landing them as WARN
      // keeps every commit green; each pass clears its files, then these graduate to ERROR.
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/await-thenable': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      '@typescript-eslint/no-confusing-void-expression': ['warn', { ignoreArrowShorthand: true }],
      '@typescript-eslint/unbound-method': 'warn',
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
      // WARN permanently: the DataSource/EditorServices adapters implement Promise-returning
      // interface methods whose bodies are legitimately synchronous (`async foo() { return x }`
      // is cleaner than `foo() { return Promise.resolve(x) }`). Not a correctness bug.
      '@typescript-eslint/require-await': 'warn',

      // --- normalization: ERROR + autofix ---
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'separate-type-imports' }],
      '@typescript-eslint/consistent-type-exports': 'error',

      // --- the any cascade: WARN in core/obsidian (logseq overrides to ERROR below) ---
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',

      // --- opinionated / high-churn: WARN (ratchet candidates) ---
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/restrict-template-expressions': ['warn', { allowNumber: true, allowBoolean: true }],
      '@typescript-eslint/restrict-plus-operands': 'warn',
      'sonarjs/cognitive-complexity': ['warn', 20],
      'sonarjs/no-identical-functions': 'warn',
    },
  },

  // logseq-plugin — hard standard: explicit `any` and dead code stay ERROR (existing,
  // already at zero). The NEW no-unsafe-* family is WARN here too for now (1 violation at the
  // transport/wheel boundary) and ratchets to ERROR in Phase 3 once that boundary is typed.
  {
    files: ['packages/logseq-plugin/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Tests — relax the any/unsafe surface (mocks, casts, partial fixtures are expected).
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // unbound-method is famously noisy in tests (referencing methods inside expect()).
      '@typescript-eslint/unbound-method': 'off',
      'sonarjs/no-identical-functions': 'off',
    },
  },

  // Build/config scripts run in Node and live outside any tsconfig — no type-aware
  // linting (disableTypeChecked turns off the typed rules + drops the project requirement).
  {
    files: ['**/*.{js,cjs,mjs}', '**/*.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
)

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
//  - Correctness rules that catch real bugs are a hard ERROR everywhere: no-floating-promises,
//    no-misused-promises, switch-exhaustiveness, no-for-in-array.
//  - The `any` cascade (no-explicit-any + no-unsafe-*) is ERROR everywhere — it has been driven
//    to zero across all of core (except transport.ts), the obsidian adapter, and the logseq
//    adapter. The sole allowlist is `transport.ts` (a generic reflective postMessage bridge),
//    pinned back to WARN in a per-file override below.
//  - A few type-aware rules stay WARN — false-positive-prone on imprecise external types or
//    pure-style ratchet candidates: await-thenable + no-confusing-void-expression (defensive
//    awaits on @logseq/libs calls whose types declare void), no-unnecessary-type-assertion
//    (its autofix once stripped a load-bearing cast), unbound-method, no-base-to-string,
//    no-redundant-type-constituents, require-await (async interface conformance), and the
//    opinionated prefer-nullish / restrict-* / sonarjs rules.
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.claude/**', // session scratch + transient agent git worktrees (gitignored)
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

      // --- correctness, ERROR (driven to zero) ---
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-for-in-array': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // --- WARN: false-positive-prone on imprecise external types / ratchet candidates ---
      // no-unnecessary-type-assertion: its autofix once stripped a load-bearing `as CardEl | null`
      //   (closest() returns Element); it false-positives on `x && x.closest()` unions.
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      // await-thenable + no-confusing-void: fire on defensive awaits of @logseq/libs calls whose
      //   types declare void; removing the awaits risks a real timing change in untested code.
      '@typescript-eslint/await-thenable': 'warn',
      '@typescript-eslint/no-confusing-void-expression': ['warn', { ignoreArrowShorthand: true }],
      '@typescript-eslint/no-base-to-string': 'warn',
      '@typescript-eslint/unbound-method': 'warn',
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
      // adapters implement Promise-returning interface methods with sync bodies (interface conformance).
      '@typescript-eslint/require-await': 'warn',

      // --- normalization: ERROR + autofix ---
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'separate-type-imports' }],
      '@typescript-eslint/consistent-type-exports': 'error',

      // --- the any cascade: ERROR everywhere (transport.ts is pinned back to WARN below) ---
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',

      // --- opinionated / high-churn: WARN (ratchet candidates) ---
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/restrict-template-expressions': ['warn', { allowNumber: true, allowBoolean: true }],
      '@typescript-eslint/restrict-plus-operands': 'warn',
      'sonarjs/cognitive-complexity': ['warn', 20],
      'sonarjs/no-identical-functions': 'warn',
    },
  },

  // transport.ts — the documented `any` allowlist. A generic reflective postMessage bridge
  // (handler maps, dynamic dispatch, untyped message payloads); end-to-end types are enforced
  // at the typed serve/proxy edge (the BACKEND_METHODS completeness check), so the interior
  // stays `any`. Pinned to WARN so it surfaces without blocking.
  {
    files: ['packages/core/src/transport.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
    },
  },

  // logseq-plugin — hard standard: unused vars / dead code are ERROR here (stricter than the
  // repo-wide warn). The any cascade is already ERROR repo-wide.
  {
    files: ['packages/logseq-plugin/**/*.ts'],
    rules: {
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

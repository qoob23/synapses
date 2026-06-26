import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{js,ts}', 'packages/**/src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/.claude/**', '**/dist/**'],
  },
})

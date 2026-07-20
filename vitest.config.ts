import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import JSON5 from 'json5'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

function json5Plugin(): Plugin {
  return {
    name: 'json5',
    transform(code, id) {
      if (!id.endsWith('.json5')) return undefined
      const parsed = JSON5.parse(code)
      return { code: `export default ${JSON.stringify(parsed)}`, map: null }
    },
  }
}

const shared = {
  // biome-ignore lint/suspicious/noExplicitAny: vite v7/v8 Plugin type mismatch
  plugins: [vue() as any, json5Plugin() as any],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
}

export default defineConfig({
  ...shared,
  test: {
    globals: true,
    passWithNoTests: true,
    projects: [
      {
        ...shared,
        test: {
          name: 'unit',
          include: [
            'src/**/*.test.ts',
            'tests/utils/**/*.test.ts',
            'tests/core/**/*.test.ts',
            'tests/stores/**/*.test.ts',
            'tests/composables/**/*.test.ts',
            'tests/theme/**/*.test.ts',
          ],
          exclude: ['src/**/*.dom.test.ts'],
          environment: 'node',
        },
      },
      {
        ...shared,
        test: {
          name: 'dom',
          include: ['src/**/*.dom.test.ts', 'tests/adapters/**/*.test.ts'],
          environment: 'happy-dom',
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/main.ts'],
    },
  },
})

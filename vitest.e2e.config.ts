import { defineConfig } from 'vitest/config'

/**
 * E2E テスト (#702) — 実アプリ (デバッグビルド) を隔離プロファイルで起動し、
 * HTTP API (port 19820) 経由で駆動する。`pnpm test` (unit/dom) とは独立で、
 * `pnpm test:e2e` でのみ実行する。
 *
 * 前提: `src-tauri/target/debug/notedeck` がビルド済みであること
 * (cargo build)。バイナリの場所は NOTEDECK_E2E_BINARY で上書き可能。
 */
export default defineConfig({
  test: {
    name: 'e2e',
    include: ['tests/e2e/**/*.test.ts'],
    environment: 'node',
    globals: true,
    // アプリ起動 (cold start + WebView) を含むため長めに取る
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // アプリは 19820 を 1 つしか bind できないため直列実行
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})

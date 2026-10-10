import { defineConfig } from 'vitest/config'

/**
 * E2E テスト (#702) — 実アプリ (デバッグビルド) を隔離プロファイルで起動し、
 * HTTP API (開発版のポート、tests/e2e/harness.ts) 経由で駆動する。`pnpm test` (unit/dom) とは独立で、
 * `pnpm test:e2e` でのみ実行する。
 *
 * 前提: `target/debug/notedeck` (workspace root) がビルド済みであること
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
    // アプリは HTTP API のポートを 1 つしか bind できないため直列実行
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})

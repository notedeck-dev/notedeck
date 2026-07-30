import { createMisskeyAdapter } from './misskey'
import type { ServerAdapter, ServerInfo, ServerSoftware } from './types'

type AdapterFactory = (
  info: ServerInfo,
  accountId: string,
  hasToken?: boolean,
) => ServerAdapter

const registry = new Map<ServerSoftware, AdapterFactory>()

export function registerAdapter(
  software: ServerSoftware,
  factory: AdapterFactory,
): void {
  registry.set(software, factory)
}

/** GitHub URL から owner/repo を抽出 */
const GITHUB_REPO_RE = /github\.com\/([^/]+\/[^/]+)/

/**
 * nodeinfo から ServerSoftware (owner/repo 形式) を解決する。
 *
 * 検出優先順位:
 * 1. nodeinfo 2.1 の software.repository（GitHub URL から owner/repo を抽出）
 *    → "misskey" と名乗りつつ独自改変しているフォークも正確に識別可能
 * 2. software.name（フォールバック: nodeinfo 2.0 や repository 未設定の場合）
 *
 * Misskey を名乗り続けるフォーク（STRATEGY.md 参照）のみ対象。
 */
export function resolveSoftware(
  name: string,
  repositoryUrl?: string,
): ServerSoftware {
  // 1. repository URL から owner/repo を抽出（最も正確）
  if (repositoryUrl) {
    const match = repositoryUrl.match(GITHUB_REPO_RE)
    if (match?.[1]) {
      const ownerRepo = match[1].toLowerCase().replace(/\.git$/, '')
      // 既知のフォークなら型安全なリテラルを返す
      if (ownerRepo === 'misskey-dev/misskey') return 'misskey-dev/misskey'
      if (ownerRepo === 'yamisskey-dev/yamisskey')
        return 'yamisskey-dev/yamisskey'
      if (ownerRepo === 'lqvp/misskey-tempura') return 'lqvp/misskey-tempura'
      // 未知だが Misskey 系なら本家扱い
    }
  }

  // 2. software.name によるフォールバック
  const n = name.toLowerCase()
  if (n === 'yamisskey') return 'yamisskey-dev/yamisskey'
  if (n === 'misskey-tempura' || n === 'tempura') return 'lqvp/misskey-tempura'
  if (n === 'misskey' || n.includes('misskey')) return 'misskey-dev/misskey'
  return 'unknown'
}

export function createAdapter(
  info: ServerInfo,
  accountId: string,
  hasToken = true,
): ServerAdapter {
  const factory =
    registry.get(info.software) ?? registry.get('misskey-dev/misskey')
  if (!factory) {
    throw new Error(
      `No adapter registered for "${info.software}" and no fallback adapter found`,
    )
  }
  return factory(info, accountId, hasToken)
}

export function getRegisteredSoftware(): ServerSoftware[] {
  return [...registry.keys()]
}

// Misskey 本家アダプターをデフォルトとして登録。
// フォーク固有アダプターが必要な場合、ここに追加登録する。
registerAdapter('misskey-dev/misskey', createMisskeyAdapter)

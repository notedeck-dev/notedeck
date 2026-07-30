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

interface ForkDefinition {
  id: ServerSoftware
  /** UI に出す表示名 */
  displayName: string
  /** NoteDeck が対応しているか。未対応フォークは識別のみ行う (#853) */
  supported: boolean
  /** nodeinfo software.name (lowercase) の一致候補 */
  names: string[]
}

/**
 * 既知の Misskey 系ソフトウェア。対応するのは「Misskey を名乗り続けるフォーク」
 * のみ (STRATEGY.md)。名前が乖離したフォークも識別して「未対応」と名指しする。
 */
const FORKS: ForkDefinition[] = [
  {
    id: 'misskey-dev/misskey',
    displayName: 'Misskey',
    supported: true,
    names: ['misskey'],
  },
  {
    id: 'yamisskey-dev/yamisskey',
    displayName: 'yamisskey',
    supported: true,
    names: ['yamisskey'],
  },
  {
    id: 'lqvp/misskey-tempura',
    displayName: 'Misskey tempura',
    supported: true,
    names: ['misskey-tempura', 'tempura'],
  },
  {
    id: 'iceshrimp/iceshrimp',
    displayName: 'Iceshrimp',
    supported: false,
    names: ['iceshrimp', 'iceshrimp.net'],
  },
  {
    id: 'kokonect-link/cherrypick',
    displayName: 'CherryPick',
    supported: false,
    names: ['cherrypick'],
  },
  {
    id: 'sharkey/sharkey',
    displayName: 'Sharkey',
    supported: false,
    names: ['sharkey'],
  },
]

/**
 * nodeinfo から ServerSoftware (owner/repo 形式) を解決する。
 *
 * 検出優先順位:
 * 1. nodeinfo 2.1 の software.repository（GitHub URL から owner/repo を抽出）
 *    → "misskey" と名乗りつつ独自改変しているフォークも正確に識別可能
 * 2. software.name（フォールバック: nodeinfo 2.0 や repository 未設定の場合、
 *    および GitHub 外でホストされているフォーク）
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
      const fork = FORKS.find((f) => f.id === ownerRepo)
      if (fork) return fork.id
      // 未知だが Misskey 系なら本家扱い
    }
  }

  // 2. software.name によるフォールバック
  const n = name.toLowerCase()
  const fork = FORKS.find((f) => f.names.includes(n))
  if (fork) return fork.id
  if (n.includes('misskey')) return 'misskey-dev/misskey'
  return 'unknown'
}

/** NoteDeck が対応しているソフトウェアか。未対応フォーク・未知は false。 */
export function isSupportedSoftware(software: ServerSoftware): boolean {
  return FORKS.some((f) => f.id === software && f.supported)
}

/** UI 表示用のソフトウェア名。識別できていない場合は null。 */
export function softwareDisplayName(software: ServerSoftware): string | null {
  return FORKS.find((f) => f.id === software)?.displayName ?? null
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

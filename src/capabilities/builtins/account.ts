import type { Command } from '@/commands/registry'
import { stripCredentials } from '@/composables/useAiSystemContext'
import { useAccountsStore } from '@/stores/accounts'

/**
 * `account.current` — 現在 active なアカウント情報を返す read 系 capability。
 *
 * `permissions: ['account.read']` を要求するので、ai.json5 が `readonly`
 * 以上のプリセットなら通る。stripCredentials を念のため通して credential
 * 系フィールドを除去する (Account 型自体には現状 token は含まれないが、
 * 将来の漏洩シナリオ対策)。
 */
export const accountCurrentCapability: Command = {
  id: 'account.current',
  label: '現在のアカウント情報',
  icon: 'ti-user',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.read'],
  signature: {
    description:
      'ユーザーが今フォーカスしている (active) アカウントの情報を返す。' +
      ' Misskey サーバーの host や displayName, username 等が含まれる。' +
      ' 認証トークンは含まれない。',
    params: {},
    returns: {
      type: 'object',
      description:
        '`{ id, host, userId, username, displayName, avatarUrl, software, hasToken }`' +
        ' (アクティブなアカウントが無いときは null)',
    },
    // store lookup のみ、API 呼び出しなし
    cheap: true,
  },
  visible: false,
  execute: () => {
    const account = useAccountsStore().activeAccount
    return account ? stripCredentials(account) : null
  },
}

/**
 * `account.list` — ログイン中の全アカウントを返す。
 */
export const accountListCapability: Command = {
  id: 'account.list',
  label: 'アカウント一覧',
  icon: 'ti-users',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.read'],
  signature: {
    description:
      'NoteDeck にログイン中の全アカウントを配列で返す。複数サーバーを' +
      ' 横断したい場合に使う。認証トークンは含まれない。',
    params: {},
    returns: {
      type: 'array',
      description: 'Account の配列',
    },
    // store lookup のみ、API 呼び出しなし
    cheap: true,
  },
  visible: false,
  execute: () => {
    return stripCredentials(useAccountsStore().accounts)
  },
}

/**
 * `account.switch` — グローバルなアクティブアカウントを切り替える write 系。
 *
 * 「メインアカウントを別の人格に切り替えて」というユーザー指示を AI が代行
 * する想定。可逆 / 対外性なし / 破壊的でないため塞ぐリスト外 (memory:
 * feedback_ai_capability_scope)。auth_start / logout_account / delete_account
 * とは性質が異なる。
 *
 * permissions: `account.write` を要求する。default プリセット (`safe` /
 * `readonly`) では拒否され、`full` (= user explicit) のみ通る。
 */
export const accountSwitchCapability: Command = {
  id: 'account.switch',
  label: 'アクティブアカウント切替',
  icon: 'ti-switch-horizontal',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.write'],
  signature: {
    description:
      'グローバルなアクティブアカウントを切り替える。新規カラム追加や' +
      ' AI チャット送信時のデフォルト送信元が変わる。可逆 (元のアカウントに' +
      ' 戻せる)、ログアウト・アカウント削除はしない。',
    params: {
      id: {
        type: 'string',
        description:
          'account.list で得られるアカウント ID。存在しない ID は失敗する。',
      },
    },
    returns: {
      type: 'object',
      description: '`{ ok: true, id }` (切替後の active account id)',
    },
    cheap: true,
  },
  visible: false,
  preflight: (params) => {
    const id = (params as { id?: unknown } | undefined)?.id
    if (typeof id !== 'string' || id.length === 0) {
      return { error: 'id (string) is required' }
    }
    if (!useAccountsStore().accounts.some((a) => a.id === id)) {
      return { error: `account "${id}" is not logged in` }
    }
    return null
  },
  execute: (params) => {
    const id = (params as { id: string }).id
    useAccountsStore().switchAccount(id)
    return { ok: true, id }
  },
}

export const ACCOUNT_BUILTIN_CAPABILITIES: readonly Command[] = [
  accountCurrentCapability,
  accountListCapability,
  accountSwitchCapability,
]

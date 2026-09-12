import type { Command } from '@/commands/registry'
import { stripCredentials } from '@/composables/useAiSystemContext'
import { useAccountsStore } from '@/stores/accounts'

/**
 * `account.current` — 呼び出し文脈のアカウント情報を返す read 系 capability。
 * per-account の AI カラムやノートのメニューから起動したプラグインには文脈
 * アカウントがあり、全アカウントのカラムや HEARTBEAT には無い (null)。
 * 「アクティブアカウント」は廃止した (#941)。
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
      '呼び出し文脈のアカウント (per-account の AI カラムならそのアカウント)' +
      ' の情報を返す。全アカウントのカラムや HEARTBEAT では null。' +
      ' Misskey サーバーの host や displayName, username 等が含まれる。' +
      ' 認証トークンは含まれない。',
    params: {},
    returns: {
      type: 'object',
      description:
        '`{ id, host, userId, username, displayName, avatarUrl, software, hasToken }`' +
        ' (文脈アカウントが無いときは null)',
    },
    // store lookup のみ、API 呼び出しなし
    cheap: true,
  },
  visible: false,
  execute: (_params, ctx) => {
    const id = ctx?.accountId
    const account = id ? useAccountsStore().accountMap.get(id) : undefined
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

export const ACCOUNT_BUILTIN_CAPABILITIES: readonly Command[] = [
  accountCurrentCapability,
  accountListCapability,
]

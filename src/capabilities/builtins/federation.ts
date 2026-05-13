import { initAdapterFor } from '@/adapters/factory'
import type {
  ApiAdapter,
  FederationInstanceSort,
  FederationInstancesParams,
} from '@/adapters/types'
import type { Command } from '@/commands/registry'
import { useAccountsStore } from '@/stores/accounts'

/**
 * Federation (Misskey 連合) 系 capability。サーバー間連合の統計と
 * 連合先インスタンス情報を AI から read-only で取得できる。
 *
 * permission: `account.read`。サーバー側公開情報を返すだけ、認証なしでも
 * 一部取れるが NoteDeck の adapter は ログイン状態を前提にしているので
 * account.read に乗せる。
 *
 * adapter にあるが本 PR では未公開:
 * - getServerNotesChart / getServerUsersChart / getApRequestChart /
 *   getServerDriveChart … サーバー管理者向けで AI 利用シナリオが薄い
 */

const VALID_SPANS = ['day', 'hour'] as const
type Span = (typeof VALID_SPANS)[number]

const VALID_SORTS: readonly FederationInstanceSort[] = [
  '+pubSub',
  '-pubSub',
  '+notes',
  '-notes',
  '+users',
  '-users',
  '+following',
  '-following',
  '+followers',
  '-followers',
  '+firstRetrievedAt',
  '-firstRetrievedAt',
  '+latestRequestSentAt',
  '-latestRequestSentAt',
] as const

async function getApiAdapter(
  accountId: string | undefined,
): Promise<ApiAdapter> {
  const store = useAccountsStore()
  const id = accountId ?? store.activeAccountId
  if (!id) throw new Error('No active account')
  const acc = store.accounts.find((a) => a.id === id)
  if (!acc) throw new Error(`Account "${id}" not found`)
  const { adapter } = await initAdapterFor(acc.host, acc.id)
  return adapter.api
}

function pickString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

function pickNumber(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return v
}

function pickBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function pickSpan(v: unknown): Span {
  const s = pickString(v) ?? 'day'
  if (!(VALID_SPANS as readonly string[]).includes(s)) {
    throw new Error(
      `federation.chart: invalid span "${s}". Valid: ${VALID_SPANS.join(', ')}`,
    )
  }
  return s as Span
}

const ACCOUNT_ID_PARAM_DESC =
  'どのアカウントで実行するか。未指定なら active アカウント。' +
  ' 別サーバーのカラムから操作するときは `<currentColumn>.accountId` を渡す。'

export const federationChartCapability: Command = {
  id: 'federation.chart',
  label: '連合チャート',
  icon: 'ti-chart-line',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.read'],
  signature: {
    description:
      '自インスタンスの連合チャート (day/hour 単位の時系列) を返す。' +
      ' インバウンド/アウトバウンドの送受信数、配送先サーバー数等を含む。',
    params: {
      span: {
        type: 'string',
        description: 'チャート粒度: day / hour (default: day)',
        enum: VALID_SPANS,
        optional: true,
      },
      limit: {
        type: 'number',
        description: '時系列の長さ (default 30、最大 90)',
        optional: true,
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: { type: 'object', description: 'FederationChart' },
    cheap: true,
  },
  visible: false,
  execute: async (params) => {
    const span = pickSpan(params?.span)
    const limit = Math.min(pickNumber(params?.limit) ?? 30, 90)
    const accountId = pickString(params?.accountId)
    const api = await getApiAdapter(accountId)
    return await api.getFederationChart(span, limit)
  },
}

export const federationInstancesCapability: Command = {
  id: 'federation.instances',
  label: '連合先インスタンス一覧',
  icon: 'ti-network',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.read'],
  signature: {
    description:
      '連合済みインスタンスの一覧を返す (read-only)。sort で並べ替え可。' +
      ' host を指定すると部分一致絞り込み。host filter で host = ホスト名そのもの。',
    params: {
      limit: {
        type: 'number',
        description: '取得件数 (default 30)',
        optional: true,
      },
      offset: {
        type: 'number',
        description: 'offset (default 0)',
        optional: true,
      },
      sort: {
        type: 'string',
        description: '並び順 (default -pubSub)',
        enum: VALID_SORTS,
        optional: true,
      },
      host: {
        type: 'string',
        description: 'host 名で絞り込み (部分一致)',
        optional: true,
      },
      blocked: {
        type: 'boolean',
        description: 'ブロック中のみ',
        optional: true,
      },
      notResponding: {
        type: 'boolean',
        description: '応答なしのみ',
        optional: true,
      },
      suspended: {
        type: 'boolean',
        description: 'suspended のみ',
        optional: true,
      },
      federating: {
        type: 'boolean',
        description: '連合中のみ',
        optional: true,
      },
      subscribing: {
        type: 'boolean',
        description: '購読中のみ',
        optional: true,
      },
      publishing: {
        type: 'boolean',
        description: '配信中のみ',
        optional: true,
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: { type: 'array', description: 'FederationInstance の配列' },
    cheap: true,
  },
  visible: false,
  execute: async (params) => {
    const sortRaw = pickString(params?.sort)
    if (
      sortRaw !== undefined &&
      !(VALID_SORTS as readonly string[]).includes(sortRaw)
    ) {
      throw new Error(
        `federation.instances: invalid sort "${sortRaw}". Valid: ${VALID_SORTS.join(', ')}`,
      )
    }
    const accountId = pickString(params?.accountId)
    const api = await getApiAdapter(accountId)
    const req: FederationInstancesParams = {
      limit: pickNumber(params?.limit),
      offset: pickNumber(params?.offset),
      sort: sortRaw as FederationInstanceSort | undefined,
      host: pickString(params?.host) ?? null,
      blocked: pickBoolean(params?.blocked) ?? null,
      notResponding: pickBoolean(params?.notResponding) ?? null,
      suspended: pickBoolean(params?.suspended) ?? null,
      federating: pickBoolean(params?.federating) ?? null,
      subscribing: pickBoolean(params?.subscribing) ?? null,
      publishing: pickBoolean(params?.publishing) ?? null,
    }
    return await api.getFederationInstances(req)
  },
}

export const federationInstanceCapability: Command = {
  id: 'federation.instance',
  label: '連合先インスタンス詳細',
  icon: 'ti-server',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.read'],
  signature: {
    description: '指定 host の連合先インスタンス詳細を返す (read-only)。',
    params: {
      host: { type: 'string', description: 'ホスト名 (例: yami.ski)' },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: { type: 'object', description: 'FederationInstance' },
    cheap: true,
  },
  visible: false,
  execute: async (params) => {
    const host = pickString(params?.host)
    if (!host) throw new Error('federation.instance: host is required')
    const accountId = pickString(params?.accountId)
    const api = await getApiAdapter(accountId)
    return await api.getFederationInstance(host)
  },
}

export const FEDERATION_BUILTIN_CAPABILITIES: readonly Command[] = [
  federationChartCapability,
  federationInstancesCapability,
  federationInstanceCapability,
]

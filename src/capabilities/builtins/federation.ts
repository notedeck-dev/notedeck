import type {
  FederationInstanceSort,
  FederationInstancesParams,
} from '@/adapters/types'
import type { Command } from '@/commands/registry'
import { getApiAdapter } from '../accountContext'
import { implement } from '../declare'

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

export const federationChartCapability = implement('federation.chart', {
  execute: async (params, ctx) => {
    const span = pickSpan(params?.span)
    const limit = Math.min(pickNumber(params?.limit) ?? 30, 90)
    const api = await getApiAdapter(params?.accountId, ctx)
    return await api.getFederationChart(span, limit)
  },
})

export const federationInstancesCapability = implement('federation.instances', {
  execute: async (params, ctx) => {
    const sortRaw = pickString(params?.sort)
    if (
      sortRaw !== undefined &&
      !(VALID_SORTS as readonly string[]).includes(sortRaw)
    ) {
      throw new Error(
        `federation.instances: invalid sort "${sortRaw}". Valid: ${VALID_SORTS.join(', ')}`,
      )
    }
    const api = await getApiAdapter(params?.accountId, ctx)
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
})

export const federationInstanceCapability = implement('federation.instance', {
  execute: async (params, ctx) => {
    const host = pickString(params?.host)
    if (!host) throw new Error('federation.instance: host is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    return await api.getFederationInstance(host)
  },
})

export const FEDERATION_BUILTIN_CAPABILITIES: readonly Command[] = [
  federationChartCapability,
  federationInstancesCapability,
  federationInstanceCapability,
]

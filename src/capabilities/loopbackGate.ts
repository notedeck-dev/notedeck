/**
 * プラグインの `http.fetch` が手元のポート (loopback) を指すときの判定 (#1293)。
 *
 * dispatcher が `http.fetch` × plugin principal のときだけ、通常の確認の前に呼ぶ。
 * 分類 (宣言 / 同意 / 本文の一致) は Rust の command `http_loopback_classify` が
 * 答え、ここは規則の順序とダイアログを担う。TS 側の判定は拒否にしか使わず、
 * 許可は Rust の記録 (同意) でだけ決まる。
 *
 * 規則 (URL が loopback の 3 表記のとき、上から順):
 * 1. 呼び出し元の連鎖に自分以外の principal が居れば拒否 (AI / 別のプラグイン /
 *    外部トークン経由では届かない)
 * 2. ウィジェット / Play / Page (id に `:` を含む) は対象外
 * 3. 常に拒否するポート (自アプリ / ブラウザが繋がない / 危険なローカルサービス)
 * 4. 宣言が無い → 拒否 (確認は出さない)
 * 5. 動作中の本文が古い → 拒否 (再起動)
 * 6. 未同意 × 実行の起点が UI → 同意ダイアログ。承認 = 記録 (1 回だけの承認は
 *    無い)。この承認はその要求の確認も兼ねる。未同意 × それ以外 → 拒否
 * 7. 同意済み → 従来の `http.fetch` の確認に戻る
 */

import type { LoopbackClassification } from '@/bindings'
import { i18n } from '@/i18n'
import type { Principal } from '@/permissions/principal'
import {
  isAlwaysDeniedLoopbackPort,
  type LoopbackDenialReason,
  loopbackPortOf,
} from '@/services/loopbackPorts'
import type { ConfirmDecision, ConfirmOptions } from '@/stores/confirm'
import { usePluginsStore } from '@/stores/plugins'
import { commands, unwrap } from '@/utils/tauriInvoke'

export type LoopbackGateResult =
  /** loopback 宛ではない / 同意済み: 従来の流れ (権限 → 確認 → 実行) へ */
  | { kind: 'pass'; port: number | null }
  /** 同意ダイアログで承認された (記録済み)。この要求の確認は兼ねている */
  | { kind: 'consented'; port: number }
  /** 同意ダイアログをキャンセルした */
  | { kind: 'cancelled'; port: number }
  | { kind: 'denied'; port: number | null; reason: LoopbackDenialReason }

/** dispatcher から渡す呼び出しの文脈 (DispatchContext の写し) */
export interface LoopbackGateContext {
  principal: Principal
  onBehalfOf?: readonly Principal[]
  /** 実行の起点。'ui' のときだけ同意ダイアログを出す */
  origin?: 'ui' | 'other'
  /** 動かしている本文の hash (起動時に Rust が計算したもの) */
  pluginBodyHash?: string
}

export interface LoopbackGateOptions {
  /** notecore が既に確認を済ませた実行: ダイアログは出さず、未同意なら拒否 */
  preConfirmed?: boolean
  confirmFn?: (opts: ConfirmOptions) => Promise<ConfirmDecision>
}

/** 差し替え可能な依存 (テスト用)。既定は Rust の command */
export interface LoopbackGateDeps {
  classify: (
    url: string,
    pluginId: string,
    bodyHash: string,
  ) => Promise<LoopbackClassification>
  grant: (pluginId: string, port: number, expectedHash: string) => Promise<void>
  confirm: (opts: ConfirmOptions) => Promise<ConfirmDecision>
  describePlugin: (pluginId: string) => {
    name?: string
    author?: string
    origin?: string
  }
}

async function defaultConfirm(opts: ConfirmOptions): Promise<ConfirmDecision> {
  const { useConfirm } = await import('@/stores/confirm')
  return useConfirm().confirmWithDecision(opts)
}

const defaultDeps: LoopbackGateDeps = {
  classify: async (url, pluginId, bodyHash) =>
    unwrap(await commands.httpLoopbackClassify(url, pluginId, bodyHash)),
  grant: async (pluginId, port, expectedHash) => {
    unwrap(await commands.loopbackConsentGrant(pluginId, port, expectedHash))
  },
  confirm: defaultConfirm,
  describePlugin: (pluginId) => {
    const item = usePluginsStore().get(pluginId)
    return item
      ? {
          name: item.name,
          author: item.extra.author,
          origin: item.store?.id,
        }
      : {}
  },
}

/** Rust の `LOOPBACK_*` の code を拒否の理由に写す。それ以外は null */
export function loopbackReasonFromCode(
  code: unknown,
): LoopbackDenialReason | null {
  switch (code) {
    case 'LOOPBACK_NOT_ELIGIBLE':
      return 'notEligible'
    case 'LOOPBACK_SELF_PORT':
      return 'selfPort'
    case 'LOOPBACK_UNDECLARED':
      return 'undeclared'
    case 'LOOPBACK_STALE':
      return 'stale'
    case 'LOOPBACK_NOT_GRANTED':
      return 'notGranted'
    default:
      return null
  }
}

/** 連鎖に自分以外の principal が居るか (自分の Nd:call で積まれる自分自身は除く) */
function hasForeignCaller(ctx: LoopbackGateContext): boolean {
  if (ctx.principal.kind !== 'plugin') return true
  const self = ctx.principal.pluginId
  return (ctx.onBehalfOf ?? []).some(
    (p) => !(p.kind === 'plugin' && p.pluginId === self),
  )
}

/** 同じプラグイン × ポートの同意ダイアログは同時に 1 枚 */
const inflight = new Map<string, Promise<unknown>>()

function requestLine(params: Record<string, unknown> | undefined): string {
  const method =
    typeof params?.method === 'string' ? params.method.toUpperCase() : 'GET'
  let path = '/'
  try {
    path = new URL(String(params?.url)).pathname
  } catch {
    /* URL として読めなければ "/" */
  }
  return `${method} ${path}`
}

/** 運用ログ用: method と path (query 無し) */
export function loopbackRequestLine(
  params: Record<string, unknown> | undefined,
): string {
  return requestLine(params)
}

export async function gateLoopbackFetch(
  params: Record<string, unknown> | undefined,
  ctx: LoopbackGateContext,
  options: LoopbackGateOptions = {},
  deps: LoopbackGateDeps = defaultDeps,
): Promise<LoopbackGateResult> {
  const port = loopbackPortOf(params?.url)
  if (port === null) return { kind: 'pass', port: null }
  if (hasForeignCaller(ctx)) return { kind: 'denied', port, reason: 'chain' }
  if (ctx.principal.kind !== 'plugin') {
    return { kind: 'denied', port, reason: 'chain' }
  }
  const self = ctx.principal
  const pluginId = self.pluginId
  if (pluginId.includes(':')) {
    return { kind: 'denied', port, reason: 'notEligible' }
  }
  if (isAlwaysDeniedLoopbackPort(port)) {
    return { kind: 'denied', port, reason: 'selfPort' }
  }
  const bodyHash = ctx.pluginBodyHash ?? ''
  const url = String(params?.url)
  const key = `${pluginId}:${port}`
  // 先に出ているダイアログがあれば、閉じるのを待ってから分類をやり直す
  // (一括解決で後続の要求の確認を飛ばさない)
  for (;;) {
    const pending = inflight.get(key)
    if (!pending) break
    await pending.catch(() => undefined)
  }
  const c = await deps.classify(url, pluginId, bodyHash)
  if (!c.loopback) return { kind: 'pass', port: null }
  if (c.alwaysDenied) return { kind: 'denied', port, reason: 'selfPort' }
  if (!c.declared) return { kind: 'denied', port, reason: 'undeclared' }
  if (c.stale) return { kind: 'denied', port, reason: 'stale' }
  if (c.granted) return { kind: 'pass', port }
  if (ctx.origin !== 'ui' || options.preConfirmed) {
    return { kind: 'denied', port, reason: 'notGranted' }
  }
  const dialog = (async (): Promise<LoopbackGateResult> => {
    const about = deps.describePlugin(pluginId)
    const name = about.name ?? self.name ?? pluginId
    const opts: ConfirmOptions = {
      title: i18n.tsx._dispatcher.loopbackConsentTitle({
        name,
        port: String(port),
      }),
      message: [
        requestLine(params),
        i18n.tsx._dispatcher.loopbackConsentOrigin({
          author:
            about.author ?? i18n.ts._dispatcher.loopbackConsentUnknownAuthor,
          origin: about.origin ?? i18n.ts._dispatcher.loopbackConsentLocal,
          id: pluginId.slice(0, 8),
        }),
        i18n.ts._dispatcher.loopbackConsentWarning,
      ].join('\n'),
      okLabel: i18n.ts._dispatcher.loopbackConsentOk,
      cancelLabel: i18n.ts._common.cancel,
      type: 'danger',
      // NoteDeck 本体の確認 (プラグインの Mk:confirm はこれを立てられない)
      trusted: true,
    }
    const decision = await (options.confirmFn ?? deps.confirm)(opts)
    if (!decision.accepted) return { kind: 'cancelled', port }
    try {
      // 記録 = 承認。引数は Rust が検証する (本文が差し替わっていれば拒む)
      await deps.grant(pluginId, port, bodyHash)
    } catch {
      return { kind: 'denied', port, reason: 'stale' }
    }
    return { kind: 'consented', port }
  })()
  inflight.set(key, dialog)
  try {
    return await dialog
  } finally {
    if (inflight.get(key) === dialog) inflight.delete(key)
  }
}

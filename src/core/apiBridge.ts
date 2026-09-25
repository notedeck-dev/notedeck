import { emit } from '@tauri-apps/api/event'
import {
  dispatchCapability,
  previewConfirmation,
} from '@/capabilities/dispatcher'
import { sanitizeToolName } from '@/capabilities/identifier'
import { listCapabilities } from '@/capabilities/registry'
import { useCommandStore } from '@/commands/registry'
import {
  beginTurnExecution,
  endTurnExecution,
} from '@/composables/aiTurnExecutions'
import { reloadAiConfig, useAiConfig } from '@/composables/useAiConfig'
import {
  buildAiContextBlock,
  projectMemos,
} from '@/composables/useAiSystemContext'
import { ensureMemosLoaded, loadAllMemos } from '@/composables/useMemos'
import { listStreamHealth } from '@/core/streamHealth'
import type { ProfiledPrincipalId } from '@/permissions/principal'
import { PERMISSION_KEYS } from '@/permissions/schema'
import {
  reloadPermissionsConfig,
  resolveForProfiled,
} from '@/permissions/store'
import { listBoundedCacheStats } from '@/services/boundedCache'
import { useAccountsStore } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import { useDeckStore } from '@/stores/deck'
import { useLogsStore } from '@/stores/logs'
import { useStreamInspectorStore } from '@/stores/streamInspector'
import { formatLocalTimestamp } from '@/utils/aiSessionId'
import { timestampTitle } from '@/utils/aiSessionTitle'
import { getStartupEntries, getWebviewFixedCost } from '@/utils/startupTrace'
import { listenTauri } from '@/utils/tauriEvents'

export interface QueryRequest {
  id: string
  type: string
  params: Record<string, unknown>
}

type QueryHandler = (params: Record<string, unknown>) => unknown

/**
 * Query Bridge トレース (#977 / #897 の IPC 可視化)。往復ごとに種別と
 * 所要時間を記録するリングバッファ。'querybridge/trace' 自身は記録しない
 * (自己汚染防止)。
 */
const QUERY_TRACE_MAX = 100
const queryTrace: { at: number; type: string; ms: number; error: boolean }[] =
  []

function recordQueryTrace(type: string, ms: number, result: unknown) {
  if (type === 'querybridge/trace') return
  queryTrace.unshift({
    at: Date.now(),
    type,
    ms: Math.round(ms * 10) / 10,
    error:
      typeof result === 'object' &&
      result !== null &&
      !Array.isArray(result) &&
      'error' in result,
  })
  if (queryTrace.length > QUERY_TRACE_MAX) queryTrace.length = QUERY_TRACE_MAX
}

const handlers: Record<string, QueryHandler> = {
  'deck/columns': () => {
    const deck = useDeckStore()
    return deck.columns
  },

  'deck/active': () => {
    const deck = useDeckStore()
    return {
      columnId: deck.activeColumnId,
    }
  },

  'commands/list': () => {
    const commandStore = useCommandStore()
    const cmds = [...commandStore.commands.values()].map((cmd) => ({
      id: cmd.id,
      label: cmd.label,
      icon: cmd.icon,
      category: cmd.category,
      enabled: cmd.enabled?.() !== false,
      visible: cmd.visible !== false,
    }))
    return cmds
  },

  // /api/health のフロント側パート: WebView 死活の証明 + ストリーム接続状態
  'health/streams': () => listStreamHealth(),

  // --- dev ダッシュボード向け読み取り診断 (#977) ---
  // ephemeral トークン (dev) 前提。永続トークン (external principal) には
  // permissions_gate の route_rule が既定 Deny を返すので開かない

  'startup/trace': () => ({
    entries: getStartupEntries(),
    webviewFixedCost: getWebviewFixedCost(),
  }),

  // HEARTBEAT daemon (notecore) がデバイスに要るもの (#1133 縦切り 5): メモ等の
  // 文脈ブロックと、セッション id / タイトル用のローカル時刻の刻印。届かなければ
  // notecore は無しで進む (notecored)
  'heartbeat/context': async (params) => {
    const { config } = useAiConfig()
    const accountsStore = useAccountsStore()
    await ensureMemosLoaded()
    // メモはアカウントに紐づかない (#1018) ので全件見る。chat と同じく
    // memosConfig の excludeTags / expandLinks / includeBacklinks を尊重 (#492 / #494)
    const all = loadAllMemos()
    const memosCfg = config.value.dataSources.memosConfig
    const memos = projectMemos(Object.entries(all), {
      excludeTags: memosCfg?.excludeTags,
      expandLinks: memosCfg?.expandLinks !== false,
      includeBacklinks: memosCfg?.includeBacklinks !== false,
      allMemosByAccount: new Map([['', all]]),
    })
    // ラベル付きのメモを文脈に入れたら system を untrusted 側に置く (#1103)
    const untrusted = memos.some((m) => all[m.id]?.data.tainted === true)
    const system = buildAiContextBlock(config.value, {
      currentAccount: null,
      currentColumn: null,
      memos,
      accounts: accountsStore.accounts,
    })
    const now = new Date(
      typeof params.triggeredAtMs === 'number'
        ? params.triggeredAtMs
        : Date.now(),
    )
    return {
      system,
      untrusted,
      localStamp: formatLocalTimestamp(now),
      localTitleTime: timestampTitle(now, '').trim(),
    }
  },
  'permissions/resolved': () => {
    const principals: ProfiledPrincipalId[] = [
      'ai.chat',
      'ai.heartbeat',
      'plugin',
      'external',
      'scratchpad',
    ]
    return {
      keys: PERMISSION_KEYS,
      principals: Object.fromEntries(
        principals.map((id) => [id, resolveForProfiled(id)]),
      ),
    }
  },

  // 上限つきキャッシュ (#987) の実測一覧 — 「必ず上限」不変条件の観測面
  'perf/caches': () => listBoundedCacheStats(),

  // フロント in-app ログ (console.warn/error のリング)。統合タイムラインが
  // Rust ログ・SSE とマージして表示する
  'logs/recent': () => useLogsStore().entries,

  'querybridge/trace': () => queryTrace,

  // Stream Inspector (アダプタ層の raw WS イベント) の種別別カウント。
  // SSE 側 (Rust イベントバス) との突き合わせ用。Inspector カラムが
  // 開いているときだけ流入する
  'inspector/recent': () => {
    const buffer = useStreamInspectorStore().buffer
    const counts: Record<string, number> = {}
    for (const entry of buffer) {
      counts[entry.kind] = (counts[entry.kind] ?? 0) + 1
    }
    return {
      total: buffer.length,
      counts,
      oldestTs: buffer.length ? (buffer[buffer.length - 1]?.ts ?? null) : null,
    }
  },

  // --- 外部アプリ向け capability 面 (#709) ---
  // 権限は external principal のプロファイルで gate される (dispatcher が照合)。
  // カラム追加/削除・コマンド実行の旧 store 直叩きハンドラは #711 で削除済み —
  // 外部からの操作はすべて capabilities/execute (= dispatcher) に一本化する。

  'capabilities/list': () =>
    listCapabilities().map((cap) => ({
      id: cap.id,
      // Anthropic / OpenAI tool 名と同じ sanitized 形式 (外部 AI がそのまま使える)
      name: sanitizeToolName(cap.id),
      label: cap.label,
      category: cap.category,
      description: cap.signature?.description ?? '',
      params: cap.signature?.params ?? {},
      returns: cap.signature?.returns ?? { type: 'void' },
      permissions: cap.permissions ?? [],
      requiresConfirmation: !!cap.requiresConfirmation,
    })),

  'capabilities/execute': async (params) => {
    return await dispatchCapability(
      params.capabilityId as string,
      // body 省略時に Rust 側から null が来る → capability には undefined で渡す
      (params.params ?? undefined) as Record<string, unknown> | undefined,
      { principal: { kind: 'external' } },
    )
  },

  // --- notecore のターン実行器からの実行要求 (#1133) ---
  // AI principal の認可 (tool 一覧の絞り込みと呼び出しごとの権限検査) と
  // 確認の要否・確認要求は Rust 側で済んでいる。ここでは既存の dispatcher を
  // 同じ principal で走らせ、capability 本体はデバイス側のまま使う。dispatcher
  // の権限検査は Rust の写しとして二重に通す。
  'ai/execute-capability': async (params) => {
    const kind = params.principal
    if (kind !== 'ai.chat' && kind !== 'ai.heartbeat') {
      return {
        ok: false,
        code: 'permission_denied',
        error: `AI ループの principal ではありません: ${String(kind)}`,
      }
    }
    const turnId = String(params.turnId ?? '')
    // 外部エディタで ai.json5 / permissions.json5 を変更した直後でも最新の
    // 設定・権限で判定したいので、tool 実行直前に再読込する (= 再起動不要)。
    // 失敗しても既存 cache で続行する。
    try {
      await reloadAiConfig()
      await reloadPermissionsConfig()
    } catch (e) {
      console.warn('[ai-turn] config reload before dispatch failed:', e)
    }
    const controller = beginTurnExecution(turnId)
    // 返す内容にラベル付きのメモ / skill が含まれたら結果に添える (notecore が
    // 読んだセッションを tainted にする、#1103)
    let taintedResult = false
    try {
      const result = await dispatchCapability(
        params.capabilityId as string,
        (params.params ?? undefined) as Record<string, unknown> | undefined,
        {
          principal: { kind },
          accountId:
            (params.accountId as string | null | undefined) ?? undefined,
        },
        {
          // notecore が確認要求で許可を得た実行。判定が食い違って dispatcher
          // が確認を出す場合 (保険) は、ターン中断で閉じられるようにする
          preConfirmed: params.confirmed === true,
          confirmFn: (opts) =>
            useConfirm().confirmWithDecision(opts, controller.signal),
          tainted: params.tainted === true,
          markTainted: () => {
            taintedResult = true
          },
        },
      )
      return taintedResult ? { ...result, tainted: true } : result
    } finally {
      endTurnExecution(turnId, controller)
    }
  },

  // notecore の確認要求に同梱する内容の組み立て (#1133 縦切り 2)。要否は
  // notecore が決め、ここは capability の実装が組む表示内容を返すだけ
  'ai/confirm-preview': async (params) => {
    const kind = params.principal
    if (kind !== 'ai.chat' && kind !== 'ai.heartbeat') {
      return { needsConfirmation: false, allowRemember: false }
    }
    return await previewConfirmation(
      params.capabilityId as string,
      (params.params ?? undefined) as Record<string, unknown> | undefined,
      {
        principal: { kind },
        accountId: (params.accountId as string | null | undefined) ?? undefined,
      },
      {
        crossAccount: params.crossAccount === true,
        destinationUntrusted: params.destinationUntrusted === true,
      },
    )
  },
}

/**
 * Query type からハンドラを引いて実行する。HTTP API (query_bridge) と
 * テストの共通入口。ハンドラ throw は構造化エラーに変換して返す
 * (= 呼び出し元の HTTP handler が 500 QUERY_FAILED にしない)。
 */
export async function handleQuery(
  type: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const handler = handlers[type]
  if (!handler) return { error: `Unknown query type: ${type}` }
  try {
    return await handler(params)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

let unlisten: (() => void) | null = null

export async function initApiBridge() {
  if (unlisten) return

  const unlistenFn = await listenTauri(
    'nd:query-request',
    async ({ id, type, params }) => {
      const started = performance.now()
      const result = await handleQuery(type, params)
      recordQueryTrace(type, performance.now() - started, result)

      // 動的イベント名なので TauriEventPayloads の対象外 (型付け不可)
      await emit(`nd:query-response-${id}`, result)
    },
  )

  unlisten = unlistenFn
}

export function destroyApiBridge() {
  if (unlisten) {
    unlisten()
    unlisten = null
  }
}

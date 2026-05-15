/**
 * Capability dispatcher — capability ID + params を受けて execute() を呼ぶ。
 *
 * - permissions チェックを通過した capability のみ実行
 * - 未登録 / permission 拒否 / 実行失敗を構造化エラーで区別して返す
 * - execute() は同期 / 非同期どちらでも対応
 *
 * Phase 2 A-3.2 で AI tool dispatcher (tool_use → これ → tool_result) の中核
 * として呼ばれる。Phase 1 の `ai.json5` permissions と同じスキーマで照合する
 * ので、ユーザーが `safe` プリセットを選んでいれば書き込み系は自動 deny される。
 */

import { nextTick } from 'vue'
import { COLUMN_LABELS } from '@/columns/registry'
import type { Command } from '@/commands/registry'
import { WINDOW_LABELS } from '@/components/deck/windowLabels'
import {
  type AiConfig,
  type PermissionKey,
  resolvePermissions,
} from '@/composables/useAiConfig'
import {
  accountTargetId,
  columnTargetId,
  navbarTargetId,
  noteTargetId,
  useSpotlightStore,
  windowTargetId,
} from '@/composables/useSpotlight'
import { getAccountLabel, useAccountsStore } from '@/stores/accounts'
import {
  type ConfirmDecision,
  type ConfirmOptions,
  useConfirm,
} from '@/stores/confirm'
import { useDeckStore } from '@/stores/deck'
import { useWindowsStore } from '@/stores/windows'
import { sanitizeToolName } from './identifier'
import { getCapability, listCapabilities } from './registry'

export type DispatchErrorCode =
  | 'unknown_capability'
  | 'permission_denied'
  | 'preflight_failed'
  | 'execute_failed'
  | 'user_cancelled'

export type DispatchResult =
  | { ok: true; result: unknown }
  | { ok: false; code: DispatchErrorCode; error: string }

/**
 * テスト容易性のために confirm 関数を差し替えられる。production では
 * 未指定で `useConfirm().confirmWithDecision` が使われる。テストは
 * `() => Promise.resolve({ accepted: true, remember: false })` 等で
 * skip / accept / reject / remember を制御する。
 */
export interface DispatchOptions {
  confirmFn?: (opts: ConfirmOptions) => Promise<ConfirmDecision>
}

/**
 * Capability を呼ぶ。permissions が通れば (必要なら confirm) execute → 結果を返す。
 * AI tool calling / slash command 経路の共通入口。
 */
export async function dispatchCapability(
  capabilityId: string,
  params: Record<string, unknown> | undefined,
  aiConfig: AiConfig,
  options?: DispatchOptions,
): Promise<DispatchResult> {
  // capabilityId は (a) registry に格納されている dotted id (`time.now`) か、
  // (b) Anthropic / OpenAI が返す sanitized name (`time_now`) のどちらかで
  // 来る可能性がある。前者は直接 lookup、後者は逆引きで解決する。
  let cap = getCapability(capabilityId)
  if (!cap) {
    cap = listCapabilities().find(
      (c) => sanitizeToolName(c.id) === capabilityId,
    )
  }
  if (!cap) {
    return {
      ok: false,
      code: 'unknown_capability',
      error: `Capability "${capabilityId}" is not registered`,
    }
  }
  const denied = checkPermissions(cap.permissions ?? [], aiConfig)
  if (denied.length > 0) {
    return {
      ok: false,
      code: 'permission_denied',
      error: `Permission denied for ${capabilityId}: required [${denied.join(', ')}] not allowed by current ai.json5 settings`,
    }
  }
  // preflight (入力検証 — 確認ダイアログより前に走る)
  if (cap.preflight) {
    const failure = await cap.preflight(params)
    if (failure) {
      return {
        ok: false,
        code: 'preflight_failed',
        error: failure.error,
      }
    }
  }
  // 確認ダイアログ (write 系などで requiresConfirmation: true)
  const confirmOpts = await buildConfirmOptions(cap, params)
  if (confirmOpts) {
    const confirmFn = options?.confirmFn ?? useConfirm().confirmWithDecision
    const decision = await confirmFn(confirmOpts)
    if (!decision.accepted) {
      return {
        ok: false,
        code: 'user_cancelled',
        error: `User cancelled execution of ${capabilityId}`,
      }
    }
    // 「次回から確認しない」が ON のまま許可されたら capability に通知する。
    // 信頼状態の永続化など、確認スキップを次回以降に効かせる副作用を委ねる。
    if (decision.remember && cap.onConfirmRemember) {
      await cap.onConfirmRemember(params)
    }
  }
  try {
    const result = await cap.execute(params, { aiConfig })
    // AI 操作の可視化: 成功時のみ、対応する UI 要素を一時的に光らせる。
    // DOM 更新後 (navbar に新 item が反映されてから) に highlight する。
    // 防御: spotlight 副作用が万一失敗しても本体 (AI flow) に影響しないよう
    // catch + Promise rejection 無視で完全分離する。
    void nextTick(() => {
      try {
        emitSpotlightFromCapability(cap.id, params, result)
      } catch (err) {
        console.warn('[dispatcher] spotlight emit failed (ignored):', err)
      }
    }).catch((err) => {
      console.warn('[dispatcher] spotlight nextTick rejected (ignored):', err)
    })
    return { ok: true, result }
  } catch (e) {
    return {
      ok: false,
      code: 'execute_failed',
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Capability 実行成功後に、対応する UI 要素を spotlight する。
 * ユーザークリックは dispatcher を通らないので、自然に AI 経由だけが光る。
 * MVP は `column.add` → navbar ボタン のみ。Phase 2 で拡張。
 */
function emitSpotlightFromCapability(
  capId: string,
  params: Record<string, unknown> | undefined,
  result: unknown,
): void {
  // === DEBUG: spotlight 発火を必ず追える console.log ===
  console.debug('[spotlight] capability succeeded:', { capId, params, result })
  if (capId === 'column.add') {
    // 新規追加されたカラム本体 (= bottombar / mobile nav のタブが反応する)
    // を spotlight する。ナビバー (= サイドバースロット) は AI による
    // 新規カラム追加では破壊的になり得るので対象にしない (#feedback)。
    const r = result as { id?: string; type?: string } | null
    const newColumnId = r?.id
    const type = r?.type ?? (params?.type as string | undefined)
    if (newColumnId && type) {
      const label = COLUMN_LABELS[type] ?? type
      const targetId = columnTargetId(newColumnId)
      console.debug('[spotlight] highlight target:', targetId, 'label:', label)
      useSpotlightStore().highlight(targetId, {
        label: `AI が${label}カラムを追加しました`,
      })
    } else {
      console.warn(
        '[spotlight] column.add succeeded but cannot derive target:',
        { newColumnId, type, result, params },
      )
    }
  } else if (capId === 'sidebar.toggle') {
    // サイドバースロットを開閉した → ナビバーボタンが反応する target
    const r = result as { type?: string; opened?: boolean } | null
    const type = r?.type ?? (params?.type as string | undefined)
    const accountId = (params?.accountId as string | null | undefined) ?? null
    // 「開いた」ときだけ spotlight (閉じた = もうそのボタンを見る理由がない)
    if (r?.opened && type) {
      const label = COLUMN_LABELS[type] ?? type
      const targetId = navbarTargetId(type, accountId)
      console.debug('[spotlight] highlight target:', targetId, 'label:', label)
      useSpotlightStore().highlight(targetId, {
        label: `AI が${label}カラムをサイドバーに開きました`,
      })
    }
  } else if (capId === 'column.remove') {
    // 削除は対象 DOM が消えるので視覚 spotlight 無し。SR テキストのみ announce。
    // type は ID から逆引きできない (既に削除済み) → 汎用文
    useSpotlightStore().announce('AI がカラムを削除しました')
  } else if (capId === 'column.move') {
    // 移動後の位置で該当カラムタブを光らせる
    const r = result as { columnId?: string } | null
    if (r?.columnId) {
      const col = useDeckStore().getColumn(r.columnId)
      const label = col?.type ? (COLUMN_LABELS[col.type] ?? col.type) : 'カラム'
      const targetId = columnTargetId(r.columnId)
      console.debug('[spotlight] highlight target:', targetId, 'label:', label)
      useSpotlightStore().highlight(targetId, {
        label: `AI が${label}カラムを移動しました`,
      })
    }
  } else if (capId === 'column.updateSettings') {
    const r = result as { columnId?: string; applied?: string[] } | null
    if (r?.columnId) {
      const col = useDeckStore().getColumn(r.columnId)
      const label = col?.type ? (COLUMN_LABELS[col.type] ?? col.type) : 'カラム'
      const fields = r.applied?.join(', ') ?? '設定'
      const targetId = columnTargetId(r.columnId)
      console.debug('[spotlight] highlight target:', targetId, 'label:', label)
      useSpotlightStore().highlight(targetId, {
        label: `AI が${label}カラムの${fields}を更新しました`,
      })
    }
  } else if (capId === 'notifications.markRead') {
    // accountId 指定があれば per-account の navbar、なければ null (全アカウント)
    const accountId =
      typeof params?.accountId === 'string' ? params.accountId : null
    const targetId = navbarTargetId('notifications', accountId)
    console.debug('[spotlight] highlight target:', targetId)
    useSpotlightStore().highlight(targetId, {
      label: 'AI が通知を既読化しました',
    })
  } else if (capId === 'windows.open') {
    // 新規 or 既存 focus されたウィンドウを朱色 glow で枠を光らせる
    const r = result as { id?: string } | null
    const type = params?.type as string | undefined
    if (r?.id) {
      const label = type ? (WINDOW_LABELS[type] ?? type) : 'ウィンドウ'
      const targetId = windowTargetId(r.id)
      console.debug('[spotlight] highlight target:', targetId, 'label:', label)
      useSpotlightStore().highlight(targetId, {
        label: `AI が${label}ウィンドウを開きました`,
      })
    }
  } else if (capId === 'windows.focus') {
    // 既存ウィンドウを最前面に → 同じ window:${id} を再点灯
    const r = result as { id?: string } | null
    if (r?.id) {
      const win = useWindowsStore().windows.find((w) => w.id === r.id)
      const label = win ? (WINDOW_LABELS[win.type] ?? win.type) : 'ウィンドウ'
      const targetId = windowTargetId(r.id)
      console.debug('[spotlight] highlight target:', targetId, 'label:', label)
      useSpotlightStore().highlight(targetId, {
        label: `AI が${label}ウィンドウを前面に出しました`,
      })
    }
  } else if (capId === 'windows.close') {
    // 閉じた window の DOM は消えているので announce のみ
    useSpotlightStore().announce('AI がウィンドウを閉じました')
  } else if (capId === 'windows.closeAll') {
    useSpotlightStore().announce('AI が全ウィンドウを閉じました')
  } else if (capId === 'notes.react') {
    // リアクション付与: 戻り値 { ok, noteId, reaction } から noteId と
    // reaction を取り、対応する note 本体を spotlight する。
    const r = result as { noteId?: string; reaction?: string } | null
    if (r?.noteId) {
      useSpotlightStore().highlight(noteTargetId(r.noteId), {
        label: r.reaction
          ? `AI がノートに ${r.reaction} でリアクションしました`
          : 'AI がノートにリアクションしました',
      })
    }
  } else if (capId === 'notes.unreact') {
    const r = result as { noteId?: string } | null
    if (r?.noteId) {
      useSpotlightStore().highlight(noteTargetId(r.noteId), {
        label: 'AI がノートのリアクションを取り消しました',
      })
    }
  } else if (capId === 'notes.pin') {
    const r = result as { noteId?: string } | null
    if (r?.noteId) {
      useSpotlightStore().highlight(noteTargetId(r.noteId), {
        label: 'AI がノートをピン留めしました',
      })
    }
  } else if (capId === 'notes.unpin') {
    const r = result as { noteId?: string } | null
    if (r?.noteId) {
      useSpotlightStore().highlight(noteTargetId(r.noteId), {
        label: 'AI がノートのピン留めを外しました',
      })
    }
  } else if (capId === 'notes.create') {
    // 投稿成功: 戻り値 { id, ... } の id がそのまま新規 note id。
    // Timeline reactivity で DOM に出れば光る (出てなければ noop)。
    const r = result as { id?: string } | null
    if (r?.id) {
      useSpotlightStore().highlight(noteTargetId(r.id), {
        label: 'AI がノートを投稿しました',
      })
    }
  } else if (capId === 'notes.delete') {
    // 削除は対象 DOM が消えるので視覚 spotlight 無し。SR テキストのみ。
    useSpotlightStore().announce('AI がノートを削除しました')
  } else if (capId === 'account.switch') {
    // アクティブアカウント切替: navbar popup が開いていれば該当行が朱色 glow。
    // 閉じていれば視覚効果は無いが SR で読み上げ。
    const r = result as { id?: string } | null
    if (r?.id) {
      const acc = useAccountsStore().accounts.find((a) => a.id === r.id)
      const label = acc ? getAccountLabel(acc) : r.id
      useSpotlightStore().highlight(accountTargetId(r.id), {
        label: `AI がアクティブアカウントを ${label} に切り替えました`,
      })
    }
  }
}

/**
 * cap.requiresConfirmation を見て confirm モーダル options を組み立てる。
 * - false / 未指定 → null (= 確認スキップ)
 * - true → label + description + 引数 JSON で汎用モーダル
 * - 関数 → 関数の戻り値をそのまま使う (null 戻りは個別スキップ)
 */
async function buildConfirmOptions(
  cap: Command,
  params: Record<string, unknown> | undefined,
): Promise<ConfirmOptions | null> {
  if (!cap.requiresConfirmation) return null
  if (typeof cap.requiresConfirmation === 'function') {
    return await cap.requiresConfirmation(params)
  }
  // boolean true → 汎用モーダル
  const desc = cap.signature?.description ?? ''
  const hasArgs = params && Object.keys(params).length > 0
  return {
    title: `${cap.label} を実行しますか?`,
    message: desc,
    // 引数 JSON は code block でシンタックスハイライト表示
    ...(hasArgs
      ? {
          code: JSON.stringify(params, null, 2),
          codeLanguage: 'json',
        }
      : {}),
    okLabel: '実行',
    cancelLabel: 'やめる',
    type: 'danger',
  }
}

/** required permission のうち config で disallow になっているものを返す。 */
function checkPermissions(
  required: readonly PermissionKey[],
  aiConfig: AiConfig,
): PermissionKey[] {
  if (required.length === 0) return []
  const resolved = resolvePermissions(aiConfig.permissions)
  return required.filter((key) => !resolved[key])
}

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
import { useAiConfig } from '@/composables/useAiConfig'
import {
  accountTargetId,
  columnTargetId,
  navbarTargetId,
  noteTargetId,
  useSpotlightStore,
  windowTargetId,
} from '@/composables/useSpotlight'
import { recordPluginDenial } from '@/permissions/pluginDenials'
import { type Principal, principalActorLabel } from '@/permissions/principal'
import type { PermissionKey } from '@/permissions/schema'
import {
  addConfirmSkip,
  confirmSkipScope,
  isConfirmSkipped,
  resolveFor,
  whenPermissionsReady,
} from '@/permissions/store'
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
import type { CapabilityContext } from './types'

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
 * dispatch の呼び出しコンテキスト。principal (誰が実行を要求しているか #712) を
 * 必須で受け取る。従来の「呼び出し側が permissions セットをすり替えた AiConfig
 * を渡す」暗黙表現を置換したもの。
 */
export interface DispatchContext {
  principal: Principal
}

/**
 * Capability を呼ぶ。permissions が通れば (必要なら confirm) execute → 結果を返す。
 * AI tool calling / slash command / HTTP API / AiScript 経路の共通入口。
 */
export async function dispatchCapability(
  capabilityId: string,
  params: Record<string, unknown> | undefined,
  ctx: DispatchContext,
  options?: DispatchOptions,
): Promise<DispatchResult> {
  // 起動直後は permissions.json5 の読込 (async) が終わる前に autoRun
  // ウィジェット等がここへ到達しうる。デフォルト値での誤判定 (「今後確認
  // しない」記憶の取りこぼし #716) を防ぐため、読込完了を待ってから判定する。
  await whenPermissionsReady()
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
  const denied = checkPermissions(cap.permissions ?? [], ctx.principal)
  if (denied.length > 0) {
    // plugin の拒否はプラグインカラムの拒否バッジに流す (#712 §8.4 — 破壊的
    // 変更をリリースノート依存にしない in-app 導線)
    if (ctx.principal.kind === 'plugin') {
      recordPluginDenial(ctx.principal.pluginId, cap.id, denied)
    }
    return {
      ok: false,
      code: 'permission_denied',
      error: `Permission denied for ${capabilityId}: required [${denied.join(', ')}] not allowed for principal "${ctx.principal.kind}" (permissions.json5)`,
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
  const capCtx: CapabilityContext = {
    aiConfig: useAiConfig().config.value,
    principal: ctx.principal,
  }
  // 確認ダイアログ (write 系などで requiresConfirmation: true)
  const confirmOpts = await buildConfirmOptions(cap, params, capCtx)
  // 汎用「今後確認しない」(#714): capability 固有の remember (vault の接続
  // 単位の信頼) を持たない capability に、scope × capability 単位のスキップを
  // 適用する。scope は ai.chat / plugin 個体のみ — user (本人操作の confirm は
  // 削らない)・ai.heartbeat (無人実行)・external は confirmSkipScope が null を
  // 返し、常に確認される。
  const skipScope = cap.onConfirmRemember
    ? null
    : confirmSkipScope(ctx.principal)
  const skipConfirmed =
    confirmOpts !== null &&
    skipScope !== null &&
    isConfirmSkipped(skipScope, cap.id)
  if (confirmOpts && !skipConfirmed) {
    // 信頼マーカー (#720): これは NoteDeck 本体の権限確認である。プラグインの
    // Mk:confirm はこのフラグを立てられないので、システム確認になりすませない。
    confirmOpts.trusted = true
    // 同一操作の dedup key (#720): 「今後確認しない」で許可したら、キューで
    // 待機している同じ scope×capability の確認も自動承認させる (#716 の
    // 「一度の同意を同一操作の待機分へ波及」)。skip 不可 scope では付けない。
    if (skipScope !== null) {
      confirmOpts.dedupKey = `${skipScope}:${cap.id}`
    }
    // 帰属表示 (#712 §3.3): 誰の要求かをダイアログ冒頭に必須表示する。
    // 無人 HEARTBEAT のモーダルが本人のチャット確認と誤認されないよう、
    // capability 側実装に任せず dispatcher が一律で注入する。
    // 操作名はタイトル行が示すので主語 (actor) のみ (長文化を避ける)。
    const actor = principalActorLabel(ctx.principal)
    if (actor) {
      confirmOpts.attribution = actor
    }
    if (skipScope !== null && !confirmOpts.rememberLabel) {
      confirmOpts.rememberLabel = '今後この操作を確認しない'
    }
    const confirmFn = options?.confirmFn ?? useConfirm().confirmWithDecision
    const decision = await confirmFn(confirmOpts)
    if (!decision.accepted) {
      return {
        ok: false,
        code: 'user_cancelled',
        error: `User cancelled execution of ${capabilityId}`,
      }
    }
    // 「次回から確認しない」が ON のまま許可されたら次回以降に効かせる。
    // capability 固有実装 (vault の接続信頼) があればそちらへ委ね、
    // 無ければ scope × capability 単位で permissions.json5 に記憶する。
    if (decision.remember) {
      if (cap.onConfirmRemember) {
        await cap.onConfirmRemember(params, capCtx)
      } else if (skipScope !== null) {
        addConfirmSkip(skipScope, cap.id)
      }
    }
  }
  try {
    const result = await cap.execute(params, capCtx)
    // AI 操作の可視化: 成功時のみ、対応する UI 要素を一時的に光らせる。
    // DOM 更新後 (navbar に新 item が反映されてから) に highlight する。
    // 防御: spotlight 副作用が万一失敗しても本体 (AI flow) に影響しないよう
    // catch + Promise rejection 無視で完全分離する。
    void nextTick(() => {
      try {
        emitSpotlightFromCapability(cap.id, params, result, ctx.principal)
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
 * 可視化は rogue plugin / rogue token を検知する security 手段なので、
 * user 以外の全 principal で発火し、帰属ラベル (誰がやったか) を正確に出す
 * (#712 §3.3)。user 本人の操作には帰属表示は不要なので発火しない。
 */
function emitSpotlightFromCapability(
  capId: string,
  params: Record<string, unknown> | undefined,
  result: unknown,
  principal: Principal,
): void {
  const actor = principalActorLabel(principal)
  if (!actor) return
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
        label: `${actor}が${label}カラムを追加しました`,
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
        label: `${actor}が${label}カラムをサイドバーに開きました`,
      })
    }
  } else if (capId === 'column.remove') {
    // 削除は対象 DOM が消えるので視覚 spotlight 無し。SR テキストのみ announce。
    // type は ID から逆引きできない (既に削除済み) → 汎用文
    useSpotlightStore().announce(`${actor}がカラムを削除しました`)
  } else if (capId === 'column.move') {
    // 移動後の位置で該当カラムタブを光らせる
    const r = result as { columnId?: string } | null
    if (r?.columnId) {
      const col = useDeckStore().getColumn(r.columnId)
      const label = col?.type ? (COLUMN_LABELS[col.type] ?? col.type) : 'カラム'
      const targetId = columnTargetId(r.columnId)
      console.debug('[spotlight] highlight target:', targetId, 'label:', label)
      useSpotlightStore().highlight(targetId, {
        label: `${actor}が${label}カラムを移動しました`,
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
        label: `${actor}が${label}カラムの${fields}を更新しました`,
      })
    }
  } else if (capId === 'notifications.markRead') {
    // accountId 指定があれば per-account の navbar、なければ null (全アカウント)
    const accountId =
      typeof params?.accountId === 'string' ? params.accountId : null
    const targetId = navbarTargetId('notifications', accountId)
    console.debug('[spotlight] highlight target:', targetId)
    useSpotlightStore().highlight(targetId, {
      label: `${actor}が通知を既読化しました`,
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
        label: `${actor}が${label}ウィンドウを開きました`,
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
        label: `${actor}が${label}ウィンドウを前面に出しました`,
      })
    }
  } else if (capId === 'windows.close') {
    // 閉じた window の DOM は消えているので announce のみ
    useSpotlightStore().announce(`${actor}がウィンドウを閉じました`)
  } else if (capId === 'windows.closeAll') {
    useSpotlightStore().announce(`${actor}が全ウィンドウを閉じました`)
  } else if (capId === 'notes.react') {
    // リアクション付与: 戻り値 { ok, noteId, reaction } から noteId と
    // reaction を取り、対応する note 本体を spotlight する。
    const r = result as { noteId?: string; reaction?: string } | null
    if (r?.noteId) {
      useSpotlightStore().highlight(noteTargetId(r.noteId), {
        label: r.reaction
          ? `${actor}がノートに ${r.reaction} でリアクションしました`
          : `${actor}がノートにリアクションしました`,
      })
    }
  } else if (capId === 'notes.unreact') {
    const r = result as { noteId?: string } | null
    if (r?.noteId) {
      useSpotlightStore().highlight(noteTargetId(r.noteId), {
        label: `${actor}がノートのリアクションを取り消しました`,
      })
    }
  } else if (capId === 'notes.pin') {
    const r = result as { noteId?: string } | null
    if (r?.noteId) {
      useSpotlightStore().highlight(noteTargetId(r.noteId), {
        label: `${actor}がノートをピン留めしました`,
      })
    }
  } else if (capId === 'notes.unpin') {
    const r = result as { noteId?: string } | null
    if (r?.noteId) {
      useSpotlightStore().highlight(noteTargetId(r.noteId), {
        label: `${actor}がノートのピン留めを外しました`,
      })
    }
  } else if (capId === 'notes.create') {
    // 投稿成功: 戻り値 { id, ... } の id がそのまま新規 note id。
    // Timeline reactivity で DOM に出れば光る (出てなければ noop)。
    const r = result as { id?: string } | null
    if (r?.id) {
      useSpotlightStore().highlight(noteTargetId(r.id), {
        label: `${actor}がノートを投稿しました`,
      })
    }
  } else if (capId === 'notes.delete') {
    // 削除は対象 DOM が消えるので視覚 spotlight 無し。SR テキストのみ。
    useSpotlightStore().announce(`${actor}がノートを削除しました`)
  } else if (capId === 'account.switch') {
    // アクティブアカウント切替: navbar popup が開いていれば該当行が朱色 glow。
    // 閉じていれば視覚効果は無いが SR で読み上げ。
    const r = result as { id?: string } | null
    if (r?.id) {
      const acc = useAccountsStore().accounts.find((a) => a.id === r.id)
      const label = acc ? getAccountLabel(acc) : r.id
      useSpotlightStore().highlight(accountTargetId(r.id), {
        label: `${actor}がアクティブアカウントを ${label} に切り替えました`,
      })
    }
  }
}

/**
 * cap.requiresConfirmation を見て confirm モーダル options を組み立てる。
 * - false / 未指定 → null (= 確認スキップ)
 * - true → label + 引数 JSON で汎用モーダル
 * - 関数 → 関数の戻り値をそのまま使う (null 戻りは個別スキップ)
 */
async function buildConfirmOptions(
  cap: Command,
  params: Record<string, unknown> | undefined,
  ctx: CapabilityContext,
): Promise<ConfirmOptions | null> {
  if (!cap.requiresConfirmation) return null
  if (typeof cap.requiresConfirmation === 'function') {
    return await cap.requiresConfirmation(params, ctx)
  }
  // boolean true → 汎用モーダル。signature.description は AI 向けの tool 説明で
  // 人間向けの確認には冗長 — 出さない (タイトル + 引数 JSON で足りる)。
  const hasArgs = params && Object.keys(params).length > 0
  return {
    title: `${cap.label} を実行しますか?`,
    message: '',
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

/** required permission のうち principal の実効権限で disallow になっているものを返す。 */
function checkPermissions(
  required: readonly PermissionKey[],
  principal: Principal,
): PermissionKey[] {
  if (required.length === 0) return []
  const resolved = resolveFor(principal)
  // user principal はプロファイルを持たず常時許可 (#712 §3.3)
  if (resolved === null) return []
  return required.filter((key) => !resolved[key])
}

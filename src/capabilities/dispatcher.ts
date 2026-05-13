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

import type { Command } from '@/commands/registry'
import {
  type AiConfig,
  type PermissionKey,
  resolvePermissions,
} from '@/composables/useAiConfig'
import { type ConfirmOptions, useConfirm } from '@/stores/confirm'
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
 * 未指定で `useConfirm().confirm` が使われる。テストは `() => Promise.resolve(true)`
 * 等で skip / accept / reject を制御する。
 */
export interface DispatchOptions {
  confirmFn?: (opts: ConfirmOptions) => Promise<boolean>
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
    const confirmFn = options?.confirmFn ?? useConfirm().confirm
    const accepted = await confirmFn(confirmOpts)
    if (!accepted) {
      return {
        ok: false,
        code: 'user_cancelled',
        error: `User cancelled execution of ${capabilityId}`,
      }
    }
  }
  try {
    const result = await cap.execute(params, { aiConfig })
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

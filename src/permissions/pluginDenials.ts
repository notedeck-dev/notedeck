/**
 * plugin principal の permission_denied の受動 surface (#712 §8.4)。
 *
 * Mk:api gate / dispatcher の拒否を pluginId 別に in-memory 記録し、
 * プラグインカラムの該当行に拒否バッジを出す。破壊的変更 (plugin プロファイル
 * 分離で今まで動いていたウィジェットが止まる) をリリースノート (= 説明書)
 * 依存にしないための in-app 導線。
 *
 * - 自律実行 (イベント駆動・起動時コード) の拒否は toast しない: 高頻度に
 *   反復されうるため能動通知は spam 化する。受動バッジのみ
 * - 例外: ユーザーの UI 操作起点 (note/user/post_form アクション =
 *   アカウント文脈付き dispatch) の拒否は、その場で 1 回だけ toast する。
 *   「クリックしたのに無言で何も起きない」を防ぐ (dispatcher が判定して
 *   notifyPluginDenialInteraction を呼ぶ)
 * - 永続化しない: 監査ログは非目標。直近状態のみ (アプリ再起動で消える)
 */

import { reactive } from 'vue'
import { i18n } from '@/i18n'
import { PERMISSION_LABELS } from '@/permissions/labels'
import type { PermissionKey } from '@/permissions/schema'
import type { LoopbackDenialReason } from '@/services/loopbackPorts'
import { useToast } from '@/stores/toast'

export interface PluginDenialEntry {
  /** 直近に拒否された対象 (capability id または Mk:api endpoint) */
  lastTarget: string
  /** 直近拒否の必要キー (permission_denied の denied keys) */
  lastKeys: string[]
  count: number
  /**
   * 手元のポートへの接続 (#1293) の拒否理由。権限の拒否 (lastKeys) ではなく
   * 連鎖 / 宣言 / 同意 / 本文の鮮度で止まったときに入る。バッジは理由を出し、
   * 押した先はプラグイン詳細
   */
  reason?: LoopbackDenialReason
}

const _denials = reactive(new Map<string, PluginDenialEntry>())

/** pluginId (`widget:<id>` 含む) の拒否を記録する。 */
export function recordPluginDenial(
  pluginId: string,
  target: string,
  keys: readonly string[],
  reason?: LoopbackDenialReason,
): void {
  const existing = _denials.get(pluginId)
  if (existing) {
    existing.lastTarget = target
    existing.lastKeys = [...keys]
    existing.count += 1
    if (reason) existing.reason = reason
    else delete existing.reason
  } else {
    _denials.set(pluginId, {
      lastTarget: target,
      lastKeys: [...keys],
      count: 1,
      ...(reason ? { reason } : {}),
    })
  }
}

/** 拒否理由の表示 (キーは静的に引く — 辞書の死にキー検査のため) */
export function loopbackReasonLabel(reason: LoopbackDenialReason): string {
  switch (reason) {
    case 'chain':
      return i18n.ts._pluginDenials._loopbackReason.chain
    case 'notEligible':
      return i18n.ts._pluginDenials._loopbackReason.notEligible
    case 'selfPort':
      return i18n.ts._pluginDenials._loopbackReason.selfPort
    case 'undeclared':
      return i18n.ts._pluginDenials._loopbackReason.undeclared
    case 'stale':
      return i18n.ts._pluginDenials._loopbackReason.stale
    case 'notGranted':
      return i18n.ts._pluginDenials._loopbackReason.notGranted
  }
}

/**
 * UI 操作起点の loopback 拒否 (#1293) をその場で toast する。押した先は
 * プラグイン詳細 (同意はそこの「許可」から)
 */
export function notifyLoopbackDenialInteraction(
  pluginId: string,
  pluginName: string | undefined,
  reason: LoopbackDenialReason,
): void {
  const name = pluginName ?? i18n.ts._pluginDenials.defaultName
  useToast().show(
    i18n.tsx._pluginDenials.loopbackDenied({
      name,
      reason: loopbackReasonLabel(reason),
    }),
    'error',
    {
      onClick: () => {
        void import('@/stores/windows').then((m) =>
          m.useWindowsStore().open('plugins', { initialPluginId: pluginId }),
        )
      },
    },
  )
}

/**
 * UI 操作起点の拒否をその場で toast する。プラグイン名と不足している
 * 権限のラベルを示し、権限設定への導線を添える。
 */
export function notifyPluginDenialInteraction(
  pluginName: string | undefined,
  keys: readonly string[],
): void {
  const labels = keys
    .map((k) => PERMISSION_LABELS[k as PermissionKey]?.label ?? k)
    .join(i18n.ts._pluginDenials.separator)
  const name = pluginName ?? i18n.ts._pluginDenials.defaultName
  useToast().show(
    i18n.tsx._pluginDenials.denied({ name, permissions: labels }),
    'error',
    {
      // 文言にプラグイン名が入っているので source は付けない。
      // 押したら権限の設定を開く。stores/windows は重いので押したときに読む
      onClick: () => {
        void import('@/stores/windows').then((m) =>
          m.useWindowsStore().open('permissions'),
        )
      },
    },
  )
}

/** バッジ表示用。無ければ null。 */
export function getPluginDenial(pluginId: string): PluginDenialEntry | null {
  return _denials.get(pluginId) ?? null
}

/** @internal テスト用 */
export function _clearPluginDenialsForTest(): void {
  _denials.clear()
}

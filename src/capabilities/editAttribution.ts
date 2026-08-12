import type { EditAttribution } from '@/utils/historyFs'
import type { CapabilityContext } from './types'

/**
 * 編集履歴の「誰が・なぜ」(#1052)。
 *
 * 帰属は権限の principal をそのまま使う — 確認ダイアログの帰属表示・Spotlight・
 * 履歴で同じ粒度になり、「AI が過去に何を変えたか」を後から辿れる。
 *
 * 理由は write 系 capability の `reason` パラメータで受ける。AI は編集を要求する
 * 時点で理由を持っているので、承認ダイアログに出して (dispatcher が注入)、承認後に
 * 履歴へ記録する。本人の手編集はデバウンスの自動保存で理由を書く機会が無いため
 * 空のままになる — 履歴 UI は理由の欄が無いエントリを前提にすること。
 */
export function editAttribution(
  ctx: CapabilityContext | undefined,
  params?: Record<string, unknown>,
): EditAttribution | undefined {
  if (!ctx?.principal) return undefined
  const raw = params?.reason
  const reason = typeof raw === 'string' ? raw.trim() : ''
  return { by: ctx.principal, ...(reason ? { reason } : {}) }
}

/** write 系 capability の signature に共通で載せる `reason` の型情報 (#1052)。 */
export const REASON_PARAM = {
  type: 'string' as const,
  description:
    'この編集の理由 (なぜ変えるか)。承認ダイアログに表示され、編集履歴に記録される。' +
    ' 後から履歴を読む人が意図を辿れるよう、必ず渡すこと',
}

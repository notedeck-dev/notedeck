/**
 * Rust (notecore) が画面向けに返す値を、表示言語で描き直す (#135 段 4)。
 *
 * notecore は表示用の欄に英語の正本文を入れ、`i18n` 欄に各欄の
 * `{ key, params }` を添えて返す (crates/notecore/src/i18n)。ここで各欄を
 * 表示言語の辞書で引き直す。辞書に無いキー (版ずれ) は英語の正本文のまま出す。
 */

import type { CapabilityId } from '@/capabilities/declarations.generated'
import { capabilityLabel } from '@/capabilities/declare'
import { i18n } from '.'

interface Hint {
  key: string
  params?: Record<string, unknown>
}

function hasHints(value: unknown): value is object {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'i18n' in value
  )
}

/**
 * 描き直した写しを返す (`i18n` 欄は落とす)。入れ子のオブジェクト
 * (確認プレビューの `installPreview` など) も自分の `i18n` 欄を持っていれば描き直す
 */
export function localizeNative<T extends object>(value: T): T {
  const { i18n: hints, ...rest } = value as T & {
    i18n?: Record<string, Hint>
  }
  const out: Record<string, unknown> = { ...rest }
  for (const [field, child] of Object.entries(out))
    if (hasHints(child)) out[field] = localizeNative(child)
  if (!hints) return out as T
  for (const [field, hint] of Object.entries(hints)) {
    const params = { ...(hint.params ?? {}) }
    // capability の表示名は Rust だと英語しか引けないので、ここで引き直す
    if (typeof params.capability === 'string')
      params.label = capabilityLabel(params.capability as CapabilityId)
    const text = i18n.byKey(hint.key, params)
    if (text !== undefined) out[field] = text
  }
  return out as T
}

/**
 * 1 つの欄だけを表示言語で描き直す。元の値を書き換えずに表示する箇所で使う
 * (描き直した写しを保存し直すと、英語の正本文と手がかりが失われるため)
 */
export function nativeField(value: object, field: string): string {
  const localized = localizeNative(value) as Record<string, unknown>
  const text = localized[field]
  return typeof text === 'string' ? text : ''
}

/**
 * Rust のストリームのエラーイベント (`error` + `error_i18n`) を表示言語の文にする。
 * 手がかりが無ければ文をそのまま、文も無ければ「不明なエラー」
 */
export function nativeError(event: {
  error?: string | null
  error_i18n?: unknown
}): string {
  const text = event.error_i18n
    ? nativeField(
        { error: event.error ?? '', i18n: { error: event.error_i18n } },
        'error',
      )
    : event.error
  return text || i18n.ts._common.unknownError
}

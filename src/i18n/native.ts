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

/** 描き直した写しを返す (`i18n` 欄は落とす) */
export function localizeNative<T extends object>(value: T): T {
  const { i18n: hints, ...rest } = value as T & {
    i18n?: Record<string, Hint>
  }
  if (!hints) return rest as T
  const out: Record<string, unknown> = { ...rest }
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

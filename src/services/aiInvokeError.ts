/**
 * AI ターンの呼び出し (invoke) が reject したときの表示文言 (#1317)。
 *
 * Tauri の reject は null / undefined / 空オブジェクトで届くことがあり、そのまま
 * 文字列にすると「⚠️ null」のように何が起きたか分からない表示になる。読める本文が
 * 無ければ null を返し、呼び出し側が既定の文言 (不明なエラー) に置き換える。
 */

import { extractErrorMessage } from '@/utils/errors'

export function invokeErrorText(e: unknown): string | null {
  if (e == null) return null
  // 既知の形 ({ code, message, ... }) で読める文字列が 1 つも無ければ、JSON の
  // 文字列化 ('{"message":null}') を見せても意味が無い
  if (typeof e === 'object' && !(e instanceof Error)) {
    const o = e as Record<string, unknown>
    const readable = ['message', 'error', 'detail', 'code'].some(
      (k) => typeof o[k] === 'string' && (o[k] as string).trim() !== '',
    )
    if (!readable) return null
  }
  const text = extractErrorMessage(e).trim()
  if (text === '' || text === 'null' || text === 'undefined' || text === '{}')
    return null
  return text
}

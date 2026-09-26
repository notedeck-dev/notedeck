/**
 * Typed invoke wrapper powered by tauri-specta bindings.
 *
 * `commands` — auto-generated typed command object (dev ビルドで src/bindings.ts に出力).
 * `unwrap()` — Result<T, E> を従来の invoke 互換に変換（成功時 T、失敗時 throw）.
 *
 * "[TAURI] Couldn't find callback id" warnings during HMR/reload are harmless
 * Tauri-side messages that cannot be suppressed from JS.
 */

import type { Result } from '@/bindings'

export { commands } from '@/bindings'

/**
 * Unwrap a tauri-specta Result into the raw value, throwing on error.
 * Compatible with existing try/catch patterns used throughout the codebase.
 */
export function unwrap<T, E = unknown>(result: Result<T, E>): T {
  if (result.status === 'ok') return result.data
  throw result.error
}

/**
 * 条件付き書込 (版の照合) が別の書き手に先を越された (#1106)。呼び出し側は
 * 最新を読み直して自分の変更を載せ直すか、諦めて最新に揃える
 */
export function isConflictError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === 'CONFLICT'
  )
}

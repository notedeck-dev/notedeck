/**
 * セーフモード (#794) — 第三者コード・ユーザー装飾を全部止めて起動する脱出ハッチ。
 *
 * 判定の正本は localStorage の 1 キーだけ。CLI 引数 (`--safe-mode`) と URL クエリ
 * (`?safemode=true`) は「そのキーを立てる起動経路」に徹する。こうすると解除は常に
 * 「キーを消してリロード」の 1 手で済み、起動経路ごとの解除手順を持たなくてよい。
 * (本家 Misskey 2026.6.0 の isSafeMode と同じ構造)
 *
 * 無効化するもの:
 *   - AiScript プラグイン / ウィジェット (起動時に自動実行される第三者コード)
 *   - カスタム CSS
 *   - ユーザーテーマ (既定テーマに固定)
 *   - HEARTBEAT daemon (常駐して AI 推論を回す global daemon)
 *
 * 本家との差は下 2 つ。本家のウィジェットは AiScript ではないため対象外で、
 * HEARTBEAT は本家に存在しない。どちらも「起動時に勝手に走る」点でプラグインと
 * 同格なので NoteDeck では止める。
 */

import { STORAGE_KEYS } from './storage'

/** Rust 側が `--safe-mode` 付き起動時に initialization script で立てるフラグ */
declare global {
  interface Window {
    __ND_SAFE_MODE_ARG__?: boolean
  }
}

export interface SafeModeSources {
  /** CLI 引数由来 (Tauri) */
  argFlag: boolean
  /** `location.search` 相当 (ブラウザ / dev サーバー用) */
  search: string
  /** localStorage の保存値 */
  stored: string | null
}

export function resolveSafeMode(sources: SafeModeSources): boolean {
  if (sources.stored === 'true') return true
  if (sources.argFlag) return true
  return new URLSearchParams(sources.search).get('safemode') === 'true'
}

/** 現在のセーフモード状態。boot script が確定させた localStorage を読むだけ。 */
export function readSafeMode(): boolean {
  // node 環境の単体テストから gate 済みモジュールを import しても落ちないように
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(STORAGE_KEYS.safeMode) === 'true'
}

/**
 * セーフモードを解除する。localStorage を消してリロードするだけ —
 * `--safe-mode` 付きで起動していた場合は次の起動でまた立つが、それは
 * 「引数を外して起動し直す」で解決する話で、解除手順は 1 つに保つ。
 */
export function exitSafeMode(): void {
  localStorage.removeItem(STORAGE_KEYS.safeMode)
  const url = new URL(window.location.href)
  url.searchParams.delete('safemode')
  window.location.replace(url.toString())
}

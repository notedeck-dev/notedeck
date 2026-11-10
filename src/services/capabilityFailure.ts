import { extractErrorMessage } from '@/utils/errors'

/** ホームディレクトリ (`/home/<名前>` / `/Users/<名前>` / `C:\Users\<名前>`) */
const HOME_DIR = /(?:\/(?:home|Users)\/|[A-Za-z]:\\Users\\)[^/\\\s"'`:]+/g

/**
 * capability の失敗を、呼んだ側 (AI・外部 API・MCP・プラグイン) へ返す文言にする。
 *
 * - Rust 由来の失敗は Error ではなく `{ code, message, ... }` の object で投げられる。
 *   `String()` で潰すと `[object Object]` になり、理由が届かない (#1255)
 * - 表示言語には描き直さない。読むのは AI と外部で、Rust 側も message を英語の
 *   正本文として持っている
 * - ファイル操作の失敗には絶対パスが入る。アプリの外へ出る文言なので、ホーム
 *   ディレクトリは `~` にして OS のユーザー名を載せない。出どころ (Rust の各所 /
 *   TS の例外 / 他のプラグイン) を問わず、外へ出るこの 1 箇所で掛ける
 */
export function failureMessage(e: unknown): string {
  return extractErrorMessage(e).replace(HOME_DIR, '~')
}

/** 相手のサーバーまで要求を出した結果の失敗 (エラー応答 / レート制限 / 通信断) */
const REMOTE_CODES = new Set([
  'API',
  'RATE_LIMITED',
  'NETWORK',
  'CONNECTION_CLOSED',
  'JSON',
])

/**
 * 失敗が「相手まで要求を出した結果」なら `{ code, message }`、呼べなかったもの
 * (要求の形の誤り / アカウントが無い / 内部の失敗 / 素の Error) なら null (#1249)。
 *
 * `code` は Misskey のエラーコードがあればそれ (本家向けに書かれた `info.code` の
 * 判定がそのまま動く)、無いとき (通信断など) は NoteDeck の種別
 */
export function remoteFailure(
  e: unknown,
): { code: string; message: string } | null {
  if (typeof e !== 'object' || e === null) return null
  const { code, apiCode } = e as { code?: unknown; apiCode?: unknown }
  if (typeof code !== 'string' || !REMOTE_CODES.has(code)) return null
  return {
    code: typeof apiCode === 'string' ? apiCode : code,
    message: failureMessage(e),
  }
}

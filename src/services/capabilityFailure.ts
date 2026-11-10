import { extractErrorMessage } from '@/utils/errors'

/**
 * ホームディレクトリ (`/home/<名前>` / `/Users/<名前>` / `C:\Users\<名前>`)。
 * Windows の名前は空白を含みうるので、次の区切りまでを名前とする。区切りは
 * JSON にした後の二重のバックスラッシュでも合うようにする
 */
const HOME_DIR =
  /\/(?:home|Users)\/[^/\\\s"'`:]+|[A-Za-z]:\\{1,2}Users\\{1,2}[^\\/:"'`\n]+/g

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

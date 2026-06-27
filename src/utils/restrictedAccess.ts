import type { AppError } from './errors'

/**
 * サーバーが匿名取得を許可していない (requireCredential) エンドポイントで返る
 * CREDENTIAL_REQUIRED / ACCESS_DENIED を、生エラー文字列の代わりに表示する案内に変換する。
 *
 * 本家 Misskey では匿名公開だが一部フォーク (yamisskey 系) が認証必須に絞っている
 * `federation/instances` や `users` などで使う。静的に常時不可能なもの (`roles/list` 等)
 * はタブ非表示で対応するためここでは扱わない。
 *
 * @param subject 「連合情報」「ユーザー情報」など、公開対象を表す名詞
 * @param hasToken ログイン済みか (未ログインかどうかで文面を変える)
 * @returns 案内を出すべきなら `{ message, info }`、該当しなければ `null` (生エラー表示にフォールバック)
 */
export function restrictedAccessNotice(
  err: AppError,
  subject: string,
  hasToken: boolean,
): { message: string; info: boolean } | null {
  const code = err.displayCode
  const credentialRequired = code === 'CREDENTIAL_REQUIRED'
  const accessDenied = code === 'ACCESS_DENIED' || code === 'PERMISSION_DENIED'

  // 未ログイン: このサーバーが匿名公開していないだけ (ログインすれば見られる場合がある)
  if (credentialRequired && !hasToken) {
    return { message: `このサーバーは${subject}を公開していません`, info: true }
  }
  // ログイン済みでも弾かれる: 権限不足 (read:federation 不許可 / モデレーター権限要 等)
  if (credentialRequired || accessDenied) {
    return { message: `${subject}の閲覧権限がありません`, info: false }
  }
  return null
}

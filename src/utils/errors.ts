/** 認証エラーの内訳。正本は notecli の `AuthErrorKind`。 */
export type AuthErrorCode =
  | 'AUTH_NO_TOKEN'
  | 'AUTH_MIAUTH_FAILED'
  | 'AUTH_MIAUTH_PENDING'
  | 'AUTH_MIAUTH_MALFORMED'
  | 'AUTH_SESSION_INVALID'
  | 'AUTH_CREDENTIAL_MISSING'

/** 正本は notecli の `NoteDeckError::code()`。 */
export type ErrorCode =
  | 'DATABASE'
  | 'NETWORK'
  | 'JSON'
  | 'ACCOUNT_NOT_FOUND'
  | 'API'
  | AuthErrorCode
  | 'NO_CONNECTION'
  | 'CONNECTION_CLOSED'
  | 'INVALID_INPUT'
  | 'KEYCHAIN'
  | 'INTERNAL'
  | 'UNKNOWN'

export const AUTH_ERROR_MESSAGE =
  'ログインが必要です。アカウントメニューから再ログインしてください。'

/** サーバーが「この資格情報では通せない」と返すときの Misskey エラーコード */
const AUTH_API_CODES = new Set(['AUTHENTICATION_FAILED', 'CREDENTIAL_REQUIRED'])

export class AppError extends Error {
  readonly code: ErrorCode
  /** Misskey が返した `error.code`。API エラー以外では null */
  readonly apiCode: string | null

  constructor(code: ErrorCode, message: string, apiCode: string | null = null) {
    super(message)
    this.code = code
    this.apiCode = apiCode
    this.name = 'AppError'
  }

  get isNetwork(): boolean {
    return this.code === 'NETWORK' || this.code === 'CONNECTION_CLOSED'
  }

  get isAuth(): boolean {
    if (this.code.startsWith('AUTH_') || this.code === 'ACCOUNT_NOT_FOUND') {
      return true
    }
    // サーバー側のトークン失効はコア層で code='API' に潰れて届くため、
    // サーバー由来の error.code で判定する
    return this.apiCode !== null && AUTH_API_CODES.has(this.apiCode)
  }

  /** toast 用のエラーコード。API エラーならサーバー由来の Misskey コード */
  get displayCode(): string {
    return this.apiCode ?? this.code
  }

  /** Parse an error from Tauri invoke rejection or any thrown value */
  static from(e: unknown): AppError {
    if (e instanceof AppError) return e
    if (typeof e === 'object' && e !== null && 'code' in e && 'message' in e) {
      const apiCode = (e as { apiCode?: unknown }).apiCode
      return new AppError(
        (e as { code: string }).code as ErrorCode,
        extractErrorMessage((e as { message: unknown }).message),
        typeof apiCode === 'string' ? apiCode : null,
      )
    }
    if (typeof e === 'string') return new AppError('UNKNOWN', e)
    if (e instanceof Error) return new AppError('UNKNOWN', e.message)
    return new AppError('UNKNOWN', extractErrorMessage(e))
  }
}

/**
 * 任意の値から「表示可能なエラーメッセージ文字列」を抽出する。
 * `String({})` が `[object Object]` を返してしまうのを避け、
 * オブジェクトは JSON 表現で読める形に正規化する。
 */
export function extractErrorMessage(e: unknown): string {
  if (e === null) return 'null'
  if (e === undefined) return 'undefined'
  if (typeof e === 'string') return e
  if (typeof e === 'number' || typeof e === 'boolean') return String(e)
  if (e instanceof Error) return e.message
  if (typeof e === 'object') {
    // 既知の shape を優先抽出
    const o = e as Record<string, unknown>
    if (typeof o.message === 'string') return o.message
    if (typeof o.message === 'object' && o.message !== null) {
      return extractErrorMessage(o.message)
    }
    if (typeof o.error === 'string') return o.error
    if (typeof o.detail === 'string') return o.detail
    if (typeof o.code === 'string') return o.code
    // フォールバック: JSON 形式 (循環参照は捕捉)
    try {
      return JSON.stringify(e)
    } catch {
      return Object.prototype.toString.call(e)
    }
  }
  return String(e)
}

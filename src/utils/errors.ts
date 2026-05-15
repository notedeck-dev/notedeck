export type ErrorCode =
  | 'DATABASE'
  | 'NETWORK'
  | 'JSON'
  | 'ACCOUNT_NOT_FOUND'
  | 'API'
  | 'AUTH'
  | 'WEBSOCKET'
  | 'NO_CONNECTION'
  | 'CONNECTION_CLOSED'
  | 'INVALID_INPUT'
  | 'UNKNOWN'

export const AUTH_ERROR_MESSAGE = 'ログインが必要です。'

export class AppError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'AppError'
  }

  get isNetwork(): boolean {
    return this.code === 'NETWORK' || this.code === 'CONNECTION_CLOSED'
  }

  get isAuth(): boolean {
    return this.code === 'AUTH' || this.code === 'ACCOUNT_NOT_FOUND'
  }

  /** toast 用のエラーコード。API エラーなら Misskey コードを抽出 */
  get displayCode(): string {
    if (this.code === 'API') {
      const match = this.message.match(/^[^:]+:\s*([A-Z_]+)/)
      if (match?.[1]) return match[1]
    }
    return this.code
  }

  /** Parse an error from Tauri invoke rejection or any thrown value */
  static from(e: unknown): AppError {
    if (e instanceof AppError) return e
    if (typeof e === 'object' && e !== null && 'code' in e && 'message' in e) {
      return new AppError(
        (e as { code: string }).code as ErrorCode,
        extractErrorMessage((e as { message: unknown }).message),
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

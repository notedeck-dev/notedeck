import { describe, expect, it } from 'vitest'
import { AppError } from '@/utils/errors'

describe('AppError.from()', () => {
  it('returns same instance for AppError input', () => {
    const err = new AppError('NETWORK', 'timeout')
    expect(AppError.from(err)).toBe(err)
  })

  it('parses Tauri-style {code, message} object', () => {
    const err = AppError.from({
      code: 'AUTH_NO_TOKEN',
      message: 'Unauthorized',
    })
    expect(err.code).toBe('AUTH_NO_TOKEN')
    expect(err.message).toBe('Unauthorized')
    expect(err.apiCode).toBeNull()
  })

  it('keeps the server-supplied apiCode', () => {
    const err = AppError.from({
      code: 'API',
      message: 'notes/show: NO_SUCH_NOTE: gone',
      apiCode: 'NO_SUCH_NOTE',
    })
    expect(err.apiCode).toBe('NO_SUCH_NOTE')
    expect(err.displayCode).toBe('NO_SUCH_NOTE')
  })

  it('displayCode falls back to code when the server gave none', () => {
    expect(new AppError('CONNECTION_CLOSED', 'closed').displayCode).toBe(
      'CONNECTION_CLOSED',
    )
  })

  it('wraps plain string as UNKNOWN', () => {
    const err = AppError.from('something went wrong')
    expect(err.code).toBe('UNKNOWN')
    expect(err.message).toBe('something went wrong')
  })

  it('wraps Error instance as UNKNOWN', () => {
    const err = AppError.from(new TypeError('bad type'))
    expect(err.code).toBe('UNKNOWN')
    expect(err.message).toBe('bad type')
  })

  it('wraps null as UNKNOWN', () => {
    const err = AppError.from(null)
    expect(err.code).toBe('UNKNOWN')
    expect(err.message).toBe('null')
  })

  it('wraps undefined as UNKNOWN', () => {
    const err = AppError.from(undefined)
    expect(err.code).toBe('UNKNOWN')
    expect(err.message).toBe('undefined')
  })

  it('wraps number as UNKNOWN', () => {
    const err = AppError.from(42)
    expect(err.code).toBe('UNKNOWN')
    expect(err.message).toBe('42')
  })

  it('isNetwork returns true for NETWORK and CONNECTION_CLOSED', () => {
    expect(new AppError('NETWORK', 'err').isNetwork).toBe(true)
    expect(new AppError('CONNECTION_CLOSED', 'err').isNetwork).toBe(true)
    expect(new AppError('AUTH_NO_TOKEN', 'err').isNetwork).toBe(false)
  })

  it('isAuth returns true for every AUTH_ kind and ACCOUNT_NOT_FOUND', () => {
    expect(new AppError('AUTH_NO_TOKEN', 'err').isAuth).toBe(true)
    expect(new AppError('AUTH_MIAUTH_PENDING', 'err').isAuth).toBe(true)
    expect(new AppError('AUTH_SESSION_INVALID', 'err').isAuth).toBe(true)
    expect(new AppError('AUTH_CREDENTIAL_MISSING', 'err').isAuth).toBe(true)
    expect(new AppError('ACCOUNT_NOT_FOUND', 'err').isAuth).toBe(true)
    expect(new AppError('NETWORK', 'err').isAuth).toBe(false)
  })

  it('isAuth detects token expiry inside API errors', () => {
    // notecli は HTTP 401 を code='API' に潰すため、サーバー由来の apiCode で判定する。
    // message の文言には依存しない
    expect(
      AppError.from({
        code: 'API',
        message: 'サーバーからのメッセージ',
        apiCode: 'AUTHENTICATION_FAILED',
      }).isAuth,
    ).toBe(true)
    expect(
      AppError.from({
        code: 'API',
        message: 'サーバーからのメッセージ',
        apiCode: 'CREDENTIAL_REQUIRED',
      }).isAuth,
    ).toBe(true)
    expect(
      AppError.from({
        code: 'API',
        message: 'notes/timeline: RATE_LIMIT_EXCEEDED: slow down',
        apiCode: 'RATE_LIMIT_EXCEEDED',
      }).isAuth,
    ).toBe(false)
  })
})

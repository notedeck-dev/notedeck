import { describe, expect, it } from 'vitest'
import { AppError } from '@/utils/errors'

describe('AppError.from()', () => {
  it('returns same instance for AppError input', () => {
    const err = new AppError('NETWORK', 'timeout')
    expect(AppError.from(err)).toBe(err)
  })

  it('parses Tauri-style {code, message} object', () => {
    const err = AppError.from({ code: 'AUTH', message: 'Unauthorized' })
    expect(err.code).toBe('AUTH')
    expect(err.message).toBe('Unauthorized')
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
    expect(new AppError('AUTH', 'err').isNetwork).toBe(false)
  })

  it('isAuth returns true for AUTH and ACCOUNT_NOT_FOUND', () => {
    expect(new AppError('AUTH', 'err').isAuth).toBe(true)
    expect(new AppError('ACCOUNT_NOT_FOUND', 'err').isAuth).toBe(true)
    expect(new AppError('NETWORK', 'err').isAuth).toBe(false)
  })

  it('isAuth detects token expiry inside API errors', () => {
    // notecli は HTTP 401 を code='API' に潰すため Misskey エラーコードで判定する
    expect(
      new AppError('API', 'i: AUTHENTICATION_FAILED: invalid token').isAuth,
    ).toBe(true)
    expect(
      new AppError('API', 'notes/timeline: CREDENTIAL_REQUIRED: login required')
        .isAuth,
    ).toBe(true)
    expect(
      new AppError('API', 'notes/timeline: RATE_LIMIT_EXCEEDED: slow down')
        .isAuth,
    ).toBe(false)
  })
})

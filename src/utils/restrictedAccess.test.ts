import { describe, expect, it } from 'vitest'
import { AppError } from './errors'
import { restrictedAccessNotice } from './restrictedAccess'

const apiErr = (apiCode: string) => new AppError('API', 'raw', apiCode)

describe('restrictedAccessNotice', () => {
  it('未ログインで CREDENTIAL_REQUIRED なら「公開していない」を info として返す', () => {
    const r = restrictedAccessNotice(
      apiErr('CREDENTIAL_REQUIRED'),
      '連合情報',
      false,
    )
    expect(r).toEqual({
      message: 'このサーバーは連合情報を公開していません',
      info: true,
    })
  })

  it('ログイン済みで CREDENTIAL_REQUIRED なら「閲覧権限がない」を info でなく返す', () => {
    expect(
      restrictedAccessNotice(apiErr('CREDENTIAL_REQUIRED'), '連合情報', true),
    ).toEqual({ message: '連合情報の閲覧権限がありません', info: false })
  })

  it.each([
    'ACCESS_DENIED',
    'PERMISSION_DENIED',
  ])('%s はログイン有無に関係なく「閲覧権限がない」', (code) => {
    for (const hasToken of [true, false]) {
      expect(
        restrictedAccessNotice(apiErr(code), 'ユーザー情報', hasToken),
      ).toEqual({ message: 'ユーザー情報の閲覧権限がありません', info: false })
    }
  })

  it('apiCode が無ければ AppError の code で判定し、該当しなければ null', () => {
    expect(
      restrictedAccessNotice(new AppError('NETWORK', 'x'), 's', false),
    ).toBeNull()
    expect(restrictedAccessNotice(apiErr('NO_SUCH_NOTE'), 's', true)).toBeNull()
  })

  it('AUTHENTICATION_FAILED は対象外 (null)', () => {
    expect(
      restrictedAccessNotice(apiErr('AUTHENTICATION_FAILED'), 's', true),
    ).toBeNull()
  })
})

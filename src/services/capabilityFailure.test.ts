import { describe, expect, it } from 'vitest'
import { failureMessage, remoteFailure } from './capabilityFailure'

describe('failureMessage: capability の失敗を、外へ返す文言にする', () => {
  it('Error はその message', () => {
    expect(failureMessage(new Error('drafts.create: text is required'))).toBe(
      'drafts.create: text is required',
    )
  })

  it('Rust 由来の失敗 (code と message を持つ object) は message を取り出す', () => {
    const e = {
      code: 'API',
      message: 'notes/drafts/list: UNKNOWN_API_ENDPOINT: Unknown API endpoint.',
      apiCode: 'UNKNOWN_API_ENDPOINT',
    }
    expect(failureMessage(e)).toBe(
      'notes/drafts/list: UNKNOWN_API_ENDPOINT: Unknown API endpoint.',
    )
  })

  it('表示言語に描き直さず、英語の正本文のまま返す (AI・外部が読む)', () => {
    const e = {
      code: 'INVALID_INPUT',
      message: 'Reserved skill cannot be renamed',
      i18n: { key: '_native.error.reservedSkill', params: {} },
    }
    expect(failureMessage(e)).toBe('Reserved skill cannot be renamed')
  })

  it('ホームディレクトリは ~ にして、OS のユーザー名を外へ出さない', () => {
    expect(
      failureMessage({
        code: 'INVALID_INPUT',
        message:
          'Invalid input: Failed to read /home/alice/.config/notedeck/config/ai.json5: No such file',
      }),
    ).toBe(
      'Invalid input: Failed to read ~/.config/notedeck/config/ai.json5: No such file',
    )
    expect(
      failureMessage(
        new Error('Failed to write /Users/bob/Library/x.json5: denied'),
      ),
    ).toBe('Failed to write ~/Library/x.json5: denied')
    expect(
      failureMessage(
        new Error('Failed to read C:\\Users\\carol\\AppData\\x.json5'),
      ),
    ).toBe('Failed to read ~\\AppData\\x.json5')
  })

  it('空白を含むユーザー名 (Windows / macOS) も、JSON にした後のパスも伏せる', () => {
    expect(
      failureMessage(
        new Error('Failed to read C:\\Users\\John Smith\\AppData\\x.json5'),
      ),
    ).toBe('Failed to read ~\\AppData\\x.json5')
    expect(
      failureMessage(
        new Error('Failed to read /Users/John Smith/Library/x.json5: denied'),
      ),
    ).toBe('Failed to read ~/Library/x.json5: denied')
    const viaJson = failureMessage({
      unexpected: 'C:\\Users\\carol\\AppData\\x.json5',
    })
    expect(viaJson).not.toContain('carol')
  })

  it('文字列でも object でもない値でも [object Object] にしない', () => {
    expect(failureMessage({ unexpected: true })).not.toContain(
      '[object Object]',
    )
  })
})

describe('remoteFailure: 相手まで要求を出した結果の失敗か', () => {
  it('サーバーのエラー応答は Misskey のコードで返す', () => {
    expect(
      remoteFailure({
        code: 'API',
        apiCode: 'UNKNOWN_API_ENDPOINT',
        message: 'notes/drafts/list: UNKNOWN_API_ENDPOINT',
      }),
    ).toEqual({
      code: 'UNKNOWN_API_ENDPOINT',
      message: 'notes/drafts/list: UNKNOWN_API_ENDPOINT',
    })
  })

  it('Misskey のコードが無い失敗 (通信断など) は NoteDeck の種別で返す', () => {
    expect(
      remoteFailure({ code: 'NETWORK', message: 'Network error' }),
    ).toEqual({ code: 'NETWORK', message: 'Network error' })
    expect(remoteFailure({ code: 'API', message: 'meta (502)' })).toEqual({
      code: 'API',
      message: 'meta (502)',
    })
  })

  it('呼べなかったもの (形の誤り / アカウント / 内部) と素の Error は null', () => {
    expect(remoteFailure(new Error('boom'))).toBeNull()
    expect(remoteFailure({ code: 'INVALID_INPUT', message: 'x' })).toBeNull()
    expect(
      remoteFailure({ code: 'ACCOUNT_NOT_FOUND', message: 'x' }),
    ).toBeNull()
    expect(remoteFailure({ code: 'INTERNAL', message: 'x' })).toBeNull()
    expect(remoteFailure('string')).toBeNull()
  })
})

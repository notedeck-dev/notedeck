import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiGetMetaDetailMock = vi.fn()
const apiGetUserPoliciesMock = vi.fn()
const apiRequestMock = vi.fn()

vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      apiGetMetaDetail: (...a: unknown[]) => apiGetMetaDetailMock(...a),
      apiGetUserPolicies: (...a: unknown[]) => apiGetUserPoliciesMock(...a),
      apiRequest: (...a: unknown[]) => apiRequestMock(...a),
    },
  }
})

import {
  loadTranslatorAvailable,
  resetTranslatorAvailabilityCache,
  translateNote,
} from './noteTranslation'

const ok = (data: unknown) => ({ status: 'ok', data })
const err = {
  status: 'error',
  error: { code: 'API', message: 'x', apiCode: 'UNAVAILABLE', i18n: null },
}

beforeEach(() => {
  resetTranslatorAvailabilityCache()
  apiGetMetaDetailMock.mockReset()
  apiGetUserPoliciesMock.mockReset()
  apiRequestMock.mockReset()
})

describe('loadTranslatorAvailable', () => {
  it('サーバーが翻訳を提供し、ロールで使えるときだけ真', async () => {
    apiGetMetaDetailMock.mockResolvedValue(ok({ translatorAvailable: true }))
    apiGetUserPoliciesMock.mockResolvedValue(ok({ canUseTranslator: true }))
    expect(await loadTranslatorAvailable('a')).toBe(true)
  })

  it('サーバーに翻訳が無ければ偽', async () => {
    apiGetMetaDetailMock.mockResolvedValue(ok({ translatorAvailable: false }))
    apiGetUserPoliciesMock.mockResolvedValue(ok({ canUseTranslator: true }))
    expect(await loadTranslatorAvailable('a')).toBe(false)
  })

  it('ロールで使えなければ偽', async () => {
    apiGetMetaDetailMock.mockResolvedValue(ok({ translatorAvailable: true }))
    apiGetUserPoliciesMock.mockResolvedValue(ok({ canUseTranslator: false }))
    expect(await loadTranslatorAvailable('a')).toBe(false)
  })

  it('読めなければ偽 (メニューに出さない)', async () => {
    apiGetMetaDetailMock.mockResolvedValue(err)
    apiGetUserPoliciesMock.mockResolvedValue(ok({ canUseTranslator: true }))
    expect(await loadTranslatorAvailable('a')).toBe(false)
  })

  it('アカウントごとに一度だけ問い合わせる', async () => {
    apiGetMetaDetailMock.mockResolvedValue(ok({ translatorAvailable: true }))
    apiGetUserPoliciesMock.mockResolvedValue(ok({ canUseTranslator: true }))
    await loadTranslatorAvailable('a')
    await loadTranslatorAvailable('a')
    await loadTranslatorAvailable('b')
    expect(apiGetMetaDetailMock).toHaveBeenCalledTimes(2)
  })
})

describe('translateNote', () => {
  it('notes/translate を表示言語で呼び、結果を返す', async () => {
    apiRequestMock.mockResolvedValue(
      ok({ sourceLang: 'EN', text: 'こんにちは' }),
    )
    expect(await translateNote('a', 'n1', 'ja-JP')).toEqual({
      sourceLang: 'EN',
      text: 'こんにちは',
    })
    expect(apiRequestMock).toHaveBeenCalledWith('a', 'notes/translate', {
      noteId: 'n1',
      targetLang: 'ja-JP',
    })
  })

  it('結果の形が違えば失敗にする (翻訳キー未設定のサーバーは空で返す)', async () => {
    apiRequestMock.mockResolvedValue(ok(null))
    await expect(translateNote('a', 'n1', 'ja-JP')).rejects.toThrow()
  })
})

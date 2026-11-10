import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiGetDrafts } = vi.hoisted(() => ({ apiGetDrafts: vi.fn() }))
vi.mock('@/utils/tauriInvoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/tauriInvoke')>()),
  commands: { apiGetDrafts },
}))

import { loadAllDrafts, refreshDrafts } from './useDrafts'

beforeEach(() => {
  apiGetDrafts.mockReset()
})

/**
 * 下書き API の無いサーバーや通信断を「0 件」にすると、AI やウィジェットは
 * 失敗と区別できない (#1255)。失敗は呼んだ側へ伝える
 */
describe('refreshDrafts の失敗', () => {
  it('取得に失敗したら握り潰さずに投げる', async () => {
    apiGetDrafts.mockResolvedValue({
      status: 'error',
      error: {
        code: 'API',
        message: 'notes/drafts/list: UNKNOWN_API_ENDPOINT',
        apiCode: 'UNKNOWN_API_ENDPOINT',
      },
    })
    await expect(refreshDrafts('a')).rejects.toMatchObject({
      apiCode: 'UNKNOWN_API_ENDPOINT',
    })
    expect(loadAllDrafts('a')).toEqual({})
  })

  it('失敗しても、前に取得した一覧は残す', async () => {
    apiGetDrafts.mockResolvedValueOnce({
      status: 'ok',
      data: [
        { id: 'd1', text: 'hello', createdAt: '2026-11-01T00:00:00.000Z' },
      ],
    })
    await refreshDrafts('b')
    apiGetDrafts.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'NETWORK', message: 'Network error' },
    })
    await expect(refreshDrafts('b')).rejects.toMatchObject({ code: 'NETWORK' })
    expect(Object.keys(loadAllDrafts('b'))).toEqual(['d1'])
  })
})

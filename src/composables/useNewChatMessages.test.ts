import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useNewChatMessages } from './useNewChatMessages'

const streamSubscribeMain = vi.fn(async (_id: string) => ({
  status: 'ok',
  data: null,
}))
vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      streamSubscribeMain: (id: string) => streamSubscribeMain(id),
    },
  }
})

describe('useNewChatMessages.follow (#1223)', () => {
  beforeEach(() => {
    streamSubscribeMain.mockClear()
  })

  it('後から増えたアカウントも新着を受ける (張るのは増えた分だけ)', async () => {
    const ids = ref(['a1'])
    const scope = effectScope()
    scope.run(() => useNewChatMessages(() => {}).follow(() => ids.value))
    expect(streamSubscribeMain.mock.calls.map((c) => c[0])).toEqual(['a1'])

    ids.value = ['a1', 'a2']
    await nextTick()
    expect(streamSubscribeMain.mock.calls.map((c) => c[0])).toEqual([
      'a1',
      'a2',
    ])
    scope.stop()
  })

  it('外れてから戻ったアカウント (再ログイン等) は張り直す', async () => {
    const ids = ref(['a1'])
    const scope = effectScope()
    scope.run(() => useNewChatMessages(() => {}).follow(() => ids.value))

    ids.value = []
    await nextTick()
    ids.value = ['a1']
    await nextTick()
    expect(streamSubscribeMain.mock.calls.map((c) => c[0])).toEqual([
      'a1',
      'a1',
    ])
    scope.stop()
  })
})

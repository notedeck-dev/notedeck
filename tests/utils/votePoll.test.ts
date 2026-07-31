import { describe, expect, it, vi } from 'vitest'
import type { NormalizedNote, NormalizedPoll } from '@/adapters/types'
import { type PollPatch, votePoll } from '@/utils/votePoll'

function makePoll(overrides: Partial<NormalizedPoll> = {}): NormalizedPoll {
  return {
    choices: [
      { text: 'A', votes: 3, isVoted: false },
      { text: 'B', votes: 1, isVoted: false },
    ],
    multiple: false,
    expiresAt: null,
    ...overrides,
  }
}

function makeNote(overrides: Partial<NormalizedNote> = {}): NormalizedNote {
  return {
    id: 'note1',
    text: 'poll note',
    poll: makePoll(),
    ...overrides,
  } as NormalizedNote
}

function makeApi() {
  return { votePoll: vi.fn().mockResolvedValue(undefined) }
}

/** apply された差分を状態として追跡する (呼び出し元の反映を模す) */
function track(note: NormalizedNote) {
  const state = { poll: note.poll }
  const patches: PollPatch[] = []
  const apply = (p: PollPatch) => {
    patches.push(p)
    state.poll = p.poll
  }
  return { state, patches, apply }
}

describe('votePoll (差分適用方式 #888)', () => {
  it('isVoted のみ楽観更新する (votes はストリームの pollVoted に任せる)', async () => {
    const api = makeApi()
    const note = makeNote()
    const { state, apply } = track(note)

    await votePoll(api, note, 1, apply)

    expect(state.poll?.choices[1]?.isVoted).toBe(true)
    expect(state.poll?.choices[1]?.votes).toBe(1)
    expect(state.poll?.choices[0]?.isVoted).toBe(false)
    expect(api.votePoll).toHaveBeenCalledWith('note1', 1)
  })

  it('note は mutate せず、新しい poll オブジェクトで apply する', async () => {
    // shallowRef 保持の面 (プロフィール・クリップ詳細等) が差し替えを
    // 検知できるよう、mutate ではなく新オブジェクトの差分として渡す
    const api = makeApi()
    const note = makeNote()
    const originalPoll = note.poll
    const { state, apply } = track(note)

    await votePoll(api, note, 0, apply)

    expect(note.poll).toBe(originalPoll)
    expect(note.poll?.choices[0]?.isVoted).toBe(false)
    expect(state.poll).not.toBe(originalPoll)
    expect(state.poll?.choices[0]?.isVoted).toBe(true)
  })

  it('失敗時は元の poll を apply し直してから throw する', async () => {
    const api = makeApi()
    api.votePoll.mockRejectedValue(new Error('fail'))
    const note = makeNote()
    const originalPoll = note.poll
    const { state, apply } = track(note)

    await expect(votePoll(api, note, 0, apply)).rejects.toThrow('fail')

    expect(state.poll).toBe(originalPoll)
    expect(state.poll?.choices[0]?.isVoted).toBe(false)
  })

  it.each([
    ['poll が無い', makeNote({ poll: undefined }), 0],
    [
      '期限切れ',
      makeNote({ poll: makePoll({ expiresAt: '2000-01-01T00:00:00Z' }) }),
      0,
    ],
    ['該当 choice が無い', makeNote({ poll: makePoll({ choices: [] }) }), 0],
    [
      '同じ choice に投票済み',
      makeNote({
        poll: makePoll({
          choices: [{ text: 'A', votes: 1, isVoted: true }],
        }),
      }),
      0,
    ],
    [
      '単一選択で別の choice に投票済み',
      makeNote({
        poll: makePoll({
          choices: [
            { text: 'A', votes: 1, isVoted: true },
            { text: 'B', votes: 0, isVoted: false },
          ],
        }),
      }),
      1,
    ],
  ])('%s なら apply も API 呼び出しもしない', async (_name, note, choice) => {
    const api = makeApi()
    const { patches, apply } = track(note)

    await votePoll(api, note, choice, apply)

    expect(patches).toEqual([])
    expect(api.votePoll).not.toHaveBeenCalled()
  })

  it('複数選択なら投票済みでも別の choice に投票できる', async () => {
    const api = makeApi()
    const note = makeNote({
      poll: makePoll({
        multiple: true,
        choices: [
          { text: 'A', votes: 1, isVoted: true },
          { text: 'B', votes: 0, isVoted: false },
        ],
      }),
    })
    const { state, apply } = track(note)

    await votePoll(api, note, 1, apply)

    expect(state.poll?.choices[1]?.isVoted).toBe(true)
    expect(api.votePoll).toHaveBeenCalledWith('note1', 1)
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import { hapticLight } from '@/utils/haptics'
import { votePoll } from '@/utils/votePoll'

vi.mock('@/utils/haptics', () => ({ hapticLight: vi.fn() }))

// 判定と差分適用は src/services/pollVote.test.ts。ここは utils 側の触覚だけ

function makeNote(isVoted: boolean): NormalizedNote {
  return {
    id: 'note1',
    text: 'poll note',
    poll: {
      choices: [{ text: 'A', votes: 0, isVoted }],
      multiple: false,
      expiresAt: null,
    },
  } as NormalizedNote
}

describe('votePoll', () => {
  it('投票できるときだけ触覚を鳴らして API を呼ぶ', async () => {
    const api = { votePoll: vi.fn().mockResolvedValue(undefined) }
    await votePoll(api, makeNote(false), 0, vi.fn())
    expect(hapticLight).toHaveBeenCalledTimes(1)
    expect(api.votePoll).toHaveBeenCalledWith('note1', 0)
  })

  it('投票済みなら触覚も API も無し', async () => {
    vi.mocked(hapticLight).mockClear()
    const api = { votePoll: vi.fn().mockResolvedValue(undefined) }
    await votePoll(api, makeNote(true), 0, vi.fn())
    expect(hapticLight).not.toHaveBeenCalled()
    expect(api.votePoll).not.toHaveBeenCalled()
  })
})

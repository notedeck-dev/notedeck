import { describe, expect, it } from 'vitest'
import type { Account } from '@/stores/accounts'
import { buildPreviewNote } from './buildPreviewNote'

// 組み立ては src/services/previewNote.test.ts。ここは accounts store の既定アバターだけ

describe('buildPreviewNote (既定 deps)', () => {
  it('アバター未設定のアカウントは既定画像', () => {
    const account: Account = {
      id: 'acc-1',
      host: 'misskey.example',
      userId: 'u1',
      username: 'taka',
      displayName: 'Taka',
      avatarUrl: null,
      software: 'misskey-dev/misskey',
      hasToken: true,
    }
    const note = buildPreviewNote({
      account,
      id: 'memo:acc-1:20260101010101',
      createdAt: '2026-01-01T01:01:01Z',
      text: 'hello',
      cw: null,
      visibility: 'public',
      localOnly: false,
    })
    expect(note.user.avatarUrl).toBe('/avatar-default.svg')
  })
})

import { describe, expect, it } from 'vitest'
import type { Account } from '@/stores/accounts'
import { buildPreviewNote } from './buildPreviewNote'

const ACCOUNT: Account = {
  id: 'acc-1',
  host: 'misskey.example',
  userId: 'u1',
  username: 'taka',
  displayName: 'Taka',
  avatarUrl: 'https://example.com/taka.png',
  software: 'misskey-dev/misskey',
  hasToken: true,
}

describe('buildPreviewNote', () => {
  it('uses account displayName/avatarUrl when no author override', () => {
    const note = buildPreviewNote({
      account: ACCOUNT,
      id: 'memo:acc-1:20260101010101',
      createdAt: '2026-01-01T01:01:01Z',
      text: 'hello',
      cw: null,
      visibility: 'public',
      localOnly: false,
    })
    expect(note.user.name).toBe('Taka')
    expect(note.user.avatarUrl).toBe('https://example.com/taka.png')
    expect(note.user.username).toBe('taka')
  })

  it('overrides name/avatarUrl/username/id with author embed (#493)', () => {
    const note = buildPreviewNote({
      account: ACCOUNT,
      id: 'memo:acc-1:20260101010101',
      createdAt: '2026-01-01T01:01:01Z',
      text: 'persona memo',
      cw: null,
      visibility: 'public',
      localOnly: false,
      author: {
        id: 'skill:aizu-9k2x',
        displayName: '藍',
        avatarUrl: 'https://example.com/aizu.svg',
      },
    })
    // 表示名 / アバターは author で上書き (= persona の身元)
    expect(note.user.name).toBe('藍')
    expect(note.user.avatarUrl).toBe('https://example.com/aizu.svg')
    // username は author.id から `skill:` prefix を除いたもの (= persona id)
    expect(note.user.username).toBe('aizu-9k2x')
    // host は null (persona はローカル概念で host を持たない)
    expect(note.user.host).toBe(null)
    // user.id も author.id (= persona と同一視できる identity)
    expect(note.user.id).toBe('skill:aizu-9k2x')
  })

  it('falls back to account avatarUrl when author has no avatarUrl', () => {
    const note = buildPreviewNote({
      account: ACCOUNT,
      id: 'memo:acc-1:20260101010101',
      createdAt: '2026-01-01T01:01:01Z',
      text: 'persona memo',
      cw: null,
      visibility: 'public',
      localOnly: false,
      author: {
        id: 'skill:no-icon',
        displayName: 'no-icon persona',
      },
    })
    expect(note.user.name).toBe('no-icon persona')
    expect(note.user.avatarUrl).toBe('https://example.com/taka.png')
  })
})

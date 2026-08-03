import { describe, expect, it } from 'vitest'
import type { DeckColumn } from '@/stores/deck'
import { columnCacheKey } from './columnCacheKey'

/** guestIds に入れた accountId だけを guest 扱いにする deps */
function deps(guestIds: string[] = []) {
  return { isGuestAccount: (id: string) => guestIds.includes(id) }
}

function col(partial: Partial<DeckColumn> & { type: string }): DeckColumn {
  return {
    id: 'col-1',
    name: null,
    width: 300,
    accountId: 'acc-1',
    ...partial,
  } as DeckColumn
}

describe('columnCacheKey: canonical キー導出 (notecli#30 v5 §6-12 / §9-10)', () => {
  it.each<{
    label: string
    column: DeckColumn
    guests?: string[]
    expected: string | null
  }>([
    // --- timeline (tl / default / guest 変換) ---
    {
      label: 'timeline: tl=home',
      column: col({ type: 'timeline', tl: 'home' }),
      expected: 'home',
    },
    {
      label: 'timeline: tl 未設定は default home',
      column: col({ type: 'timeline' }),
      expected: 'home',
    },
    {
      label: 'timeline: フォーク TL はそのまま',
      column: col({ type: 'timeline', tl: 'bubble' }),
      expected: 'bubble',
    },
    {
      label: 'timeline: guest の tl 未設定は default local',
      column: col({ type: 'timeline' }),
      guests: ['acc-1'],
      expected: 'local',
    },
    {
      label: 'timeline: guest の home は local へ変換',
      column: col({ type: 'timeline', tl: 'home' }),
      guests: ['acc-1'],
      expected: 'local',
    },
    {
      label: 'timeline: guest の social は local へ変換',
      column: col({ type: 'timeline', tl: 'social' }),
      guests: ['acc-1'],
      expected: 'local',
    },
    {
      label: 'timeline: guest でも global はそのまま',
      column: col({ type: 'timeline', tl: 'global' }),
      guests: ['acc-1'],
      expected: 'global',
    },
    {
      label: 'timeline: accountId null は非 guest 扱いで default home',
      column: col({ type: 'timeline', accountId: null }),
      guests: ['acc-1'],
      expected: 'home',
    },
    // --- id 付き種別 ---
    {
      label: 'antenna',
      column: col({ type: 'antenna', antennaId: 'a1' }),
      expected: 'antenna:a1',
    },
    {
      label: 'antenna: id 欠落は null',
      column: col({ type: 'antenna' }),
      expected: null,
    },
    {
      label: 'channel',
      column: col({ type: 'channel', channelId: 'ch1' }),
      expected: 'channel:ch1',
    },
    {
      label: 'clip',
      column: col({ type: 'clip', clipId: 'cl1' }),
      expected: 'clip:cl1',
    },
    {
      label: 'user',
      column: col({ type: 'user', userId: 'u1' }),
      expected: 'user:u1',
    },
    {
      label: 'list は user-list:{id} (旧ミラーの list:{id} は誤り)',
      column: col({ type: 'list', listId: 'l1' }),
      expected: 'user-list:l1',
    },
    {
      label: 'role (旧ミラーは case 欠落で preview が常に空だった)',
      column: col({ type: 'role', roleId: 'r1' }),
      expected: 'role:r1',
    },
    // --- 固定キー種別 ---
    {
      label: 'favorites',
      column: col({ type: 'favorites' }),
      expected: 'favorites',
    },
    {
      label: 'explore',
      column: col({ type: 'explore' }),
      expected: 'explore',
    },
    {
      label: 'mentions',
      column: col({ type: 'mentions' }),
      expected: 'mentions',
    },
    {
      label: 'specified は specified (旧ミラーの mentions は誤り)',
      column: col({ type: 'specified' }),
      expected: 'specified',
    },
    // --- キャッシュ非対応種別 ---
    {
      label: 'キャッシュを持たない種別は null',
      column: col({ type: 'chat' }),
      expected: null,
    },
  ])('$label', ({ column, guests, expected }) => {
    expect(columnCacheKey(column, deps(guests))).toBe(expected)
  })
})

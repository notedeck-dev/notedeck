import { describe, expect, it, vi } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import {
  buildReactionsData,
  canRenoteNote,
  clampMenuPosition,
  deriveActiveModeFlags,
  deriveChannelInfo,
  extractNoteUrls,
  isLongNoteText,
  isPureRenote,
  resolveEffectiveNoteBase,
} from './noteViewModel'

function note(partial: Partial<NormalizedNote> = {}): NormalizedNote {
  return {
    id: 'n1',
    _accountId: 'acc-1',
    _serverHost: 'misskey.example',
    createdAt: '2026-07-01T00:00:00.000Z',
    text: 'hello',
    cw: null,
    user: {
      id: 'u1',
      username: 'alice',
      host: null,
      name: 'アリス',
      avatarUrl: null,
    },
    visibility: 'public',
    emojis: {},
    reactionEmojis: {},
    reactions: {},
    renoteCount: 0,
    repliesCount: 0,
    files: [],
    localOnly: false,
    ...partial,
  }
}

describe('isPureRenote / resolveEffectiveNoteBase', () => {
  it('renote があり text が null なら pure renote で、内側のノートを表示する', () => {
    const inner = note({ id: 'inner' })
    const n = note({ renote: inner, text: null })
    expect(isPureRenote(n)).toBe(true)
    expect(resolveEffectiveNoteBase(n)).toBe(inner)
  })

  it('text がある引用リノートは pure renote ではなく、自身を表示する', () => {
    const n = note({ renote: note({ id: 'inner' }), text: '引用コメント' })
    expect(isPureRenote(n)).toBe(false)
    expect(resolveEffectiveNoteBase(n)).toBe(n)
  })

  it('renote が無ければ自身を表示する', () => {
    const n = note()
    expect(isPureRenote(n)).toBe(false)
    expect(resolveEffectiveNoteBase(n)).toBe(n)
  })
})

describe('extractNoteUrls', () => {
  it('本文中の URL を抽出する', () => {
    const n = note({ text: '見て https://example.com/a すごい' })
    expect(extractNoteUrls(n)).toEqual(['https://example.com/a'])
  })

  it('renote の url / uri と一致する URL は除外する', () => {
    const n = note({
      text: 'https://example.com/a https://example.com/b',
      renote: note({
        id: 'inner',
        url: 'https://example.com/a',
        uri: 'https://example.com/b',
      }),
    })
    expect(extractNoteUrls(n)).toEqual([])
  })

  it('text が null なら空配列', () => {
    expect(extractNoteUrls(note({ text: null }))).toEqual([])
  })
})

describe('deriveChannelInfo', () => {
  it('channel オブジェクトがあれば name / color を使う', () => {
    const n = note({
      channel: { id: 'ch1', name: '雑談', color: '#ff0000' },
    })
    expect(deriveChannelInfo(n)).toEqual({
      id: 'ch1',
      name: '雑談',
      color: '#ff0000',
    })
  })

  it('color が無ければ id から決定論的な hsl を導出する', () => {
    const a = deriveChannelInfo(note({ channel: { id: 'ch1', name: 'x' } }))
    const b = deriveChannelInfo(note({ channel: { id: 'ch1', name: 'x' } }))
    expect(a?.color).toMatch(/^hsl\(\d+, 65%, 55%\)$/)
    expect(a?.color).toBe(b?.color)
  })

  it('channelId のみ (channel 未 hydrate) でも id で成立する', () => {
    const info = deriveChannelInfo(note({ channelId: 'ch2' }))
    expect(info).toMatchObject({ id: 'ch2', name: null })
  })

  it('チャンネル情報が無ければ null', () => {
    expect(deriveChannelInfo(note())).toBeNull()
  })
})

describe('isLongNoteText', () => {
  it('500 文字超で true', () => {
    expect(isLongNoteText(note({ text: 'あ'.repeat(501) }))).toBe(true)
    expect(isLongNoteText(note({ text: 'あ'.repeat(500) }))).toBe(false)
  })

  it('8 行超で true', () => {
    expect(isLongNoteText(note({ text: 'a\n'.repeat(9).trim() }))).toBe(true)
    expect(isLongNoteText(note({ text: 'a\nb\nc' }))).toBe(false)
  })

  it('CW 付きは折りたたみ機構が別にあるので false', () => {
    expect(isLongNoteText(note({ cw: '注意', text: 'あ'.repeat(600) }))).toBe(
      false,
    )
  })

  it('text が null なら false', () => {
    expect(isLongNoteText(note({ text: null }))).toBe(false)
  })
})

describe('canRenoteNote (Misskey WebUI と同じ判定)', () => {
  it('public / home は誰でも可', () => {
    expect(canRenoteNote(note({ visibility: 'public' }), false)).toBe(true)
    expect(canRenoteNote(note({ visibility: 'home' }), false)).toBe(true)
  })

  it('followers は自分のノートのみ可', () => {
    expect(canRenoteNote(note({ visibility: 'followers' }), true)).toBe(true)
    expect(canRenoteNote(note({ visibility: 'followers' }), false)).toBe(false)
  })

  it('specified は不可', () => {
    expect(canRenoteNote(note({ visibility: 'specified' }), true)).toBe(false)
  })
})

describe('deriveActiveModeFlags', () => {
  it('true のフラグのみ isNoteIn<X>Mode からラベルを導出する', () => {
    const flags = deriveActiveModeFlags({
      isNoteInYamiMode: true,
      isNoteInFooMode: false,
    })
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({ key: 'isNoteInYamiMode', label: 'Yami' })
    expect(flags[0]?.icon).toBe('moon')
  })

  it('フォークごとのモードに対応するアイコンを付ける', () => {
    expect(deriveActiveModeFlags({ isNoteInHanaMode: true })[0]?.icon).toBe(
      'flower',
    )
    expect(deriveActiveModeFlags({ isNoteInFooMode: true })[0]?.icon).toBe(
      'circle-dot',
    )
  })

  it('パターン外のキーはキー名をそのままラベルにする', () => {
    const flags = deriveActiveModeFlags({ customFlag: true })
    expect(flags[0]).toMatchObject({ key: 'customFlag', label: 'customFlag' })
  })

  it('undefined なら空配列', () => {
    expect(deriveActiveModeFlags(undefined)).toEqual([])
  })
})

describe('buildReactionsData', () => {
  it('リアクションをキー昇順に整列し、URL を resolver で解決する', () => {
    const reactionUrl = vi.fn(
      (reaction: string) => `https://cdn/${encodeURIComponent(reaction)}`,
    )
    const n = note({
      reactions: { ':b:': 2, ':a:': 5 },
      emojis: { x: 'u' },
      reactionEmojis: { y: 'v' },
    })
    const data = buildReactionsData(n, reactionUrl)
    expect(data.sorted).toEqual([
      { reaction: ':a:', count: 5 },
      { reaction: ':b:', count: 2 },
    ])
    expect(data.urls[':a:']).toBe('https://cdn/%3Aa%3A')
    expect(reactionUrl).toHaveBeenCalledWith(
      ':a:',
      n.emojis,
      n.reactionEmojis,
      'misskey.example',
    )
  })

  it('リアクションが無ければ空を返し resolver を呼ばない', () => {
    const reactionUrl = vi.fn(() => null)
    const data = buildReactionsData(note(), reactionUrl)
    expect(data.sorted).toEqual([])
    expect(data.urls).toEqual({})
    expect(reactionUrl).not.toHaveBeenCalled()
  })
})

describe('clampMenuPosition', () => {
  const viewport = { width: 1000, height: 800 }
  const size = { width: 200, height: 80 }

  it('収まる場合はアンカー直下 (left, bottom+4)', () => {
    const pos = clampMenuPosition(
      { left: 100, top: 300, bottom: 320 },
      size,
      viewport,
    )
    expect(pos).toEqual({ x: 100, y: 324 })
  })

  it('右端からはみ出す場合は右余白 8px で clamp する', () => {
    const pos = clampMenuPosition(
      { left: 900, top: 300, bottom: 320 },
      size,
      viewport,
    )
    expect(pos.x).toBe(1000 - 200 - 8)
  })

  it('下端からはみ出す場合はアンカー上側へ反転する', () => {
    const pos = clampMenuPosition(
      { left: 100, top: 760, bottom: 780 },
      size,
      viewport,
    )
    expect(pos.y).toBe(760 - 80 - 4)
  })

  it('左上には最低 8px の余白を確保する', () => {
    const pos = clampMenuPosition(
      { left: -50, top: 0, bottom: 4 },
      size,
      viewport,
    )
    expect(pos.x).toBe(8)
    expect(pos.y).toBe(8)
  })
})

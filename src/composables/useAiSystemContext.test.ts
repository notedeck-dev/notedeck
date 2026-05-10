import { describe, expect, it } from 'vitest'
import type { Account } from '@/stores/accounts'
import type { DeckColumn } from '@/stores/deck'
import {
  type AiConfig,
  defaultConfig,
  setDataSourcePreset,
} from './useAiConfig'
import {
  buildAiContextBlock,
  buildHeartbeatContextBlock,
  composeHeartbeatSystemPrompt,
  joinSystemPrompt,
  MAX_MEMOS,
  MAX_RECENT_TURNS,
  MAX_VISIBLE_NOTES,
  type MemoEntry,
  pickVisibleBlockTag,
  projectMemos,
  projectRecentConversation,
  projectVisibleItems,
  projectVisibleNotes,
  stripCredentials,
} from './useAiSystemContext'
import type { StoredMemo } from './useMemos'

const SAMPLE_ACCOUNT: Account = {
  id: 'acc-1',
  host: 'misskey.example',
  userId: 'u1',
  username: 'taka',
  displayName: 'Taka',
  avatarUrl: null,
  software: 'misskey-dev/misskey',
  hasToken: true,
}

function configWithDataSources(preset: 'readonly' | 'safe' | 'full'): AiConfig {
  const cfg = defaultConfig()
  cfg.dataSources = setDataSourcePreset(cfg.dataSources, preset)
  return cfg
}

describe('stripCredentials', () => {
  it('removes top-level credential fields', () => {
    const input = {
      id: 'a',
      token: 'secret',
      i: 'misskey-token',
      apiKey: 'sk-...',
      accessToken: 'a',
      refreshToken: 'r',
      password: 'p',
      secret: 's',
    }
    expect(stripCredentials(input)).toEqual({ id: 'a' })
  })

  it('removes nested credentials in deep objects', () => {
    const input = {
      user: { name: 'foo', token: 'leak', nested: { i: 'leak2', ok: 1 } },
    }
    expect(stripCredentials(input)).toEqual({
      user: { name: 'foo', nested: { ok: 1 } },
    })
  })

  it('handles arrays of objects', () => {
    const input = [
      { name: 'a', password: 'p1' },
      { name: 'b', token: 't' },
    ]
    expect(stripCredentials(input)).toEqual([{ name: 'a' }, { name: 'b' }])
  })

  it('returns primitives untouched (string / number / null / undefined / boolean)', () => {
    expect(stripCredentials('hello')).toBe('hello')
    expect(stripCredentials(42)).toBe(42)
    expect(stripCredentials(null)).toBe(null)
    expect(stripCredentials(undefined)).toBe(undefined)
    expect(stripCredentials(true)).toBe(true)
  })
})

describe('buildAiContextBlock', () => {
  it('returns empty string when nothing to inject (no account, no column)', () => {
    const cfg = configWithDataSources('full')
    expect(
      buildAiContextBlock(cfg, { activeAccount: null, currentColumn: null }),
    ).toBe('')
  })

  it('outputs currentAccount block by default (readonly preset)', () => {
    const cfg = defaultConfig() // readonly: currentAccount on, visibleNotes off
    const block = buildAiContextBlock(cfg, {
      activeAccount: SAMPLE_ACCOUNT,
      currentColumn: null,
    })
    expect(block).toContain('<currentAccount>')
    expect(block).toContain('"username": "taka"')
    expect(block).not.toContain('<visibleNotes>')
    expect(block).not.toContain('<recentConversation>')
  })

  it('strips Misskey-style credential fields from a leaky account-like object', () => {
    const cfg = defaultConfig()
    const leaky = {
      ...SAMPLE_ACCOUNT,
      // 想定外の漏洩シナリオ: account に直接トークンを混入
      token: 'SHOULD-NOT-LEAK-1',
      i: 'SHOULD-NOT-LEAK-2',
      accessToken: 'SHOULD-NOT-LEAK-3',
    } as unknown as Account
    const block = buildAiContextBlock(cfg, {
      activeAccount: leaky,
      currentColumn: null,
    })
    expect(block).toContain('"id": "acc-1"')
    expect(block).not.toContain('SHOULD-NOT-LEAK-1')
    expect(block).not.toContain('SHOULD-NOT-LEAK-2')
    expect(block).not.toContain('SHOULD-NOT-LEAK-3')
  })

  it('returns empty string when ALL dataSources are off via custom preset', () => {
    const cfg = defaultConfig()
    cfg.dataSources = {
      preset: 'custom',
      custom: {
        currentAccount: false,
        currentColumn: false,
        visibleNotes: false,
        recentConversation: false,
        memos: false,
      },
    }
    const block = buildAiContextBlock(cfg, {
      activeAccount: SAMPLE_ACCOUNT,
      currentColumn: { id: 'c', type: 'timeline' } as unknown as DeckColumn,
      visibleNotes: [{ id: 'n1', text: 'hi' }],
      recentConversation: [{ role: 'user', content: 'msg' }],
    })
    expect(block).toBe('')
    // notedeck-context タグ自体が出ない
    expect(block).not.toContain('<notedeck-context')
  })

  it('does not leak credentials anywhere (worst-case account / column / notes / conversation)', () => {
    const cfg = configWithDataSources('full')
    const leakyAccount = {
      ...SAMPLE_ACCOUNT,
      i: 'LEAK-i',
      token: 'LEAK-token',
      accessToken: 'LEAK-at',
      refreshToken: 'LEAK-rt',
      apiKey: 'LEAK-ak',
      password: 'LEAK-pw',
      secret: 'LEAK-sec',
    } as unknown as Account
    const leakyColumn = {
      id: 'col-1',
      type: 'timeline',
      accountId: null,
      name: 'TL',
      token: 'LEAK-col-tok',
      filters: { secret: 'LEAK-filter-sec' },
    } as unknown as DeckColumn
    const leakyNotes = [
      { id: 'n1', text: 'hello', token: 'LEAK-note-tok' },
      { id: 'n2', text: 'world', user: { username: 'foo', i: 'LEAK-user-i' } },
    ]
    const leakyConv = [
      { role: 'user', content: 'msg1' },
      { role: 'assistant', content: 'reply1' },
    ]

    const block = buildAiContextBlock(cfg, {
      activeAccount: leakyAccount,
      currentColumn: leakyColumn,
      visibleNotes: leakyNotes, // 注: stripCredentials は raw でも効く
      recentConversation: leakyConv,
    })

    const leaks = [
      'LEAK-i',
      'LEAK-token',
      'LEAK-at',
      'LEAK-rt',
      'LEAK-ak',
      'LEAK-pw',
      'LEAK-sec',
      'LEAK-col-tok',
      'LEAK-filter-sec',
      'LEAK-note-tok',
      'LEAK-user-i',
    ]
    for (const leak of leaks) {
      expect(block, `must not leak ${leak}`).not.toContain(leak)
    }
    // 正常データはちゃんと出ている
    expect(block).toContain('"username": "taka"')
    expect(block).toContain('"id": "col-1"')
    expect(block).toContain('"text": "hello"')
  })

  it('respects dataSources off — skips currentAccount when disabled', () => {
    const cfg = defaultConfig()
    cfg.dataSources = {
      preset: 'custom',
      custom: {
        ...cfg.dataSources.custom,
        currentAccount: false,
        currentColumn: false,
      },
    }
    const block = buildAiContextBlock(cfg, {
      activeAccount: SAMPLE_ACCOUNT,
      currentColumn: null,
    })
    expect(block).toBe('')
  })

  it('omits visibleNotes block when array is empty even if enabled', () => {
    const cfg = configWithDataSources('safe')
    const block = buildAiContextBlock(cfg, {
      activeAccount: SAMPLE_ACCOUNT,
      currentColumn: null,
      visibleNotes: [],
    })
    expect(block).not.toContain('<visibleNotes>')
  })

  it('includes visibleNotes block when enabled and non-empty', () => {
    const cfg = configWithDataSources('safe')
    const block = buildAiContextBlock(cfg, {
      activeAccount: null,
      currentColumn: { id: 'c', type: 'timeline' } as unknown as DeckColumn,
      visibleNotes: [{ id: 'n1', text: 'hello' }],
    })
    expect(block).toContain('<visibleNotes>')
    expect(block).toContain('"id": "n1"')
  })

  it('emits column meta when currentColumn dataSource is on', () => {
    const cfg = defaultConfig()
    const column = {
      id: 'col-1',
      type: 'timeline',
      name: 'TL',
      accountId: null,
    } as unknown as DeckColumn
    const block = buildAiContextBlock(cfg, {
      activeAccount: null,
      currentColumn: column,
    })
    expect(block).toContain('<currentColumn>')
    expect(block).toContain('"id": "col-1"')
  })

  it('enriches currentColumn with accountHost when accounts is provided', () => {
    const cfg = configWithDataSources('safe')
    const column = {
      id: 'col-misskey-io',
      type: 'timeline',
      name: 'misskey.io LTL',
      accountId: 'acc-2',
    } as unknown as DeckColumn
    const accounts: Account[] = [
      SAMPLE_ACCOUNT,
      {
        id: 'acc-2',
        host: 'misskey.io',
        userId: 'u2',
        username: 'sub',
        displayName: 'Sub',
        avatarUrl: null,
        software: 'misskey-dev/misskey',
        hasToken: true,
      },
    ]
    const block = buildAiContextBlock(cfg, {
      activeAccount: SAMPLE_ACCOUNT,
      currentColumn: column,
      accounts,
    })
    // <currentColumn> 内に accountHost が出る
    expect(block).toContain('"accountHost": "misskey.io"')
    expect(block).toContain('"accountId": "acc-2"')
  })

  it('does not add accountHost when column.accountId is null', () => {
    const cfg = configWithDataSources('safe')
    const column = {
      id: 'col-noacc',
      type: 'timeline',
      name: 'TL',
      accountId: null,
    } as unknown as DeckColumn
    const block = buildAiContextBlock(cfg, {
      activeAccount: SAMPLE_ACCOUNT,
      currentColumn: column,
      accounts: [SAMPLE_ACCOUNT],
    })
    expect(block).not.toContain('accountHost')
  })

  it('does not add accountHost when accounts list is omitted (back-compat)', () => {
    const cfg = configWithDataSources('safe')
    const column = {
      id: 'col-x',
      type: 'timeline',
      name: 'TL',
      accountId: 'acc-1',
    } as unknown as DeckColumn
    const block = buildAiContextBlock(cfg, {
      activeAccount: SAMPLE_ACCOUNT,
      currentColumn: column,
    })
    expect(block).not.toContain('accountHost')
  })
})

describe('projectVisibleNotes', () => {
  it('returns empty array when input is empty / undefined', () => {
    expect(projectVisibleNotes(undefined)).toEqual([])
    expect(projectVisibleNotes([])).toEqual([])
  })

  it('caps the result at MAX_VISIBLE_NOTES (10) by default', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `n${i}`,
      text: `t${i}`,
    }))
    const out = projectVisibleNotes(many)
    expect(out).toHaveLength(MAX_VISIBLE_NOTES)
    expect(out[0]?.id).toBe('n0')
    expect(out[9]?.id).toBe('n9')
  })

  it('extracts id / userId / text / createdAt and inner user.username', () => {
    const out = projectVisibleNotes([
      {
        id: 'n1',
        userId: 'u1',
        text: 'hi',
        createdAt: '2026-05-01T00:00:00Z',
        user: { username: 'taka' },
      },
    ])
    expect(out[0]).toEqual({
      id: 'n1',
      userId: 'u1',
      username: 'taka',
      text: 'hi',
      createdAt: '2026-05-01T00:00:00Z',
    })
  })

  it('replaces text with [CW: <reason>] when cw is set', () => {
    const out = projectVisibleNotes([
      { id: 'n1', cw: 'spoiler', text: 'big secret' },
    ])
    expect(out[0]?.text).toBe('[CW: spoiler]')
    expect(out[0]?.text).not.toContain('big secret')
  })

  it('handles primitives / nullish entries gracefully', () => {
    const out = projectVisibleNotes([null, 'string', { id: 'ok' }])
    expect(out).toHaveLength(3)
    expect(out[0]?.id).toBe('unknown')
    expect(out[1]?.id).toBe('unknown')
    expect(out[2]?.id).toBe('ok')
  })
})

describe('pickVisibleBlockTag', () => {
  it.each([
    'timeline',
    'list',
    'antenna',
    'mentions',
    'channel',
    'favorites',
    'clip',
    'user',
    'specified',
    'search',
    'role',
    'chat',
  ])('returns visibleNotes for note-like type %s', (type) => {
    expect(pickVisibleBlockTag(type)).toBe('visibleNotes')
  })

  it('returns visibleNotifications for notifications', () => {
    expect(pickVisibleBlockTag('notifications')).toBe('visibleNotifications')
  })

  it('returns visibleDriveItems for drive', () => {
    expect(pickVisibleBlockTag('drive')).toBe('visibleDriveItems')
  })

  it('returns visibleItems for unknown / undefined types', () => {
    expect(pickVisibleBlockTag(undefined)).toBe('visibleItems')
    expect(pickVisibleBlockTag('explore')).toBe('visibleItems')
    expect(pickVisibleBlockTag('aiscript')).toBe('visibleItems')
  })
})

describe('buildAiContextBlock — visible block tag dispatch', () => {
  it('emits <visibleNotes> for timeline column', () => {
    const cfg = configWithDataSources('safe')
    const block = buildAiContextBlock(cfg, {
      activeAccount: null,
      currentColumn: { id: 'c', type: 'timeline' } as unknown as DeckColumn,
      visibleNotes: [{ id: 'n1', text: 'hi' }],
    })
    expect(block).toContain('<visibleNotes>')
    expect(block).not.toContain('<visibleNotifications>')
    expect(block).not.toContain('<visibleDriveItems>')
  })

  it('emits <visibleNotifications> for notifications column', () => {
    const cfg = configWithDataSources('safe')
    const block = buildAiContextBlock(cfg, {
      activeAccount: null,
      currentColumn: {
        id: 'c',
        type: 'notifications',
      } as unknown as DeckColumn,
      visibleNotes: [{ id: 'notif-1', type: 'reaction' }],
    })
    expect(block).toContain('<visibleNotifications>')
    expect(block).not.toContain('<visibleNotes>')
  })

  it('emits <visibleDriveItems> for drive column', () => {
    const cfg = configWithDataSources('safe')
    const block = buildAiContextBlock(cfg, {
      activeAccount: null,
      currentColumn: { id: 'c', type: 'drive' } as unknown as DeckColumn,
      visibleNotes: [{ id: 'f1', name: 'a.png' }],
    })
    expect(block).toContain('<visibleDriveItems>')
    expect(block).not.toContain('<visibleNotes>')
  })

  it('falls back to <visibleItems> for unsupported column types', () => {
    const cfg = configWithDataSources('safe')
    const block = buildAiContextBlock(cfg, {
      activeAccount: null,
      currentColumn: { id: 'c', type: 'explore' } as unknown as DeckColumn,
      visibleNotes: [{ id: 'x' }],
    })
    expect(block).toContain('<visibleItems>')
    expect(block).not.toContain('<visibleNotes>')
  })
})

describe('projectVisibleItems (kind dispatch)', () => {
  it('dispatches to note projection for note-like column types', () => {
    const out = projectVisibleItems(
      [{ id: 'n1', text: 'hi', cw: 'spoiler', user: { username: 'u' } }],
      'timeline',
    )
    expect(out[0]).toEqual({
      id: 'n1',
      userId: undefined,
      username: 'u',
      text: '[CW: spoiler]',
      createdAt: undefined,
    })
  })

  it.each([
    'list',
    'antenna',
    'mentions',
    'channel',
    'favorites',
    'clip',
  ])('treats %s as note-like', (type) => {
    const out = projectVisibleItems([{ id: 'n1', text: 'hi' }], type)
    expect(out[0]?.text).toBe('hi')
  })

  it('dispatches to notification projection', () => {
    const out = projectVisibleItems(
      [
        {
          id: 'notif-1',
          type: 'reaction',
          userId: 'u1',
          noteId: 'n1',
          reaction: '👍',
          createdAt: '2026-05-01T00:00:00Z',
          user: { username: 'reactor' },
          note: { text: 'original note' },
        },
      ],
      'notifications',
    )
    expect(out[0]).toMatchObject({
      kind: 'notification',
      id: 'notif-1',
      type: 'reaction',
      userId: 'u1',
      noteId: 'n1',
      reaction: '👍',
      username: 'reactor',
      noteText: 'original note',
    })
  })

  it('replaces note text with [CW: ...] for CW notifications', () => {
    const out = projectVisibleItems(
      [
        {
          id: 'notif-2',
          type: 'reply',
          note: { cw: 'sensitive', text: 'hidden body' },
        },
      ],
      'notifications',
    )
    expect(out[0]?.noteText).toBe('[CW: sensitive]')
    expect(out[0]?.noteText).not.toContain('hidden body')
  })

  it('dispatches to drive projection', () => {
    const out = projectVisibleItems(
      [
        {
          id: 'file-1',
          name: 'photo.png',
          type: 'image/png',
          size: 12345,
          createdAt: '2026-05-01T00:00:00Z',
        },
      ],
      'drive',
    )
    expect(out[0]).toEqual({
      kind: 'driveItem',
      id: 'file-1',
      name: 'photo.png',
      type: 'image/png',
      size: 12345,
      createdAt: '2026-05-01T00:00:00Z',
    })
  })

  it('falls back to raw projection for unknown column types', () => {
    const out = projectVisibleItems(
      [{ id: 'x', name: 'something', type: 'unknown', extra: 'leak' }],
      'someUnsupportedType',
    )
    expect(out[0]).toEqual({
      id: 'x',
      name: 'something',
      type: 'unknown',
    })
    // 想定外フィールドは落とす (raw fallback は最小限)
    expect(out[0]).not.toHaveProperty('extra')
  })

  it('caps at MAX_VISIBLE_NOTES across all kinds', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `n${i}`,
      type: 'reaction',
    }))
    const out = projectVisibleItems(many, 'notifications')
    expect(out).toHaveLength(MAX_VISIBLE_NOTES)
  })
})

describe('projectRecentConversation', () => {
  it('returns empty array for empty / undefined input', () => {
    expect(projectRecentConversation(undefined)).toEqual([])
    expect(projectRecentConversation([])).toEqual([])
  })

  it('keeps the last MAX_RECENT_TURNS messages by default (= 20)', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      role: 'user' as const,
      content: `m${i}`,
    }))
    const out = projectRecentConversation(many)
    expect(out).toHaveLength(MAX_RECENT_TURNS)
    expect(out[0]?.content).toBe('m30')
    expect(out[19]?.content).toBe('m49')
  })

  it('drops messages whose role is not user / assistant / system', () => {
    const out = projectRecentConversation([
      { role: 'user', content: 'hi' },
      { role: 'tool' as unknown as 'user', content: 'ignored' },
      { role: 'assistant', content: 'hello' },
    ])
    expect(out).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })

  it('coerces non-string content to empty string', () => {
    const out = projectRecentConversation([
      {
        role: 'user',
        content: { foo: 1 } as unknown as string,
      },
    ])
    expect(out).toEqual([{ role: 'user', content: '' }])
  })
})

describe('projectMemos', () => {
  function makeMemo(text: string, updatedAt: string): StoredMemo {
    return {
      updatedAt,
      data: {
        text,
        cw: 'secret-cw',
        showCw: true,
        visibility: 'followers',
        localOnly: true,
        fileIds: ['file-1'],
        pollChoices: ['a', 'b'],
        pollMultiple: true,
        showPoll: true,
        scheduledAt: '2026-01-01T00:00:00Z',
      },
    }
  }

  it('returns empty array for empty / undefined input', () => {
    expect(projectMemos(undefined)).toEqual([])
    expect(projectMemos([])).toEqual([])
  })

  it('keeps only id / text / updatedAt and drops draft-only fields', () => {
    const entries: MemoEntry[] = [
      ['20260101010101', makeMemo('first body', '2026-01-01T01:01:01Z')],
    ]
    const out = projectMemos(entries)
    expect(out).toEqual([
      {
        id: '20260101010101',
        text: 'first body',
        updatedAt: '2026-01-01T01:01:01Z',
      },
    ])
    // draft 専用フィールドが落ちていることを明示確認
    const memo = out[0] as unknown as Record<string, unknown>
    expect(memo).not.toHaveProperty('cw')
    expect(memo).not.toHaveProperty('visibility')
    expect(memo).not.toHaveProperty('fileIds')
    expect(memo).not.toHaveProperty('pollChoices')
    expect(memo).not.toHaveProperty('scheduledAt')
    expect(memo).not.toHaveProperty('localOnly')
  })

  it('sorts by updatedAt descending (newest first)', () => {
    const entries: MemoEntry[] = [
      ['20260101000000', makeMemo('older', '2026-01-01T00:00:00Z')],
      ['20260201000000', makeMemo('newest', '2026-02-01T00:00:00Z')],
      ['20260115000000', makeMemo('middle', '2026-01-15T00:00:00Z')],
    ]
    const out = projectMemos(entries)
    expect(out.map((m) => m.text)).toEqual(['newest', 'middle', 'older'])
  })

  it('caps the result at MAX_MEMOS (20) by default', () => {
    const entries: MemoEntry[] = Array.from({ length: 30 }, (_, i) => {
      // i が大きいほど updatedAt が新しい
      const day = String(i + 1).padStart(2, '0')
      return [
        `2026010100000${i}`,
        makeMemo(`memo-${i}`, `2026-01-${day}T00:00:00Z`),
      ] as MemoEntry
    })
    const out = projectMemos(entries)
    expect(out).toHaveLength(MAX_MEMOS)
    // 一番新しい (= i=29) が先頭
    expect(out[0]?.text).toBe('memo-29')
  })

  it('respects custom limit', () => {
    const entries: MemoEntry[] = Array.from(
      { length: 5 },
      (_, i) =>
        [
          `2026010100000${i}`,
          makeMemo(`m${i}`, `2026-01-0${i + 1}T00:00:00Z`),
        ] as MemoEntry,
    )
    expect(projectMemos(entries, 2)).toHaveLength(2)
  })
})

describe('buildAiContextBlock — memos', () => {
  const SAMPLE_MEMO = {
    id: '20260101010101',
    text: 'todo: write release notes',
    updatedAt: '2026-01-01T01:01:01Z',
  }

  it('emits <memos> when ds.memos is on and memos array is non-empty', () => {
    const cfg = configWithDataSources('safe')
    const block = buildAiContextBlock(cfg, {
      activeAccount: null,
      currentColumn: null,
      memos: [SAMPLE_MEMO],
    })
    expect(block).toContain('<memos>')
    expect(block).toContain('"id": "20260101010101"')
    expect(block).toContain('"text": "todo: write release notes"')
  })

  it('omits <memos> when ds.memos is explicitly disabled via custom preset', () => {
    const cfg = configWithDataSources('readonly')
    cfg.dataSources = {
      preset: 'custom',
      custom: { ...cfg.dataSources.custom, memos: false },
    }
    const block = buildAiContextBlock(cfg, {
      activeAccount: null,
      currentColumn: null,
      memos: [SAMPLE_MEMO],
    })
    expect(block).not.toContain('<memos>')
  })

  it('omits <memos> when memos array is empty even if enabled', () => {
    const cfg = configWithDataSources('safe')
    const block = buildAiContextBlock(cfg, {
      activeAccount: null,
      currentColumn: null,
      memos: [],
    })
    expect(block).not.toContain('<memos>')
  })

  it('omits <memos> when memos is undefined even if enabled', () => {
    const cfg = configWithDataSources('safe')
    const block = buildAiContextBlock(cfg, {
      activeAccount: null,
      currentColumn: null,
    })
    expect(block).not.toContain('<memos>')
  })
})

describe('buildAiContextBlock — persona (#491)', () => {
  it('emits <persona> block with id, displayName, and authorId instruction', () => {
    const cfg = configWithDataSources('readonly')
    const block = buildAiContextBlock(cfg, {
      activeAccount: null,
      currentColumn: null,
      persona: {
        id: 'skill:aizu-9k2x',
        displayName: '藍',
      },
    })
    expect(block).toContain('<persona>')
    expect(block).toContain('藍')
    expect(block).toContain('skill:aizu-9k2x')
    // memos.create / authorId 規約も注入されること
    expect(block).toContain('authorId')
  })

  it('includes bio line when persona has bio', () => {
    const cfg = configWithDataSources('readonly')
    const block = buildAiContextBlock(cfg, {
      activeAccount: null,
      currentColumn: null,
      persona: {
        id: 'skill:aizu',
        displayName: 'aizu',
        bio: 'Misskey の妖精',
      },
    })
    expect(block).toContain('Misskey の妖精')
  })

  it('omits <persona> block when persona is undefined', () => {
    const cfg = configWithDataSources('readonly')
    const block = buildAiContextBlock(cfg, {
      activeAccount: null,
      currentColumn: null,
    })
    expect(block).not.toContain('<persona>')
  })

  it('persona is session-driven, not gated by dataSources flags', () => {
    // dataSources で memos / visibleNotes 等を全部切っても persona は渡せば出る
    const cfg = configWithDataSources('readonly')
    const block = buildAiContextBlock(cfg, {
      activeAccount: null,
      currentColumn: null,
      persona: { id: 'skill:p', displayName: 'P' },
    })
    expect(block).toContain('<persona>')
  })
})

describe('joinSystemPrompt', () => {
  it('returns undefined when both inputs are empty', () => {
    expect(joinSystemPrompt('', '')).toBeUndefined()
  })

  it('returns skills prompt alone when context is empty', () => {
    expect(joinSystemPrompt('You are helpful.', '')).toBe('You are helpful.')
  })

  it('returns context block alone when skills prompt is empty', () => {
    expect(joinSystemPrompt('', '<notedeck-context></notedeck-context>')).toBe(
      '<notedeck-context></notedeck-context>',
    )
  })

  it('joins both with double newline separator', () => {
    expect(joinSystemPrompt('You are helpful.', '<notedeck-context/>')).toBe(
      'You are helpful.\n\n<notedeck-context/>',
    )
  })
})

describe('buildHeartbeatContextBlock (#411 Phase 6)', () => {
  it('returns empty string when all results are 0 / map is empty', () => {
    expect(buildHeartbeatContextBlock({})).toBe('')
    expect(buildHeartbeatContextBlock({ unreadMentions: 0 })).toBe('')
  })

  it('emits <heartbeat-context> with non-zero entries only', () => {
    const block = buildHeartbeatContextBlock({
      unreadMentions: 5,
      notReached: 0,
    })
    expect(block).toContain('<heartbeat-context>')
    expect(block).toContain('<cheapCheckResults>')
    expect(block).toContain('<unreadMentions>5</unreadMentions>')
    // 0 件は出さない
    expect(block).not.toContain('<notReached>')
  })

  it('includes triggeredAt when provided', () => {
    const block = buildHeartbeatContextBlock(
      { unreadMentions: 3 },
      '2026-05-01T00:00:00Z',
    )
    expect(block).toContain('<triggeredAt>2026-05-01T00:00:00Z</triggeredAt>')
  })

  it('omits triggeredAt when not provided', () => {
    const block = buildHeartbeatContextBlock({ unreadMentions: 3 })
    expect(block).not.toContain('<triggeredAt>')
  })
})

describe('composeHeartbeatSystemPrompt (#411 Phase 6)', () => {
  it('joins all four parts with double newlines', () => {
    const out = composeHeartbeatSystemPrompt(
      'skills',
      '<notedeck-context/>',
      '<heartbeat-context/>',
      'instruction',
    )
    expect(out).toBe(
      'skills\n\n<notedeck-context/>\n\n<heartbeat-context/>\n\ninstruction',
    )
  })

  it('skips empty parts so output never has blank stretches', () => {
    expect(composeHeartbeatSystemPrompt('', '<x/>', '', 'i')).toBe('<x/>\n\ni')
    expect(composeHeartbeatSystemPrompt('', '', '', 'i')).toBe('i')
    expect(composeHeartbeatSystemPrompt('', '', '', '')).toBe('')
  })
})

// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/settingsFs', () => ({
  isTauri: false,
  SKILL_EXT: '.md',
  PROFILE_EXT: '.ndprofile.json5',
}))
vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))

import { emitNoteDeckEvent } from '@/aiscript/events'
import { isSkillEnabled, type SkillItem, useSkillsStore } from '@/stores/skills'

vi.mock('@/aiscript/events', () => ({
  emitNoteDeckEvent: vi.fn(),
}))

function makeSkill(
  id: string,
  partial: Partial<SkillItem['extra']> & {
    name?: string
    content?: string
  } = {},
) {
  const { name, content, ...extra } = partial
  return {
    id,
    name: name ?? id,
    scope: { kind: 'none' } as const,
    content: content ?? 'body',
    extra: {
      version: '1.0.0',
      mode: 'trigger' as const,
      triggers: [],
      builtIn: false,
      cheapCheckCapabilities: [],
      isPersona: false,
      ...extra,
    },
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.mocked(emitNoteDeckEvent).mockClear()
})

describe('useSkillsStore.triggerMatchingSkillIds', () => {
  it('returns ids whose triggers substring-match the input (mode=trigger)', async () => {
    const store = useSkillsStore()
    await store.add(makeSkill('guide', { triggers: ['どこ', '使い方'] }))
    expect(store.triggerMatchingSkillIds('投稿はどこ?')).toEqual(['guide'])
    expect(store.triggerMatchingSkillIds('使い方を教えて')).toEqual(['guide'])
  })

  it('returns empty array when no trigger matches', async () => {
    const store = useSkillsStore()
    await store.add(makeSkill('guide', { triggers: ['どこ', 'help'] }))
    expect(store.triggerMatchingSkillIds('今日の天気は')).toEqual([])
  })

  it('ignores skills whose mode is not "trigger"', async () => {
    const store = useSkillsStore()
    await store.add(makeSkill('manual', { mode: 'manual', triggers: ['どこ'] }))
    await store.add(makeSkill('always', { mode: 'always', triggers: ['どこ'] }))
    await store.add(
      makeSkill('heartbeat', { mode: 'heartbeat', triggers: ['どこ'] }),
    )
    expect(store.triggerMatchingSkillIds('どこ?')).toEqual([])
  })

  it('matches case-insensitively (e.g. Help / HELP / help)', async () => {
    const store = useSkillsStore()
    await store.add(makeSkill('guide', { triggers: ['Help'] }))
    expect(store.triggerMatchingSkillIds('HELP me')).toEqual(['guide'])
    expect(store.triggerMatchingSkillIds('please help')).toEqual(['guide'])
  })

  it('returns all matching ids when multiple skills hit', async () => {
    const store = useSkillsStore()
    await store.add(makeSkill('guide', { triggers: ['どこ'] }))
    await store.add(makeSkill('tour', { triggers: ['使い方'] }))
    expect(store.triggerMatchingSkillIds('どこで使い方を見る?')).toEqual([
      'guide',
      'tour',
    ])
  })

  it('returns empty array for empty input / empty triggers / empty entries', async () => {
    const store = useSkillsStore()
    await store.add(makeSkill('guide', { triggers: ['', 'どこ'] }))
    await store.add(makeSkill('none', { triggers: [] }))
    expect(store.triggerMatchingSkillIds('')).toEqual([])
    expect(store.triggerMatchingSkillIds('xyz')).toEqual([])
    expect(store.triggerMatchingSkillIds('どこ?')).toEqual(['guide'])
  })
})

describe('useSkillsStore.remove (undo)', () => {
  it('returns an undo that restores the skill at its original position', async () => {
    const store = useSkillsStore()
    await store.add(makeSkill('a'))
    await store.add(makeSkill('b', { content: 'b body' }))
    await store.add(makeSkill('c'))
    const undo = await store.remove('b')
    expect(store.get('b')).toBeUndefined()
    expect(undo).toBeTypeOf('function')
    undo?.()
    expect(store.items.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(store.get('b')?.content).toBe('b body')
  })

  it('returns undefined for unknown id', async () => {
    const store = useSkillsStore()
    expect(await store.remove('nope')).toBeUndefined()
  })

  it('restores the active state on undo', async () => {
    const store = useSkillsStore()
    await store.add(makeSkill('a', { mode: 'manual' }))
    await store.setActive('a', true)
    const undo = await store.remove('a')
    expect(store.isActive('a')).toBe(false)
    undo?.()
    expect(store.isActive('a')).toBe(true)
  })
})

describe('スキルの有効 / 無効 (#1116)', () => {
  it('有効にすると個体に active が付き、無効に戻すと印ごと消える', async () => {
    const store = useSkillsStore()
    await store.add(makeSkill('a', { mode: 'manual' }))
    expect(await store.setActive('a', true)).toBe(true)
    expect(store.get('a')?.extra.active).toBe(true)
    expect(store.isActive('a')).toBe(true)
    expect(await store.setActive('a', false)).toBe(true)
    expect('active' in (store.get('a')?.extra ?? {})).toBe(false)
    expect(store.isActive('a')).toBe(false)
  })

  it('mode=always は印が無くても実効有効 (isSkillEnabled)', async () => {
    const store = useSkillsStore()
    await store.add(makeSkill('a', { mode: 'always' }))
    await store.add(makeSkill('b', { mode: 'manual' }))
    expect(store.items.filter(isSkillEnabled).map((s) => s.id)).toEqual(['a'])
    await store.setActive('b', true)
    expect(store.items.filter(isSkillEnabled).map((s) => s.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('未知の id は false', async () => {
    const store = useSkillsStore()
    expect(await store.setActive('nope', true)).toBe(false)
  })

  it('端末ローカル (localStorage) の有効一覧はブラウザ dev モードでは読まない', async () => {
    localStorage.setItem('nd-skills-active', JSON.stringify(['a']))
    const store = useSkillsStore()
    await store.add(makeSkill('a', { mode: 'manual' }))
    expect(store.isActive('a')).toBe(false)
  })
})

describe('update (編集)', () => {
  it('名前 / 本文 / extra をまとめて更新し、プラグインへ skill:edited を知らせる', async () => {
    const store = useSkillsStore()
    await store.add(makeSkill('a'))
    expect(
      await store.update('a', {
        name: 'renamed',
        content: 'new body',
        extra: { mode: 'manual', triggers: ['x'] },
      }),
    ).toBe(true)
    expect(store.get('a')).toMatchObject({
      name: 'renamed',
      content: 'new body',
      extra: { mode: 'manual', triggers: ['x'], version: '1.0.0' },
    })
    expect(emitNoteDeckEvent).toHaveBeenCalledWith('skill:edited', { id: 'a' })
  })

  it('未知の id は false', async () => {
    const store = useSkillsStore()
    expect(await store.update('nope', { content: 'x' })).toBe(false)
  })
})

describe('HEARTBEAT (#411)', () => {
  it('setHeartbeat(true) で mode=heartbeat、false で manual に戻る', async () => {
    const store = useSkillsStore()
    await store.add(makeSkill('s1', { mode: 'manual' }))
    await store.setHeartbeat('s1', true)
    expect(store.get('s1')?.extra.mode).toBe('heartbeat')
    expect(store.heartbeatSkills.map((s) => s.id)).toEqual(['s1'])
    await store.setHeartbeat('s1', false)
    expect(store.get('s1')?.extra.mode).toBe('manual')
    expect(store.heartbeatSkills).toEqual([])
  })

  it('heartbeatSkills は mode で絞り、一覧の順を保つ', async () => {
    const store = useSkillsStore()
    await store.add(makeSkill('a', { mode: 'heartbeat' }))
    await store.add(makeSkill('b', { mode: 'manual' }))
    await store.add(makeSkill('c', { mode: 'heartbeat' }))
    expect(store.heartbeatSkills.map((s) => s.id)).toEqual(['a', 'c'])
  })
})

describe('applyStoreUpdate (#913 / #981)', () => {
  it('本文とストア由来 (版 / 作者 / triggers / persona) を上書きし、name / mode / active は維持する', async () => {
    const store = useSkillsStore()
    await store.add(
      makeSkill('s', {
        name: 'My Renamed',
        mode: 'heartbeat',
        active: true,
        triggers: ['old'],
      }),
    )
    expect(
      await store.applyStoreUpdate('s', {
        content: 'new body',
        description: 'desc',
        iconUrl: 'https://example.com/i.svg',
        version: '2.0.0',
        author: 'someone',
        triggers: ['hi'],
        cheapCheckCapabilities: ['notes.list'],
        isPersona: true,
        store: { id: 'ent', sha512: 'abc', version: '2.0.0' },
      }),
    ).toBe(true)
    expect(store.get('s')).toMatchObject({
      name: 'My Renamed',
      content: 'new body',
      description: 'desc',
      iconUrl: 'https://example.com/i.svg',
      store: { id: 'ent', sha512: 'abc', version: '2.0.0' },
      extra: {
        mode: 'heartbeat',
        active: true,
        version: '2.0.0',
        author: 'someone',
        triggers: ['hi'],
        cheapCheckCapabilities: ['notes.list'],
        isPersona: true,
      },
    })
  })
})

describe('予約 skill (#1162)', () => {
  async function addReserved(id: 'AGENTS' | 'HEARTBEAT') {
    const store = useSkillsStore()
    const item = await store.add(
      makeSkill(id, {
        mode: id === 'AGENTS' ? 'always' : 'heartbeat',
        reserved: true,
      }),
    )
    item.fileBase = id
    return store
  }

  it('改名 / mode 変更 / persona 化 / 有効無効 / 削除を拒否し、本文は書ける', async () => {
    const store = await addReserved('HEARTBEAT')
    await expect(
      store.update('HEARTBEAT', { name: 'rounds' }),
    ).rejects.toThrow()
    await expect(
      store.update('HEARTBEAT', { extra: { mode: 'manual' } }),
    ).rejects.toThrow()
    await expect(
      store.update('HEARTBEAT', { extra: { isPersona: true } }),
    ).rejects.toThrow()
    await expect(store.setHeartbeat('HEARTBEAT', false)).rejects.toThrow()
    await expect(store.setActive('HEARTBEAT', true)).rejects.toThrow()
    await expect(store.remove('HEARTBEAT')).rejects.toThrow()
    expect(store.get('HEARTBEAT')?.extra.mode).toBe('heartbeat')
    // 同じ値を送るのは改名でも mode 変更でもない (エディタの自動保存)
    expect(
      await store.update('HEARTBEAT', {
        name: 'HEARTBEAT',
        content: '- check drafts\n',
        extra: { mode: 'heartbeat' },
      }),
    ).toBe(true)
    expect(store.get('HEARTBEAT')?.content).toBe('- check drafts\n')
  })
})

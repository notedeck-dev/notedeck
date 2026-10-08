import { describe, expect, it } from 'vitest'
import type { TimelineType } from '@/adapters/types'
import {
  applyPoliciesToAvailability,
  commonFilterKeys,
  findModeKeyForTimeline,
  getRelatedTimelineTypes,
  modeIcon,
  noteModeBadgeIcon,
} from './timelinePolicy'

describe('getRelatedTimelineTypes', () => {
  it('expands local/social to the shared ltlAvailable group', () => {
    expect(getRelatedTimelineTypes('local')).toEqual(['local', 'social'])
    expect(getRelatedTimelineTypes('social')).toEqual(['local', 'social'])
  })

  it('returns global alone (gtlAvailable group)', () => {
    expect(getRelatedTimelineTypes('global')).toEqual(['global'])
  })

  it('returns unknown types as a singleton', () => {
    expect(getRelatedTimelineTypes('bubble')).toEqual(['bubble'])
    expect(getRelatedTimelineTypes('home')).toEqual(['home'])
  })
})

describe('applyPoliciesToAvailability', () => {
  const run = (policies: Record<string, boolean>) => {
    const available: TimelineType[] = []
    const denied = new Set<string>()
    applyPoliciesToAvailability(policies, available, denied)
    return { available, denied: [...denied].sort() }
  }

  it('policy を返さないサーバーは標準 TL を全部出す', () => {
    expect(run({})).toEqual({
      available: ['local', 'social', 'global'],
      denied: [],
    })
  })

  it('標準 policy は true のものだけ出し、false は denied へ', () => {
    expect(run({ ltlAvailable: true, gtlAvailable: false })).toEqual({
      available: ['local', 'social'],
      denied: ['global'],
    })
  })

  it('フォーク固有の *TlAvailable も同じ規則で扱い、他のキーは無視する', () => {
    expect(
      run({
        ltlAvailable: true,
        gtlAvailable: true,
        bubbleTlAvailable: true,
        yamiTlAvailable: false,
        canInvite: true,
      }),
    ).toEqual({
      available: ['local', 'social', 'global', 'bubble'],
      denied: ['yami'],
    })
  })
})

describe('modeIcon', () => {
  it('yami モードは月 (yamisskey 本家の ti-moon / ti-moon-off に合わせる)', () => {
    expect(modeIcon('isInYamiMode', true)).toBe('moon')
    expect(modeIcon('isInYamiMode', false)).toBe('moon-off')
  })

  it('hana モードは花 (はなみすきー本家の独自グリフに合わせる)', () => {
    expect(modeIcon('isInHanaMode', true)).toBe('flower')
    expect(modeIcon('isInHanaMode', false)).toBe('flower-off')
  })

  it('ノート単位のキーでも同じアイコンになる', () => {
    expect(modeIcon('isNoteInHanaMode', true)).toBe('flower')
    expect(modeIcon('isNoteInYamiMode', false)).toBe('moon-off')
  })

  it('未知のモードはトグルアイコンにフォールバックする', () => {
    expect(modeIcon('isInFooMode', true)).toBe('toggle-right')
    expect(modeIcon('isInFooMode', false)).toBe('toggle-left')
  })
})

describe('noteModeBadgeIcon', () => {
  it('既知のモードはトグルの on 側と同じアイコンになる', () => {
    expect(noteModeBadgeIcon('isNoteInYamiMode')).toBe('moon')
    expect(noteModeBadgeIcon('isNoteInHanaMode')).toBe('flower')
  })

  it('未知のモードはトグルではなく中立な印にフォールバックする', () => {
    expect(noteModeBadgeIcon('isNoteInFooMode')).toBe('circle-dot')
    expect(noteModeBadgeIcon('customFlag')).toBe('circle-dot')
  })
})

describe('commonFilterKeys — 全アカウント面の組込フィルタ候補', () => {
  it('全サーバーが対応するキーだけを既知の順で返す', () => {
    expect(
      commonFilterKeys([
        ['withRenotes', 'withReplies', 'withFiles'],
        ['withFiles', 'withRenotes'],
      ]),
    ).toEqual(['withRenotes', 'withFiles'])
  })

  it('対象サーバーが無ければ空', () => {
    expect(commonFilterKeys([])).toEqual([])
  })
})

describe('findModeKeyForTimeline', () => {
  it('matches a timeline type that starts with the mode name', () => {
    expect(findModeKeyForTimeline('yami', { isInYamiMode: true })).toBe(
      'isInYamiMode',
    )
    // 'hanami' starts with 'hana' → isInHanaMode
    expect(findModeKeyForTimeline('hanami', { isInHanaMode: false })).toBe(
      'isInHanaMode',
    )
  })

  it('returns undefined when nothing matches', () => {
    expect(findModeKeyForTimeline('bubble', { isInYamiMode: true })).toBe(
      undefined,
    )
    expect(findModeKeyForTimeline('yami', {})).toBe(undefined)
  })

  it('ignores keys that are not isIn*Mode shaped', () => {
    expect(findModeKeyForTimeline('yami', { yamiEnabled: true })).toBe(
      undefined,
    )
  })
})

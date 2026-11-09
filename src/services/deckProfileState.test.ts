import { describe, expect, it } from 'vitest'
import type { DeckColumn, DeckProfile } from '@/stores/deck'
import {
  allocateStateFileName,
  isEmptyState,
  mergeProfileState,
  parseDeckProfileState,
  serializeDeckProfileState,
  splitProfile,
  stateFileBase,
} from './deckProfileState'

function profile(): DeckProfile {
  return {
    id: 'main',
    name: 'Main',
    createdAt: 1,
    layout: [['a', 'b']],
    windows: [{ id: 'w1', x: 1, y: 2, width: 300, height: 400 }],
    columns: [
      {
        id: 'a',
        type: 'timeline',
        name: '',
        width: 320,
        accountId: null,
        windowId: 'w1',
        query: 'cats',
      } as DeckColumn,
      {
        id: 'b',
        type: 'search',
        name: '',
        width: 300,
        accountId: null,
      } as DeckColumn,
    ],
  }
}

describe('deckProfileState (#1333 §3)', () => {
  it('設定側と状態側に分け、重ねると元に戻る', () => {
    const p = profile()
    const { config, state } = splitProfile(p)
    expect(config.windows).toBeUndefined()
    expect(config.columns[0]).not.toHaveProperty('windowId')
    expect(config.columns[0]).not.toHaveProperty('query')
    expect(config.columns[0]?.width).toBe(320)
    expect(state).toEqual({
      id: 'main',
      windows: p.windows,
      columns: { a: { windowId: 'w1', query: 'cats' } },
    })
    expect(mergeProfileState(config, state)).toEqual(p)
    // 入力は変えない
    expect(p.columns[0]?.windowId).toBe('w1')
  })

  it('状態の無いプロファイルは空で、ファイルは要らない', () => {
    const p = profile()
    delete p.windows
    delete p.columns[0]?.windowId
    delete p.columns[0]?.query
    expect(isEmptyState(splitProfile(p).state)).toBe(true)
  })

  it('読んで書いた結果を読んで書いても変わらない', () => {
    const first = serializeDeckProfileState(splitProfile(profile()).state)
    const again = serializeDeckProfileState(
      parseDeckProfileState(first) ?? { id: '', columns: {} },
    )
    expect(again).toBe(first)
    expect(first.endsWith('\n')).toBe(true)
    // id の無い / 壊れた本文は無し
    expect(parseDeckProfileState('{ columns: {} }')).toBeNull()
    expect(parseDeckProfileState('{{{')).toBeNull()
    expect(parseDeckProfileState('')).toBeNull()
  })

  it('ファイル名は id の slug、衝突したら連番、同じ id は既存の名前', () => {
    expect(stateFileBase('main')).toBe('main')
    expect(stateFileBase('old name.ndprofile.json5')).toBe(
      'old-name-ndprofile-json5',
    )
    const existing = new Map<string, string>([['main.json5', 'other']])
    expect(allocateStateFileName('main', existing)).toBe('main-2.json5')
    expect(allocateStateFileName('other', existing)).toBe('main.json5')
    expect(allocateStateFileName('fresh', existing)).toBe('fresh.json5')
  })
})

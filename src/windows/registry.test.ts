import { describe, expect, it } from 'vitest'
import type { DeckWindow } from '@/stores/windows'
import {
  ALL_WINDOW_TYPES,
  buildWindowUri,
  WINDOW_ICONS,
  WINDOW_LABELS,
  WINDOW_REGISTRY,
  WINDOW_SIZES,
} from './registry'

function win(type: string, props: Record<string, unknown>): DeckWindow {
  return {
    id: 'w1',
    type,
    props,
    x: 0,
    y: 0,
    zIndex: 1,
    minimized: false,
    maximized: false,
  } as DeckWindow
}

describe('ウィンドウレジストリ (#794 W6)', () => {
  it('全種別がラベル・アイコン・サイズ・コンポーネントを持つ', () => {
    for (const type of ALL_WINDOW_TYPES) {
      const spec = WINDOW_REGISTRY[type]
      expect(spec, type).toBeDefined()
      expect(spec?.label, type).toBeTruthy()
      expect(spec?.icon, type).toBeTruthy()
      expect(spec?.width, type).toBeGreaterThan(0)
      expect(spec?.maxHeight, type).toBeGreaterThan(0)
      expect(spec?.component, type).toBeTypeOf('function')
    }
  })

  it('派生マップがレジストリと同じキー集合になる', () => {
    const keys = [...ALL_WINDOW_TYPES].sort()
    expect(Object.keys(WINDOW_SIZES).sort()).toEqual(keys)
    expect(Object.keys(WINDOW_LABELS).sort()).toEqual(keys)
    expect(Object.keys(WINDOW_ICONS).sort()).toEqual(keys)
  })

  it('サイズ派生が spec の値をそのまま反映する', () => {
    const spec = WINDOW_REGISTRY['note-detail']
    expect(WINDOW_SIZES['note-detail']).toEqual({
      width: spec?.width,
      maxHeight: spec?.maxHeight,
      anchor: spec?.anchor,
    })
  })

  it('anchor を宣言した種別だけが anchor を持つ', () => {
    expect(WINDOW_REGISTRY.tutorial?.anchor).toBe('top-right')
    expect(WINDOW_REGISTRY['note-detail']?.anchor).toBeUndefined()
  })

  describe('buildWindowUri', () => {
    it('uri を宣言した種別は URI を組む', () => {
      expect(
        buildWindowUri(win('note-detail', { noteId: 'n1' }), 'ex.com'),
      ).toBe('notedeck://ex.com/note/n1')
      expect(
        buildWindowUri(win('user-profile', { userId: 'u1' }), 'ex.com'),
      ).toBe('notedeck://ex.com/user/u1')
    })

    it('follow-list はタブで経路が変わる', () => {
      expect(
        buildWindowUri(
          win('follow-list', { userId: 'u1', initialTab: 'followers' }),
          'ex.com',
        ),
      ).toBe('notedeck://ex.com/user/u1/followers')
      expect(
        buildWindowUri(win('follow-list', { userId: 'u1' }), 'ex.com'),
      ).toBe('notedeck://ex.com/user/u1/following')
    })

    it('必要な props が無ければ null', () => {
      expect(buildWindowUri(win('note-detail', {}), 'ex.com')).toBeNull()
    })

    it('uri 未宣言の種別は null', () => {
      expect(buildWindowUri(win('permissions', {}), 'ex.com')).toBeNull()
    })

    it('ホスト不明なら null', () => {
      expect(
        buildWindowUri(win('note-detail', { noteId: 'n1' }), null),
      ).toBeNull()
    })
  })
})

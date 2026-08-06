import { describe, expect, it } from 'vitest'
import { modeIcon, noteModeBadgeIcon } from './customTimelines'

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

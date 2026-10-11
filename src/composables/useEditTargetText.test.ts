import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSkillsStore } from '@/stores/skills'
import { useThemeStore } from '@/stores/theme'
import { useEditTargetText } from './useEditTargetText'

describe('useEditTargetText', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('css: custom.css の現在値を返し、変更に追従する', () => {
    const theme = useThemeStore()
    theme.customCss = '.before {}'
    const text = useEditTargetText(
      () => 'css',
      () => undefined,
    )
    expect(text.value).toBe('.before {}')
    // revert / AI 編集で store が変わったら比較相手も変わる (静的コピーにしない)
    theme.customCss = '.after {}'
    expect(text.value).toBe('.after {}')
  })

  it('skill: 対象 id の本文を返す', async () => {
    const skills = useSkillsStore()
    const skill = await skills.add({
      id: 'sk-target',
      name: 'target',
      scope: { kind: 'none' },
      content: '本文',
      extra: {
        version: '0.1.0',
        mode: 'manual',
        triggers: [],
        builtIn: false,
        cheapCheckCapabilities: [],
        isPersona: false,
      },
    })
    const text = useEditTargetText(
      () => 'skill',
      () => skill.id,
    )
    expect(text.value).toBe('本文')
    await skills.update(skill.id, { content: '戻したあとの本文' })
    expect(text.value).toBe('戻したあとの本文')
  })

  it('theme: 履歴の snapshot と同じ形 (id / name / base / props) の JSON を返す', () => {
    const theme = useThemeStore()
    theme.items = [
      {
        id: 'th-1',
        name: 'T',
        createdAt: 0,
        updatedAt: 0,
        scope: { kind: 'shared', global: false, installedFor: [] },
        content: { base: 'dark', props: { accent: '#f00' } },
        extra: {},
        fileBase: 'my-theme',
      },
    ]
    const text = useEditTargetText(
      () => 'theme',
      () => 'th-1',
    )
    expect(text.value).toContain('"accent": "#f00"')
    expect(text.value).not.toContain('fileBase')
  })

  it('対象が見つからなければ空文字 (全行挿入の diff になる)', () => {
    const text = useEditTargetText(
      () => 'widget',
      () => 'missing',
    )
    expect(text.value).toBe('')
  })
})

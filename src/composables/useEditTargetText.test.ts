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

  it('skill: 対象 id の本文を返す', () => {
    const skills = useSkillsStore()
    const skill = skills.add({
      id: 'sk-target',
      name: 'target',
      version: '0.1.0',
      mode: 'manual',
      triggers: [],
      scope: 'global',
      body: '本文',
      cheapCheckCapabilities: [],
    })
    const text = useEditTargetText(
      () => 'skill',
      () => skill.id,
    )
    expect(text.value).toBe('本文')
    skills.update(skill.id, { body: '戻したあとの本文' })
    expect(text.value).toBe('戻したあとの本文')
  })

  it('theme: fileBase を除いたテーマ全文 JSON を返す', () => {
    const theme = useThemeStore()
    theme.installedThemes = [
      {
        id: 'th-1',
        name: 'T',
        base: 'dark',
        props: { accent: '#f00' },
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

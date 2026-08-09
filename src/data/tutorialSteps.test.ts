import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildTutorialSteps,
  TUTORIAL_CATEGORIES,
  type TutorialStep,
  tutorialDocsUrl,
} from './tutorialSteps'

/** docs のパスに対応する markdown が site/ に実在するか */
function docsFileExists(docsPath: string): boolean {
  const rel = docsPath.replace(/^\//, '')
  const base = resolve(__dirname, '../../site')
  const candidates = docsPath.endsWith('/')
    ? [`${rel}index.md`]
    : [`${rel}.md`, `${rel}/index.md`]
  return candidates.some((c) => existsSync(resolve(base, c)))
}

/** 初回ウィザードに出る step (wizard 未指定は既定 true) */
function wizardSteps(steps: TutorialStep[]): TutorialStep[] {
  return steps.filter((s) => s.wizard !== false)
}

describe('buildTutorialSteps', () => {
  it('初回ウィザードは API キー不要の範囲だけで完走できる (#1012)', () => {
    const ids = wizardSteps(buildTutorialSteps()).map((s) => s.id)
    expect(ids).toEqual([
      'welcome',
      'account-login',
      'add-first-column',
      'open-notifications',
      'complete',
    ])
  })

  it('AI の step は任意線 (「使いこなす」カテゴリ) に置かれる', () => {
    const mastery = buildTutorialSteps().filter((s) => s.category === 'mastery')
    const ai = mastery.filter((s) => s.id.startsWith('ai-'))
    expect(ai.map((s) => s.id)).toEqual([
      'ai-setup',
      'ai-select-provider',
      'ai-column',
    ])
    // 任意線なので初回ウィザードには出ない
    expect(mastery.every((s) => s.wizard === false)).toBe(true)
  })

  it('最終 step だけが isFinal を持つ', () => {
    const steps = buildTutorialSteps()
    expect(steps.filter((s) => s.isFinal).map((s) => s.id)).toEqual([
      'complete',
    ])
  })

  it('カテゴリ付き step はすべて完了検知を持つ (チェックリストに出るため)', () => {
    for (const step of buildTutorialSteps()) {
      if (!step.category) continue
      expect(step.completion, `${step.id} に completion がない`).toBeDefined()
      expect(step.precheck, `${step.id} に precheck がない`).toBeDefined()
    }
  })

  it('step の category はすべて定義済みカテゴリを指す', () => {
    const known = new Set(TUTORIAL_CATEGORIES.map((c) => c.id))
    for (const step of buildTutorialSteps()) {
      if (!step.category) continue
      expect(known.has(step.category), `${step.id} の category が未定義`).toBe(
        true,
      )
    }
  })

  it('各カテゴリに step が 1 つ以上ある (空の実績を作らない)', () => {
    const steps = buildTutorialSteps()
    for (const category of TUTORIAL_CATEGORIES) {
      const members = steps.filter((s) => s.category === category.id)
      expect(members.length, `${category.id} が空`).toBeGreaterThan(0)
    }
  })
})

describe('ドキュメントとの対応', () => {
  it('カテゴリの docsPath は site/ に実在するページを指す', () => {
    for (const category of TUTORIAL_CATEGORIES) {
      expect(
        docsFileExists(category.docsPath),
        `${category.id} の ${category.docsPath} が無い`,
      ).toBe(true)
    }
  })

  it('step の docsPath は site/ に実在するページを指す', () => {
    for (const step of buildTutorialSteps()) {
      if (!step.docsPath) continue
      expect(
        docsFileExists(step.docsPath),
        `${step.id} の ${step.docsPath} が無い`,
      ).toBe(true)
    }
  })

  it('カテゴリ付き step はすべてドキュメントに紐づく', () => {
    for (const step of buildTutorialSteps()) {
      if (!step.category) continue
      expect(step.docsPath, `${step.id} に docsPath がない`).toBeDefined()
    }
  })

  it('docs の URL は公式サイトを指す', () => {
    expect(tutorialDocsUrl('/docs/first-run')).toBe(
      'https://notedeck.io/docs/first-run',
    )
  })
})

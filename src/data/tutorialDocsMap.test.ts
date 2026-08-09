import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTutorialSteps, TUTORIAL_CATEGORIES } from './tutorialSteps'

/**
 * チュートリアルと公式ドキュメントの対応を機械的に守る (#1029)。
 *
 * 対応が崩れる壊れ方は 2 方向ある:
 * - step が指すページが無い / 別セクションに移った
 * - 操作を教えるページが増えたのに step が無い
 *
 * どちらもレビューでは見落とすので、サイドバー定義を正本として突き合わせる。
 */

const CONFIG_PATH = resolve(__dirname, '../../site/.vitepress/config.mts')

/**
 * 読み物として置いているページ。操作を伴わない (または操作が状態に残らない)
 * ので、対応する step を持たない。ここに足すときは理由を添えること。
 */
const DOCS_WITHOUT_STEP: Record<string, string> = {
  '/docs/': 'NoteDeck とは — 読み物',
  '/docs/install': 'インストール — アプリの外の作業',
  '/docs/guest': 'ログインせずに試す — ログイン済みなら通らない代替経路',
  '/docs/guide/grow': '環境を育てる — 他ページの総まとめ',
  '/docs/dev/': '拡張の全体像 — 読み物',
  '/docs/config/files': '設定ファイル — 読み物',
  '/docs/config/backup': 'バックアップ — 操作だが習熟の対象ではない',
  '/docs/troubleshooting': 'トラブルシューティング — 困った時に引くもの',
}

/** チュートリアルのカテゴリを持たないセクション (すべて読み物) */
const SECTIONS_WITHOUT_CATEGORY = ['はじめに', '設定とデータ', 'こまったとき']

interface DocsSection {
  text: string
  links: string[]
}

/** VitePress のサイドバー定義から、セクションとページの並びを読む */
function readSidebar(): DocsSection[] {
  const src = readFileSync(CONFIG_PATH, 'utf-8')
  const start = src.indexOf("'/docs/': [")
  expect(start, 'サイドバー定義が見つからない').toBeGreaterThan(-1)
  const body = src.slice(start)
  const sections: DocsSection[] = []
  const sectionRe =
    /text:\s*'([^']+)',\s*\n\s*collapsed:[\s\S]*?items:\s*\[([\s\S]*?)\]/g
  let m = sectionRe.exec(body)
  while (m) {
    const links = [...(m[2] ?? '').matchAll(/link:\s*'([^']+)'/g)].map(
      (x) => x[1] as string,
    )
    sections.push({ text: m[1] as string, links })
    m = sectionRe.exec(body)
  }
  return sections
}

const sections = readSidebar()
const allDocsLinks = sections.flatMap((s) => s.links)

describe('ドキュメントとの対応 (#1029)', () => {
  it('サイドバーを読めている', () => {
    expect(sections.length).toBeGreaterThan(0)
    expect(allDocsLinks.length).toBeGreaterThan(0)
  })

  it('カテゴリはドキュメントのセクションと 1 対 1', () => {
    const sectionTitles = sections
      .map((s) => s.text)
      .filter((t) => !SECTIONS_WITHOUT_CATEGORY.includes(t))
    expect(TUTORIAL_CATEGORIES.map((c) => c.title)).toEqual(sectionTitles)
  })

  it('カテゴリの docsPath は、そのカテゴリに対応するセクション内のページを指す', () => {
    for (const category of TUTORIAL_CATEGORIES) {
      const section = sections.find((s) => s.text === category.title)
      expect(section, `${category.title} のセクションが無い`).toBeDefined()
      expect(
        section?.links,
        `${category.id} の docsPath がセクション外を指している`,
      ).toContain(category.docsPath)
    }
  })

  it('step の docsPath は、その step のカテゴリのセクション内にある', () => {
    for (const step of buildTutorialSteps()) {
      if (!step.category) continue
      const category = TUTORIAL_CATEGORIES.find((c) => c.id === step.category)
      const section = sections.find((s) => s.text === category?.title)
      expect(
        section?.links,
        `${step.id} の ${step.docsPath} が ${category?.title} の外にある`,
      ).toContain(step.docsPath)
    }
  })

  it('step の並びはドキュメントのページ順に従う', () => {
    const steps = buildTutorialSteps()
    for (const category of TUTORIAL_CATEGORIES) {
      const section = sections.find((s) => s.text === category.title)
      const paths = steps
        .filter((s) => s.category === category.id)
        .map((s) => s.docsPath)
      // 1 ページに複数 step があるもの (AI) は畳んでから比べる。
      // 畳めない = 同じページの step が離れて並んでいるので、それも落とす
      const collapsed = paths.filter((p, i) => p !== paths[i - 1])
      expect(
        new Set(collapsed).size,
        `${category.id} で同じページの step が離れている`,
      ).toBe(collapsed.length)
      const expected = (section?.links ?? []).filter((l) => paths.includes(l))
      expect(collapsed, `${category.id} の並びがページ順と違う`).toEqual(
        expected,
      )
    }
  })

  it('操作を教えるページには必ず step がある', () => {
    const covered = new Set(
      buildTutorialSteps()
        .map((s) => s.docsPath)
        .filter((p): p is string => p != null),
    )
    for (const link of allDocsLinks) {
      if (link in DOCS_WITHOUT_STEP) continue
      expect(
        covered.has(link),
        `${link} に対応する step が無い (読み物なら DOCS_WITHOUT_STEP に理由つきで足す)`,
      ).toBe(true)
    }
  })

  it('読み物として除外したページは、実在してかつ step を持たない', () => {
    const covered = new Set(
      buildTutorialSteps()
        .map((s) => s.docsPath)
        .filter((p): p is string => p != null),
    )
    for (const link of Object.keys(DOCS_WITHOUT_STEP)) {
      expect(allDocsLinks, `${link} はもうサイドバーに無い`).toContain(link)
      expect(covered.has(link), `${link} は step を持っている`).toBe(false)
    }
  })
})

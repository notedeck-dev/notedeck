import JSON5 from 'json5'
import { describe, expect, it } from 'vitest'
import { parseSkillFile } from '@/utils/skillFrontmatter'
import { injectFrontmatterId, injectJson5Id } from './idFreeze'

describe('injectJson5Id', () => {
  it('空オブジェクトに ID を注入できる', () => {
    const out = injectJson5Id('{}', 'installId', 'wgt-1')
    expect(JSON5.parse(out)).toEqual({ installId: 'wgt-1' })
  })

  it('既存メンバーを保ったまま注入する', () => {
    const out = injectJson5Id(
      "{ name: 'あいう', autoRun: true }",
      'installId',
      'x.meta.json5',
    )
    expect(JSON5.parse(out)).toEqual({
      name: 'あいう',
      autoRun: true,
      installId: 'x.meta.json5',
    })
  })

  it('trailing comma があっても壊れない', () => {
    const out = injectJson5Id("{\n  name: 'a',\n}", 'id', 'qry-1')
    expect(JSON5.parse(out)).toEqual({ name: 'a', id: 'qry-1' })
  })

  it('コメントと整形を保持する', () => {
    const raw = "{\n  // 手書きコメント\n  name: 'a', /* inline */\n}"
    const out = injectJson5Id(raw, 'id', 'x')
    expect(out).toContain('// 手書きコメント')
    expect(out).toContain('/* inline */')
    expect(JSON5.parse(out)).toEqual({ name: 'a', id: 'x' })
  })

  it('既存の不正値は後勝ちで上書きされる', () => {
    const out = injectJson5Id(
      "{ installId: '', name: 'a' }",
      'installId',
      'frozen',
    )
    expect(JSON5.parse(out).installId).toBe('frozen')
  })

  it('文字列・コメント内の波括弧に惑わされない', () => {
    const out1 = injectJson5Id("{ name: 'a}b' }", 'id', 'x')
    expect(JSON5.parse(out1)).toEqual({ name: 'a}b', id: 'x' })
    const out2 = injectJson5Id('{ n: 1 /* } */ }', 'id', 'x')
    expect(JSON5.parse(out2)).toEqual({ n: 1, id: 'x' })
  })

  it('値のクオート・エスケープが正しい', () => {
    const tricky = "it's \\ tricky"
    const out = injectJson5Id('{}', 'id', tricky)
    expect(JSON5.parse(out).id).toBe(tricky)
  })

  it('決定的（同一入力 → 同一出力）', () => {
    const raw = "{ name: 'テーマ 1' }"
    expect(injectJson5Id(raw, 'id', 'custom-a.ndtheme.json5')).toBe(
      injectJson5Id(raw, 'id', 'custom-a.ndtheme.json5'),
    )
  })
})

describe('injectFrontmatterId', () => {
  it('既存 frontmatter の末尾に id を足す（本文は不変）', () => {
    const raw = '---\nname: 天気\nmode: manual\n---\n\n# body\n'
    const out = injectFrontmatterId(raw, 'tenki')
    const parsed = parseSkillFile(out)
    expect(parsed.meta.id).toBe('tenki')
    expect(parsed.meta.name).toBe('天気')
    expect(parsed.body).toBe('# body\n')
  })

  it('frontmatter が無ければ作る', () => {
    const raw = '# 本文だけ\n'
    const out = injectFrontmatterId(raw, 'skill-1')
    const parsed = parseSkillFile(out)
    expect(parsed.meta.id).toBe('skill-1')
    expect(parsed.body).toBe('# 本文だけ\n')
  })

  it('既存の不正 id は後勝ちで上書きされる', () => {
    const raw = "---\nid: ''\nname: x\n---\nbody"
    const out = injectFrontmatterId(raw, 'frozen')
    expect(parseSkillFile(out).meta.id).toBe('frozen')
  })

  it('決定的（同一入力 → 同一出力）', () => {
    const raw = '---\nname: a\n---\nbody'
    expect(injectFrontmatterId(raw, 'x')).toBe(injectFrontmatterId(raw, 'x'))
  })
})

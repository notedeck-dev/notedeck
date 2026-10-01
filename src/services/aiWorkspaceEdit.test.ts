import { describe, expect, it } from 'vitest'
import { forgetAll, removeEntry, replaceEntry } from './aiWorkspaceEdit'

const MEMORY = `# MEMORY.md

<!-- あなた自身の覚え書き: 小さな耐久事実と決めたこと。1 項目 1 行の箇条書き。
     詳しいことはメモに書き、ここには要点だけ。 -->

- 朝は短い返事を好む
- 週末は misskey.io を見ない
  (本人談)
- 誕生日は 3 月
`

const USER = `# USER.md

<!-- 相手について。Always / Never / Prefer で始まる指示の形で 1 項目ずつ。 -->

<!-- observed: 2026-09-30 | status: superseded -->
- Always call them Taka
<!-- observed: 2026-10-01 | status: active -->
- Always call them たか
<!-- observed: 2026-10-01 | status: active -->
- Prefer short answers
- Never use emoji
`

describe('aiWorkspaceEdit / MEMORY', () => {
  it('removes the bullet whose flattened text matches', () => {
    const next = removeEntry(
      'memory',
      MEMORY,
      '週末は misskey.io を見ない (本人談)',
    )
    expect(next).toBe(`# MEMORY.md

<!-- あなた自身の覚え書き: 小さな耐久事実と決めたこと。1 項目 1 行の箇条書き。
     詳しいことはメモに書き、ここには要点だけ。 -->

- 朝は短い返事を好む
- 誕生日は 3 月
`)
  })

  it('replaces the bullet in place and folds multi-line input into one bullet', () => {
    const next = replaceEntry(
      'memory',
      MEMORY,
      '誕生日は 3 月',
      '誕生日は\n3 月 3 日',
    )
    expect(next).toContain(
      '- 週末は misskey.io を見ない\n  (本人談)\n- 誕生日は 3 月 3 日\n',
    )
    expect(next).not.toContain('- 誕生日は 3 月\n')
  })

  it('returns null when the entry is not there (stale copy)', () => {
    expect(removeEntry('memory', MEMORY, 'ない項目')).toBeNull()
    expect(replaceEntry('memory', MEMORY, 'ない項目', 'x')).toBeNull()
  })

  it('replacing with an empty text removes the entry', () => {
    const next = replaceEntry('memory', MEMORY, '朝は短い返事を好む', '   ')
    expect(next).not.toContain('朝は短い返事を好む')
  })

  it('forgetAll keeps only the heading and the leading comment', () => {
    expect(forgetAll(MEMORY)).toBe(`# MEMORY.md

<!-- あなた自身の覚え書き: 小さな耐久事実と決めたこと。1 項目 1 行の箇条書き。
     詳しいことはメモに書き、ここには要点だけ。 -->
`)
  })

  it('forgetAll of a bare file keeps just the heading', () => {
    expect(forgetAll('# MEMORY.md\n\n- a\n- b\n')).toBe('# MEMORY.md\n')
    expect(forgetAll('')).toBe('')
  })
})

describe('aiWorkspaceEdit / USER', () => {
  it('removes the whole directive block (marker + bullets)', () => {
    const next = removeEntry(
      'user',
      USER,
      'Prefer short answers Never use emoji',
    )
    expect(next).toBe(`# USER.md

<!-- 相手について。Always / Never / Prefer で始まる指示の形で 1 項目ずつ。 -->

<!-- observed: 2026-09-30 | status: superseded -->
- Always call them Taka
<!-- observed: 2026-10-01 | status: active -->
- Always call them たか
`)
  })

  it('does not match superseded blocks', () => {
    expect(removeEntry('user', USER, 'Always call them Taka')).toBeNull()
  })

  it('replaces the bullet text and keeps the marker line', () => {
    const next = replaceEntry(
      'user',
      USER,
      'Always call them たか',
      'Always call them taka',
    )
    expect(next).toContain(
      '<!-- observed: 2026-10-01 | status: active -->\n- Always call them taka\n<!-- observed',
    )
    expect(next).toContain('status: superseded -->\n- Always call them Taka\n')
  })

  it('forgetAll drops active and superseded blocks but keeps the template comment', () => {
    expect(forgetAll(USER)).toBe(`# USER.md

<!-- 相手について。Always / Never / Prefer で始まる指示の形で 1 項目ずつ。 -->
`)
  })

  it('forgetAll does not keep a directive marker as the template comment', () => {
    const body =
      '# USER.md\n\n<!-- observed: 2026-10-01 | status: active -->\n- Prefer tea\n'
    expect(forgetAll(body)).toBe('# USER.md\n')
  })
})

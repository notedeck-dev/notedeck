import { describe, expect, it } from 'vitest'
import {
  replaceMarkdownSection,
  SKILLS_BUILTIN_CAPABILITIES,
  skillsAppendCapability,
  skillsListCapability,
  skillsReadCapability,
  skillsReplaceSectionCapability,
  skillsToggleCapability,
} from './skills'

// Note: execute は内部で useSkillsStore (Pinia) を呼ぶため、unit 環境では
// store mock が必要になる。Pinia の setup 抜きでは走らないので、本テストは
// capability 定義 (id / permissions / signature / aiTool) と引数バリデーション、
// および pure ロジック (replaceMarkdownSection) を検証する。

describe('skill capabilities — declaration', () => {
  it('skills.list: read permission, aiTool true, cheap', () => {
    expect(skillsListCapability.id).toBe('skills.list')
    expect(skillsListCapability.permissions).toEqual(['skills.read'])
    expect(skillsListCapability.aiTool).toBe(true)
    expect(skillsListCapability.signature?.cheap).toBe(true)
  })

  it('skills.read: read permission, requires id', () => {
    expect(skillsReadCapability.id).toBe('skills.read')
    expect(skillsReadCapability.permissions).toEqual(['skills.read'])
    expect(skillsReadCapability.signature?.params?.id?.optional).not.toBe(true)
    expect(() => skillsReadCapability.execute({})).toThrow(/id is required/)
  })

  it('skills.append: write permission, requires confirmation, requires id+content', () => {
    expect(skillsAppendCapability.id).toBe('skills.append')
    expect(skillsAppendCapability.permissions).toEqual(['skills.write'])
    expect(skillsAppendCapability.requiresConfirmation).toBe(true)
    expect(() => skillsAppendCapability.execute({ id: 'x' })).toThrow(
      /content is required/,
    )
    expect(() => skillsAppendCapability.execute({ content: 'x' })).toThrow(
      /id is required/,
    )
  })

  it('skills.replaceSection: write permission, requires confirmation, requires id+heading', () => {
    expect(skillsReplaceSectionCapability.id).toBe('skills.replaceSection')
    expect(skillsReplaceSectionCapability.permissions).toEqual(['skills.write'])
    expect(skillsReplaceSectionCapability.requiresConfirmation).toBe(true)
    expect(() => skillsReplaceSectionCapability.execute({ id: 'x' })).toThrow(
      /heading is required/,
    )
  })

  it('skills.toggle: write permission, no confirm (= 可逆な切替)', () => {
    expect(skillsToggleCapability.id).toBe('skills.toggle')
    expect(skillsToggleCapability.permissions).toEqual(['skills.write'])
    expect(skillsToggleCapability.requiresConfirmation).not.toBe(true)
  })
})

describe('SKILLS_BUILTIN_CAPABILITIES', () => {
  it('contains all 5 skill capabilities', () => {
    const ids = SKILLS_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual([
      'skills.append',
      'skills.list',
      'skills.read',
      'skills.replaceSection',
      'skills.toggle',
    ])
  })
})

describe('replaceMarkdownSection — pure logic', () => {
  it('replaces an existing section between `## heading` and the next heading', () => {
    const body = [
      'intro line',
      '',
      '## Foo',
      'old foo content',
      'still foo',
      '',
      '## Bar',
      'bar content',
    ].join('\n')
    const { body: out, replaced } = replaceMarkdownSection(
      body,
      'Foo',
      'NEW FOO',
    )
    expect(replaced).toBe(true)
    expect(out).toContain('intro line')
    expect(out).toContain('## Foo\n\nNEW FOO')
    expect(out).toContain('## Bar\nbar content')
    expect(out).not.toContain('old foo content')
  })

  it('replaces the last section (next-heading boundary = EOF)', () => {
    const body = '## Foo\nold'
    const { body: out, replaced } = replaceMarkdownSection(body, 'Foo', 'new')
    expect(replaced).toBe(true)
    expect(out).toBe('## Foo\n\nnew')
  })

  it('appends a new section when heading is not found', () => {
    const body = 'just text'
    const { body: out, replaced } = replaceMarkdownSection(
      body,
      'New',
      'fresh content',
    )
    expect(replaced).toBe(false)
    expect(out).toBe('just text\n\n## New\n\nfresh content')
  })

  it('handles empty body (= 新規セクションだけ)', () => {
    const { body: out, replaced } = replaceMarkdownSection('', 'New', 'x')
    expect(replaced).toBe(false)
    expect(out).toBe('## New\n\nx')
  })

  it('stops replacement at the next h1 (= ## の上位境界)', () => {
    const body = ['## Foo', 'old', '# Section', 'after'].join('\n')
    const { body: out } = replaceMarkdownSection(body, 'Foo', 'new')
    expect(out).toContain('## Foo\n\nnew')
    expect(out).toContain('# Section\nafter')
    expect(out).not.toContain('old')
  })

  it('treats heading text comparison as exact (whitespace-trim only)', () => {
    const body = '## Foo Bar\nstuff'
    const { replaced } = replaceMarkdownSection(body, 'foo bar', 'x')
    // case-sensitive: 'foo bar' は '## Foo Bar' とは異なる
    expect(replaced).toBe(false)
  })

  it('escapes regex metacharacters in heading', () => {
    const body = '## A.B (test)\nold'
    const { body: out, replaced } = replaceMarkdownSection(
      body,
      'A.B (test)',
      'new',
    )
    expect(replaced).toBe(true)
    expect(out).toContain('## A.B (test)\n\nnew')
  })
})

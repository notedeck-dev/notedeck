import { describe, expect, it } from 'vitest'
import { parseSkillFile, serializeSkillFile } from '@/services/skillFrontmatter'

describe('parseSkillFile', () => {
  it('extracts flat string/number/boolean/array fields from frontmatter', () => {
    const raw = [
      '---',
      'id: translator',
      'name: 翻訳',
      'version: 0.1.0',
      'mode: manual',
      'triggers: [composing-reply, viewing-thread]',
      'builtIn: true',
      'createdAt: 1700000000000',
      '---',
      'body line 1',
      'body line 2',
    ].join('\n')

    const { meta, body } = parseSkillFile(raw)
    expect(meta.id).toBe('translator')
    expect(meta.name).toBe('翻訳')
    expect(meta.version).toBe('0.1.0')
    expect(meta.mode).toBe('manual')
    expect(meta.triggers).toEqual(['composing-reply', 'viewing-thread'])
    expect(meta.builtIn).toBe(true)
    expect(meta.createdAt).toBe(1700000000000)
    expect(body).toBe('body line 1\nbody line 2')
  })

  it('returns whole content as body when no frontmatter is present', () => {
    const raw = 'no frontmatter here\njust body'
    const { meta, body } = parseSkillFile(raw)
    expect(meta).toEqual({})
    expect(body).toBe(raw)
  })

  it('strips matching surrounding quotes from string values', () => {
    const raw = "---\nname: '日本語: コロン入り'\n---\nbody"
    const { meta } = parseSkillFile(raw)
    expect(meta.name).toBe('日本語: コロン入り')
  })

  it('handles empty string values', () => {
    const raw = '---\nauthor:\nname: x\n---\n'
    const { meta } = parseSkillFile(raw)
    expect(meta.author).toBe('')
    expect(meta.name).toBe('x')
  })

  it('parses multi-line YAML array (block style: `key:` + indented `- item`)', () => {
    const raw = [
      '---',
      'id: plugin-author',
      'triggers:',
      '  - プラグイン',
      '  - plugin',
      '  - aiscript',
      'mode: trigger',
      '---',
      'body',
    ].join('\n')
    const { meta } = parseSkillFile(raw)
    expect(meta.triggers).toEqual(['プラグイン', 'plugin', 'aiscript'])
    expect(meta.mode).toBe('trigger')
    expect(meta.id).toBe('plugin-author')
  })

  it('block array supports quoted entries', () => {
    const raw = [
      '---',
      'tags:',
      "  - 'colon: in value'",
      '  - simple',
      '---',
      '',
    ].join('\n')
    const { meta } = parseSkillFile(raw)
    expect(meta.tags).toEqual(['colon: in value', 'simple'])
  })

  it('still treats lone `key:` as empty string when next line is not a `- item`', () => {
    const raw = '---\nauthor:\nname: x\n---\n'
    const { meta } = parseSkillFile(raw)
    expect(meta.author).toBe('')
  })

  it('strips blank lines between frontmatter end (`---`) and body start', () => {
    // 慣習的な「frontmatter / body の見た目 separator」(空行 1 個) を吸収して
    // body 先頭に余分な改行が残らないようにする。
    const raw = '---\nid: x\n---\n\n# Heading\n'
    const { body } = parseSkillFile(raw)
    expect(body).toBe('# Heading\n')
  })

  it('strips multiple blank lines between frontmatter and body', () => {
    const raw = '---\nid: x\n---\n\n\n\n# Heading\n'
    const { body } = parseSkillFile(raw)
    expect(body).toBe('# Heading\n')
  })

  it('handles no blank line between frontmatter and body (compact form)', () => {
    const raw = '---\nid: x\n---\n# Heading\n'
    const { body } = parseSkillFile(raw)
    expect(body).toBe('# Heading\n')
  })
})

describe('serializeSkillFile', () => {
  it('round-trips through parseSkillFile', () => {
    const original = {
      id: 'aizu',
      name: '三須木藍',
      version: '0.1.0',
      mode: 'always',
      triggers: ['a', 'b'],
      builtIn: true,
    }
    const body = '本文です。\n2 行目。'
    const serialized = serializeSkillFile(original, body)
    const { meta, body: parsedBody } = parseSkillFile(serialized)
    expect(meta).toMatchObject(original)
    expect(parsedBody).toBe(body)
  })

  it('quotes values containing colons or commas', () => {
    const out = serializeSkillFile(
      { name: 'has: colon', desc: 'has, comma' },
      '',
    )
    const { meta } = parseSkillFile(out)
    expect(meta.name).toBe('has: colon')
    expect(meta.desc).toBe('has, comma')
  })
})

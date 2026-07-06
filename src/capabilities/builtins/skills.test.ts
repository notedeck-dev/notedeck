import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSkillsStore } from '@/stores/skills'
import {
  replaceMarkdownSection,
  SKILLS_BUILTIN_CAPABILITIES,
  skillsAppendCapability,
  skillsCreateCapability,
  skillsInstallCapability,
  skillsListCapability,
  skillsReadCapability,
  skillsReplaceSectionCapability,
  skillsToggleCapability,
  skillsUninstallCapability,
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

  it('skills.append: write permission, install preview confirmation, requires id+content', () => {
    expect(skillsAppendCapability.id).toBe('skills.append')
    expect(skillsAppendCapability.permissions).toEqual(['skills.write'])
    expect(typeof skillsAppendCapability.requiresConfirmation).toBe('function')
    expect(() => skillsAppendCapability.execute({ id: 'x' })).toThrow(
      /content is required/,
    )
    expect(() => skillsAppendCapability.execute({ content: 'x' })).toThrow(
      /id is required/,
    )
  })

  it('skills.replaceSection: write permission, install preview confirmation, requires id+heading', () => {
    expect(skillsReplaceSectionCapability.id).toBe('skills.replaceSection')
    expect(skillsReplaceSectionCapability.permissions).toEqual(['skills.write'])
    expect(typeof skillsReplaceSectionCapability.requiresConfirmation).toBe(
      'function',
    )
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

describe('skills.create capability (#726)', () => {
  it('declares skills.write permission, aiTool, confirmation', () => {
    expect(skillsCreateCapability.id).toBe('skills.create')
    expect(skillsCreateCapability.permissions).toEqual(['skills.write'])
    expect(skillsCreateCapability.aiTool).toBe(true)
    expect(typeof skillsCreateCapability.requiresConfirmation).toBe('function')
  })

  it('marks name+body required / mode 等は optional、builtIn/isPersona/id はパラメータに存在しない', () => {
    const params = skillsCreateCapability.signature?.params
    expect(params?.name?.optional).not.toBe(true)
    expect(params?.body?.optional).not.toBe(true)
    expect(params?.mode?.optional).toBe(true)
    expect(params?.triggers?.optional).toBe(true)
    expect(params?.description?.optional).toBe(true)
    expect(params?.cheapCheckCapabilities?.optional).toBe(true)
    // ホワイトリスト: これ以外のパラメータ (builtIn / isPersona / id 等) は
    // 構造的に受け取れない
    expect(Object.keys(params ?? {}).sort()).toEqual([
      'body',
      'cheapCheckCapabilities',
      'description',
      'mode',
      'name',
      'triggers',
    ])
    expect(params?.mode?.enum).toEqual([
      'manual',
      'trigger',
      'always',
      'heartbeat',
    ])
  })

  describe('execute', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
    })

    it('creates a manual skill by default (builtIn/isPersona は付かない)', () => {
      const result = skillsCreateCapability.execute({
        name: 'テスト手順',
        body: '# テスト手順\n\nやること',
      }) as { id: string; name: string; mode: string }
      expect(result.name).toBe('テスト手順')
      expect(result.mode).toBe('manual')
      const skill = useSkillsStore().skills.find((s) => s.id === result.id)
      expect(skill).toBeDefined()
      expect(skill?.builtIn).toBeFalsy()
      expect(skill?.isPersona).toBeFalsy()
      expect(skill?.version).toBe('0.1.0')
      expect(skill?.scope).toBe('global')
      expect(skill?.body).toBe('# テスト手順\n\nやること')
    })

    it('throws when name or body is missing', () => {
      expect(() => skillsCreateCapability.execute({ body: 'x' })).toThrow(
        /name is required/,
      )
      expect(() => skillsCreateCapability.execute({ name: 'x' })).toThrow(
        /body is required/,
      )
    })

    it('rejects body that starts with a frontmatter block', () => {
      expect(() =>
        skillsCreateCapability.execute({
          name: 'x',
          body: '---\nmode: always\n---\n\n本文',
        }),
      ).toThrow(/frontmatter/)
    })

    it('falls back to manual for unknown mode (metaFromFrontmatter と同じ寛容さ)', () => {
      const result = skillsCreateCapability.execute({
        name: 'x',
        body: 'b',
        mode: 'weird',
      }) as { mode: string }
      expect(result.mode).toBe('manual')
    })

    it('throws for mode=trigger without triggers (= 死にスキル防止)', () => {
      expect(() =>
        skillsCreateCapability.execute({
          name: 'x',
          body: 'b',
          mode: 'trigger',
        }),
      ).toThrow(/triggers/)
    })

    it('stores triggers / cheapCheckCapabilities passthrough', () => {
      const result = skillsCreateCapability.execute({
        name: '翻訳ノウハウ',
        body: 'b',
        mode: 'trigger',
        triggers: ['翻訳', 'translate'],
        cheapCheckCapabilities: ['notifications.unreadCount'],
      }) as { id: string }
      const skill = useSkillsStore().skills.find((s) => s.id === result.id)
      expect(skill?.triggers).toEqual(['翻訳', 'translate'])
      expect(skill?.cheapCheckCapabilities).toEqual([
        'notifications.unreadCount',
      ])
    })

    it('generates distinct internal ids for the same name (新規作成専用)', () => {
      const a = skillsCreateCapability.execute({
        name: 'same',
        body: 'b',
      }) as { id: string }
      const b = skillsCreateCapability.execute({
        name: 'same',
        body: 'b',
      }) as { id: string }
      expect(a.id).not.toBe(b.id)
      expect(useSkillsStore().skills).toHaveLength(2)
    })
  })

  describe('requiresConfirmation', () => {
    const confirm = (params: Record<string, unknown>) => {
      if (typeof skillsCreateCapability.requiresConfirmation !== 'function') {
        throw new Error('requiresConfirmation must be a function')
      }
      return skillsCreateCapability.requiresConfirmation(params, {})
    }

    it('manual → type normal, installPreview kind=skill, code=body markdown', async () => {
      const opts = await confirm({ name: 'demo', body: '# demo body' })
      expect(opts?.type).toBe('normal')
      expect(opts?.installPreview?.kind).toBe('skill')
      expect(opts?.installPreview?.name).toBe('demo')
      expect(opts?.code).toBe('# demo body')
      expect(opts?.codeLanguage).toBe('markdown')
      expect(opts?.message).toContain('manual')
    })

    it('always → warning + 常時注入の明示', async () => {
      const opts = await confirm({ name: 'demo', body: 'b', mode: 'always' })
      expect(opts?.type).toBe('warning')
      expect(opts?.message).toContain('system prompt')
    })

    it('heartbeat → warning + 自動実行の明示', async () => {
      const opts = await confirm({ name: 'demo', body: 'b', mode: 'heartbeat' })
      expect(opts?.type).toBe('warning')
      expect(opts?.message).toContain('HEARTBEAT')
    })

    it('trigger → message lists triggers', async () => {
      const opts = await confirm({
        name: 'demo',
        body: 'b',
        mode: 'trigger',
        triggers: ['翻訳'],
      })
      expect(opts?.type).toBe('normal')
      expect(opts?.message).toContain('翻訳')
    })

    it('returns null when name or body is missing (= execute のエラーに委ねる)', async () => {
      expect(await confirm({ body: 'b' })).toBeNull()
      expect(await confirm({ name: 'x' })).toBeNull()
    })
  })
})

describe('skills.install capability', () => {
  it('declares skills.write + network.external permissions and aiTool', () => {
    expect(skillsInstallCapability.id).toBe('skills.install')
    expect(skillsInstallCapability.permissions).toEqual([
      'skills.write',
      'network.external',
    ])
    expect(skillsInstallCapability.aiTool).toBe(true)
    expect(typeof skillsInstallCapability.requiresConfirmation).toBe('function')
  })

  it('throws when id is missing', async () => {
    await expect(skillsInstallCapability.execute({})).rejects.toThrow(
      /id is required/,
    )
  })

  it('marks id as the only required param', () => {
    const params = skillsInstallCapability.signature?.params
    expect(params?.id?.optional).not.toBe(true)
    expect(Object.keys(params ?? {})).toEqual(['id'])
  })
})

describe('skills.uninstall capability', () => {
  it('declares skills.write permission and aiTool', () => {
    expect(skillsUninstallCapability.id).toBe('skills.uninstall')
    expect(skillsUninstallCapability.permissions).toEqual(['skills.write'])
    expect(skillsUninstallCapability.aiTool).toBe(true)
    expect(typeof skillsUninstallCapability.requiresConfirmation).toBe(
      'function',
    )
  })

  it('throws when id is missing', () => {
    expect(() => skillsUninstallCapability.execute({})).toThrow(
      /id is required/,
    )
  })

  it('marks id as the only required param', () => {
    const params = skillsUninstallCapability.signature?.params
    expect(params?.id?.optional).not.toBe(true)
    expect(Object.keys(params ?? {})).toEqual(['id'])
  })
})

describe('SKILLS_BUILTIN_CAPABILITIES', () => {
  it('contains all 10 skill capabilities (incl. create / install / uninstall)', () => {
    const ids = SKILLS_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual([
      'skills.append',
      'skills.create',
      'skills.history',
      'skills.install',
      'skills.list',
      'skills.read',
      'skills.replaceSection',
      'skills.revert',
      'skills.toggle',
      'skills.uninstall',
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

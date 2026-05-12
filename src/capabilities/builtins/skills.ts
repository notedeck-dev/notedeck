import type { Command } from '@/commands/registry'
import { useSkillsStore } from '@/stores/skills'

/**
 * Skill 系 capability — 「自己拡張する IDE」の中核 (memory:
 * project_self_extending_ide_roadmap.md)。AI / プラグインが skill の
 * 本文 (markdown body) を編集することで、persona が自分の知識・態度を
 * 育てられる。
 *
 * 設計判断:
 * - frontmatter (id / version / mode / scope / builtIn / isPersona) は
 *   触らせない。本文 markdown のみ編集対象
 * - 全文置換は破壊的なので append / replaceSection を提供 (memory 推奨)
 * - 編集系は requiresConfirmation: true (= ユーザー承認後に書込)
 * - Phase 1 では「どの skill を編集できるか」は permission レベル管理
 *   (scope 制限 = persona の自分の skill だけ、は Phase 2)
 */

export const skillsListCapability: Command = {
  id: 'skills.list',
  label: 'スキル一覧',
  icon: 'ti-book',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['skills.read'],
  signature: {
    description:
      '登録されている skill の一覧を返す。各要素は { id, name, mode, ' +
      'isPersona, builtIn, author?, description? }。body は含まれない (= 大きいため、' +
      'skills.read で個別取得)。',
    params: {},
    returns: {
      type: 'array',
      description: 'skill メタデータの配列',
    },
    cheap: true,
  },
  visible: false,
  execute: () => {
    const store = useSkillsStore()
    return store.skills.map((s) => ({
      id: s.id,
      name: s.name,
      mode: s.mode,
      isPersona: s.isPersona ?? false,
      builtIn: s.builtIn ?? false,
      author: s.author ?? null,
      description: s.description ?? null,
      version: s.version,
    }))
  },
}

export const skillsReadCapability: Command = {
  id: 'skills.read',
  label: 'スキル本文を読む',
  icon: 'ti-book',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['skills.read'],
  signature: {
    description: '指定 id の skill の markdown 本文を返す。',
    params: {
      id: {
        type: 'string',
        description: '対象 skill の id (skills.list で取得)',
      },
    },
    returns: {
      type: 'object',
      description: '{ id, name, body, mode }',
    },
    cheap: true,
  },
  visible: false,
  execute: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('skills.read: id is required')
    const store = useSkillsStore()
    const skill = store.skills.find((s) => s.id === id)
    if (!skill) throw new Error(`skills.read: skill "${id}" not found`)
    return {
      id: skill.id,
      name: skill.name,
      body: skill.body,
      mode: skill.mode,
    }
  },
}

export const skillsAppendCapability: Command = {
  id: 'skills.append',
  label: 'スキル本文に追記',
  icon: 'ti-plus',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['skills.write'],
  requiresConfirmation: true,
  signature: {
    description:
      'skill 本文の末尾に markdown を追記する。skill 全体を書き換える' +
      'のではなく追記のみ (= 学習が積み上がる)。frontmatter は触れない。',
    params: {
      id: {
        type: 'string',
        description: '対象 skill の id',
      },
      content: {
        type: 'string',
        description: '末尾に追記する markdown (改行は \\n)',
      },
    },
    returns: {
      type: 'object',
      description: '{ id, length: 追記後の body 文字数 }',
    },
  },
  visible: false,
  execute: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    const content = typeof params?.content === 'string' ? params.content : ''
    if (!id) throw new Error('skills.append: id is required')
    if (!content) throw new Error('skills.append: content is required')
    const store = useSkillsStore()
    const skill = store.skills.find((s) => s.id === id)
    if (!skill) throw new Error(`skills.append: skill "${id}" not found`)
    const newBody = `${skill.body}${skill.body.endsWith('\n') ? '' : '\n'}${content}`
    store.update(id, { body: newBody })
    return { id, length: newBody.length }
  },
}

/**
 * markdown の `## <heading>` セクションを置換する。指定 heading が
 * 見つからない場合は本文末尾に新規セクションとして追加する (= idempotent)。
 *
 * セクションは `## <heading>` から次の同レベル以上の見出し (= `## ` / `# `)
 * までを 1 つの単位として扱う。
 */
export const skillsReplaceSectionCapability: Command = {
  id: 'skills.replaceSection',
  label: 'スキルのセクションを置換',
  icon: 'ti-edit',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['skills.write'],
  requiresConfirmation: true,
  signature: {
    description:
      'skill 本文の `## <heading>` セクションを置換する。該当 heading が' +
      '無ければ末尾に新規セクションとして追加 (idempotent)。',
    params: {
      id: { type: 'string', description: '対象 skill の id' },
      heading: {
        type: 'string',
        description: 'セクション見出しテキスト (`## ` を除いた本体)',
      },
      content: {
        type: 'string',
        description: 'セクション本体の新しい markdown (heading 行は含めない)',
      },
    },
    returns: {
      type: 'object',
      description: '{ id, replaced: boolean (false = 新規追加), length }',
    },
  },
  visible: false,
  execute: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    const heading = typeof params?.heading === 'string' ? params.heading : ''
    const content = typeof params?.content === 'string' ? params.content : ''
    if (!id) throw new Error('skills.replaceSection: id is required')
    if (!heading) throw new Error('skills.replaceSection: heading is required')
    const store = useSkillsStore()
    const skill = store.skills.find((s) => s.id === id)
    if (!skill) {
      throw new Error(`skills.replaceSection: skill "${id}" not found`)
    }
    const { body, replaced } = replaceMarkdownSection(
      skill.body,
      heading,
      content,
    )
    store.update(id, { body })
    return { id, replaced, length: body.length }
  },
}

export const skillsToggleCapability: Command = {
  id: 'skills.toggle',
  label: 'スキルの有効/無効を切替',
  icon: 'ti-toggle-left',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['skills.write'],
  signature: {
    description:
      'skill の active 状態を切り替える。mode="always" の skill は常時 ' +
      'active 扱いのため設定は無視される。',
    params: {
      id: { type: 'string', description: '対象 skill の id' },
      active: {
        type: 'boolean',
        description: 'true = 有効化 / false = 無効化',
      },
    },
    returns: {
      type: 'object',
      description: '{ id, active }',
    },
  },
  visible: false,
  execute: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('skills.toggle: id is required')
    const active = params?.active === true
    const store = useSkillsStore()
    const skill = store.skills.find((s) => s.id === id)
    if (!skill) throw new Error(`skills.toggle: skill "${id}" not found`)
    store.setActive(id, active)
    return { id, active }
  },
}

/**
 * `## <heading>` で始まるセクションを置換する。次に出現する `## ` / `# `
 * の直前までが置換対象。
 */
export function replaceMarkdownSection(
  body: string,
  heading: string,
  newContent: string,
): { body: string; replaced: boolean } {
  const lines = body.split('\n')
  const headingPattern = new RegExp(
    `^##\\s+${escapeRegExp(heading.trim())}\\s*$`,
  )
  let startIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (headingPattern.test(line)) {
      startIdx = i
      break
    }
  }

  if (startIdx < 0) {
    // 見つからない: 末尾に新規セクションを追加
    const prefix = body.endsWith('\n') || body.length === 0 ? body : `${body}\n`
    const sep = prefix.length === 0 ? '' : '\n'
    return {
      body: `${prefix}${sep}## ${heading}\n\n${newContent}`,
      replaced: false,
    }
  }

  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (/^#{1,2}\s/.test(line)) {
      endIdx = i
      break
    }
  }

  const before = lines.slice(0, startIdx).join('\n')
  const after = lines.slice(endIdx).join('\n')
  const newSection = `## ${heading}\n\n${newContent}`
  const joined = [before, newSection, after]
    .filter((s, i) => i === 1 || s.length > 0)
    .join('\n')
  return { body: joined, replaced: true }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const SKILLS_BUILTIN_CAPABILITIES: readonly Command[] = [
  skillsListCapability,
  skillsReadCapability,
  skillsAppendCapability,
  skillsReplaceSectionCapability,
  skillsToggleCapability,
]

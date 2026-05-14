import type { Command } from '@/commands/registry'
import { useMisStoreStore } from '@/stores/misstore'
import { useSkillsStore } from '@/stores/skills'
import { getSnapshotAt, listSnapshots } from '@/utils/historyFs'

interface SkillSnapshot {
  body: string
  name?: string
  version?: string
  mode?: string
}

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
  requiresConfirmation: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    const content = typeof params?.content === 'string' ? params.content : ''
    const cur = useSkillsStore().skills.find((s) => s.id === id)
    if (!cur) return null
    return {
      title: 'スキル本文に追記',
      message:
        `${cur.name} の本文に ${content.length} 文字を追記します。` +
        ' frontmatter は触れません。',
      installPreview: {
        kind: 'skill',
        name: cur.name,
        version: cur.version,
        description: `${cur.mode} mode / ${cur.scope} scope`,
      },
      code: content,
      codeLanguage: 'markdown',
      okLabel: '追記',
      cancelLabel: 'やめる',
      type: 'normal',
    }
  },
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
  requiresConfirmation: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    const heading = typeof params?.heading === 'string' ? params.heading : ''
    const content = typeof params?.content === 'string' ? params.content : ''
    const cur = useSkillsStore().skills.find((s) => s.id === id)
    if (!cur) return null
    return {
      title: 'スキルのセクションを置換',
      message:
        `${cur.name} の \`## ${heading}\` セクションを ${content.length} 文字に置換します。` +
        ' 該当 heading が無ければ末尾に新規追加します (idempotent)。',
      installPreview: {
        kind: 'skill',
        name: cur.name,
        version: cur.version,
        description: `${cur.mode} mode / ${cur.scope} scope`,
      },
      code: `## ${heading}\n\n${content}`,
      codeLanguage: 'markdown',
      okLabel: '置換',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
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

export const skillsHistoryCapability: Command = {
  id: 'skills.history',
  label: 'スキルの編集履歴を取得',
  icon: 'ti-history',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['skills.read'],
  signature: {
    description:
      '指定 id の skill の編集前 snapshot 一覧 (新しい順、最大 10 件) を返す。' +
      ' 各エントリは { at: 時刻 ms, snapshot: { body, name?, version?, mode? } }。',
    params: {
      id: { type: 'string', description: '対象 skill の id' },
    },
    returns: {
      type: 'array',
      description: '編集前 snapshot の配列 (新しい順)',
    },
    cheap: true,
  },
  visible: false,
  execute: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('skills.history: id is required')
    const store = useSkillsStore()
    const skill = store.skills.find((s) => s.id === id)
    if (!skill) throw new Error(`skills.history: skill "${id}" not found`)
    const basename = skill.name || skill.id
    return await listSnapshots<SkillSnapshot>('skill', basename)
  },
}

export const skillsRevertCapability: Command = {
  id: 'skills.revert',
  label: 'スキルを過去の編集前状態に戻す',
  icon: 'ti-arrow-back-up',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['skills.write'],
  requiresConfirmation: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    const index = typeof params?.index === 'number' ? params.index : -1
    const cur = useSkillsStore().skills.find((s) => s.id === id)
    if (!cur || index < 0) return null
    const basename = cur.name || cur.id
    const entry = await getSnapshotAt<SkillSnapshot>('skill', basename, index)
    if (!entry) return null
    return {
      title: 'スキルを過去の状態に戻す',
      message:
        `${cur.name} を編集履歴 #${index} ` +
        `(${new Date(entry.at).toLocaleString()}) の本文に戻します。` +
        ' 現在の body は上書きされます。',
      installPreview: {
        kind: 'skill',
        name: cur.name,
        version: cur.version,
        description: `${cur.mode} mode / ${cur.scope} scope`,
      },
      code: entry.snapshot.body,
      codeLanguage: 'markdown',
      okLabel: 'この状態に戻す',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  signature: {
    description:
      'skill を編集履歴の index 番目の snapshot に戻す。skills.history で index を取得。',
    params: {
      id: { type: 'string', description: '対象 skill の id' },
      index: {
        type: 'number',
        description: 'snapshot index (0 = 最新、skills.history の順序と一致)',
      },
    },
    returns: {
      type: 'object',
      description: '{ id, reverted: boolean, at: number }',
    },
  },
  visible: false,
  execute: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    const index = typeof params?.index === 'number' ? params.index : -1
    if (!id) throw new Error('skills.revert: id is required')
    if (index < 0) throw new Error('skills.revert: index must be >= 0')
    const store = useSkillsStore()
    const skill = store.skills.find((s) => s.id === id)
    if (!skill) throw new Error(`skills.revert: skill "${id}" not found`)
    const basename = skill.name || skill.id
    const entry = await getSnapshotAt<SkillSnapshot>('skill', basename, index)
    if (!entry) {
      throw new Error(`skills.revert: no snapshot at index ${index}`)
    }
    store.update(id, { body: entry.snapshot.body })
    return { id, reverted: true, at: entry.at }
  },
}

/**
 * `skills.install` — MisStore (misstore.hital.in) から既製 skill を取得して
 * skills store に追加する。AI が「翻訳がうまい persona ない？」のように
 * 推薦から install まで一気通貫で実行できるようにするためのラッパ。
 *
 * 設計判断 (memory: project_self_extending_ide_roadmap.md):
 * - これは **AI が他 persona / curator skill を取得する経路**であり、
 *   skill self-edit (= AI が自分の設計図を書き換える) とは別物。
 *   後者は鶏卵問題のため意図的に避けている。
 * - 内部実装は `useMisStoreStore.installSkill(entry)` (sha512 検証 +
 *   frontmatter parse + add/update まで完備) を呼ぶだけ。
 */
export const skillsInstallCapability: Command = {
  id: 'skills.install',
  label: 'MisStore からスキルを入れる',
  icon: 'ti-download',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['skills.write', 'network.external'],
  requiresConfirmation: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) return null
    const misStore = useMisStoreStore()
    await misStore.fetchSkills()
    const entry = misStore.skills.find((s) => s.id === id)
    if (!entry) return null
    return {
      title: 'MisStore からスキルを入れる',
      message:
        `${entry.name} (v${entry.version} / by ${entry.author}) を MisStore から取得します。` +
        (entry.mode === 'always'
          ? ' (mode=always: 常に system prompt に注入されます)'
          : ` (mode=${entry.mode ?? 'manual'})`),
      installPreview: {
        kind: 'skill',
        name: entry.name,
        version: entry.version,
        author: entry.author,
        description: entry.description,
      },
      code: entry.description,
      codeLanguage: 'plaintext',
      okLabel: 'インストール',
      cancelLabel: 'やめる',
      type: 'normal',
    }
  },
  signature: {
    description:
      'MisStore (misstore.hital.in) の既製スキルをインストールする。' +
      ' id は `misstore.search` で取得した値を渡す。sha512 検証付き。' +
      ' 既存の同 storeId / 同 id は上書き更新 (= 再インストール = アップデート)。',
    params: {
      id: {
        type: 'string',
        description: 'MisStore registry 上の skill id',
      },
    },
    returns: {
      type: 'object',
      description: '{ id, name, mode, installed: boolean }',
    },
  },
  visible: false,
  execute: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('skills.install: id is required')
    const misStore = useMisStoreStore()
    await misStore.fetchSkills()
    const entry = misStore.skills.find((s) => s.id === id)
    if (!entry) {
      throw new Error(
        `skills.install: skill "${id}" not found in MisStore (try misstore.search first)`,
      )
    }
    await misStore.installSkill(entry)
    return {
      id: entry.id,
      name: entry.name,
      mode: entry.mode ?? 'manual',
      installed: true,
    }
  },
}

/**
 * `skills.uninstall` — インストール済みスキルを完全削除する。
 *
 * 安全弁: builtIn skill (= NoteDeck 標準同梱) は削除を拒否する。
 * AI が誤って自己定義 (= 自分が立脚している persona) を消すのを防ぐ。
 */
export const skillsUninstallCapability: Command = {
  id: 'skills.uninstall',
  label: 'スキルを削除',
  icon: 'ti-trash',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['skills.write'],
  requiresConfirmation: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) return null
    const cur = useSkillsStore().skills.find((s) => s.id === id)
    if (!cur) return null
    if (cur.builtIn) return null
    return {
      title: 'スキルを削除',
      message:
        `${cur.name} (v${cur.version} / ${cur.mode} mode) を完全に削除します。` +
        ' frontmatter・本文・編集履歴ファイルは残りません (= 不可逆)。',
      installPreview: {
        kind: 'skill',
        name: cur.name,
        version: cur.version,
        description: `${cur.mode} mode / ${cur.scope} scope`,
      },
      okLabel: '削除',
      cancelLabel: 'やめる',
      type: 'danger',
    }
  },
  signature: {
    description:
      'インストール済みスキルを完全削除する。builtIn (NoteDeck 標準同梱) skill は' +
      ' 削除拒否される (= 安全弁)。MisStore 経由 install したものは普通に消せる。',
    params: {
      id: { type: 'string', description: '削除するスキルの id' },
    },
    returns: {
      type: 'object',
      description: '{ id, removed: boolean }',
    },
  },
  visible: false,
  execute: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('skills.uninstall: id is required')
    const store = useSkillsStore()
    const skill = store.skills.find((s) => s.id === id)
    if (!skill) {
      throw new Error(`skills.uninstall: skill "${id}" is not installed`)
    }
    if (skill.builtIn) {
      throw new Error(
        `skills.uninstall: cannot remove built-in skill "${id}" (safety guard)`,
      )
    }
    store.remove(id)
    return { id, removed: true }
  },
}

export const SKILLS_BUILTIN_CAPABILITIES: readonly Command[] = [
  skillsListCapability,
  skillsReadCapability,
  skillsAppendCapability,
  skillsReplaceSectionCapability,
  skillsToggleCapability,
  skillsInstallCapability,
  skillsUninstallCapability,
  skillsHistoryCapability,
  skillsRevertCapability,
]

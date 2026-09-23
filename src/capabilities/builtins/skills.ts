import type { Command } from '@/commands/registry'
import { appendBlock, replaceMarkdownSection } from '@/services/selfEditApply'
import { useMisStoreStore } from '@/stores/misstore'
import {
  generateSkillId,
  type SkillMode,
  useSkillsStore,
} from '@/stores/skills'
import { getSnapshotAt, listSnapshots } from '@/utils/historyFs'
import { implement } from '../declare'
import { editAttribution } from '../editAttribution'
import { stageEdit, takeStagedEdit } from '../stagedEdit'

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
 * - frontmatter (id / version / mode / builtIn / isPersona) は
 *   触らせない。本文 markdown のみ編集対象
 * - 全文置換は破壊的なので append / replaceSection を提供 (memory 推奨)
 * - 編集系は requiresConfirmation: true (= ユーザー承認後に書込)
 * - Phase 1 では「どの skill を編集できるか」は permission レベル管理
 *   (scope 制限 = persona の自分の skill だけ、は Phase 2)
 */

export const skillsListCapability = implement('skills.list', {
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
})

export const skillsReadCapability = implement('skills.read', {
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
})

function normalizeSkillMode(v: unknown): SkillMode {
  return v === 'always' ||
    v === 'trigger' ||
    v === 'heartbeat' ||
    v === 'manual'
    ? v
    : 'manual'
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map(String).filter((s) => s.length > 0)
}

/**
 * `skills.create` — 新規スキルの作成 (#726)。
 *
 * 設計判断:
 * - 冒頭コメントの「frontmatter は AI に触らせない」は維持する。raw
 *   frontmatter は受け取らず、ホワイトリスト化した構造化パラメータのみ
 *   受ける。builtIn / isPersona / storeId はパラメータに存在しない
 *   (= 物理的に付与不可能)
 * - 新規作成専用。id は内部生成 (generateSkillId) で AI に選ばせない
 *   (= 将来の built-in id の先取り占拠や既存スキルの上書きを構造的に排除)。
 *   self-edit は従来どおり append / replaceSection の領分
 * - mode=always / heartbeat は保存直後から AI の指示ストリームに自動合流
 *   するため warning 型 confirm にする
 * - mode=trigger で triggers 空は永久に発火しない死にスキルになるので拒否
 *   (ファイル読込側 metaFromFrontmatter が寛容なのはユーザー手書きファイルで
 *   起動を落とさないため。create は AI がエラーを読んでリトライできる)
 * - cheapCheckCapabilities は素通しで保存する。cheap=true でない id は
 *   HEARTBEAT runner 側が無視する既存フィルタに委ねる
 */
export const skillsCreateCapability = implement('skills.create', {
  requiresConfirmation: (params) => {
    const name = typeof params?.name === 'string' ? params.name.trim() : ''
    const body = typeof params?.body === 'string' ? params.body : ''
    if (!name || !body.trim()) return null
    const mode = normalizeSkillMode(params?.mode)
    const triggers = toStringArray(params?.triggers)
    const modeNote =
      mode === 'always'
        ? ' mode=always: 保存後は常に system prompt に注入されます。'
        : mode === 'heartbeat'
          ? ' mode=heartbeat: HEARTBEAT 有効中、tick ごとに自動実行されます。'
          : mode === 'trigger'
            ? ` (mode=trigger: 「${triggers.join('」「')}」で自動ロード)`
            : ' (mode=manual: 有効化するまで使われません)'
    return {
      title: 'スキルを作成',
      message: `AI が生成したスキル「${name}」を新規保存します。${modeNote}`,
      installPreview: {
        kind: 'skill',
        name,
        version: '0.1.0',
        description: `${mode} mode`,
      },
      code: body,
      codeLanguage: 'markdown',
      okLabel: '作成',
      cancelLabel: 'やめる',
      type: mode === 'always' || mode === 'heartbeat' ? 'warning' : 'normal',
    }
  },
  execute: (params) => {
    const name = typeof params?.name === 'string' ? params.name.trim() : ''
    const body = typeof params?.body === 'string' ? params.body : ''
    if (!name) throw new Error('skills.create: name is required')
    if (!body.trim()) throw new Error('skills.create: body is required')
    if (/^---\r?\n/.test(body)) {
      throw new Error(
        'skills.create: body must not start with a frontmatter block (---). ' +
          'mode / triggers / description はパラメータで渡すこと',
      )
    }
    const mode = normalizeSkillMode(params?.mode)
    const triggers = toStringArray(params?.triggers)
    if (mode === 'trigger' && triggers.length === 0) {
      throw new Error(
        'skills.create: mode="trigger" requires non-empty triggers ' +
          '(= 永久に発火しないスキルになる)',
      )
    }
    const description =
      typeof params?.description === 'string' && params.description
        ? params.description
        : undefined
    const store = useSkillsStore()
    let id = generateSkillId(name)
    while (store.skills.some((s) => s.id === id)) id = generateSkillId(name)
    const skill = store.add({
      id,
      name,
      version: '0.1.0',
      description,
      mode,
      triggers,
      body,
      cheapCheckCapabilities: toStringArray(params?.cheapCheckCapabilities),
    })
    return { id: skill.id, name: skill.name, mode: skill.mode }
  },
})

export const skillsAppendCapability = implement('skills.append', {
  requiresConfirmation: (params, ctx) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    const content = typeof params?.content === 'string' ? params.content : ''
    const cur = useSkillsStore().skills.find((s) => s.id === id)
    if (!cur) return null
    // 追記断片ではなく適用後の全文を見せる (#981 確定 2)。どこに何が入るかは
    // 既存本文と並べないと判断できない。
    const next = stageEdit(ctx, cur.body, appendBlock(cur.body, content))
    return {
      title: 'スキル本文に追記',
      message:
        `${cur.name} の本文に ${content.length} 文字を追記します。` +
        ' frontmatter は触れません。',
      installPreview: {
        kind: 'skill',
        name: cur.name,
        version: cur.version,
        description: `${cur.mode} mode`,
      },
      diff: { old: cur.body, new: next, language: 'markdown' },
      okLabel: '追記',
      cancelLabel: 'やめる',
      type: 'normal',
    }
  },
  execute: (params, ctx) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    const content = typeof params?.content === 'string' ? params.content : ''
    if (!id) throw new Error('skills.append: id is required')
    if (!content) throw new Error('skills.append: content is required')
    const store = useSkillsStore()
    const skill = store.skills.find((s) => s.id === id)
    if (!skill) throw new Error(`skills.append: skill "${id}" not found`)
    const newBody = takeStagedEdit(ctx, 'skills.append', skill.body, () =>
      appendBlock(skill.body, content),
    )
    store.update(id, { body: newBody }, editAttribution(ctx, params))
    return { id, length: newBody.length }
  },
})

/**
 * markdown の `## <heading>` セクションを置換する。指定 heading が
 * 見つからない場合は本文末尾に新規セクションとして追加する (= idempotent)。
 *
 * セクションは `## <heading>` から次の同レベル以上の見出し (= `## ` / `# `)
 * までを 1 つの単位として扱う。
 */
export const skillsReplaceSectionCapability = implement(
  'skills.replaceSection',
  {
    requiresConfirmation: (params, ctx) => {
      const id = typeof params?.id === 'string' ? params.id : ''
      const heading = typeof params?.heading === 'string' ? params.heading : ''
      const content = typeof params?.content === 'string' ? params.content : ''
      const cur = useSkillsStore().skills.find((s) => s.id === id)
      if (!cur) return null
      // 置換で消える旧セクションの本文は、全文 diff にしないと見えない (#981)
      const next = stageEdit(
        ctx,
        cur.body,
        replaceMarkdownSection(cur.body, heading, content).body,
      )
      return {
        title: 'スキルのセクションを置換',
        message:
          `${cur.name} の \`## ${heading}\` セクションを ${content.length} 文字に置換します。` +
          ' 該当 heading が無ければ末尾に新規追加します (idempotent)。',
        installPreview: {
          kind: 'skill',
          name: cur.name,
          version: cur.version,
          description: `${cur.mode} mode`,
        },
        diff: { old: cur.body, new: next, language: 'markdown' },
        okLabel: '置換',
        cancelLabel: 'やめる',
        type: 'warning',
      }
    },
    execute: (params, ctx) => {
      const id = typeof params?.id === 'string' ? params.id : ''
      const heading = typeof params?.heading === 'string' ? params.heading : ''
      const content = typeof params?.content === 'string' ? params.content : ''
      if (!id) throw new Error('skills.replaceSection: id is required')
      if (!heading)
        throw new Error('skills.replaceSection: heading is required')
      const store = useSkillsStore()
      const skill = store.skills.find((s) => s.id === id)
      if (!skill) {
        throw new Error(`skills.replaceSection: skill "${id}" not found`)
      }
      const computed = replaceMarkdownSection(skill.body, heading, content)
      const body = takeStagedEdit(
        ctx,
        'skills.replaceSection',
        skill.body,
        () => computed.body,
      )
      store.update(id, { body }, editAttribution(ctx, params))
      return { id, replaced: computed.replaced, length: body.length }
    },
  },
)

export const skillsToggleCapability = implement('skills.toggle', {
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
})

export const skillsHistoryCapability = implement('skills.history', {
  execute: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('skills.history: id is required')
    const store = useSkillsStore()
    const skill = store.skills.find((s) => s.id === id)
    if (!skill) throw new Error(`skills.history: skill "${id}" not found`)
    // 履歴キーは対応表の fileBase (#913)。未割当なら旧キーに落ちる
    const basename = skill.fileBase ?? (skill.name || skill.id)
    return await listSnapshots<SkillSnapshot>('skill', basename)
  },
})

export const skillsRevertCapability = implement('skills.revert', {
  requiresConfirmation: async (params, ctx) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    const index = typeof params?.index === 'number' ? params.index : -1
    const cur = useSkillsStore().skills.find((s) => s.id === id)
    if (!cur || index < 0) return null
    const basename = cur.fileBase ?? (cur.name || cur.id)
    const entry = await getSnapshotAt<SkillSnapshot>('skill', basename, index)
    if (!entry) return null
    const next = stageEdit(ctx, cur.body, entry.snapshot.body)
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
        description: `${cur.mode} mode`,
      },
      diff: { old: cur.body, new: next, language: 'markdown' },
      okLabel: 'この状態に戻す',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  execute: async (params, ctx) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    const index = typeof params?.index === 'number' ? params.index : -1
    if (!id) throw new Error('skills.revert: id is required')
    if (index < 0) throw new Error('skills.revert: index must be >= 0')
    const store = useSkillsStore()
    const skill = store.skills.find((s) => s.id === id)
    if (!skill) throw new Error(`skills.revert: skill "${id}" not found`)
    const basename = skill.fileBase ?? (skill.name || skill.id)
    const entry = await getSnapshotAt<SkillSnapshot>('skill', basename, index)
    if (!entry) {
      throw new Error(`skills.revert: no snapshot at index ${index}`)
    }
    const body = takeStagedEdit(
      ctx,
      'skills.revert',
      skill.body,
      () => entry.snapshot.body,
    )
    store.update(id, { body }, editAttribution(ctx, params))
    return { id, reverted: true, at: entry.at }
  },
})

/**
 * `skills.install` — MisStore (store.notedeck.io) から既製 skill を取得して
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
export const skillsInstallCapability = implement('skills.install', {
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
})

/**
 * `skills.uninstall` — インストール済みスキルを完全削除する。
 *
 * 同梱 skill は廃止したので (#746)、削除できない skill は無い。不可逆操作の
 * 保護は確認ダイアログ (削除内容と「残りません」の明示) が担う。
 */
export const skillsUninstallCapability = implement('skills.uninstall', {
  requiresConfirmation: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) return null
    const cur = useSkillsStore().skills.find((s) => s.id === id)
    if (!cur) return null
    return {
      title: 'スキルを削除',
      message:
        `${cur.name} (v${cur.version} / ${cur.mode} mode) を完全に削除します。` +
        ' frontmatter・本文・編集履歴ファイルは残りません (= 不可逆)。',
      installPreview: {
        kind: 'skill',
        name: cur.name,
        version: cur.version,
        description: `${cur.mode} mode`,
      },
      okLabel: '削除',
      cancelLabel: 'やめる',
      type: 'danger',
    }
  },
  execute: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('skills.uninstall: id is required')
    const store = useSkillsStore()
    const skill = store.skills.find((s) => s.id === id)
    if (!skill) {
      throw new Error(`skills.uninstall: skill "${id}" is not installed`)
    }
    store.remove(id)
    return { id, removed: true }
  },
})

export const SKILLS_BUILTIN_CAPABILITIES: readonly Command[] = [
  skillsListCapability,
  skillsReadCapability,
  skillsCreateCapability,
  skillsAppendCapability,
  skillsReplaceSectionCapability,
  skillsToggleCapability,
  skillsInstallCapability,
  skillsUninstallCapability,
  skillsHistoryCapability,
  skillsRevertCapability,
]

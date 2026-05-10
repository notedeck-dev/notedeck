import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import * as settingsFs from '@/utils/settingsFs'
import { parseSkillFile, serializeSkillFile } from '@/utils/skillFrontmatter'
import { getStorageJson, STORAGE_KEYS, setStorageJson } from '@/utils/storage'

/**
 * Skill 実行モード:
 * - `always`: AI セッション開始時に常に system prompt に注入
 * - `manual`: ユーザーが UI からトグルしたときだけ active
 * - `trigger`: triggers[] にマッチした時だけ active (将来用)
 * - `heartbeat`: AI 設定の heartbeat 有効化中、tick ごとに body を AI に読ませる
 *   (OpenClaw HEARTBEAT.md 相当 / #411)
 */
export type SkillMode = 'always' | 'manual' | 'trigger' | 'heartbeat'
export type SkillScope = 'global' | 'per-account'

export interface SkillMeta {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  mode: SkillMode
  triggers: string[]
  scope: SkillScope
  installedFor?: string[]
  storeId?: string
  /** Markdown 本文 (frontmatter を除いた指示文) */
  body: string
  createdAt: number
  updatedAt: number
  /** 内蔵テンプレ由来 (アンインストールではなく無効化が推奨される) */
  builtIn?: boolean
  /** スキル個別アイコン URL (MisStore registry の iconUrl 互換) */
  iconUrl?: string
  /**
   * HEARTBEAT Cheap Check First (#411): tick 開始時に呼んで「変化検知」
   * に使う capability id 配列。指定された capability は cheap=true な
   * もののみ受け入れられる (重い API は無視)。
   *
   * - 空配列 (default) = cheap check 機構を発動しない (= 毎回 AI を叩く)
   * - 1 個以上指定 = それらの結果を JSON.stringify で前回値と比較し、
   *   変化なしなら AI を skip して HEARTBEAT_OK 扱い
   *
   * mode='heartbeat' な skill にのみ意味がある。
   * 型は常に `string[]` (空配列含む) — `triggers` と同じパターン。
   */
  cheapCheckCapabilities: string[]
  /**
   * Persona-eligible flag (#491): この skill を AI session の persona
   * 候補として扱うか。true のとき:
   * - AI session のチャットヘッダ persona セレクタに表示される
   * - session.personaSkillId として選ばれると `<persona>` block が
   *   system prompt に注入され、authorId='skill:<id>' の memo を作れる
   *
   * skill.iconUrl は「skill そのもののアイコン」(例: 翻訳 skill のレンチ)、
   * persona の avatar は「想起されるキャラクターの顔」と意味が違うので、
   * iconUrl 有無ではなく明示フラグで判別する。
   *
   * 未指定 = false。
   */
  isPersona?: boolean
}

export function generateSkillId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  const slug = base || 'skill'
  return `${slug}-${Math.random().toString(36).slice(2, 6)}`
}

interface SkillFrontmatter {
  id?: string
  name?: string
  version?: string
  description?: string
  author?: string
  mode?: string
  triggers?: string[]
  scope?: string
  installedFor?: string[]
  storeId?: string
  builtIn?: boolean
  createdAt?: number
  updatedAt?: number
  iconUrl?: string
  cheapCheckCapabilities?: string[]
  isPersona?: boolean
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string' && v) return [v]
  return []
}

function frontmatterFromMeta(skill: SkillMeta): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: skill.id,
    name: skill.name,
    version: skill.version,
    mode: skill.mode,
    scope: skill.scope,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  }
  if (skill.description) out.description = skill.description
  if (skill.author) out.author = skill.author
  if (skill.triggers.length > 0) out.triggers = skill.triggers
  if (skill.installedFor && skill.installedFor.length > 0) {
    out.installedFor = skill.installedFor
  }
  if (skill.storeId) out.storeId = skill.storeId
  if (skill.builtIn) out.builtIn = true
  if (skill.iconUrl) out.iconUrl = skill.iconUrl
  if (skill.cheapCheckCapabilities && skill.cheapCheckCapabilities.length > 0) {
    out.cheapCheckCapabilities = skill.cheapCheckCapabilities
  }
  if (skill.isPersona) out.isPersona = true
  return out
}

function metaFromFrontmatter(
  fm: SkillFrontmatter,
  body: string,
  fallbackId: string,
): SkillMeta {
  const now = Date.now()
  const mode: SkillMode =
    fm.mode === 'always' ||
    fm.mode === 'trigger' ||
    fm.mode === 'heartbeat' ||
    fm.mode === 'manual'
      ? fm.mode
      : 'manual'
  const scope = (
    fm.scope === 'per-account' ? 'per-account' : 'global'
  ) as SkillScope
  return {
    id: fm.id || fallbackId,
    name: fm.name || fallbackId,
    version: fm.version || '0.1.0',
    description: fm.description,
    author: fm.author,
    mode,
    triggers: asArray(fm.triggers),
    scope,
    installedFor:
      scope === 'per-account' ? asArray(fm.installedFor) : undefined,
    storeId: fm.storeId,
    body,
    createdAt: fm.createdAt ?? now,
    updatedAt: fm.updatedAt ?? now,
    builtIn: !!fm.builtIn,
    iconUrl: fm.iconUrl,
    cheapCheckCapabilities: asArray(fm.cheapCheckCapabilities),
    isPersona: !!fm.isPersona,
  }
}

/**
 * 内部関数の test 用 export。プロダクトコードから直接呼ばないこと
 * (公開 API は store の `add` / `setHeartbeat` 等を使う)。
 */
export const _internal = {
  metaFromFrontmatter,
  frontmatterFromMeta,
}

interface BuiltInTemplate {
  id: string
  filename: string
  raw: string
}

/**
 * Built-in skill templates bundled with the app. Seeded on first run so the
 * skill カラム is never empty out-of-the-box.
 */
async function loadBuiltInTemplates(): Promise<BuiltInTemplate[]> {
  const modules = import.meta.glob('@/defaults/skills/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  })
  const out: BuiltInTemplate[] = []
  for (const [path, raw] of Object.entries(modules)) {
    const filename = path.split('/').pop() ?? ''
    const id = filename.replace(/\.md$/, '')
    out.push({ id, filename, raw: raw as string })
  }
  return out
}

export const useSkillsStore = defineStore('skills', () => {
  const skills = ref<SkillMeta[]>([])
  const activeIds = ref<string[]>(
    getStorageJson<string[]>(STORAGE_KEYS.skillsActive, []),
  )
  const initialized = ref(false)
  let loaded = false

  function ensureLoaded() {
    if (loaded) return
    loaded = true
    if (settingsFs.isTauri) {
      initFileStorage().catch((e) =>
        console.warn('[skills] file storage init failed:', e),
      )
    } else {
      initialized.value = true
    }
  }

  function persistActive() {
    setStorageJson(STORAGE_KEYS.skillsActive, activeIds.value)
  }

  function isActive(id: string): boolean {
    return activeIds.value.includes(id)
  }

  function setActive(id: string, active: boolean) {
    ensureLoaded()
    const has = activeIds.value.includes(id)
    if (active && !has) {
      activeIds.value = [...activeIds.value, id]
      persistActive()
    } else if (!active && has) {
      activeIds.value = activeIds.value.filter((x) => x !== id)
      persistActive()
    }
  }

  /** mode='always' のスキルは常に active 扱い (UI でトグル不可)。 */
  const effectiveActiveIds = computed(() => {
    const set = new Set(activeIds.value)
    for (const s of skills.value) {
      if (s.mode === 'always') set.add(s.id)
    }
    return Array.from(set)
  })

  /**
   * Phase 2 で AI provider に渡す system prompt を組み立てるためのヘルパ。
   * mode='always' + 明示的に active な mode='manual' のスキルを宣言順で結合する。
   *
   * #491 拡張:
   * - `extraSkillIds`: session-only に追加する skill (= activeIds を汚さず
   *   その session だけで含める。session.personaSkillId 注入で使う)
   * - `excludePersonaSkillsExcept`: 指定 id 以外の `isPersona: true` skill を
   *   除外 (= 複数 always-persona があるとき session の persona 以外を抑制)
   */
  function composedSystemPrompt(
    extraSkillIds: readonly string[] = [],
    excludePersonaSkillsExcept?: string,
  ): string {
    const set = new Set(effectiveActiveIds.value)
    for (const id of extraSkillIds) set.add(id)
    return skills.value
      .filter((s) => set.has(s.id))
      .filter((s) => {
        if (excludePersonaSkillsExcept === undefined) return true
        if (!s.isPersona) return true
        return s.id === excludePersonaSkillsExcept
      })
      .map((s) => s.body.trim())
      .filter((b) => b.length > 0)
      .join('\n\n')
  }

  async function persist(skill: SkillMeta): Promise<void> {
    if (!settingsFs.isTauri) return
    const fm = frontmatterFromMeta(skill)
    const content = serializeSkillFile(
      fm as Record<string, string | number | boolean | string[]>,
      skill.body,
    )
    const filename = settingsFs.skillFilename(skill.id)
    await settingsFs.writeSkillFile(filename, content)
  }

  async function deleteFile(skill: SkillMeta): Promise<void> {
    if (!settingsFs.isTauri) return
    const filename = settingsFs.skillFilename(skill.id)
    try {
      await settingsFs.deleteSkillFile(filename)
    } catch (e) {
      console.warn('[skills] failed to delete skill file:', e)
    }
  }

  async function initFileStorage(): Promise<void> {
    const files = await settingsFs.listSkillFiles()
    const fileSkills: SkillMeta[] = []
    for (const filename of files) {
      try {
        const raw = await settingsFs.readSkillFile(filename)
        const { meta, body } = parseSkillFile(raw)
        const fallbackId = filename.replace(/\.md$/, '')
        fileSkills.push(
          metaFromFrontmatter(meta as SkillFrontmatter, body, fallbackId),
        )
      } catch (e) {
        console.warn(`[skills] failed to parse ${filename}:`, e)
      }
    }
    fileSkills.sort((a, b) => a.createdAt - b.createdAt)

    if (fileSkills.length === 0) {
      await seedBuiltIns()
    } else {
      skills.value = fileSkills
      await migrateLegacyAizu()
      await seedMissingBuiltIns()
    }

    initialized.value = true
  }

  async function seedBuiltIns(): Promise<void> {
    const templates = await loadBuiltInTemplates()
    const seeded: SkillMeta[] = []
    for (const tpl of templates) {
      const { meta, body } = parseSkillFile(tpl.raw)
      const fm = meta as SkillFrontmatter
      const skill = metaFromFrontmatter(fm, body, tpl.id)
      skill.builtIn = true
      seeded.push(skill)
    }
    skills.value = seeded
    await Promise.all(seeded.map((s) => persist(s)))
    setStorageJson(
      STORAGE_KEYS.skillsSeededBuiltins,
      seeded.map((s) => s.id),
    )
  }

  /**
   * 既に skill ディレクトリに何か入っている既存ユーザー向けに、後から
   * 追加された built-in テンプレを補填する。
   *
   * 「過去 seed した id」を localStorage に蓄積しているので、ユーザーが
   * 内蔵 skill を意図的に削除した場合は再生成しない (= seed 済 id は永続)。
   * 新しく defaults/skills/ に追加された未知 id だけが対象になる。
   */
  async function seedMissingBuiltIns(): Promise<void> {
    const templates = await loadBuiltInTemplates()
    const seenIds = new Set(skills.value.map((s) => s.id))
    const previouslySeeded = new Set(
      getStorageJson<string[]>(STORAGE_KEYS.skillsSeededBuiltins, []),
    )

    const toAdd: SkillMeta[] = []
    for (const tpl of templates) {
      const { meta, body } = parseSkillFile(tpl.raw)
      const fm = meta as SkillFrontmatter
      const skill = metaFromFrontmatter(fm, body, tpl.id)
      skill.builtIn = true
      // 既に同 id の skill ファイルがある: 何もしない (ユーザー編集を尊重)
      if (seenIds.has(skill.id)) {
        previouslySeeded.add(skill.id)
        continue
      }
      // 過去に seed したことがある = ユーザーが削除した: 再生成しない
      if (previouslySeeded.has(skill.id)) continue
      toAdd.push(skill)
    }

    if (toAdd.length === 0) {
      // seenIds 経由で既知の id を `previouslySeeded` に追加した分は永続化
      setStorageJson(
        STORAGE_KEYS.skillsSeededBuiltins,
        Array.from(previouslySeeded),
      )
      return
    }

    skills.value = [...skills.value, ...toAdd]
    await Promise.all(toAdd.map((s) => persist(s)))
    for (const s of toAdd) previouslySeeded.add(s.id)
    setStorageJson(
      STORAGE_KEYS.skillsSeededBuiltins,
      Array.from(previouslySeeded),
    )
  }

  /**
   * 旧 built-in aizu (mode='always', builtIn=true, ローカル iconUrl) を
   * MisStore 配布版相当 (mode='manual', builtIn=false, storeId='aizu', remote iconUrl)
   * に変換し、ユーザーが任意に有効/無効化できるようにする。
   */
  async function migrateLegacyAizu(): Promise<void> {
    const idx = skills.value.findIndex(
      (s) => s.id === 'aizu' && s.builtIn === true,
    )
    if (idx < 0) return
    const current = skills.value[idx]
    if (!current) return
    const migrated: SkillMeta = {
      ...current,
      mode: 'manual',
      builtIn: false,
      storeId: 'aizu',
      iconUrl: 'https://misstore.hital.in/registry/skills/aizu/icon.svg',
      updatedAt: Date.now(),
    }
    skills.value = [
      ...skills.value.slice(0, idx),
      migrated,
      ...skills.value.slice(idx + 1),
    ]
    await persist(migrated)
  }

  function get(id: string): SkillMeta | undefined {
    ensureLoaded()
    return skills.value.find((s) => s.id === id)
  }

  function add(input: Omit<SkillMeta, 'createdAt' | 'updatedAt'>): SkillMeta {
    ensureLoaded()
    const now = Date.now()
    const skill: SkillMeta = { ...input, createdAt: now, updatedAt: now }
    skills.value = [...skills.value, skill]
    if (initialized.value) {
      persist(skill).catch((e) =>
        console.warn('[skills] failed to persist new skill:', e),
      )
    }
    return skill
  }

  function update(id: string, patch: Partial<SkillMeta>): void {
    ensureLoaded()
    const idx = skills.value.findIndex((s) => s.id === id)
    if (idx < 0) return
    const current = skills.value[idx]
    if (!current) return
    const updated: SkillMeta = {
      ...current,
      ...patch,
      id,
      updatedAt: Date.now(),
    }
    skills.value = [
      ...skills.value.slice(0, idx),
      updated,
      ...skills.value.slice(idx + 1),
    ]
    if (initialized.value) {
      persist(updated).catch((e) =>
        console.warn('[skills] failed to persist update:', e),
      )
    }
  }

  function remove(id: string): void {
    ensureLoaded()
    const target = skills.value.find((s) => s.id === id)
    if (!target) return
    skills.value = skills.value.filter((s) => s.id !== id)
    if (initialized.value) deleteFile(target)
  }

  function removeWithMigration(id: string): void {
    remove(id)
    setActive(id, false)
  }

  // --- HEARTBEAT (#411) ---

  /**
   * `mode: 'heartbeat'` の skill 一覧。runner が tick ごとにこれを
   * 読んで AI に渡す。順序は skills の宣言順を保つ。
   */
  const heartbeatSkills = computed(() =>
    skills.value.filter((s) => s.mode === 'heartbeat'),
  )

  /**
   * skill の HEARTBEAT 対象を on/off する。enabled=true で mode='heartbeat'、
   * false で mode='manual' に戻す (always / trigger は専用設定なので保持しない)。
   * frontmatter にも書き戻され永続化される。
   */
  function setHeartbeat(id: string, enabled: boolean): void {
    update(id, { mode: enabled ? 'heartbeat' : 'manual' })
  }

  return {
    skills,
    activeIds,
    effectiveActiveIds,
    initialized,
    ensureLoaded,
    isActive,
    setActive,
    composedSystemPrompt,
    get,
    add,
    update,
    remove: removeWithMigration,
    heartbeatSkills,
    setHeartbeat,
  }
})

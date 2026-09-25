import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { emitNoteDeckEvent } from '@/aiscript/events'
import { injectFrontmatterId } from '@/services/idFreeze'
import { registerSettingsFileHandler } from '@/services/settingsFileSync'
import { createSingleFileCollection } from '@/services/singleFileCollection'
import { planStoreMovedMigration } from '@/services/storeMovedSkills'
import { type EditAttribution, pushSnapshot } from '@/utils/historyFs'
import * as settingsFs from '@/utils/settingsFs'
import {
  type ParsedSkillFile,
  parseSkillFile,
  serializeSkillFile,
} from '@/utils/skillFrontmatter'
import { getStorageJson, removeStorage, STORAGE_KEYS } from '@/utils/storage'
import { notifyWarningToast } from '@/utils/toastNotify'

/**
 * Skill 実行モード:
 * - `always`: AI セッション開始時に常に system prompt に注入
 * - `manual`: ユーザーが UI からトグルしたときだけ active
 * - `trigger`: user 入力に triggers[] のいずれかが部分一致したら active 化し、
 *   そのセッション中は維持される (#725 session-sticky)。
 *   `triggerMatchingSkillIds` で判定 → session の triggeredSkillIds に累積 →
 *   `composedSystemPrompt` の extraSkillIds 経由で注入する
 * - `heartbeat`: AI 設定の heartbeat 有効化中、tick ごとに body を AI に読ませる
 *   (OpenClaw HEARTBEAT.md 相当 / #411)
 */
export type SkillMode = 'always' | 'manual' | 'trigger' | 'heartbeat'

export interface SkillMeta {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  mode: SkillMode
  triggers: string[]
  /**
   * 本体の有効 (#1116)。有効のときだけ frontmatter に書く省略書式 (値が無い =
   * 無効。従来の「有効一覧に無ければ無効」と同じ既定)。mode='always' は
   * この印に関係なく常時有効。プラグイン・クエリと同じくファイルが正で、
   * 設定バックアップにそのまま乗る
   */
  active?: boolean
  storeId?: string
  /** インストール/更新時に照合済みの配布ソース SHA-512 (#913。更新検知 #1040 の baseline) */
  storeSha512?: string
  /** インストール/更新時の registry バージョン (#913) */
  storeVersion?: string
  /** Markdown 本文 (frontmatter を除いた指示文) */
  body: string
  createdAt: number
  updatedAt: number
  /**
   * 旧・内蔵テンプレ由来 (#746 で同梱は廃止)。手元に残った旧同梱 skill を
   * ストア配布版へ移行する判定にだけ使う。新しく true になる経路は無い
   */
  builtIn?: boolean
  /** スキル個別アイコン URL (MisStore registry の iconUrl 互換) */
  iconUrl?: string
  /**
   * tainted なセッション (他人の内容を読んだ後の AI) が書いた (#1103)。
   * 一度付いたら外れない。注入 / 読取したセッションを tainted にする
   */
  tainted?: boolean
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
  /**
   * 実ファイル basename (#913 の ID → ファイル名対応表)。runtime-only —
   * frontmatter には書かない (frontmatterFromMeta に含めないこと)。
   */
  fileBase?: string
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
  active?: boolean
  storeId?: string
  storeSha512?: string
  storeVersion?: string
  builtIn?: boolean
  createdAt?: number
  updatedAt?: number
  iconUrl?: string
  cheapCheckCapabilities?: string[]
  isPersona?: boolean
  tainted?: boolean
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
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  }
  if (skill.description) out.description = skill.description
  if (skill.author) out.author = skill.author
  if (skill.triggers.length > 0) out.triggers = skill.triggers
  if (skill.active) out.active = true
  if (skill.storeId) out.storeId = skill.storeId
  if (skill.storeSha512) out.storeSha512 = skill.storeSha512
  if (skill.storeVersion) out.storeVersion = skill.storeVersion
  if (skill.builtIn) out.builtIn = true
  if (skill.iconUrl) out.iconUrl = skill.iconUrl
  if (skill.cheapCheckCapabilities && skill.cheapCheckCapabilities.length > 0) {
    out.cheapCheckCapabilities = skill.cheapCheckCapabilities
  }
  if (skill.isPersona) out.isPersona = true
  if (skill.tainted) out.tainted = true
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
  return {
    id: fm.id || fallbackId,
    name: fm.name || fallbackId,
    version: fm.version || '0.1.0',
    description: fm.description,
    author: fm.author,
    mode,
    triggers: asArray(fm.triggers),
    ...(fm.active === true ? { active: true } : {}),
    storeId: fm.storeId,
    storeSha512: fm.storeSha512,
    storeVersion: fm.storeVersion,
    body,
    createdAt: fm.createdAt ?? now,
    updatedAt: fm.updatedAt ?? now,
    builtIn: !!fm.builtIn,
    iconUrl: fm.iconUrl,
    cheapCheckCapabilities: asArray(fm.cheapCheckCapabilities),
    isPersona: !!fm.isPersona,
    ...(fm.tainted === true ? { tainted: true } : {}),
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

function serializeSkill(skill: SkillMeta): string {
  const fm = frontmatterFromMeta(skill)
  return serializeSkillFile(
    fm as Record<string, string | number | boolean | string[]>,
    skill.body,
  )
}

/**
 * skill (`skills/<base>.md` 単一ファイル・frontmatter が meta) の永続化
 * (#913 で ID → ファイル名対応表化)。
 * ID 凍結の実効値 = 拡張子を除いた basename (現行 fallbackId と同値)。
 */
const skillFiles = createSingleFileCollection<SkillMeta, ParsedSkillFile>({
  logTag: 'skills',
  notify: notifyWarningToast,
  kindFallback: 'skill',
  ext: settingsFs.SKILL_EXT,
  // ストアインストールはファイル名 = storeId (#913。占有時は連番 suffix)。
  // builtin seed はテンプレ id (slug 適合) をそのままファイル名にする
  // (表示名 slug だと `notedeck.md` / `notedeck-2.md` に化けて意味が消える)
  preferredBase: (s) => s.storeId ?? (s.builtIn ? s.id : undefined),
  // 占有判定・sweep には .history.json5 を含む実列挙が要る
  // (規定拡張子の filter はコレクション側が行う)
  list: () => settingsFs.listSkillDirFiles(),
  read: (filename) => settingsFs.readSkillFile(filename),
  write: (filename, content) => settingsFs.writeSkillFile(filename, content),
  remove: (filename) => settingsFs.deleteSkillFile(filename),
  rename: (oldFilename, newFilename) =>
    settingsFs.renameSkillFile(oldFilename, newFilename),
  parse: (raw) => parseSkillFile(raw),
  rawIdOf: (p) => p.meta.id,
  effectiveIdOf: (_filename, base) => base,
  injectId: (raw, id) => injectFrontmatterId(raw, id),
  fromFile: (p, id, filename) =>
    metaFromFrontmatter(
      { ...(p.meta as SkillFrontmatter), id },
      p.body,
      filename.replace(/\.md$/, ''),
    ),
  displayNameOf: (p) => (typeof p.meta.name === 'string' ? p.meta.name : ''),
  idOf: (s) => s.id,
  nameOf: (s) => s.name,
  serialize: serializeSkill,
})

export const useSkillsStore = defineStore('skills', () => {
  const skills = ref<SkillMeta[]>([])
  const initialized = ref(false)

  // notecore が skill ファイルを書いた (AI の skills.* は notecore の本体が書く,
  // #1133) → そのファイルだけ読み直して写しを揃える。履歴ファイルは写しを
  // 持たないので無視する
  registerSettingsFileHandler('skills', async (change) => {
    if (!change.name.endsWith(settingsFs.SKILL_EXT)) return
    const base = change.name.slice(0, -settingsFs.SKILL_EXT.length)
    if (change.op === 'delete') {
      skills.value = skills.value.filter((s) => s.fileBase !== base)
      return
    }
    let raw: string
    try {
      raw = await settingsFs.readSkillFile(change.name)
    } catch (e) {
      console.warn(`[skills] reload ${change.name} failed:`, e)
      return
    }
    const parsed = parseSkillFile(raw)
    const id = typeof parsed.meta.id === 'string' ? parsed.meta.id : base
    const next: SkillMeta = {
      ...metaFromFrontmatter(
        { ...(parsed.meta as SkillFrontmatter), id },
        parsed.body,
        base,
      ),
      fileBase: base,
    }
    const idx = skills.value.findIndex(
      (s) => s.id === next.id || s.fileBase === base,
    )
    skills.value =
      idx >= 0
        ? skills.value.map((s, i) => (i === idx ? next : s))
        : [...skills.value, next]
    emitNoteDeckEvent('skill:edited', { id: next.id })
  })
  let loaded = false
  // 変更系操作 (新規作成・リネーム・保存・削除) のファイル反映は
  // 「初回読込 (対応表確定) + 初回移行」の完了を待つゲート (#913)
  let resolveReady: (() => void) | undefined
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  function ensureLoaded() {
    if (loaded) return
    loaded = true
    if (settingsFs.isTauri) {
      initFileStorage()
        .catch((e) => console.warn('[skills] file storage init failed:', e))
        .finally(() => resolveReady?.())
    } else {
      initialized.value = true
      resolveReady?.()
    }
  }

  function isActive(id: string): boolean {
    return skills.value.find((s) => s.id === id)?.active === true
  }

  /**
   * 本体の有効 / 無効 (#1116)。ファイルの frontmatter に持つ (以前は端末
   * ローカルの一覧で、バックアップに乗らなかった)。有効に戻すときは印ごと消す
   */
  function setActive(id: string, active: boolean) {
    ensureLoaded()
    const idx = skills.value.findIndex((s) => s.id === id)
    const current = skills.value[idx]
    if (!current) return
    if ((current.active === true) === active) return
    const { active: _omit, ...rest } = current
    const next: SkillMeta = active ? { ...rest, active: true } : rest
    skills.value = skills.value.map((s) => (s.id === id ? next : s))
    if (settingsFs.isTauri) {
      void ready
        .then(() => persist(next))
        .catch((e) => console.warn('[skills] failed to persist active:', e))
    }
  }

  /** mode='always' のスキルは常に active 扱い (UI でトグル不可)。 */
  const effectiveActiveIds = computed(() =>
    skills.value
      .filter((s) => s.mode === 'always' || s.active === true)
      .map((s) => s.id),
  )

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
  /** system prompt に合流する skill (composedSystemPrompt と同じ選び方) */
  function composedSkills(
    extraSkillIds: readonly string[] = [],
    excludePersonaSkillsExcept?: string,
  ): SkillMeta[] {
    const set = new Set(effectiveActiveIds.value)
    for (const id of extraSkillIds) set.add(id)
    return skills.value
      .filter((s) => set.has(s.id))
      .filter((s) => {
        if (excludePersonaSkillsExcept === undefined) return true
        if (!s.isPersona) return true
        return s.id === excludePersonaSkillsExcept
      })
  }

  function composedSystemPrompt(
    extraSkillIds: readonly string[] = [],
    excludePersonaSkillsExcept?: string,
  ): string {
    return composedSkills(extraSkillIds, excludePersonaSkillsExcept)
      .map((s) => s.body.trim())
      .filter((b) => b.length > 0)
      .join('\n\n')
  }

  /**
   * system prompt に合流する skill にラベル付き (tainted) が含まれるか (#1103)。
   * 含まれるなら、そのターンのセッションは文脈から tainted になる
   */
  function composedSkillsTainted(
    extraSkillIds: readonly string[] = [],
    excludePersonaSkillsExcept?: string,
  ): boolean {
    return composedSkills(extraSkillIds, excludePersonaSkillsExcept).some(
      (s) => s.tainted === true && s.body.trim().length > 0,
    )
  }

  /** ファイルへの直接反映 (初期化・seed 用。通常経路は ready ゲート越し)。 */
  async function persist(skill: SkillMeta): Promise<void> {
    if (!settingsFs.isTauri) return
    // ref の深い reactivity で skills.value の要素は proxy になるため、
    // 占有判定の「操作対象自身は占有とみなさない」参照一致が崩れないよう
    // live 要素 (proxy) を渡す (raw を渡すと自分の ID/fileBase が占有扱いに
    // なり preferredBase = id/storeId のファイル名へ無意味な suffix が付く)
    const live = skills.value.find((s) => s.id === skill.id) ?? skill
    await skillFiles.persistItem(live, skills.value)
  }

  async function initFileStorage(): Promise<void> {
    const { items: fileSkills } = await skillFiles.loadAll()
    fileSkills.sort((a, b) => a.createdAt - b.createdAt)

    if (fileSkills.length === 0) {
      // 同梱の skill はゼロ (#746 で全て MisStore 配布へ移した)。手元に何も
      // 無い状態が正しい初期状態で、追加はストアからのインストールで行う
      initialized.value = true
      return
    }

    // 初期化 (この async 関数が走る間) にメモリ追加された skill は残す
    const fileIds = new Set(fileSkills.map((s) => s.id))
    const memoryOnly = skills.value.filter((s) => !fileIds.has(s.id))
    skills.value = [...fileSkills, ...memoryOnly]

    // マイグレーション (#913) はメインウィンドウのみが実行する。冪等。
    // スキルは本文の localStorage ミラーが無いため (b) 再作成は非適用
    // (外部削除 = 削除確定)
    if (settingsFs.isMainDeckWindow()) {
      // (a) 規約外名の copy-adopt 正規化
      await skillFiles.migrateItems(skills.value)
      // 履歴 sweep: 主ファイルと対応の取れない .history.json5 を削除
      await skillFiles
        .sweepHistory()
        .catch((e) => console.warn('[skills] history sweep failed:', e))
    }

    await migrateLegacyAizu()
    await migrateStoreMovedBuiltIns()
    await migrateLegacyActiveList()
    initialized.value = true
  }

  /**
   * 端末ローカルにしか無かった有効一覧をファイルへ移す (#1116)。一度きり。
   * 一覧に載っていてファイルに印の無い個体だけ書き、終わったら一覧を消す
   */
  async function migrateLegacyActiveList(): Promise<void> {
    const legacy = getStorageJson<unknown>(STORAGE_KEYS.skillsActive, null)
    if (legacy === null) return
    // 壊れた値 (配列でない JSON) で初期化ごと止めない。捨てて先へ進む
    if (!Array.isArray(legacy)) {
      console.warn('[skills] legacy active list is not an array — discarded')
      removeStorage(STORAGE_KEYS.skillsActive)
      return
    }
    const ids = new Set(legacy.map(String))
    const changed: SkillMeta[] = []
    skills.value = skills.value.map((s) => {
      if (!ids.has(s.id) || s.active === true) return s
      const next = { ...s, active: true }
      changed.push(next)
      return next
    })
    await Promise.all(changed.map((s) => persist(s)))
    removeStorage(STORAGE_KEYS.skillsActive)
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
      iconUrl: 'https://store.notedeck.io/registry/skills/aizu/icon.svg',
      updatedAt: Date.now(),
    }
    skills.value = [
      ...skills.value.slice(0, idx),
      migrated,
      ...skills.value.slice(idx + 1),
    ]
    await persist(migrated)
  }

  /**
   * 同梱をやめた作者系 built-in (#969) を MisStore 配布版相当に変換する。
   * 判定は `@/services/storeMovedSkills` 側の純関数が持つ。
   */
  async function migrateStoreMovedBuiltIns(): Promise<void> {
    const { migrated, changed, changedSkills } = planStoreMovedMigration(
      skills.value,
      Date.now(),
    )
    if (!changed) return
    skills.value = migrated
    await Promise.all(changedSkills.map((s) => persist(s)))
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
    if (settingsFs.isTauri) {
      // 新規作成の fileBase は persistItem が割り当てる (storeId 優先 →
      // 表示名 slug。ファイル名は ID からでなく対応表から #913)。
      // ready 待ちで移行と直列化
      void ready
        .then(() => persist(skill))
        .catch((e) => console.warn('[skills] failed to persist new skill:', e))
    }
    return skill
  }

  function update(
    id: string,
    patch: Partial<SkillMeta>,
    attribution?: EditAttribution,
  ): void {
    ensureLoaded()
    const idx = skills.value.findIndex((s) => s.id === id)
    if (idx < 0) return
    const current = skills.value[idx]
    if (!current) return
    const prevSnapshot = {
      body: current.body,
      name: current.name,
      version: current.version,
      mode: current.mode,
    }
    const renamed =
      typeof patch.name === 'string' && patch.name !== current.name
    const updated: SkillMeta = {
      ...current,
      ...patch,
      id,
      updatedAt: Date.now(),
    }
    // snapshot が記録する範囲が動いたときだけ履歴に積む。内容が同じ保存で
    // 積むと、エディタのデバウンス自動保存がリングを使い潰し、意味のある
    // 編集前の状態が押し出される
    const snapshotChanged =
      prevSnapshot.body !== updated.body ||
      prevSnapshot.name !== updated.name ||
      prevSnapshot.version !== updated.version ||
      prevSnapshot.mode !== updated.mode
    skills.value = [
      ...skills.value.slice(0, idx),
      updated,
      ...skills.value.slice(idx + 1),
    ]
    if (settingsFs.isTauri) {
      void ready
        .then(async () => {
          // 直近の状態を参照する (連続 update では最後の閉包が最新を書く)
          const live = skills.value.find((s) => s.id === id)
          if (!live) return // 既に削除された
          // 編集前 snapshot を history sidecar に push。履歴キーは対応表の
          // fileBase (未割当 = ファイル未作成なら履歴も無し)
          if (live.fileBase && snapshotChanged) {
            await pushSnapshot(
              'skill',
              live.fileBase,
              prevSnapshot,
              attribution,
            )
          }
          // 表示名の変更はファイル rename で追随 (ID 不変・主ファイル + 履歴)。
          // rename の完了を待ってから保存する (#913)
          if (renamed) await skillFiles.renameItemFiles(live, skills.value)
          await skillFiles.persistItem(live, skills.value)
        })
        .catch((e) => console.warn('[skills] failed to persist update:', e))
    }
    emitNoteDeckEvent('skill:edited', { id })
  }

  /**
   * 更新検知の基準記録 (#1040)。storeSha512 未記録のストア由来スキルへ
   * registry 現行値を無通知で記録する。update() と違い履歴 push・
   * updatedAt 更新・skill:edited イベントを出さない。
   */
  function recordStoreBaseline(
    id: string,
    patch: { storeSha512: string; storeVersion: string },
  ): void {
    ensureLoaded()
    const idx = skills.value.findIndex((s) => s.id === id)
    const current = skills.value[idx]
    if (!current) return
    const updated: SkillMeta = { ...current, ...patch }
    skills.value = [
      ...skills.value.slice(0, idx),
      updated,
      ...skills.value.slice(idx + 1),
    ]
    if (settingsFs.isTauri) {
      void ready
        .then(() => {
          const live = skills.value.find((s) => s.id === id)
          if (!live) return
          return skillFiles.persistItem(live, skills.value)
        })
        .catch((e) => console.warn('[skills] failed to persist baseline:', e))
    }
  }

  /** スキルを削除する。undo トースト用に復元関数を返す (ファイル再書込方式) */
  function remove(id: string): (() => void) | undefined {
    ensureLoaded()
    const idx = skills.value.findIndex((s) => s.id === id)
    const target = skills.value[idx]
    if (!target) return undefined
    skills.value = skills.value.filter((s) => s.id !== id)
    if (settingsFs.isTauri) {
      // 主ファイル + 履歴サイドカーを削除 (ready 待ち)
      void ready
        .then(() => skillFiles.deleteItemFiles(target))
        .catch((e) => console.warn('[skills] failed to delete skill file:', e))
    }
    return () => {
      if (skills.value.some((s) => s.id === id)) return
      const at = Math.min(idx, skills.value.length)
      skills.value = [
        ...skills.value.slice(0, at),
        target,
        ...skills.value.slice(at),
      ]
      if (settingsFs.isTauri) {
        void ready
          .then(() => skillFiles.persistItem(target, skills.value))
          .catch((e) =>
            console.warn('[skills] failed to restore skill file:', e),
          )
      }
    }
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

  // --- trigger mode ---

  /**
   * `mode: 'trigger'` の skill のうち、`triggers[]` のいずれかが `input` に
   * 部分一致したものの id を返す。AI チャット送信時に呼び、戻り id を
   * session の `triggeredSkillIds` に累積して `composedSystemPrompt` の
   * `extraSkillIds` に渡すと、そのセッション中は skill body が system prompt
   * に注入され続ける (#725 session-sticky)。
   *
   * - 大文字小文字無視 (英日 trigger 混在に対応)
   * - 空文字 input / 空 triggers / 非 trigger mode は対象外
   * - マッチ判定は `String.prototype.includes` の素朴部分一致 (regex なし)
   */
  function triggerMatchingSkillIds(input: string): string[] {
    const text = (input ?? '').toLocaleLowerCase()
    if (!text) return []
    const matched: string[] = []
    for (const s of skills.value) {
      if (s.mode !== 'trigger') continue
      if (s.triggers.length === 0) continue
      const hit = s.triggers.some((t) => {
        const trig = t.toLocaleLowerCase()
        return trig.length > 0 && text.includes(trig)
      })
      if (hit) matched.push(s.id)
    }
    return matched
  }

  return {
    skills,
    effectiveActiveIds,
    initialized,
    ensureLoaded,
    isActive,
    setActive,
    composedSystemPrompt,
    composedSkillsTainted,
    get,
    add,
    update,
    recordStoreBaseline,
    remove,
    heartbeatSkills,
    setHeartbeat,
    triggerMatchingSkillIds,
  }
})

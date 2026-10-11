import { defineStore } from 'pinia'
import { computed } from 'vue'
import { emitNoteDeckEvent } from '@/aiscript/events'
import { i18n } from '@/i18n'
import type {
  DistributableFileCollection,
  DistributableStoreOrigin,
} from '@/services/distributable'
import { singleFileCollectionFor } from '@/services/distributableCodecs/singleFile'
import {
  reservedSkillKind,
  type SkillExtra,
  type SkillItem,
  skillCodec,
} from '@/services/distributableCodecs/skillCodec'
import { injectFrontmatterId } from '@/services/idFreeze'
import {
  migrateLegacyAizu,
  migrateStoreMovedSkills,
} from '@/services/storeMovedSkills'
import {
  createDistributableStore,
  type NewDistributable,
} from '@/stores/distributableStore'
import type { EditAttribution } from '@/utils/historyFs'
import * as settingsFs from '@/utils/settingsFs'
import { getStorageJson, removeStorage, STORAGE_KEYS } from '@/utils/storage'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { notifyWarningToast } from '@/utils/toastNotify'

/**
 * skill のプール。
 *
 * - 個体は envelope (`SkillItem`、#1202 段階 1)。本文 (`content`) は frontmatter
 *   を除いた Markdown、`extra` に mode / triggers / active / persona 等。スコープは
 *   無い (`none`)
 * - 保存は単一ファイル (`skills/<base>.md`、frontmatter がメタ)。projection は
 *   `skillCodec`。ブラウザ dev モードでは保存しない (メモリだけ)
 * - 予約 skill (`AGENTS.md` / `HEARTBEAT.md`、#1162) はファイル名で決まる。id /
 *   ファイル名 / mode は固定で、改名・mode 変更・persona 化・有効無効・削除は
 *   ここで拒否する (notemaid も拒否する。UI はボタンを出さない)。黙らせるには
 *   本文を空にする
 * - system prompt への本文の合流は notemaid が行う (#1162)。ここは一覧と状態だけ
 */

export type {
  ReservedSkillKind,
  SkillExtra,
  SkillItem,
  SkillMode,
} from '@/services/distributableCodecs/skillCodec'
export { reservedSkillKind } from '@/services/distributableCodecs/skillCodec'

/**
 * 一覧・エディタに出す名前。予約 skill はファイル名ではなく役割の語
 * (「ルール」/「巡回」) で見せる
 */
export function skillDisplayName(skill: SkillItem): string {
  const kind = skill.fileBase ? reservedSkillKind(skill.fileBase) : undefined
  if (kind === 'agents') return i18n.ts._skills.reservedAgents
  if (kind === 'heartbeat') return i18n.ts._skills.reservedHeartbeat
  return skill.name
}

/** 実効の有効 (mode=always は印に関係なく常時有効)。判定は codec の宣言 1 箇所 */
export function isSkillEnabled(skill: SkillItem): boolean {
  return skillCodec.enabled.get(skill)
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

/** 編集の patch。envelope の 3 項目と、編集で変わる `extra` の一部 */
export interface SkillPatch {
  name?: string
  description?: string
  content?: string
  extra?: Partial<SkillExtra>
}

/** 配布ソースから決まる値 (frontmatter 由来 + ストア 3 点)。ローカル値は含まない */
export interface SkillStorePatch {
  content: string
  description?: string
  iconUrl?: string
  version: string
  author?: string
  triggers: string[]
  cheapCheckCapabilities: string[]
  isPersona: boolean
  store: DistributableStoreOrigin
}

const inner = singleFileCollectionFor(skillCodec, {
  logTag: 'skills',
  notify: notifyWarningToast,
  kindFallback: 'skill',
  ext: settingsFs.SKILL_EXT,
  // 占有判定・sweep には .history.json5 を含む実列挙が要る
  // (規定拡張子の filter はコレクション側が行う)
  list: () => settingsFs.listSkillDirFiles(),
  read: (filename) => settingsFs.readSkillFile(filename),
  write: (filename, content) => settingsFs.writeSkillFile(filename, content),
  remove: (filename) => settingsFs.deleteSkillFile(filename),
  rename: (oldFilename, newFilename) =>
    settingsFs.renameSkillFile(oldFilename, newFilename),
  rawIdOf: (p) => p.meta.id,
  // ID 凍結の実効値 = 拡張子を除いた basename (codec の fallback と同値)
  effectiveIdOf: (_filename, base) => base,
  injectId: (raw, id) => injectFrontmatterId(raw, id),
  displayNameOf: (p) => (typeof p.meta.name === 'string' ? p.meta.name : ''),
})

/**
 * 予約 skill は大文字のファイル名が正なので、規約外名の copy-adopt 正規化の
 * 対象にしない (notecore も改名を拒否する)
 */
const skillFiles: DistributableFileCollection<SkillItem> = {
  ...inner,
  migrateItems: (items) =>
    inner.migrateItems(items.filter((s) => !s.extra.reserved)),
}

const fileBaseOf = (filename: string): string | undefined =>
  filename.endsWith(settingsFs.SKILL_EXT) &&
  !filename.endsWith('.history.json5')
    ? filename.slice(0, -settingsFs.SKILL_EXT.length)
    : undefined

export const useSkillsStore = defineStore('skills', () => {
  /**
   * 初回読込後の移行。順序を確定するため createdAt 昇順にしてから、
   * 旧 built-in (#746 / aizu) をストア配布版相当へ、端末ローカルにしか無かった
   * 有効一覧をファイルへ (#1116、一度きり) 移す
   */
  function migrate(items: SkillItem[]): SkillItem[] {
    items.sort((a, b) => a.createdAt - b.createdAt)
    const now = Date.now()
    const changed = new Set<SkillItem>([
      ...migrateLegacyAizu(items, now),
      ...migrateStoreMovedSkills(items, now),
    ])
    if (settingsFs.isTauri) {
      for (const s of migrateLegacyActiveList(items)) changed.add(s)
    }
    return [...changed]
  }

  /**
   * 端末ローカルにしか無かった有効一覧をファイルへ移す (#1116)。一覧に載っていて
   * 印の無い個体だけ立て、終わったら一覧を消す。壊れた値 (配列でない JSON) で
   * 初期化を止めず、捨てて先へ進む
   */
  function migrateLegacyActiveList(items: SkillItem[]): SkillItem[] {
    const legacy = getStorageJson<unknown>(STORAGE_KEYS.skillsActive, null)
    if (legacy === null) return []
    removeStorage(STORAGE_KEYS.skillsActive)
    if (!Array.isArray(legacy)) {
      console.warn('[skills] legacy active list is not an array — discarded')
      return []
    }
    const ids = new Set(legacy.map(String))
    const changed: SkillItem[] = []
    for (const s of items) {
      if (!ids.has(s.id) || s.extra.active === true) continue
      s.extra = { ...s.extra, active: true }
      changed.push(s)
    }
    return changed
  }

  const base = createDistributableStore<string, SkillItem>({
    logTag: 'skills',
    codec: skillCodec,
    files: skillFiles,
    settingsScope: 'skills',
    fileBaseOf,
    // ブラウザ dev モードでは保存しない (browserStorageKey 無し)
    generateId: () => generateSkillId('skill'),
    // 履歴の形は `skills.revert` (notemaid) とエディタの履歴窓が読むので
    // キー名は on-disk の互換を保つ
    history: {
      kind: 'skill',
      snapshot: (s) => ({
        body: s.content,
        name: s.name,
        version: s.extra.version,
        mode: s.extra.mode,
      }),
    },
    // スコープが無いので掃除の対象にならない (宣言は要るので unlink)
    purgeAccount: 'unlink',
    hooks: {
      migrate,
      // 別の書き手 (notemaid の skills.* / 他のウィンドウ) が本文を書いたら
      // プラグインへ知らせる。自分の編集は `update` が知らせる
      afterContentChange: (s, _prev, source) => {
        if (source === 'external')
          emitNoteDeckEvent('skill:edited', { id: s.id })
      },
    },
  })

  function isActive(id: string): boolean {
    return base.get(id)?.extra.active === true
  }

  /** 予約 skill は本文 (と説明) だけ。名前 / mode / persona 化は固定 */
  function rejectIfReservedLocked(current: SkillItem, patch: SkillPatch): void {
    if (!current.extra.reserved) return
    const renaming = patch.name !== undefined && patch.name !== current.name
    const remoding =
      patch.extra?.mode !== undefined && patch.extra.mode !== current.extra.mode
    if (renaming || remoding || patch.extra?.isPersona === true) {
      throw new Error(i18n.ts._skills.reservedLocked)
    }
  }

  /**
   * 本体の有効 / 無効 (#1116)。frontmatter に持つ (バックアップに乗る)。
   * 予約 skill は拒否する。false = 未知の id
   */
  async function setActive(id: string, active: boolean): Promise<boolean> {
    const current = base.get(id)
    if (!current) return false
    if (current.extra.reserved) throw new Error(i18n.ts._skills.reservedLocked)
    return base.setEnabled(id, active)
  }

  /** 編集 (名前 / 説明 / 本文 / mode 等)。予約 skill の固定項目は拒否する */
  async function update(
    id: string,
    patch: SkillPatch,
    attribution?: EditAttribution,
  ): Promise<boolean> {
    const current = base.get(id)
    if (!current) return false
    rejectIfReservedLocked(current, patch)
    if (!(await base.update(id, patch, attribution))) return false
    emitNoteDeckEvent('skill:edited', { id })
    return true
  }

  /**
   * ストア再インストール / 更新 (#913 / #981): 本文とストア由来 (frontmatter
   * 由来の版 / 作者 / triggers / cheap check / persona を含む) を上書きする。
   * ローカル値 (改名した name / mode / 有効) は維持
   */
  async function applyStoreUpdate(
    id: string,
    patch: SkillStorePatch,
  ): Promise<boolean> {
    const prev = base.get(id)
    if (!prev) return false
    const { content, description, iconUrl, store, ...fromSource } = patch
    return base.applyStoreUpdate(id, {
      content,
      description,
      iconUrl,
      store,
      extra: { ...prev.extra, ...fromSource },
    })
  }

  /** 削除。予約 skill は拒否する。undo を返す (ファイル再書込方式) */
  async function remove(id: string): Promise<(() => void) | undefined> {
    const target = base.get(id)
    if (target?.extra.reserved) throw new Error(i18n.ts._skills.reservedLocked)
    return base.remove(id)
  }

  /**
   * 1 ファイルを読み直して写しに載せる (notemaid が置いた skill の取り込み。
   * 変更通知を待たずに結果が要る呼び出し側が使う)
   */
  async function reload(filename: string): Promise<void> {
    await base.reload(filename)
    const fileBase = fileBaseOf(filename)
    const loaded = base.items.value.find((s) => s.fileBase === fileBase)
    if (loaded) emitNoteDeckEvent('skill:edited', { id: loaded.id })
  }

  // --- HEARTBEAT (#411) ---

  /**
   * `mode: 'heartbeat'` の skill 一覧。runner が tick ごとにこれを読んで AI に
   * 渡す。順序は一覧の宣言順を保つ
   */
  const heartbeatSkills = computed(() =>
    base.items.value.filter((s) => s.extra.mode === 'heartbeat'),
  )

  /**
   * skill の HEARTBEAT 対象を on/off する。enabled=true で mode='heartbeat'、
   * false で mode='manual' に戻す (always / trigger は専用設定なので保持しない)
   */
  function setHeartbeat(id: string, enabled: boolean): Promise<boolean> {
    return update(id, { extra: { mode: enabled ? 'heartbeat' : 'manual' } })
  }

  /**
   * 巡回の手順 (予約 skill `HEARTBEAT.md`、#1162) を無ければ置いて (冪等)、
   * その skill id を返す。置くのは notemaid で、デバイスは結果を写しに載せる
   * だけ (変更通知を待たずに読み直し、開いたエディタが「見つかりません」を
   * 挟まないようにする)
   */
  async function seedHeartbeatSteps(): Promise<string> {
    base.ensureLoaded()
    const meta = unwrap(await commands.maidHeartbeatStepsSeed())
    if (meta.fileBase) await reload(`${meta.fileBase}${settingsFs.SKILL_EXT}`)
    return meta.id
  }

  /**
   * 「ルールを編集」(AI 設定のペルソナ) の入口。AGENTS.md は最初の AI ターンで
   * notemaid が置くが、それより前に開いても編集できるように無ければ置く (冪等)。
   * 戻り値は skill id
   */
  async function seedAgents(): Promise<string> {
    base.ensureLoaded()
    const meta = unwrap(await commands.maidAgentsSeed())
    if (meta.fileBase) await reload(`${meta.fileBase}${settingsFs.SKILL_EXT}`)
    return meta.id
  }

  // --- trigger mode ---

  /**
   * `mode: 'trigger'` の skill のうち、`triggers[]` のいずれかが `input` に
   * 部分一致したものの id を返す。AI チャット送信時に呼び、戻り id を
   * session の `triggeredSkillIds` に累積して notemaid の組み立ての
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
    for (const s of base.items.value) {
      if (s.extra.mode !== 'trigger') continue
      if (s.extra.triggers.length === 0) continue
      const hit = s.extra.triggers.some((t) => {
        const trig = t.toLocaleLowerCase()
        return trig.length > 0 && text.includes(trig)
      })
      if (hit) matched.push(s.id)
    }
    return matched
  }

  return {
    ...base,
    add: (input: NewDistributable<SkillItem>) => base.add(input),
    isActive,
    setActive,
    update,
    applyStoreUpdate,
    remove,
    reload,
    heartbeatSkills,
    setHeartbeat,
    seedHeartbeatSteps,
    seedAgents,
    triggerMatchingSkillIds,
  }
})

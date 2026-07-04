/**
 * principal 別権限プロファイルの保存と解決 (#712 PR 1b)。
 *
 * 保存先は独立ファイル `permissions.json5` — settings.json5 / ai.json5 に
 * 同居させない理由は自己昇格の防止 (theme.write 等でファイルを書ける
 * capability が既にあり、認可データを capability 到達可能なファイルに置くと
 * 書き込み権限のバグ 1 つで権限自体の改変に化ける)。このファイルに対応する
 * write capability は作らない (書けるのは設定 UI と外部エディタのみ)。
 *
 * 旧 `ai.json5` の 3 プロファイル (permissions / heartbeat.permissions /
 * httpApi.permissions) は初回起動時に一度だけここへ移行される。
 */

import JSON5 from 'json5'
import { type Ref, ref } from 'vue'
import {
  isTauri,
  readAiSettings,
  readPermissionsSettings,
  writeAiSettings,
  writePermissionsSettings,
} from '@/utils/settingsFs'
import { commands, unwrap } from '@/utils/tauriInvoke'
import type { Principal, ProfiledPrincipalId } from './principal'
import {
  EXTERNAL_DEFAULT_PROFILE,
  EXTERNAL_READ_FLOOR,
  LOCAL_READ_KEYS,
  normalizeProfile,
  PERMISSION_KEYS,
  PERMISSIONS_SCHEMA_VERSION,
  type PermissionKey,
  type PermissionsConfig,
  type PermissionsFileConfig,
  PROFILED_PRINCIPAL_IDS,
  presetFromMap,
  resolvePermissions,
  THIRD_PARTY_DENY_KEYS,
} from './schema'

/** 欠損時の安全側フォールバック (deny 側 = readonly)。 */
const READONLY_PROFILE: PermissionsConfig = {
  preset: 'readonly',
  custom: {} as never,
}

// --- Defaults ---

/**
 * 新規インストール時のデフォルト。
 *
 * - `ai.chat` / `plugin`: `safe` — AI カラムの tool calling とウィジェット /
 *   プラグインの基本動作 (react / メモ / クリップ / 下書き / widgets・plugins
 *   書込等の低リスク書込) を初期状態で妨げない。高リスク (notes.write /
 *   account.write / network.external / vault.use 等) は据え置き opt-in。
 *   plugin の危険権限 (skills.write / tasks.run / vault.use) は preset に
 *   関わらず clampForPrincipal が恒久 deny する
 * - `ai.heartbeat`: `readonly` — 無人実行は安全側 (#712 §4.4)
 * - `external`: 縮小 custom (#712 §4.4 — 「トークン発行 = Misskey read の
 *   同意」にローカル私的データを含めない)
 */
export function defaultPermissionsFile(): PermissionsFileConfig {
  return {
    schemaVersion: PERMISSIONS_SCHEMA_VERSION,
    principals: {
      'ai.chat': { preset: 'safe', custom: {} as never },
      'ai.heartbeat': { preset: 'readonly', custom: {} as never },
      plugin: { preset: 'safe', custom: {} as never },
      external: {
        preset: 'custom',
        custom: { ...EXTERNAL_DEFAULT_PROFILE.custom },
      },
    },
    confirmSkips: {},
  }
}

/**
 * confirmSkips (#714) の読み込み時正規化: 有効な scope (`ai.chat` /
 * `plugin:<id>`) のみ保持し、capability id の重複・非文字列を落とす。
 * ai.heartbeat / external / 未知キーは (外部エディタで書かれても) 破棄 —
 * 無人実行と外部アプリの確認スキップは構造的に成立させない。
 */
function normalizeConfirmSkips(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [scope, ids] of Object.entries(raw as Record<string, unknown>)) {
    if (scope !== 'ai.chat' && !scope.startsWith('plugin:')) continue
    if (!Array.isArray(ids)) continue
    const clean = [
      ...new Set(ids.filter((v): v is string => typeof v === 'string')),
    ]
    if (clean.length > 0) out[scope] = clean
  }
  return out
}

/**
 * 読み込んだファイルの正規化: 固定 4 principal の存在保証 + custom map の
 * 欠損キー backfill。未知キー (将来の `plugin:<id>` 等) はそのまま保持する。
 */
export function normalizePermissionsFile(
  parsed: Partial<PermissionsFileConfig> | null | undefined,
): PermissionsFileConfig {
  const base = defaultPermissionsFile()
  const principals: Record<string, PermissionsConfig> = {
    ...(parsed?.principals ?? {}),
  }
  for (const id of PROFILED_PRINCIPAL_IDS) {
    const saved = principals[id] ?? base.principals[id] ?? READONLY_PROFILE
    principals[id] = normalizeProfile(saved, id)
  }
  return {
    schemaVersion: PERMISSIONS_SCHEMA_VERSION,
    principals,
    confirmSkips: normalizeConfirmSkips(parsed?.confirmSkips),
  }
}

// --- 一度きり移行 (ai.json5 → permissions.json5) ---

/** 旧 ai.json5 が持っていた権限系フィールド (移行読込専用)。 */
export interface LegacyAiPermissionFields {
  permissions?: PermissionsConfig
  heartbeat?: { permissions?: PermissionsConfig }
  httpApi?: { permissions?: PermissionsConfig }
}

/**
 * 旧 ai.json5 の 3 プロファイルから permissions.json5 の内容を生成する
 * (#712 §4.4)。純関数 (テスト対象)。
 *
 * - `ai.chat` ← permissions そのまま
 * - `plugin` ← permissions の複製 (第三者 deny floor 等の実効挙動は PR 1c)
 * - `ai.heartbeat` ← resolve(chat) AND resolve(heartbeat) の交差。現状の実効
 *   権限は「絞り込み = heartbeat / enforce = chat」の AND なので、素朴な複製は
 *   権限拡大 (chat=safe/hb=full で今まで拒否された write が無人実行可能) になる
 * - `external` ← httpApi: readonly/safe → LOCAL_READ_KEYS を落とした縮小
 *   custom (意図した縮小・リリースノート明記) / full・custom → そのまま保存
 *   (custom は backfill で deck.read=false が補完される)
 */
export function migrateLegacyPermissions(
  legacy: LegacyAiPermissionFields,
): PermissionsFileConfig {
  const chatRaw = legacy.permissions ?? READONLY_PROFILE
  const chat = normalizeProfile(chatRaw, 'ai.chat')

  // heartbeat: AND 初期化 (実効挙動の厳密保存)
  const hbRaw = legacy.heartbeat?.permissions ?? READONLY_PROFILE
  const hbResolved = resolvePermissions(normalizeProfile(hbRaw, 'ai.heartbeat'))
  const chatResolved = resolvePermissions(chat)
  const andMap = {} as Record<PermissionKey, boolean>
  for (const key of PERMISSION_KEYS) {
    andMap[key] = chatResolved[key] === true && hbResolved[key] === true
  }

  // external: 縮小移行
  const httpRaw = legacy.httpApi?.permissions
  let external: PermissionsConfig
  if (!httpRaw) {
    external = {
      preset: 'custom',
      custom: { ...EXTERNAL_DEFAULT_PROFILE.custom },
    }
  } else if (httpRaw.preset === 'readonly' || httpRaw.preset === 'safe') {
    const custom = resolvePermissions(normalizeProfile(httpRaw, 'external'))
    for (const key of LOCAL_READ_KEYS) custom[key] = false
    external = { preset: 'custom', custom }
  } else {
    // full = 「全部」への明示同意 / custom = 個別編集の明示同意 → そのまま
    // (custom の deck.read 欠損は normalizeProfile が external=false で補完)
    external = normalizeProfile(httpRaw, 'external')
  }

  return {
    schemaVersion: PERMISSIONS_SCHEMA_VERSION,
    principals: {
      'ai.chat': chat,
      'ai.heartbeat': presetFromMap(andMap),
      plugin: { preset: chat.preset, custom: { ...chat.custom } },
      external,
    },
    confirmSkips: {},
  }
}

// --- Composable (singleton) ---
//
// useAiConfig と同型: 全コンポーネントで同じ ref を共有する module-scope
// singleton。権限ウィンドウでの変更が dispatcher の resolve に即反映される。

const _file: Ref<PermissionsFileConfig> = ref(defaultPermissionsFile())
const _initialized: Ref<boolean> = ref(false)
let _initStarted = false

async function _initFileStorage(): Promise<void> {
  const content = await readPermissionsSettings()
  if (content) {
    try {
      _file.value = normalizePermissionsFile(
        JSON5.parse(content) as Partial<PermissionsFileConfig>,
      )
    } catch (e) {
      console.warn('[permissions] failed to parse permissions.json5:', e)
      _file.value = defaultPermissionsFile()
    }
    _initialized.value = true
    return
  }

  // permissions.json5 が無い → ai.json5 から一度きり移行
  let migrated = defaultPermissionsFile()
  try {
    const aiContent = await readAiSettings()
    if (aiContent) {
      const parsed = JSON5.parse(aiContent) as LegacyAiPermissionFields &
        Record<string, unknown>
      migrated = migrateLegacyPermissions(parsed)
      // 旧キーを落として ai.json5 を書き戻す (β: dead field を残さない)
      const { permissions: _p, httpApi: _h, ...rest } = parsed
      if (rest.heartbeat && typeof rest.heartbeat === 'object') {
        const { permissions: _hp, ...hbRest } = rest.heartbeat as Record<
          string,
          unknown
        >
        rest.heartbeat = hbRest
      }
      if ('permissions' in parsed || 'httpApi' in parsed) {
        await writeAiSettings(`${JSON5.stringify(rest, null, 2)}\n`)
      }
    }
  } catch (e) {
    console.warn('[permissions] migration from ai.json5 failed:', e)
  }
  _file.value = migrated
  try {
    await writePermissionsSettings(`${JSON5.stringify(_file.value, null, 2)}\n`)
  } catch (e) {
    console.warn('[permissions] failed to write permissions.json5:', e)
  }
  _initialized.value = true
}

/**
 * Rust 側 external gate (#712 §5.3 PR 4) へ resolve 済み granted map を同期
 * する。フロント (dispatcher) と Rust (core proxy gate) の 2 つの enforce 点が
 * 別々の値で動く時間帯を作らない — 再読込・保存は必ずこれを伴う (#712 §4.2)。
 */
async function syncExternalToRust(): Promise<void> {
  if (!isTauri) return
  try {
    unwrap(await commands.permissionsSync(resolveForProfiled('external')))
  } catch (e) {
    console.warn('[permissions] permissions_sync failed:', e)
  }
}

/**
 * permissions.json5 を再読込して singleton に反映する。外部エディタで編集した
 * 場合に AI tool 呼び出し直前のフローで呼ぶ (reloadAiConfig と対)。
 * Rust 側 gate への permissions_sync を必ず伴う。
 */
export async function reloadPermissionsConfig(): Promise<void> {
  await _initFileStorage()
  await syncExternalToRust()
}

export function usePermissionsConfig() {
  if (!_initStarted) {
    _initStarted = true
    if (isTauri) {
      _initFileStorage().then(syncExternalToRust)
    }
  }

  function save(): void {
    writePermissionsSettings(`${JSON5.stringify(_file.value, null, 2)}\n`)
      .then(syncExternalToRust)
      .catch((e: unknown) =>
        console.warn('[permissions] failed to write permissions.json5:', e),
      )
  }

  return {
    file: _file,
    save,
    initialized: _initialized,
  }
}

/** @internal テスト用。state を初期化する。 */
export function _resetPermissionsForTest(): void {
  _file.value = defaultPermissionsFile()
  _initialized.value = false
  _initStarted = false
}

// --- principal → 実効権限の解決 ---

function principalProfileId(principal: Principal): ProfiledPrincipalId | null {
  switch (principal.kind) {
    case 'user':
      return null
    case 'ai.chat':
      return 'ai.chat'
    case 'ai.heartbeat':
      return 'ai.heartbeat'
    case 'plugin':
      return 'plugin'
    case 'external':
      return 'external'
  }
}

/**
 * principal が従う権限プロファイルを返す。user は null (プロファイル無し =
 * 常時許可)。
 *
 * plugin の分離実効化 (Nd:call の plugin principal 化) は PR 1c — それまで
 * plugin プロファイルは移行で chat 複製として存在するが参照されない。
 */
export function profileFor(principal: Principal): PermissionsConfig | null {
  const id = principalProfileId(principal)
  if (!id) return null
  usePermissionsConfig() // 初期化トリガ (singleton)
  // normalizePermissionsFile が 4 principal の存在を保証するが、
  // 万一欠けていても安全側 (readonly) に倒す — user 扱い (null) にはしない
  return _file.value.principals[id] ?? normalizeProfile(READONLY_PROFILE, id)
}

/**
 * principal 別の floor / ceiling clamp (#712 §3.7 / §3.8 / §5.3 / §6.1)。
 * 保存値は変えず resolve 時にのみ適用する — 権限ウィンドウの表示は
 * disabledKeys 機構が同じ定数を参照して「変更できない事実」を示す。
 *
 * - plugin / external: THIRD_PARTY_DENY_KEYS (AI 指示チャネル + tasks.run) を
 *   恒久 OFF。full preset でも拒否 (「同意しても成立させない」構造的禁止)
 * - plugin: vault.use も恒久 OFF (Secret Vault はプラグインに開示しない)
 * - external: EXTERNAL_READ_FLOOR (Misskey コンテンツ read 4 キー) を常時 ON
 */
function clampForPrincipal(
  map: Record<PermissionKey, boolean>,
  id: ProfiledPrincipalId,
): Record<PermissionKey, boolean> {
  if (id === 'plugin' || id === 'external') {
    for (const key of THIRD_PARTY_DENY_KEYS) map[key] = false
  }
  if (id === 'plugin') {
    map['vault.use'] = false
  }
  if (id === 'external') {
    for (const key of EXTERNAL_READ_FLOOR) map[key] = true
  }
  return map
}

/**
 * principal の実効 granted map。user は null (常時許可の意)。
 * dispatcher の実行時 enforce・一覧フィルタ・meta 系の自己申告が共有する
 * 唯一の判定。
 */
export function resolveFor(
  principal: Principal,
): Record<PermissionKey, boolean> | null {
  const id = principalProfileId(principal)
  if (!id) return null
  return resolveForProfiled(id)
}

/**
 * profiled principal 用の非 null 版 (user を型で除外)。HEARTBEAT daemon の
 * tool 一覧絞り込みなど「必ずプロファイルがある」文脈で使う。
 */
export function resolveForProfiled(
  id: ProfiledPrincipalId,
): Record<PermissionKey, boolean> {
  usePermissionsConfig()
  const profile =
    _file.value.principals[id] ?? normalizeProfile(READONLY_PROFILE, id)
  return clampForPrincipal(resolvePermissions(profile), id)
}

// --- 「今後確認しない」の記憶 (#714) ---
//
// 確認ダイアログで「今後この操作を確認しない」を ON にして許可された
// capability を scope 単位で記憶し、次回以降の確認をスキップする。保存先は
// permissions.json5 — 権限プロファイルと同じく capability から書き換え不能
// (自己昇格防止、ファイル冒頭 doc 参照)。

/**
 * principal の確認スキップ scope。null = スキップ不可 (常に確認)。
 *
 * - `ai.chat` → 'ai.chat' (capability 単位で記憶)
 * - `plugin` → `plugin:<pluginId>` (個体単位 — 1 つのプラグイン / ウィジェット
 *   への同意が他の AiScript に波及しない)
 * - `user` → null (本人操作の confirm は削らない — vault の信頼と同じ規則)
 * - `ai.heartbeat` → null (無人実行。チャットで押した同意の波及はもちろん、
 *   heartbeat 自身のダイアログでの記憶も認めない — 同意すり替え防止 #712 §3.3)
 * - `external` → null (外部アプリの書き込みは都度確認)
 */
export function confirmSkipScope(principal: Principal): string | null {
  switch (principal.kind) {
    case 'ai.chat':
      return 'ai.chat'
    case 'plugin':
      return `plugin:${principal.pluginId}`
    case 'user':
    case 'ai.heartbeat':
    case 'external':
      return null
  }
}

/** scope × capability が「今後確認しない」記憶済みかを返す。 */
export function isConfirmSkipped(scope: string, capabilityId: string): boolean {
  usePermissionsConfig()
  return _file.value.confirmSkips[scope]?.includes(capabilityId) ?? false
}

/** 「今後確認しない」を記憶して永続化する。 */
export function addConfirmSkip(scope: string, capabilityId: string): void {
  const { file, save } = usePermissionsConfig()
  const list = file.value.confirmSkips[scope] ?? []
  if (list.includes(capabilityId)) return
  file.value.confirmSkips[scope] = [...list, capabilityId]
  save()
}

/** 記憶した「今後確認しない」を取り消して永続化する (権限ウィンドウの導線)。 */
export function removeConfirmSkip(scope: string, capabilityId: string): void {
  const { file, save } = usePermissionsConfig()
  const next = (file.value.confirmSkips[scope] ?? []).filter(
    (id) => id !== capabilityId,
  )
  if (next.length > 0) file.value.confirmSkips[scope] = next
  else delete file.value.confirmSkips[scope]
  save()
}

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
import { useToast } from '@/stores/toast'
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
  PLUGIN_DEFAULT_PROFILE,
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

/**
 * permissions.json5 が壊れて読めないときのフォールバック (#719)。全 principal を
 * readonly に倒す — 新規インストール時デフォルト (plugin = safe + network.external)
 * に倒すと、権限を絞っていたユーザーがファイル破損だけで無言のうちに権限拡大して
 * しまう。破損は異常事態なので最小権限で起動し、ユーザーが設定 UI で復旧できる状態に
 * する (external の Misskey read floor は resolve 時に clampForPrincipal が保証)。
 */
function safeFallbackFile(): PermissionsFileConfig {
  const principals: Record<string, PermissionsConfig> = {}
  for (const id of PROFILED_PRINCIPAL_IDS) {
    principals[id] = normalizeProfile(READONLY_PROFILE, id)
  }
  return {
    schemaVersion: PERMISSIONS_SCHEMA_VERSION,
    principals,
    confirmSkips: {},
  }
}

// --- Defaults ---

/**
 * 新規インストール時のデフォルト。
 *
 * - `ai.chat`: `safe` — AI カラムの tool calling の基本動作 (react / メモ /
 *   クリップ / 下書き / widgets・plugins 書込等の低リスク書込) を初期状態で
 *   妨げない。高リスク (notes.write / account.write / network.external /
 *   vault.use 等) は据え置き opt-in
 * - `plugin`: safe + `network.external` (PLUGIN_DEFAULT_PROFILE #714 followup)
 *   — 外部 API 連携ウィジェットを初期状態で妨げない (http.fetch の都度確認は
 *   残る)。危険権限 (skills.write / tasks.run) は preset に関わらず
 *   clampForPrincipal が恒久 deny する。vault.use は safe で OFF (opt-in) —
 *   接続側の per-connection 開示と合わせた二段 gate (#759)
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
      plugin: {
        preset: 'custom',
        custom: { ...PLUGIN_DEFAULT_PROFILE.custom },
      },
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
let _initPromise: Promise<void> | null = null
// 進行中の save() の書き込み。reload (再読込) が未完了の書き込みより前の
// 内容を読み戻してメモリ上の変更・確認スキップ記憶を巻き戻さないよう、
// 読込はこれを待ってから走る (#716)。
let _pendingWrite: Promise<unknown> = Promise.resolve()

async function _initFileStorage(): Promise<void> {
  // 進行中の save() の書き込みを待ってから読む (save→reload レースで
  // 未完了の書き込みより前の内容を読み戻さない #716)。
  await _pendingWrite.catch(() => {})
  const content = await readPermissionsSettings()
  if (content) {
    try {
      _file.value = normalizePermissionsFile(
        JSON5.parse(content) as Partial<PermissionsFileConfig>,
      )
    } catch (e) {
      // 破損時はデフォルト (plugin=safe) でなく最小権限へ倒す (#719)
      console.warn('[permissions] failed to parse permissions.json5:', e)
      _file.value = safeFallbackFile()
      // 無言で権限を狭めない (#722): ユーザーに最小権限起動を知らせる
      useToast().show(
        '権限設定を読み込めなかったため、安全のため最小権限で起動しました。設定から権限を確認してください。',
        'warning',
      )
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
const SYNC_MAX_ATTEMPTS = 3
const SYNC_RETRY_BASE_MS = 200

async function syncExternalToRust(): Promise<void> {
  if (!isTauri) return
  // 呼び出し時点の granted を送る。sync 失敗を握りつぶすと Rust gate が古い
  // (広い) 権限のまま動き続けるため、一時障害はリトライで回復させる (#718)。
  const granted = resolveForProfiled('external')
  for (let attempt = 1; attempt <= SYNC_MAX_ATTEMPTS; attempt++) {
    try {
      unwrap(await commands.permissionsSync(granted))
      return
    } catch (e) {
      if (attempt === SYNC_MAX_ATTEMPTS) {
        // リトライ枯渇。古い広い権限のまま動かさないよう Rust gate を
        // フェイルセーフに倒す (floor 以外を全 deny #718)。無引数なので
        // payload 起因の sync 失敗でも到達しうる。lockdown も失敗 (IPC 全断)
        // なら Rust は到達不能なので警告に残すしかない。
        console.warn(
          `[permissions] permissions_sync failed after ${SYNC_MAX_ATTEMPTS} attempts; locking external gate down:`,
          e,
        )
        try {
          unwrap(await commands.permissionsLockdown())
        } catch (e2) {
          console.warn('[permissions] permissions_lockdown also failed:', e2)
        }
        // 無言で外部連携を止めない (#722): 自動制限をユーザーに知らせる
        useToast().show(
          '権限の同期に失敗したため、外部連携を一時的に制限しました。アプリを再起動すると復旧します。',
          'warning',
        )
        return
      }
      await new Promise((resolve) =>
        setTimeout(resolve, SYNC_RETRY_BASE_MS * attempt),
      )
    }
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
      _initPromise = _initFileStorage()
        .then(syncExternalToRust)
        .catch((e: unknown) => {
          console.warn('[permissions] initial load failed:', e)
        })
    }
  }

  function save(): void {
    _pendingWrite = writePermissionsSettings(
      `${JSON5.stringify(_file.value, null, 2)}\n`,
    )
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

/**
 * permissions.json5 の初回読込完了を待つ (#716)。起動直後は読込 (async) が
 * 終わる前に autoRun ウィジェット等が dispatch へ到達しうる。デフォルト値
 * (confirmSkips 空・デフォルトプロファイル) での誤判定を防ぐため、dispatcher
 * は判定前にこれを await する。読込不要な環境 (非 Tauri) では即時解決。
 */
export function whenPermissionsReady(): Promise<void> {
  usePermissionsConfig() // 初期化トリガ (singleton)
  return _initPromise ?? Promise.resolve()
}

/** @internal テスト用。state を初期化する。 */
export function _resetPermissionsForTest(): void {
  _file.value = defaultPermissionsFile()
  _initialized.value = false
  _initStarted = false
  _initPromise = null
  _pendingWrite = Promise.resolve()
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
 * - external: EXTERNAL_READ_FLOOR (Misskey コンテンツ read 4 キー) を常時 ON
 *
 * plugin の vault.use はここで clamp しない (#759) — Secret Vault 側の
 * per-connection 開示 (`exposedTo: ['plugin']`, default 非開示) が gate になる。
 */
function clampForPrincipal(
  map: Record<PermissionKey, boolean>,
  id: ProfiledPrincipalId,
): Record<PermissionKey, boolean> {
  if (id === 'plugin' || id === 'external') {
    for (const key of THIRD_PARTY_DENY_KEYS) map[key] = false
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

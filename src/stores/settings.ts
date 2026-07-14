/**
 * useSettingsStore — `settings.json5` (VSCode `settings.json` 相当) の Pinia ラッパー。
 *
 * 現段階は土台 PR。realtimeMode のみが実際にここを経由する。他のストアは
 * 次 PR 以降で段階的に移行していく。詳細は [DESIGN.md](../../DESIGN.md) の
 * 「マイグレーション」節、および memory/project_settings_as_files.md 参照。
 *
 * 動作:
 * - 起動時に `load()` で settings.json5 を読み込む (存在しなければ defaults)
 * - `set()` で値を更新すると debounce (300ms) 後に settings.json5 に書き戻す
 * - 不正値や IO エラーは defaults にフォールバック (起動不能を避ける)
 */

import JSON5 from 'json5'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  type NotedeckSettings,
  parseSettings,
} from '@/settings/schema'
import { createDebouncedPersist } from '@/utils/debouncedPersist'
import { isTauri } from '@/utils/settingsFs'
import { emitTauri, listenTauri } from '@/utils/tauriEvents'
import { commands, unwrap } from '@/utils/tauriInvoke'

/** ウィンドウ間同期イベントで自分自身の emit を無視するための識別子 */
const SYNC_SOURCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`

export const useSettingsStore = defineStore('settings', () => {
  /** 現在の設定値 (load() 完了まで DEFAULT_SETTINGS のコピー) */
  const settings = shallowRef<NotedeckSettings>({ ...DEFAULT_SETTINGS })

  /** DEFAULT_SETTINGS からの差分のみ (_schema 除外)。エディタ表示用。 */
  const overrides = computed<Record<string, unknown>>(() => {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(settings.value)) {
      if (key === '_schema') continue
      const defaultVal = (
        DEFAULT_SETTINGS as unknown as Record<string, unknown>
      )[key]
      if (value !== defaultVal) {
        result[key] = value
      }
    }
    return result
  })

  /** settings.json5 からの初期ロードが完了したか */
  const initialized = ref(false)

  /** 現在書き込み中か (UI の保存インジケータ等で参照) */
  const saving = ref(false)

  /** 直近の永続化エラー (成功時は null にリセット) */
  const lastError = ref<string | null>(null)

  /**
   * settings.json5 を読み込んで settings を初期化する。
   * 複数回呼ばれても idempotent (初回のみ実行)。
   * 読み込みに失敗したら defaults で続行する。
   */
  async function load(): Promise<void> {
    if (initialized.value) return

    // Web ビルド (非 Tauri) では settings.json5 が存在しないので defaults のまま
    if (!isTauri) {
      initialized.value = true
      return
    }

    try {
      const raw = unwrap(await commands.readNotedeckJson())
      if (raw.length === 0) {
        settings.value = { ...DEFAULT_SETTINGS }
      } else {
        const parsed = JSON5.parse(raw) as Record<string, unknown>
        settings.value = parseSettings(parsed)
      }
    } catch (e) {
      console.warn(
        '[settings] failed to load settings.json5, using defaults:',
        e,
      )
      settings.value = { ...DEFAULT_SETTINGS }
    }
    initialized.value = true
    startCrossWindowSync()
  }

  /**
   * 他ウィンドウ (ポップアウトカラム / PiP) が settings.json5 を書き換えたら
   * 再読込して追従する。テーマ等の設定変更がリロードなしで全ウィンドウに届く。
   */
  let syncStarted = false
  function startCrossWindowSync(): void {
    if (syncStarted || !isTauri) return
    syncStarted = true
    listenTauri('nd:settings-changed', async (payload) => {
      if (payload.sourceId === SYNC_SOURCE_ID) return
      try {
        const raw = unwrap(await commands.readNotedeckJson())
        settings.value =
          raw.length === 0
            ? { ...DEFAULT_SETTINGS }
            : parseSettings(JSON5.parse(raw) as Record<string, unknown>)
      } catch (e) {
        console.warn('[settings] cross-window reload failed:', e)
      }
    }).catch((e) => console.warn('[settings] sync listen failed:', e))
  }

  /**
   * スカラー設定を取得する。
   * 未定義キーは `undefined` を返す (呼び出し側でデフォルトを補う想定)。
   */
  function get<K extends keyof NotedeckSettings>(
    key: K,
  ): NotedeckSettings[K] | undefined {
    return settings.value[key]
  }

  /**
   * スカラー設定を更新する。shallowRef の reactivity をトリガーするため
   * 新オブジェクトを代入してから debounce 付きで永続化する。
   */
  function set<K extends keyof NotedeckSettings>(
    key: K,
    value: NotedeckSettings[K],
  ): void {
    settings.value = { ...settings.value, [key]: value }
    schedulePersist()
  }

  const { schedule: schedulePersist, flush } = createDebouncedPersist(persist, {
    onError: (e) => {
      console.warn('[settings] persist failed:', e)
      lastError.value = e instanceof Error ? e.message : String(e)
    },
  })

  async function persist(): Promise<void> {
    if (!isTauri) return // Web ビルドでは no-op

    saving.value = true
    try {
      const toWrite = {
        ...settings.value,
        _schema: CURRENT_SCHEMA_VERSION,
      }
      const content = `${JSON5.stringify(toWrite, null, 2)}\n`
      unwrap(await commands.writeNotedeckJson(content))
      lastError.value = null
      emitTauri('nd:settings-changed', { sourceId: SYNC_SOURCE_ID }).catch(
        () => {
          // Not running in Tauri (browser dev mode)
        },
      )
    } finally {
      saving.value = false
    }
  }

  /**
   * 設定全体を置き換える。エディタからの overrides 適用時に使用。
   * 既存キーの削除も反映される（set() では不可能な操作）。
   */
  function replaceAll(newSettings: NotedeckSettings): void {
    settings.value = { ...newSettings }
    schedulePersist()
  }

  return {
    settings,
    overrides,
    initialized,
    saving,
    lastError,
    load,
    get,
    set,
    replaceAll,
    flush,
  }
})

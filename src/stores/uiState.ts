import { defineStore } from 'pinia'
import { nextTick, ref } from 'vue'
import { registerSettingsFileHandler } from '@/services/settingsFileSync'
import {
  parseUiState,
  serializeUiState,
  type UiState,
  type UiStateKey,
} from '@/services/uiState'
import { createDebouncedPersist } from '@/utils/debouncedPersist'
import { isTauri, readUiState, writeUiState } from '@/utils/settingsFs'

/**
 * この機械の UI の状態 (`state/ui.json5`、#1333 §3)。
 *
 * settings.json5 から出した値 (ペットの位置 / ズーム / 投稿フォームの前回値) の
 * 写し。最後に書いた者勝ちで、別のウィンドウの書込は変更通知で読み直す。
 */
export const useUiStateStore = defineStore('uiState', () => {
  const data = ref<UiState>({})
  const initialized = ref(false)
  let hydrating = false

  const { schedule: schedulePersist } = createDebouncedPersist(persist, {
    onError: (e) => console.warn('[uiState] persist failed:', e),
  })

  async function persist(): Promise<void> {
    if (!isTauri) return
    await writeUiState(serializeUiState(data.value))
  }

  async function hydrate(text: string): Promise<void> {
    hydrating = true
    try {
      data.value = parseUiState(text)
      await nextTick()
    } finally {
      hydrating = false
    }
  }

  /** 起動時に 1 回。失敗しても空で続ける (次の操作で書き直される) */
  async function load(): Promise<void> {
    if (initialized.value) return
    if (isTauri) {
      try {
        await hydrate(await readUiState())
      } catch (e) {
        console.warn('[uiState] failed to load ui.json5:', e)
      }
    }
    initialized.value = true
  }

  function get<K extends UiStateKey>(key: K): UiState[K] {
    return data.value[key]
  }

  function set<K extends UiStateKey>(key: K, value: UiState[K]): void {
    if (hydrating) return
    if (value === undefined) {
      const { [key]: _removed, ...rest } = data.value
      data.value = rest as UiState
    } else {
      data.value = { ...data.value, [key]: value }
    }
    schedulePersist()
  }

  /**
   * 旧 settings.json5 に残っていた値を一度だけ持ち越す (ui.json5 に無いキーだけ)。
   * settings store が初回の書込より前に呼ぶ
   */
  async function carryOver(legacy: UiState): Promise<void> {
    await load()
    let changed = false
    const next: UiState = { ...data.value }
    for (const [key, value] of Object.entries(legacy) as [
      UiStateKey,
      UiState[UiStateKey],
    ][]) {
      if (value === undefined || next[key] !== undefined) continue
      ;(next as Record<string, unknown>)[key] = value
      changed = true
    }
    if (!changed) return
    data.value = next
    await persist()
  }

  // 別のウィンドウ (ズーム / ペットのドラッグ) が ui.json5 を書いた → 写しを読み直す
  registerSettingsFileHandler('root', async (change) => {
    if (change.name !== 'ui.json5' || !isTauri) return
    try {
      await hydrate(await readUiState())
    } catch (e) {
      console.warn('[uiState] reload failed:', e)
    }
  })

  return { data, initialized, load, get, set, carryOver }
})

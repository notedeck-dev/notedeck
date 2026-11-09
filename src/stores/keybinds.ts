import JSON5 from 'json5'
import { defineStore } from 'pinia'
import { nextTick, ref, watch } from 'vue'

import type { Shortcut } from '@/commands/registry'
import defaultKeybindsJson5 from '@/defaults/keybindings.json5?raw'
import { parseJson5Document, stringifyJson5 } from '@/services/json5Document'
import { registerSettingsFileHandler } from '@/services/settingsFileSync'
import { createDebouncedPersist } from '@/utils/debouncedPersist'
import { isTauri, readKeybinds, writeKeybinds } from '@/utils/settingsFs'

export interface KeybindEntry {
  commandId: string
  shortcuts: Shortcut[]
}

const DEFAULT_KEYBINDS: KeybindEntry[] = JSON5.parse(defaultKeybindsJson5)

export const useKeybindsStore = defineStore('keybinds', () => {
  const overrides = ref<Record<string, Shortcut[]>>({})
  const initialized = ref(false)

  const { schedule: schedulePersist } = createDebouncedPersist(persist, {
    onError: (e) => console.warn('[keybinds] persist failed:', e),
  })

  async function persist(): Promise<void> {
    if (!isTauri) return
    await writeKeybinds(stringifyJson5(overrides.value))
  }

  // ファイルから写しを入れている間は書き戻さない (#1333 §2)。読んだだけで書くと
  // 起動のたびにファイルが書き換わり、利用者のコメントが消え、notemaid が書いた
  // 形も JSON5.stringify の形に揃えられてしまう
  let hydrating = false
  watch(
    overrides,
    () => {
      if (!hydrating) schedulePersist()
    },
    { deep: true },
  )

  async function hydrate(content: string): Promise<void> {
    hydrating = true
    try {
      overrides.value = parseJson5Document<Record<string, Shortcut[]>>(
        content,
        () => ({}),
      )
      await nextTick()
    } finally {
      hydrating = false
    }
  }

  async function initFileStorage(): Promise<void> {
    const content = await readKeybinds()
    try {
      await hydrate(content)
    } catch (e) {
      console.warn('[keybinds] failed to parse keybinds.json5:', e)
    }
    initialized.value = true
  }

  function init(): void {
    if (isTauri) {
      initFileStorage().catch((e) =>
        console.warn('[keybinds] file storage init failed:', e),
      )
    } else {
      initialized.value = true
    }
  }

  function getShortcuts(commandId: string): Shortcut[] {
    if (commandId in overrides.value) {
      return overrides.value[commandId] ?? []
    }
    const entry = DEFAULT_KEYBINDS.find((e) => e.commandId === commandId)
    return entry?.shortcuts ?? []
  }

  function getDefaultShortcuts(commandId: string): Shortcut[] {
    const entry = DEFAULT_KEYBINDS.find((e) => e.commandId === commandId)
    return entry?.shortcuts ?? []
  }

  function setShortcuts(commandId: string, shortcuts: Shortcut[]) {
    overrides.value = { ...overrides.value, [commandId]: shortcuts }
  }

  function resetToDefault(commandId: string) {
    const { [commandId]: _, ...rest } = overrides.value
    overrides.value = rest
  }

  function resetAll() {
    overrides.value = {}
  }

  function isCustomized(commandId: string): boolean {
    return commandId in overrides.value
  }

  function getAllCommandIds(): string[] {
    return DEFAULT_KEYBINDS.map((e) => e.commandId)
  }

  /**
   * 登録済み command の今のショートカット (#1243)。上書き → 既定ファイル →
   * command 自身の宣言の順。組込は登録時に既定を写しているが、プラグインが
   * `Nd:register_command` で登録した command は宣言が空で既定ファイルにも無いので、
   * keybinds.json5 の上書きだけが効く。キー入力の照合 / OS グローバルの登録 /
   * 表示はすべてこれを通す (登録時の写しを見ない)
   */
  function resolveShortcuts(cmd: {
    id: string
    shortcuts: readonly Shortcut[]
  }): readonly Shortcut[] {
    if (cmd.id in overrides.value) return overrides.value[cmd.id] ?? []
    const entry = DEFAULT_KEYBINDS.find((e) => e.commandId === cmd.id)
    return entry?.shortcuts ?? cmd.shortcuts
  }

  // notecore が keybinds.json5 を書いた (AI の keybinds.* は notecore の本体が
  // 書く, #1133) → 写しを読み直す
  registerSettingsFileHandler('root', async (change) => {
    if (change.name !== 'keybinds.json5' || !isTauri) return
    try {
      await hydrate(await readKeybinds())
    } catch (e) {
      console.warn('[keybinds] reload failed:', e)
    }
  })

  return {
    overrides,
    init,
    getShortcuts,
    getDefaultShortcuts,
    setShortcuts,
    resetToDefault,
    resetAll,
    isCustomized,
    getAllCommandIds,
    resolveShortcuts,
  }
})

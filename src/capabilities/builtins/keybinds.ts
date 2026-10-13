import { type Command, useCommandStore } from '@/commands/registry'
import { TASK_COMMAND_PREFIX } from '@/commands/taskCommandPrefix'
import { isExposed } from '@/settings/exposure'
import { useKeybindsStore } from '@/stores/keybinds'
import { implement, implementCore } from '../declare'

export const keybindsListCapability = implementCore('keybinds.list')

export const keybindsSetCapability = implementCore('keybinds.set')

export const keybindsResetCapability = implementCore('keybinds.reset')

export const keybindsResetAllCapability = implementCore('keybinds.resetAll')

/**
 * 登録元。プラグインのコマンド id は `<provider>:<name>` で、provider は
 * storeId か `local:<installId>` (registrationId.ts)。タスクは `task.<id>`
 */
function commandSource(id: string): string {
  if (id.startsWith(TASK_COMMAND_PREFIX)) return 'task'
  const sep = id.lastIndexOf(':')
  return sep < 0 ? 'builtin' : id.slice(0, sep)
}

/**
 * `commands.list` — コマンドパレットに並ぶコマンドの表示名・アイコン・登録元・
 * 現在のショートカットを返す (#1252)。`keybinds.list` の commandId を人が読める
 * 名前に引くのに使う。表示名は今の UI 言語のまま。
 */
export const commandsListCapability = implement('commands.list', {
  execute: () => {
    const keybinds = useKeybindsStore()
    return (
      [...useCommandStore().commands.values()]
        // パレットと同じ条件 (開発者向けは開発者モードのときだけ)
        .filter((c) => c.visible !== false && isExposed(c.exposure))
        .map((c) => ({
          id: c.id,
          label: c.label,
          icon: c.icon,
          source: commandSource(c.id),
          shortcuts: keybinds.getShortcuts(c.id),
        }))
    )
  },
})

export const KEYBINDS_BUILTIN_CAPABILITIES: readonly Command[] = [
  commandsListCapability,
  keybindsListCapability,
  keybindsSetCapability,
  keybindsResetCapability,
  keybindsResetAllCapability,
]

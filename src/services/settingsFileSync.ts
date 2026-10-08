/**
 * 別の書き手が設定ファイルを書いたときの写しの読み直しの配線表 (#1133 縦切り 4
 * 第 3 弾)。書き手は notecore (AI / 復元) と他のウィンドウ (#1042) の 2 つで、
 * 購読 (Tauri イベント) は `composables/useSettingsFileSync` が行い、ここは
 * 「scope (subdir か root) → handler」の登録と配送だけ (純ロジック、store から
 * import できる)。
 *
 * - store は `registerSettingsFileHandler(scope, handler)` で登録する。scope は
 *   subdir 名 (`'sessions'` / `'skills'` …) か、root ファイルなら `'root'`
 * - 自分のウィンドウの書込 (store 自身の永続化) は届かない。自分の写しは
 *   自分で更新している
 * - 他のウィンドウの書込は subdir 配下のファイルだけ届く。root 直下
 *   (settings.json5 等) は `nd:settings-changed` など各自の経路を持つ
 */

import type { SettingsChange } from '@/bindings'

export type SettingsFileHandler = (
  change: SettingsChange,
) => void | Promise<void>

export const ROOT_SCOPE = 'root'

/** scope → handler の集合。登録解除で消える (面ごとに高々 store の数) */
const handlers = new Map<string, Set<SettingsFileHandler>>()

export function scopeOf(change: Pick<SettingsChange, 'subdir'>): string {
  return change.subdir ?? ROOT_SCOPE
}

/** 自分の面の変更を受ける。戻り値で解除する */
export function registerSettingsFileHandler(
  scope: string,
  handler: SettingsFileHandler,
): () => void {
  let set = handlers.get(scope)
  if (!set) {
    set = new Set()
    handlers.set(scope, set)
  }
  set.add(handler)
  return () => {
    const cur = handlers.get(scope)
    if (!cur) return
    cur.delete(handler)
    if (cur.size === 0) handlers.delete(scope)
  }
}

/** 1 件の変更を該当 scope の handler に配る。handler の失敗は warn で止めない */
export async function dispatchSettingsChange(
  change: SettingsChange,
): Promise<void> {
  const set = handlers.get(scopeOf(change))
  if (!set || set.size === 0) return
  await Promise.all(
    [...set].map(async (h) => {
      try {
        await h(change)
      } catch (e) {
        console.warn(
          `[settings-sync] handler failed for ${scopeOf(change)}/${change.name}:`,
          e,
        )
      }
    }),
  )
}

/** テスト用: 登録を消す */
export function _resetSettingsFileHandlersForTest(): void {
  handlers.clear()
}

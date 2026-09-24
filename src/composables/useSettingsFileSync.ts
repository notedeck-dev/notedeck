/**
 * notecore が設定ファイルを書いたときの写しの読み直し (#1133 縦切り 4 第 3 弾)。
 *
 * notecore が書き手のファイル (AI セッション、`exec: core` な設定系 capability が
 * 書くもの) は、デバイスの store の写しが古くなる。古い写しを書き戻すと
 * notecore の変更が消えるので、notecore は書くたびに `nd:settings-file-changed`
 * (subdir / name / op) を流し、store は自分の面 (subdir か root ファイル) の
 * 変更だけ受けて読み直す。
 *
 * - store は `registerSettingsFileHandler(scope, handler)` で登録する。scope は
 *   subdir 名 (`'sessions'` / `'skills'` …) か、root ファイルなら `'root'`
 * - 購読は `startSettingsFileSync()` で 1 ウィンドウ 1 回 (App.vue)。全ウィンドウ
 *   に届くので、PiP など別ウィンドウの store も追従する
 * - デバイス発の書込 (store 自身の永続化) は通知されない
 */

import type { SettingsChange } from '@/bindings'
import { isTauri } from '@/utils/settingsFs'
import { listenTauri } from '@/utils/tauriEvents'

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

let started = false

/** notecore の変更通知の購読を始める (1 ウィンドウ 1 回) */
export function startSettingsFileSync(): void {
  if (started || !isTauri) return
  started = true
  listenTauri('nd:settings-file-changed', (change) => {
    void dispatchSettingsChange(change)
  }).catch((e) => console.warn('[settings-sync] listen failed:', e))
}

/** テスト用: 登録と購読状態を消す */
export function _resetSettingsFileSyncForTest(): void {
  handlers.clear()
  started = false
}

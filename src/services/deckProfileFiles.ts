/**
 * デッキプロファイル (`profiles/<base>.ndprofile.json5` 単一ファイル) の永続化
 * (#913 で ID → ファイル名対応表化)。themeFileSync と同役割。
 *
 * - 対応表の実体は profile の runtime-only な `fileBase`。
 *   ファイルへは書かない (toFileFormat が strip する)
 * - ID 凍結の実効値 = 拡張子込みの完全ファイル名 (現行「ID = ファイル名」の
 *   フォールバックと同値。既存の nd-deck-active-profile / `?profile=` /
 *   windowProfileId 参照が無追随で生き続ける)
 * - widget マイグレーションの副産物 (Console 削除数・抽出 widget) は
 *   fromFile から返せないため蓄積し、store が drainProfileLoadByproducts で
 *   回収する
 */

import JSON5 from 'json5'
import { parseProfileFile, toFileFormat } from '@/services/deckProfileCodec'
import { injectJson5Id } from '@/services/idFreeze'
import { createSingleFileCollection } from '@/services/singleFileCollection'
import type { DeckProfile } from '@/stores/deck'
import type { WidgetMeta } from '@/stores/widgets'
import * as settingsFs from '@/utils/settingsFs'
import { notifyWarningToast } from '@/utils/toastNotify'

export interface ProfileLoadByproducts {
  droppedConsoleCount: number
  extractedWidgets: WidgetMeta[]
  sidebarSeed: string[]
}

function emptyByproducts(): ProfileLoadByproducts {
  return { droppedConsoleCount: 0, extractedWidgets: [], sidebarSeed: [] }
}

let pendingByproducts = emptyByproducts()

/** loadAll 中に蓄積した widget マイグレーション副産物を回収する。 */
export function drainProfileLoadByproducts(): ProfileLoadByproducts {
  const out = pendingByproducts
  pendingByproducts = emptyByproducts()
  return out
}

export const profileFiles = createSingleFileCollection<
  DeckProfile,
  Record<string, unknown>
>({
  logTag: 'deckProfile',
  notify: notifyWarningToast,
  kindFallback: 'profile',
  ext: settingsFs.PROFILE_EXT,
  // 占有判定・sweep には .history.json5 を含む実列挙が要る
  // (規定拡張子の filter はコレクション側が行う)
  list: () => settingsFs.listProfileDirFiles(),
  read: (filename) => settingsFs.readProfile(filename),
  write: (filename, content) => settingsFs.writeProfile(filename, content),
  remove: (filename) => settingsFs.deleteProfile(filename),
  rename: (oldFilename, newFilename) =>
    settingsFs.renameProfile(oldFilename, newFilename),
  parse: (raw) => JSON5.parse(raw) as Record<string, unknown>,
  accepts: (p) => !!p && typeof p === 'object' && !Array.isArray(p),
  rawIdOf: (p) => p.id,
  effectiveIdOf: (filename) => filename,
  injectId: (raw, id) => injectJson5Id(raw, 'id', id),
  fromFile: (p, id, filename) => {
    const { profile, droppedConsoleCount, extractedWidgets, sidebarSeed } =
      parseProfileFile(p, id, filename)
    pendingByproducts.droppedConsoleCount += droppedConsoleCount
    pendingByproducts.extractedWidgets.push(...extractedWidgets)
    pendingByproducts.sidebarSeed.push(...sidebarSeed)
    return profile
  },
  displayNameOf: (p) => (typeof p.name === 'string' ? p.name : ''),
  idOf: (p) => p.id,
  nameOf: (p) => p.name,
  serialize: (p) => JSON5.stringify(toFileFormat(p), null, 2),
})

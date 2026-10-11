import { singleFileCollectionFor } from '@/services/distributableCodecs/singleFile'
import {
  type ThemeItem,
  themeCodec,
} from '@/services/distributableCodecs/themeCodec'
import { injectJson5Id } from '@/services/idFreeze'
import { casefold } from '@/services/settingsSlug'
import {
  nextDropInId,
  parseDropInRecord,
  parseDropInTheme,
  pickPendingDropIns,
  pruneDropInRecord,
  serializeDropInRecord,
} from '@/services/themeDropIn'
import * as settingsFs from '@/utils/settingsFs'
import { notifyWarningToast } from '@/utils/toastNotify'

/**
 * テーマ (`themes/<base>.ndtheme.json5` 単一ファイル) の永続化
 * (#913 で ID → ファイル名対応表化。#1202 段階 1 で codec をコレクションに載せた)。
 *
 * - 対応表の実体は個体の runtime-only な `fileBase`。ファイルへは書かない
 * - ID 凍結の実効値 = `custom-` + 完全ファイル名 (codec の fallback と同値)
 * - themes/ の素の `.json5` (規定拡張子でないもの) はコレクションの外。
 *   起動時に `adoptDropIns` が一回きりコピーして採用する (#1041)
 */
export const themeFiles = singleFileCollectionFor(themeCodec, {
  logTag: 'theme',
  notify: notifyWarningToast,
  kindFallback: 'theme',
  ext: settingsFs.THEME_EXT,
  // 占有判定・sweep には .history.json5 を含む実列挙が要る
  // (規定拡張子の filter はコレクション側が行う)
  list: () => settingsFs.listThemeDirFiles(),
  read: (filename) => settingsFs.readTheme(filename),
  write: (filename, content) => settingsFs.writeTheme(filename, content),
  remove: (filename) => settingsFs.deleteTheme(filename),
  rename: (oldFilename, newFilename) =>
    settingsFs.renameTheme(oldFilename, newFilename),
  accepts: (p) => !!p && typeof p === 'object' && !!p.props,
  rawIdOf: (p) => p.id,
  effectiveIdOf: (filename) => `custom-${filename}`,
  injectId: (raw, id) => injectJson5Id(raw, 'id', id),
  displayNameOf: (p) => (typeof p.name === 'string' ? p.name : ''),
})

/**
 * themes/ に置かれた素の `.json5` を取り込む (#1041)。規則は services/themeDropIn。
 * 採用したテーマ (fileBase 割当済み) を返す。呼び出し側が一覧に足す。
 * 1 件の失敗は他に波及させない (記録しないので次回起動で再試行される)
 */
export async function adoptDropIns(
  installed: readonly ThemeItem[],
): Promise<ThemeItem[]> {
  const files = await settingsFs.listThemeDirFiles()
  const stored = await settingsFs.readThemeDropInRecordVersioned()
  const before = parseDropInRecord(stored.content)
  const record = pruneDropInRecord(before, files)
  let changed = Object.keys(record).length !== Object.keys(before).length
  const all = [...installed]
  const adopted: ThemeItem[] = []
  for (const filename of pickPendingDropIns(files, record)) {
    let body: ReturnType<typeof parseDropInTheme>
    try {
      body = parseDropInTheme(await settingsFs.readTheme(filename), filename)
    } catch (e) {
      console.warn('[theme] drop-in read failed:', filename, e)
      continue
    }
    if (!body) continue
    const now = Date.now()
    const theme: ThemeItem = {
      id: nextDropInId(new Set(all.map((t) => t.id))),
      name: body.name,
      createdAt: now,
      updatedAt: now,
      // 外部由来のファイルにストア紐付き / per-account 紐付きを持ち込まない
      scope: { kind: 'shared', global: false, installedFor: [] },
      content: { base: body.base ?? 'dark', props: body.props },
      extra: {},
    }
    try {
      await themeFiles.persistItem(theme, all)
    } catch (e) {
      console.warn('[theme] drop-in adopt failed:', filename, e)
      continue
    }
    all.push(theme)
    adopted.push(theme)
    record[casefold(filename)] = theme.id
    changed = true
  }
  if (changed) {
    // 条件付き (#1106): 先を越されたら記録しない (次回起動で取り直す)
    await settingsFs
      .writeThemeDropInRecord(serializeDropInRecord(record), stored.version)
      .catch((e) => console.warn('[theme] drop-in record write failed:', e))
  }
  return adopted
}

/** Write custom CSS to file. */
export async function writeCustomCssFile(css: string): Promise<void> {
  await settingsFs.writeCustomCss(css)
}

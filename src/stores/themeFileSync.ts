import JSON5 from 'json5'
import { injectJson5Id } from '@/services/idFreeze'
import { casefold } from '@/services/settingsSlug'
import { createSingleFileCollection } from '@/services/singleFileCollection'
import {
  nextDropInId,
  parseDropInRecord,
  parseDropInTheme,
  pickPendingDropIns,
  pruneDropInRecord,
  serializeDropInRecord,
} from '@/services/themeDropIn'
import type { MisskeyTheme, NotedeckThemeMeta } from '@/theme/types'
import * as settingsFs from '@/utils/settingsFs'
import { notifyWarningToast } from '@/utils/toastNotify'

/**
 * テーマ (`themes/<base>.ndtheme.json5` 単一ファイル) の永続化
 * (#913 で ID → ファイル名対応表化)。
 *
 * - 対応表の実体は theme オブジェクトの runtime-only な `fileBase`。
 *   ファイルへは書かない (serializeTheme が projection で strip する)
 * - ID 凍結の実効値 = `custom-` + 完全ファイル名 (現行フォールバックと同値)
 * - themes/ の素の `.json5` (規定拡張子でないもの) はコレクションの外。
 *   起動時に `adoptDropIns` が一回きりコピーして採用する (#1041)
 */

type ParsedTheme = Record<string, unknown>

/** テーマ 1 件のファイル projection。runtime-only の fileBase は含めない。 */
function serializeTheme(theme: MisskeyTheme): string {
  const out: Record<string, unknown> = {
    id: theme.id,
    name: theme.name,
    base: theme.base === 'light' ? 'light' : 'dark',
    props: theme.props,
  }
  // NoteDeck 独自メタ ($notedeck) は従来どおりファイルに書く
  if (theme.$notedeck) out.$notedeck = theme.$notedeck
  return JSON5.stringify(out, null, 2)
}

export const themeFiles = createSingleFileCollection<MisskeyTheme, ParsedTheme>(
  {
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
    parse: (raw) => JSON5.parse(raw) as ParsedTheme,
    accepts: (p) => !!p && typeof p === 'object' && !!p.props,
    rawIdOf: (p) => p.id,
    effectiveIdOf: (filename) => `custom-${filename}`,
    injectId: (raw, id) => injectJson5Id(raw, 'id', id),
    fromFile: (p, id, filename) => {
      const theme: MisskeyTheme = {
        id,
        name: typeof p.name === 'string' && p.name ? p.name : filename,
        base: p.base === 'light' ? 'light' : 'dark',
        props: p.props as Record<string, string>,
      }
      // NoteDeck 独自メタ ($notedeck.storeId / installedFor 等) を保持
      // しないと再起動時にストア紐付き / per-account 紐付きが消える
      if (p.$notedeck && typeof p.$notedeck === 'object') {
        theme.$notedeck = { ...(p.$notedeck as NotedeckThemeMeta) }
      }
      return theme
    },
    displayNameOf: (p) => (typeof p.name === 'string' ? p.name : ''),
    idOf: (t) => t.id,
    nameOf: (t) => t.name,
    serialize: serializeTheme,
  },
)

export interface FileStorageData {
  themes: MisskeyTheme[]
  /** ディレクトリに存在した .ndtheme.json5 の数 (パース失敗分を含む) */
  entryFileCount: number
  customCss: string | null
  /** True when localStorage has custom CSS but no file exists */
  needsMigrateCss: boolean
}

/** Load installed themes and custom CSS from the file system. */
export async function loadFromFiles(): Promise<FileStorageData> {
  const { items, entryFileCount } = await themeFiles.loadAll()
  const customCss = await settingsFs.readCustomCss()
  return {
    themes: items,
    entryFileCount,
    customCss: customCss || null,
    needsMigrateCss: !customCss,
  }
}

/**
 * themes/ に置かれた素の `.json5` を取り込む (#1041)。規則は services/themeDropIn。
 * 採用したテーマ (fileBase 割当済み) を返す。呼び出し側が一覧に足す。
 * 1 件の失敗は他に波及させない (記録しないので次回起動で再試行される)
 */
export async function adoptDropIns(
  installed: readonly MisskeyTheme[],
): Promise<MisskeyTheme[]> {
  const files = await settingsFs.listThemeDirFiles()
  const before = parseDropInRecord(await settingsFs.readThemeDropInRecord())
  const record = pruneDropInRecord(before, files)
  let changed = Object.keys(record).length !== Object.keys(before).length
  const all = [...installed]
  const adopted: MisskeyTheme[] = []
  for (const filename of pickPendingDropIns(files, record)) {
    let body: ReturnType<typeof parseDropInTheme>
    try {
      body = parseDropInTheme(await settingsFs.readTheme(filename), filename)
    } catch (e) {
      console.warn('[theme] drop-in read failed:', filename, e)
      continue
    }
    if (!body) continue
    const theme: MisskeyTheme = {
      id: nextDropInId(new Set(all.map((t) => t.id))),
      ...body,
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
    await settingsFs.writeThemeDropInRecord(serializeDropInRecord(record))
  }
  return adopted
}

/** Write custom CSS to file. */
export async function writeCustomCssFile(css: string): Promise<void> {
  await settingsFs.writeCustomCss(css)
}

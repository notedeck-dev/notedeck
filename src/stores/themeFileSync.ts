import JSON5 from 'json5'

import { injectJson5Id } from '@/services/idFreeze'
import { createSingleFileCollection } from '@/services/singleFileCollection'
import type { MisskeyTheme, NotedeckThemeMeta } from '@/theme/types'
import * as settingsFs from '@/utils/settingsFs'

/**
 * テーマ (`themes/<base>.ndtheme.json5` 単一ファイル) の永続化
 * (#913 で ID → ファイル名対応表化)。
 *
 * - 対応表の実体は theme オブジェクトの runtime-only な `fileBase`。
 *   ファイルへは書かない (serializeTheme が projection で strip する)
 * - ID 凍結の実効値 = `custom-` + 完全ファイル名 (現行フォールバックと同値)
 * - themes/ の素の `.json5` (規定拡張子でないもの) は従来どおり無視
 *   (drop-in は #1041 スコープ外)
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

/** Write custom CSS to file. */
export async function writeCustomCssFile(css: string): Promise<void> {
  await settingsFs.writeCustomCss(css)
}

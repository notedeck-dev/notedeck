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

/**
 * テーマ 1 件のファイル projection。runtime-only の fileBase は含めない。
 * 形は notecore の `themes.rs` `serialize_theme_file` と、codec
 * (`services/distributableCodecs/themeCodec.ts`) の出力と一致する
 * (storeParity.test / golden が固定)
 */
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

/** `$notedeck` に createdAt / updatedAt が揃っているか (#1202 段階 0 の揃え) */
function hasTimestamps(nd: unknown): boolean {
  if (!nd || typeof nd !== 'object') return false
  const m = nd as Record<string, unknown>
  return typeof m.createdAt === 'number' && typeof m.updatedAt === 'number'
}

/**
 * パース済みファイル + 確定 ID → テーマ。NoteDeck 独自メタ ($notedeck.storeId /
 * installedFor 等) を保持しないと再起動時にストア紐付き / per-account 紐付きが
 * 消える。`$notedeck` は規定順 (ストア 3 点 → installedFor → 時刻) に並べ直し、
 * createdAt / updatedAt が無い旧ファイルは今を入れる (メインウィンドウが
 * 書き戻す。#1202 段階 0)。変更通知の写し更新 (theme store) も同じ関数を使う
 */
export function themeFromFile(
  p: ParsedTheme,
  id: string,
  filename: string,
  now: number = Date.now(),
): MisskeyTheme {
  const nd =
    p.$notedeck && typeof p.$notedeck === 'object'
      ? (p.$notedeck as NotedeckThemeMeta)
      : {}
  return {
    id,
    name: typeof p.name === 'string' && p.name ? p.name : filename,
    base: p.base === 'light' ? 'light' : 'dark',
    props: p.props as Record<string, string>,
    $notedeck: {
      ...(nd.storeId ? { storeId: nd.storeId } : {}),
      ...(nd.storeSha512 ? { storeSha512: nd.storeSha512 } : {}),
      ...(nd.storeVersion ? { storeVersion: nd.storeVersion } : {}),
      ...(nd.installedFor?.length ? { installedFor: nd.installedFor } : {}),
      createdAt: typeof nd.createdAt === 'number' ? nd.createdAt : now,
      updatedAt: typeof nd.updatedAt === 'number' ? nd.updatedAt : now,
    },
  }
}

/**
 * 内部関数の test 用 export (codec との一致検査)。プロダクトコードから直接
 * 呼ばないこと
 */
export const _internal = { serializeTheme }

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
    fromFile: (p, id, filename) => themeFromFile(p, id, filename),
    // #1202 段階 0: $notedeck の createdAt / updatedAt が無い旧ファイルは書き戻して揃える
    isOutdated: (p) => !hasTimestamps(p.$notedeck),
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
  /** on-disk の形が古く、書き戻して揃えるテーマ (`themes` の部分集合、#1202) */
  outdated: MisskeyTheme[]
  customCss: string | null
  /** True when localStorage has custom CSS but no file exists */
  needsMigrateCss: boolean
}

/** Load installed themes and custom CSS from the file system. */
export async function loadFromFiles(): Promise<FileStorageData> {
  const { items, entryFileCount, outdated } = await themeFiles.loadAll()
  const customCss = await settingsFs.readCustomCss()
  return {
    themes: items,
    entryFileCount,
    outdated,
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
  const stored = await settingsFs.readThemeDropInRecordVersioned()
  const before = parseDropInRecord(stored.content)
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

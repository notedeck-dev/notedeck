import JSON5 from 'json5'
import type {
  DistributableCodec,
  DistributableMeta,
  FileContext,
} from '@/services/distributable'

/**
 * テーマ (`themes/<slug>.ndtheme.json5` 単一ファイル) の codec (#1202 段階 0)。
 * Rust 側は `crates/notecore/src/themes.rs` の `parse_theme_code` /
 * `serialize_theme_file`。
 *
 * on-disk は Misskey 互換の上位 (id / name / base / props) を保ち、NoteDeck
 * 独自メタは `$notedeck` の下に畳む (本家は知らないキーだが registry sync で
 * パススルーされる)。段階 0 で `$notedeck` に createdAt / updatedAt を足した:
 *
 * `$notedeck`: storeId? / storeSha512? / storeVersion?, installedFor? (空は
 * 書かない), createdAt, updatedAt — この順
 *
 * スコープは `shared` だが global を持たない (紐付けの配列だけ。外して空に
 * なった本体は store 側が削除する)。「有効」は無い (選択は settings 側)
 */
export interface ThemeNotedeckMeta {
  storeId?: string
  storeSha512?: string
  storeVersion?: string
  installedFor?: string[]
  createdAt: number
  updatedAt: number
}

export interface ThemeFile {
  id: string
  name: string
  base: 'dark' | 'light'
  props: Record<string, string>
  $notedeck: ThemeNotedeckMeta
}

/** 読むときの形 (旧ファイルは `$notedeck` やその時刻を欠く) */
export type ThemeFileInput = Partial<Omit<ThemeFile, '$notedeck'>> & {
  $notedeck?: Partial<ThemeNotedeckMeta>
}

export interface ThemeContent {
  base: 'dark' | 'light'
  props: Record<string, string>
}

export type ThemeItem = DistributableMeta<ThemeContent, Record<string, never>>

/** ID 凍結の欠損判定 (single-file collection と同じ規則) */
function isValidId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 256
}

function fromFile(file: ThemeFileInput, ctx: FileContext): ThemeItem {
  const nd = file.$notedeck ?? {}
  return {
    // ID 凍結の実効値 = `custom-` + 完全ファイル名 (themeFileSync と同値)
    id: isValidId(file.id) ? file.id : `custom-${ctx.filename}`,
    name: file.name || ctx.filename,
    createdAt: typeof nd.createdAt === 'number' ? nd.createdAt : ctx.now,
    updatedAt: typeof nd.updatedAt === 'number' ? nd.updatedAt : ctx.now,
    store: nd.storeId
      ? {
          id: nd.storeId,
          ...(nd.storeSha512 ? { sha512: nd.storeSha512 } : {}),
          ...(nd.storeVersion ? { version: nd.storeVersion } : {}),
        }
      : undefined,
    scope: {
      kind: 'shared',
      global: false,
      installedFor: nd.installedFor ?? [],
    },
    content: {
      base: file.base === 'light' ? 'light' : 'dark',
      props: file.props ?? {},
    },
    extra: {},
  }
}

function toFile(item: ThemeItem): ThemeFile {
  const installedFor =
    item.scope.kind === 'shared' ? item.scope.installedFor : []
  return {
    id: item.id,
    name: item.name,
    base: item.content.base,
    props: item.content.props,
    $notedeck: {
      ...(item.store ? { storeId: item.store.id } : {}),
      ...(item.store?.sha512 ? { storeSha512: item.store.sha512 } : {}),
      ...(item.store?.version ? { storeVersion: item.store.version } : {}),
      ...(installedFor.length > 0 ? { installedFor } : {}),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    },
  }
}

/** `$notedeck` に時刻が揃っているか (段階 0 の揃えの判定) */
export function themeHasTimestamps(
  nd: Partial<ThemeNotedeckMeta> | undefined,
): boolean {
  return typeof nd?.createdAt === 'number' && typeof nd?.updatedAt === 'number'
}

export const themeCodec: DistributableCodec<ThemeFileInput, ThemeItem> = {
  kind: 'theme',
  fromFile,
  toFile,
  encode: (file) => JSON5.stringify(file, null, 2),
  decode: (text) => JSON5.parse(text) as ThemeFileInput,
  outdated: (file) => !themeHasTimestamps(file.$notedeck),
}

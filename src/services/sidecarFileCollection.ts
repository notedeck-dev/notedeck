import JSON5 from 'json5'

/**
 * 「src + meta サイドカーペアで 1 アイテム」を表すコレクションのファイル
 * 永続化サービス (#782 Phase 2)。plugins / widgets が同型実装していた
 * persistSingle / persistAll / deleteFiles / initFileStorage のパース部を
 * 共通化する。
 *
 * 状態は持たない。reactive state・localStorage・マージ/seed の方針は
 * 引き続き store 側が持ち、ファイル I/O の手続きだけをここへ委譲する。
 */
export interface SidecarCollectionConfig<T, M> {
  /** console.warn の識別子 (例: 'plugins') */
  logTag: string
  /** 基底名 → src ファイル名 (例: `${name}.is`) */
  srcFilename(base: string): string
  /** 基底名 → meta ファイル名 (例: `${name}.meta.json5`) */
  metaFilename(base: string): string
  list(): Promise<string[]>
  read(filename: string): Promise<string>
  write(filename: string, content: string): Promise<void>
  remove(filename: string): Promise<void>
  /** ファイル名の基底 (慣例: `item.name || item.installId`) */
  baseName(item: T): string
  srcOf(item: T): string
  /** item → meta ファイルに書く projection */
  toFileMeta(item: T): M
  /** パース済み meta + src → item。呼び出し側の try/catch はサービスが持つ */
  fromFile(meta: M, src: string, metaFile: string): T
}

const META_SUFFIX = '.meta.json5'
const SRC_SUFFIX = '.is'

export interface LoadAllResult<T> {
  items: T[]
  /**
   * ディレクトリに存在した meta ファイル数。`items.length` と別に返すのは
   * 「全ファイルがパース失敗」(entryFileCount > 0, items 空) と「ファイルなし」
   * (= localStorage → ファイルの片方向移行が必要) を呼び出し側が区別するため。
   */
  entryFileCount: number
}

export function createSidecarCollection<T, M>(
  cfg: SidecarCollectionConfig<T, M>,
) {
  async function persistItem(item: T): Promise<void> {
    const base = cfg.baseName(item)
    const meta = cfg.toFileMeta(item)
    await Promise.all([
      cfg.write(cfg.srcFilename(base), cfg.srcOf(item)),
      cfg.write(cfg.metaFilename(base), JSON5.stringify(meta, null, 2)),
    ])
  }

  async function persistAll(items: readonly T[]): Promise<void> {
    await Promise.all(items.map((item) => persistItem(item)))
  }

  async function deleteItemFiles(item: T): Promise<void> {
    const base = cfg.baseName(item)
    await Promise.all([
      cfg.remove(cfg.srcFilename(base)),
      cfg.remove(cfg.metaFilename(base)),
    ])
  }

  async function loadAll(): Promise<LoadAllResult<T>> {
    const allFiles = await cfg.list()
    const metaFiles = allFiles.filter((f) => f.endsWith(META_SUFFIX))

    const results = await Promise.all(
      metaFiles.map(async (metaFile) => {
        try {
          const srcFile = metaFile.replace(/\.meta\.json5$/, SRC_SUFFIX)
          const [metaContent, src] = await Promise.all([
            cfg.read(metaFile),
            allFiles.includes(srcFile)
              ? cfg.read(srcFile)
              : Promise.resolve(''),
          ])
          const meta = JSON5.parse(metaContent) as M
          return cfg.fromFile(meta, src, metaFile)
        } catch (e) {
          console.warn(`[${cfg.logTag}] failed to parse ${metaFile}:`, e)
          return null
        }
      }),
    )
    return {
      items: results.filter((item): item is Awaited<T> => item !== null),
      entryFileCount: metaFiles.length,
    }
  }

  return { persistItem, persistAll, deleteItemFiles, loadAll }
}

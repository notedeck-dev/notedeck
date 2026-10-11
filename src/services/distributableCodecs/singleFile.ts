import type {
  DistributableCodec,
  DistributableFileCollection,
  DistributableMeta,
} from '@/services/distributable'
import { createSingleFileCollection } from '@/services/singleFileCollection'

/**
 * 単一ファイルの kind (skill の `.md` / theme の `.ndtheme.json5`) の I/O と、
 * codec では決まらない ID 凍結の規則 (実効値 / 注入) を kind 側が渡す
 */
export interface SingleFileIo<File> {
  /** console.warn の識別子 */
  logTag: string
  /** slug が空になったときの種別 fallback */
  kindFallback: string
  /** 規定複合拡張子 ('.md' | '.ndtheme.json5') */
  ext: string
  list(): Promise<string[]>
  read(filename: string): Promise<string>
  write(filename: string, content: string): Promise<void>
  remove(filename: string): Promise<void>
  rename(oldFilename: string, newFilename: string): Promise<void>
  notify?(message: string): void
  /** パース結果の生 ID (欠損判定前) */
  rawIdOf(file: File): unknown
  /** ID 凍結の実効値 (skill = 拡張子なし basename / theme = `custom-<完全ファイル名>`) */
  effectiveIdOf(filename: string, base: string): string
  /** 生内容への最小変換で ID を注入する (idFreeze) */
  injectId(raw: string, id: string): string
  /** copy-adopt で slug の元にする表示名 (欠損なら '' → kindFallback に落ちる) */
  displayNameOf(file: File): string
  /** パース成功でも採用しない個体 (theme の props 欠損等) */
  accepts?(file: File): boolean
}

/**
 * codec を単一ファイルのコレクションに載せる (store factory の `files`)。
 * sidecar 版 (`sidecarCollectionFor`) と対。読み書きの projection は codec が
 * 持ち、コレクションはファイル名の対応表と直列化だけを担う。ストア由来の個体は
 * ファイル名 = storeId を優先 (#913)
 */
export function singleFileCollectionFor<
  File,
  Item extends DistributableMeta<unknown, unknown>,
>(
  codec: DistributableCodec<File, Item>,
  io: SingleFileIo<File>,
): DistributableFileCollection<Item> {
  return createSingleFileCollection<Item, File>({
    ...io,
    parse: (raw) => codec.decode(raw),
    // ID はコレクションが凍結した実効値を正とする (codec の fallback と同値)
    fromFile: (file, id, filename) => ({
      ...codec.fromFile(file, { filename, now: Date.now() }),
      id,
    }),
    isOutdated: (file) => codec.outdated(file),
    idOf: (item) => item.id,
    nameOf: (item) => item.name,
    serialize: (item) => codec.encode(codec.toFile(item)),
    preferredBase: (item) => item.store?.id,
  })
}

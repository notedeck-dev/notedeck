import JSON5 from 'json5'
import type {
  DistributableCodec,
  DistributableFileCollection,
  DistributableMeta,
  DistributableStoreOrigin,
} from '@/services/distributable'
import {
  createSidecarCollection,
  META_SUFFIX,
} from '@/services/sidecarFileCollection'

/**
 * sidecar 形式 (src `.is` + meta `.meta.json5` の 2 ファイルで 1 個体) の
 * codec が共有する部品。Rust 側は `crates/notecore/src/sidecar/`
 */

/** パース済みのメタ + ソース本文 */
export interface SidecarFile<Meta> {
  meta: Meta
  src: string
}

/** メタファイルの本文。store の `JSON5.stringify(meta, null, 2)` と同じ */
export function sidecarMetaText(meta: unknown): string {
  return JSON5.stringify(meta, null, 2)
}

export function decodeSidecar<Meta>(
  metaText: string,
  src: string,
): SidecarFile<Meta> {
  return { meta: JSON5.parse(metaText) as Meta, src }
}

/** ファイル内の storeId / storeSha512 / storeVersion → envelope の `store` */
export function storeOriginOf(meta: {
  storeId?: string
  storeSha512?: string
  storeVersion?: string
}): DistributableStoreOrigin | undefined {
  if (!meta.storeId) return undefined
  return {
    id: meta.storeId,
    ...(meta.storeSha512 ? { sha512: meta.storeSha512 } : {}),
    ...(meta.storeVersion ? { version: meta.storeVersion } : {}),
  }
}

/** envelope の `store` → ファイルの 3 点 (無いものは書かない) */
export function storeFieldsOf(store: DistributableStoreOrigin | undefined): {
  storeId?: string
  storeSha512?: string
  storeVersion?: string
} {
  if (!store) return {}
  return {
    storeId: store.id,
    ...(store.sha512 ? { storeSha512: store.sha512 } : {}),
    ...(store.version ? { storeVersion: store.version } : {}),
  }
}

/** 変更通知のファイル名 → fileBase。メタファイル以外 (ソース / 履歴) は対象外 */
export function sidecarFileBaseOf(filename: string): string | undefined {
  return filename.endsWith(META_SUFFIX)
    ? filename.slice(0, -META_SUFFIX.length)
    : undefined
}

export interface SidecarIo {
  /** console.warn の識別子 */
  logTag: string
  /** slug が空になったときの種別 fallback */
  kindFallback: string
  /** メタ JSON5 内の ID キー名 ('installId' | 'id') */
  idKey: string
  list(): Promise<string[]>
  read(filename: string): Promise<string>
  write(filename: string, content: string): Promise<void>
  remove(filename: string): Promise<void>
  rename(oldFilename: string, newFilename: string): Promise<void>
  notify?(message: string): void
}

/**
 * codec を sidecar コレクションに載せる (store factory の `files`)。
 * 読み書きの projection は codec が持ち、コレクションはファイル名の対応表と
 * 直列化だけを担う。ストア由来の個体はファイル名 = storeId を優先 (#913)
 */
export function sidecarCollectionFor<
  Meta,
  Item extends DistributableMeta<string, unknown>,
>(
  codec: DistributableCodec<SidecarFile<Meta>, Item>,
  io: SidecarIo,
): DistributableFileCollection<Item> {
  return createSidecarCollection<Item, Meta>({
    ...io,
    idOf: (item) => item.id,
    nameOf: (item) => item.name,
    srcOf: (item) => item.content,
    preferredBase: (item) => item.store?.id,
    toFileMeta: (item) => codec.toFile(item).meta,
    fromFile: (meta, src, metaFile) =>
      codec.fromFile({ meta, src }, { filename: metaFile, now: Date.now() }),
    isOutdated: (meta) => codec.outdated({ meta, src: '' }),
  })
}

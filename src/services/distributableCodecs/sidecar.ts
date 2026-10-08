import JSON5 from 'json5'
import type { DistributableStoreOrigin } from '@/services/distributable'

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

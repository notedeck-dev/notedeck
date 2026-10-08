import type {
  DistributableCodec,
  DistributableMeta,
  FileContext,
} from '@/services/distributable'
import {
  decodeSidecar,
  type SidecarFile,
  sidecarMetaText,
  storeFieldsOf,
  storeOriginOf,
} from '@/services/distributableCodecs/sidecar'

/**
 * カラムクエリ (`queries/<slug>.is` + `.meta.json5`) の codec (#1202 段階 0)。
 * Rust 側は `crates/notecore/src/sidecar/queries.rs` の `normalize_meta`。
 *
 * on-disk (段階 0 で `disabled` (反転、true のときだけ) を `active` (常に書く)
 * に揃えた):
 * id, name, description?, storeId? / storeSha512? / storeVersion? / iconUrl?,
 * global? (true のときだけ), installedFor? (空は書かない), scoped? (true の
 * ときだけ), active (常に), createdAt, updatedAt
 *
 * 読むときは両方受ける (`active` があればそれ、無ければ `disabled !== true`)。
 * 旧形式のファイルは `outdated` で書き戻しの対象になる
 */
export interface QueryFileMeta {
  id: string
  name: string
  description?: string
  storeId?: string
  storeSha512?: string
  storeVersion?: string
  iconUrl?: string
  global?: boolean
  installedFor?: string[]
  scoped?: boolean
  active: boolean
  createdAt: number
  updatedAt: number
  /** @deprecated 旧形式 (反転の印、true のときだけ)。読むだけで、書かない */
  disabled?: boolean
}

export type QueryFile = SidecarFile<Partial<QueryFileMeta>>

export interface QueryExtra {
  /**
   * スコープ機構に載った個体の印 (#1018)。無いものはスコープ導入前に作られた
   * ので初回読込で全体スコープへ移行する (移行済みかどうかを個体側に持つ)
   */
  scoped: boolean
  /**
   * 本体の有効 (#1043)。無効なクエリは参照している全カラムで評価上「無いもの」
   * (fail-open)。カラムの適用やスコープ参加には触れない
   */
  active: boolean
}

export type QueryItem = DistributableMeta<string, QueryExtra>

function activeOf(m: Partial<QueryFileMeta>): boolean {
  if (typeof m.active === 'boolean') return m.active
  return m.disabled !== true
}

function fromFile(file: QueryFile, ctx: FileContext): QueryItem {
  const m = file.meta
  return {
    id: m.id || ctx.filename,
    name: m.name || ctx.filename,
    description: m.description,
    iconUrl: m.iconUrl,
    createdAt: m.createdAt ?? ctx.now,
    updatedAt: m.updatedAt ?? ctx.now,
    store: storeOriginOf(m),
    scope: {
      kind: 'shared',
      global: m.global === true,
      installedFor: m.installedFor ?? [],
    },
    content: file.src,
    extra: { scoped: m.scoped === true, active: activeOf(m) },
  }
}

function toFile(item: QueryItem): QueryFile {
  const scope = item.scope.kind === 'shared' ? item.scope : undefined
  const meta: QueryFileMeta = {
    id: item.id,
    name: item.name,
    ...(item.description ? { description: item.description } : {}),
    ...storeFieldsOf(item.store),
    ...(item.iconUrl ? { iconUrl: item.iconUrl } : {}),
    ...(scope?.global ? { global: true } : {}),
    ...(scope?.installedFor.length ? { installedFor: scope.installedFor } : {}),
    ...(item.extra.scoped ? { scoped: true } : {}),
    active: item.extra.active,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
  return { meta, src: item.content }
}

export const queryCodec: DistributableCodec<QueryFile, QueryItem> = {
  kind: 'query',
  fromFile,
  toFile,
  encode: (file) => sidecarMetaText(file.meta),
  decode: (text, src = '') => decodeSidecar(text, src),
  // 旧形式 (`disabled` の省略書式) は `active` を常に書く形へ書き戻す
  outdated: (file) => typeof file.meta.active !== 'boolean',
  enabled: {
    get: (item) => item.extra.active,
    set: (item, enabled) => ({
      ...item,
      extra: { ...item.extra, active: enabled },
    }),
  },
}

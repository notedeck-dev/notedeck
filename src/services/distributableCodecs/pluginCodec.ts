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
import type { PluginConfigDef } from '@/stores/plugins'

/**
 * プラグイン (`plugins/<slug>.is` + `.meta.json5`) の codec (#1202 段階 0)。
 * Rust 側は `crates/notecore/src/sidecar/plugins.rs` の `normalize_meta` で、
 * キー順と省略規則が一致することを golden (`golden/vectors.json`) で固定する。
 *
 * on-disk (段階 0 で createdAt / updatedAt を足した):
 * installId, name, version, author?, description?, permissions? (空は書かない),
 * config? (truthy のときだけ), configData (常に), active (常に),
 * global? (true のときだけ), installedFor? (空は書かない),
 * storeId? / storeSha512? / storeVersion? / iconUrl?, createdAt, updatedAt
 */
export interface PluginFileMeta {
  installId: string
  name: string
  version: string
  author?: string
  description?: string
  permissions?: string[]
  config?: Record<string, PluginConfigDef>
  configData: Record<string, unknown>
  active: boolean
  global?: boolean
  installedFor?: string[]
  storeId?: string
  storeSha512?: string
  storeVersion?: string
  iconUrl?: string
  createdAt: number
  updatedAt: number
}

export type PluginFile = SidecarFile<Partial<PluginFileMeta>>

export interface PluginExtra {
  /** プラグインヘッダの版 (`/// @ <ver>`)。無ければ `0.0.0` */
  version: string
  author?: string
  /** ヘッダで宣言した権限 (`### { permissions }`) */
  permissions?: string[]
  /** 設定項目の定義 (`### { config }`) */
  config?: Record<string, PluginConfigDef>
  /** 設定値 (ローカル)。ストア更新で新しいキーだけ default を補う */
  configData: Record<string, unknown>
  /** 本体の有効 (起動 / 停止はデバイスが変更通知で行う) */
  active: boolean
}

export type PluginItem = DistributableMeta<string, PluginExtra>

function fromFile(file: PluginFile, ctx: FileContext): PluginItem {
  const m = file.meta
  return {
    id: m.installId || ctx.filename,
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
    extra: {
      version: m.version || '0.0.0',
      author: m.author,
      permissions: m.permissions,
      config: m.config,
      configData: m.configData || {},
      active: m.active ?? false,
    },
  }
}

function toFile(item: PluginItem): PluginFile {
  const x = item.extra
  const scope = item.scope.kind === 'shared' ? item.scope : undefined
  const meta: PluginFileMeta = {
    installId: item.id,
    name: item.name,
    version: x.version,
    ...(x.author ? { author: x.author } : {}),
    ...(item.description ? { description: item.description } : {}),
    ...(x.permissions?.length ? { permissions: x.permissions } : {}),
    ...(x.config ? { config: x.config } : {}),
    configData: x.configData,
    active: x.active,
    ...(scope?.global ? { global: true } : {}),
    ...(scope?.installedFor.length ? { installedFor: scope.installedFor } : {}),
    ...storeFieldsOf(item.store),
    ...(item.iconUrl ? { iconUrl: item.iconUrl } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
  return { meta, src: item.content }
}

export const pluginCodec: DistributableCodec<PluginFile, PluginItem> = {
  kind: 'plugin',
  fromFile,
  toFile,
  encode: (file) => sidecarMetaText(file.meta),
  decode: (text, src = '') => decodeSidecar(text, src),
  // 段階 0 で足した createdAt / updatedAt が無い旧ファイルは書き戻して揃える
  outdated: (file) =>
    typeof file.meta.createdAt !== 'number' ||
    typeof file.meta.updatedAt !== 'number',
  enabled: {
    get: (item) => item.extra.active,
    set: (item, enabled) => ({
      ...item,
      extra: { ...item.extra, active: enabled },
    }),
  },
}

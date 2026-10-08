import type {
  DistributableCodec,
  DistributableMeta,
  DistributableScope,
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
 * ウィジェット (`widgets/<slug>.is` + `.meta.json5`) の codec (#1202 段階 0)。
 * Rust 側は `crates/notecore/src/sidecar/widgets.rs` の `normalize_meta`。
 *
 * on-disk (段階 0 では変えない):
 * installId, name, autoRun (常に), storeId? / storeSha512? / storeVersion? /
 * iconUrl?, accountKey?, createdAt, updatedAt
 *
 * 「有効」は宣言しない — autoRun は「mount 時に自動実行するか」で、false でも
 * 手動実行できる (有効フラグではない)。envelope では `extra.autoRun` のまま
 */
export interface WidgetFileMeta {
  installId: string
  name: string
  autoRun: boolean
  storeId?: string
  storeSha512?: string
  storeVersion?: string
  iconUrl?: string
  accountKey?: string
  createdAt: number
  updatedAt: number
  /** @deprecated 旧形式の実行アカウント (内部 UUID)。読むだけで、書かない */
  accountId?: string
}

export type WidgetFile = SidecarFile<Partial<WidgetFileMeta>>

export interface WidgetExtra {
  /** mount 時に自動実行するか (有効フラグではない) */
  autoRun: boolean
  /**
   * 実行アカウントの安定キー (`accountScopeKey`、#1061)。on-disk の正本で、
   * `scope` はここから写した過渡的なビュー (下を参照)。段階 1 の widget の
   * 回で紐付け配列 (`installedFor`) に置き換わる
   */
  accountKey?: string
  /**
   * 旧形式の実行アカウント (内部 UUID)。accountKey が無いファイルから読んだ
   * ときだけ持ち、accounts ロード後の移行で accountKey に置換される
   */
  legacyAccountId?: string
}

export type WidgetItem = DistributableMeta<string, WidgetExtra>

/**
 * 過渡的な写し (段階 0): on-disk の `accountKey` (1 アカウント) を 2 戦略の
 * `shared` に写す。accountKey あり = そのアカウントだけ、無し = 全体
 * (per-account カラムではカラムのアカウントで動く)。書くときは `extra.accountKey`
 * を見るので、`scope` を書き換えても on-disk には反映されない (段階 1 で逆転)
 */
function scopeOf(accountKey: string | undefined): DistributableScope {
  return accountKey
    ? { kind: 'shared', global: false, installedFor: [accountKey] }
    : { kind: 'shared', global: true, installedFor: [] }
}

function fromFile(file: WidgetFile, ctx: FileContext): WidgetItem {
  const m = file.meta
  return {
    id: m.installId || ctx.filename,
    name: m.name || ctx.filename,
    iconUrl: m.iconUrl,
    createdAt: m.createdAt ?? ctx.now,
    updatedAt: m.updatedAt ?? ctx.now,
    store: storeOriginOf(m),
    scope: scopeOf(m.accountKey),
    content: file.src,
    extra: {
      autoRun: m.autoRun ?? false,
      accountKey: m.accountKey,
      legacyAccountId: m.accountKey ? undefined : m.accountId,
    },
  }
}

function toFile(item: WidgetItem): WidgetFile {
  const x = item.extra
  const meta: WidgetFileMeta = {
    installId: item.id,
    name: item.name,
    autoRun: x.autoRun,
    ...storeFieldsOf(item.store),
    ...(item.iconUrl ? { iconUrl: item.iconUrl } : {}),
    ...(x.accountKey ? { accountKey: x.accountKey } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
  return { meta, src: item.content }
}

export const widgetCodec: DistributableCodec<WidgetFile, WidgetItem> = {
  kind: 'widget',
  fromFile,
  toFile,
  encode: (file) => sidecarMetaText(file.meta),
  decode: (text, src = '') => decodeSidecar(text, src),
  // 段階 0 では on-disk を変えない (accountKey → 紐付け配列は段階 1)
  outdated: () => false,
}

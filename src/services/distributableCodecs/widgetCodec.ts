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
 * ウィジェット (`widgets/<slug>.is` + `.meta.json5`) の codec (#1202 段階 1)。
 * Rust 側は `crates/notecore/src/sidecar/widgets.rs` の `normalize_meta`。
 *
 * on-disk (段階 1 で本体を紐付け配列で共有する形に揃えた、決定 (b)):
 * installId, name, autoRun (常に), storeId? / storeSha512? / storeVersion? /
 * iconUrl?, global (常に), installedFor? (空は書かない), createdAt, updatedAt
 *
 * 読むときは旧形式も受ける:
 * - `accountKey` (1 アカウントに固定された個体) → `installedFor: [accountKey]`。
 *   固定だった印は `extra.legacyAccountKey` に残す (runtime-only。配置へ実行
 *   アカウントを移す移行が読む、決定 (g))
 * - `accountKey` も `accountId` も無い旧個体 (per-account カラム用) → `global: true`
 * - `accountId` だけの旧々個体 (内部 UUID) → `extra.legacyAccountId`。アカウント
 *   一覧が要るので store 側の移行が安定キーへ写す。移行待ちの間は書き戻す
 *   (Rust も同じ規則で残す)
 * 旧形式は `outdated` で書き戻しの対象になる。
 *
 * 「有効」は宣言しない — autoRun は「mount 時に自動実行するか」で、false でも
 * 手動実行できる (有効フラグではない)
 */
export interface WidgetFileMeta {
  installId: string
  name: string
  autoRun: boolean
  storeId?: string
  storeSha512?: string
  storeVersion?: string
  iconUrl?: string
  global: boolean
  installedFor?: string[]
  createdAt: number
  updatedAt: number
  /** @deprecated 旧形式 (1 アカウントに固定)。読むだけで、書かない */
  accountKey?: string
  /** @deprecated 旧々形式 (内部 UUID)。読んで、移行待ちの間だけ書き戻す */
  accountId?: string
}

export type WidgetFile = SidecarFile<Partial<WidgetFileMeta>>

export interface WidgetExtra {
  /** mount 時に自動実行するか (有効フラグではない) */
  autoRun: boolean
  /**
   * 旧々形式の実行アカウント (内部 UUID)。accountKey が無いファイルから読んだ
   * ときだけ持ち、accounts ロード後の移行で安定キーの紐付けに置換される
   */
  legacyAccountId?: string
  /**
   * 旧形式で 1 アカウントに固定されていた印 (runtime-only、書かない)。配置へ
   * 実行アカウントを移す移行 (決定 (g)) と複製の統合 (決定 (i)) が読んで消す
   */
  legacyAccountKey?: string
}

export type WidgetItem = DistributableMeta<string, WidgetExtra>

function scopeOf(m: Partial<WidgetFileMeta>): DistributableScope {
  if (m.accountKey) {
    return { kind: 'shared', global: false, installedFor: [m.accountKey] }
  }
  if (typeof m.global === 'boolean') {
    return {
      kind: 'shared',
      global: m.global,
      installedFor: m.installedFor ?? [],
    }
  }
  // 旧個体: アカウント未固定 = どのカラムでも使えた = 全体。旧々 (accountId) は
  // 移行待ちなので参加先なし
  return { kind: 'shared', global: !m.accountId, installedFor: [] }
}

function fromFile(file: WidgetFile, ctx: FileContext): WidgetItem {
  const m = file.meta
  const legacyAccountKey = m.accountKey || undefined
  const legacyAccountId = legacyAccountKey ? undefined : m.accountId
  return {
    id: m.installId || ctx.filename,
    name: m.name || ctx.filename,
    iconUrl: m.iconUrl,
    createdAt: m.createdAt ?? ctx.now,
    updatedAt: m.updatedAt ?? ctx.now,
    store: storeOriginOf(m),
    scope: scopeOf(m),
    content: file.src,
    extra: {
      autoRun: m.autoRun ?? false,
      ...(legacyAccountId ? { legacyAccountId } : {}),
      ...(legacyAccountKey ? { legacyAccountKey } : {}),
    },
  }
}

function toFile(item: WidgetItem): WidgetFile {
  const scope = item.scope.kind === 'shared' ? item.scope : undefined
  const meta: WidgetFileMeta = {
    installId: item.id,
    name: item.name,
    autoRun: item.extra.autoRun,
    ...storeFieldsOf(item.store),
    ...(item.iconUrl ? { iconUrl: item.iconUrl } : {}),
    global: scope?.global === true,
    ...(scope?.installedFor.length ? { installedFor: scope.installedFor } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(item.extra.legacyAccountId
      ? { accountId: item.extra.legacyAccountId }
      : {}),
  }
  return { meta, src: item.content }
}

export const widgetCodec: DistributableCodec<WidgetFile, WidgetItem> = {
  kind: 'widget',
  fromFile,
  toFile,
  encode: (file) => sidecarMetaText(file.meta),
  decode: (text, src = '') => decodeSidecar(text, src),
  // 旧形式 (accountKey / 紐付け無し) は global を常に書く形へ書き戻す
  outdated: (file) => typeof file.meta.global !== 'boolean',
}

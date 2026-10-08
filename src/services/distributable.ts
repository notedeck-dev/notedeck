/**
 * 配布物 5 種 (plugin / widget / query / skill / theme) のメモリ上の共通形
 * = envelope (#1202 段階 0)。
 *
 * - on-disk の形は kind ごとに違う (sidecar の `.meta.json5` / テーマの
 *   `.ndtheme.json5` / skill の frontmatter)。その差は
 *   `src/services/distributableCodecs/<kind>Codec.ts` が吸収し、ここには
 *   kind を知らない形だけを置く
 * - codec は「固定 projection」: `toFile(fromFile(x))` は今の store が書く
 *   ファイルとバイト一致する (golden テストが受け入れ条件)。envelope に
 *   あるからといって on-disk に書かない
 * - 段階 0 では store はまだこの型を使わない (段階 1 で store factory が
 *   置き換える)。store の serialize と codec の出力が一致することは
 *   `distributableCodecs/storeParity.test.ts` が固定する
 */

export type DistributableKind =
  | 'plugin'
  | 'widget'
  | 'query'
  | 'skill'
  | 'theme'

/** MisStore 由来の 3 点。storeId が無い個体はサイドロードで、この塊ごと無い */
export interface DistributableStoreOrigin {
  /** レジストリの id (ストアの追跡 ID。再インストールで参照が生き残る) */
  id: string
  /**
   * インストール / 更新時に照合済みの配布ソース SHA-512 (更新検知 #1040 の
   * 基準)。基準未記録 (旧インストール) は無い
   */
  sha512?: string
  /** インストール / 更新時のレジストリ版。sha512 と同じく基準未記録なら無い */
  version?: string
}

/**
 * スコープ (決定 (b)、2026-10-08): 「共有 / なし」の 2 戦略。
 * - `shared`: 本体は 1 つで、全体 (`global`) とアカウント別の紐付け
 *   (`installedFor` = `accountScopeKey` の配列) で参加先を持つ。plugin / query
 *   はこの形そのまま、theme は global を持たない (常に false)、widget は段階 1
 *   の widget の回まで on-disk が `accountKey` (1 アカウント) なので codec が
 *   過渡的に写す (widgetCodec を参照)
 * - `none`: スコープの概念が無い (skill)
 */
export type DistributableScope =
  | { kind: 'none' }
  | { kind: 'shared'; global: boolean; installedFor: string[] }

export interface DistributableMeta<Content, Extra> {
  /** 個体の参照 ID (ファイル名ではない。#913 の ID → ファイル名対応表の鍵) */
  id: string
  /** 表示名 (ファイル名 slug の元)。ローカルで改名できる */
  name: string
  /** 説明 (任意。無い kind もある) */
  description?: string
  /** 個別アイコン URL (MisStore registry の iconUrl 互換。theme は持たない) */
  iconUrl?: string
  /** 作成時刻 (ms)。段階 0 の on-disk 揃えで全 kind のファイルが持つ */
  createdAt: number
  /** 最終更新時刻 (ms)。本文 / 名前 / 有効 / 設定 / スコープの変更で進む */
  updatedAt: number
  /** MisStore 由来なら 3 点。サイドロードは無い */
  store?: DistributableStoreOrigin
  /** 参加先 (上の 2 戦略) */
  scope: DistributableScope
  /**
   * 実ファイル基底名 (拡張子なし)。runtime-only で、ファイルへは書かない
   * (codec の `toFile` に含めない)。未割当 = まだファイル化されていない
   */
  fileBase?: string
  /**
   * 読取専用。sidecar 3 種は「メタあり・ソース無し」の個体 (空ソースを
   * 書き戻してコードを失わないため persist を抑止)。runtime-only
   */
  readOnly?: boolean
  /** 本文 (AiScript ソース / Markdown 本文 / テーマの base + props) */
  content: Content
  /** kind 固有の付帯情報 (有効フラグ・版・権限・mode 等)。共通層は中を見ない */
  extra: Extra
}

/** codec の `fromFile` に渡す文脈。純関数にするため時刻は呼び出し側が渡す */
export interface FileContext {
  /**
   * 読んだファイルの名前 (sidecar はメタファイルの完全名、単一ファイルは
   * その完全名)。ID 欠損時の実効値 (ID 凍結の規則) と表示名の fallback に使う
   */
  filename: string
  /** 欠損した createdAt / updatedAt の埋め草 (ms) */
  now: number
}

/**
 * 「有効」の宣言。kind が opt-in する (widget / theme は持たない — widget の
 * autoRun は「mount 時に自動実行するか」で有効フラグではなく、theme の選択は
 * settings 側)。`get` は実効の有効 (skill の mode=always を含む)、`set` は
 * on-disk の印を書き換えた新しい個体を返す
 */
export interface EnabledDeclaration<Item> {
  get(item: Item): boolean
  set(item: Item, enabled: boolean): Item
}

/**
 * kind ごとの codec。`File` は on-disk の構造 (パース済み)。
 * `encode` はそのテキスト (sidecar はメタファイルの本文で、ソースは
 * `File.src` のまま別ファイル)。`decode` はその逆
 */
export interface DistributableCodec<
  File,
  Item extends DistributableMeta<unknown, unknown>,
> {
  kind: DistributableKind
  /** パース済みのファイル → envelope。欠損は規定値で埋める */
  fromFile(file: File, ctx: FileContext): Item
  /** envelope → パース済みのファイル (固定 projection。fileBase / readOnly は書かない) */
  toFile(item: Item): File
  /** ファイル本文 (sidecar はメタの本文) */
  encode(file: File): string
  /** 本文 → パース済みのファイル (sidecar は `src` も受ける) */
  decode(text: string, src?: string): File
  /**
   * on-disk の形が今の規則より古い (読込時に書き戻して揃える対象) か。
   * 段階 0 の揃え: plugin / theme の createdAt・updatedAt 欠損、query の
   * `disabled` → `active`
   */
  outdated(file: File): boolean
  /** 「有効」の宣言 (無い kind は undefined) */
  enabled?: EnabledDeclaration<Item>
}

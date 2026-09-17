/**
 * NoteDeck 独自のテーマメタ。
 * 本家 Misskey は知らないフィールドだが registry sync (JSON) でパススルーされ
 * るため Web UI と双方向同期しても破壊されない。
 */
export interface NotedeckThemeMeta {
  /** misstore からインストールされた場合の追跡 ID (将来の自動更新用) */
  storeId?: string
  /** インストール/更新時に照合済みの配布ソース SHA-512 (#913。更新検知 #1040 の baseline) */
  storeSha512?: string
  /** インストール/更新時の registry バージョン (#913) */
  storeVersion?: string
  /**
   * どのアカウントのテーマカラムに出すか。値はアカウントの安定キー
   * (`accountScopeKey` = host:userId、#1113)。内部 UUID は再ログインで変わり
   * 紐付けが無言で切れるため使わない (プラグイン #771 / クエリ / ウィジェット
   * と同じ)。複数アカウントに紐付けられる (重複インストール不要)。
   * 旧 UUID の値は起動時に安定キーへ移行する。
   */
  installedFor?: string[]
}

export interface MisskeyTheme {
  id: string
  name: string
  base?: 'light' | 'dark'
  props: Record<string, string>
  /** NoteDeck 独自拡張 (本家は無視、registry sync では保持される) */
  $notedeck?: NotedeckThemeMeta
  /**
   * 実ファイル basename (#913 の ID → ファイル名対応表)。runtime-only —
   * ファイルへは書かず (themeFileSync が書込前に strip)、localStorage
   * ミラーには同乗する。
   */
  fileBase?: string
}

export type CompiledProps = Record<string, string>

export interface ThemeSource {
  kind:
    | 'builtin-dark'
    | 'builtin-light'
    | 'server-dark'
    | 'server-light'
    | 'custom-dark'
    | 'custom-light'
  host?: string
  theme: MisskeyTheme
}

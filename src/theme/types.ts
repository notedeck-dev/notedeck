/**
 * NoteDeck 独自のテーマメタ。
 * 本家 Misskey は知らないフィールドだが registry sync (JSON) でパススルーされ
 * るため Web UI と双方向同期しても破壊されない。
 */
export interface NotedeckThemeMeta {
  /** misstore からインストールされた場合の追跡 ID (将来の自動更新用) */
  storeId?: string
  /** どの account の per-account テーマカラム「ストアのテーマ」セクションに
   *  表示するか。空 / undefined なら誰も使わない (Global ローカルセクション
   *  にのみ出る)。複数 account に紐付けられる (重複インストール不要)。 */
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

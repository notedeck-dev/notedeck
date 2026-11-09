/**
 * 設定ファイル (JSON5) の読み書きの共通形 (#1333 §2)。
 *
 * 設定ファイルは Git や dotfiles マネージャで管理できるものなので、書込は決定的
 * でなければならない: 同じ内容を読んで書けば同じバイト列。そのために
 *
 * - 整形は 1 か所 (`stringifyJson5`): `JSON5.stringify(value, null, 2)` + 末尾改行
 * - キー順はファイルの順 (JSON5.parse は出現順を保ち、stringify は挿入順で出す)
 * - コメントは保持しない。「再保存でコメントは消える」はドキュメントに書く
 *   (JSON5 を AST で編集する実装は大きいので採らない)
 *
 * 各設定ファイルのコーデック (parse / serialize) は決定性テスト
 * (`src/services/settingsFileCodecs.test.ts`) に登録する。allowlist
 * (`crates/notecore/src/settings_store.rs` の ROOT_FILES) にあって登録の無い
 * ファイルは落ちる。
 */

import JSON5 from 'json5'

/** 設定ファイルの標準の整形。notemaid 側の `json5_out::stringify` と同じ出力 */
export function stringifyJson5(value: unknown): string {
  return `${JSON5.stringify(value, null, 2)}\n`
}

/**
 * 空ファイル (無い) は `empty()`、それ以外は JSON5 として読む。パースできない
 * ときは例外のまま (握り潰すと壊れたファイルを既定値で上書きして消すため、
 * 呼び手が「書かない」判断をする)
 */
export function parseJson5Document<T>(text: string, empty: () => T): T {
  if (text.trim().length === 0) return empty()
  return JSON5.parse(text) as T
}

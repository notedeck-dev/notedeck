/**
 * AI チャットのメッセージ id からターン id を取り出す (#1162)。
 *
 * notemaid (`crates/notemaid/src/ai_turn/mod.rs`) とフロント (`useAiTurn`) は
 * ターン id の後ろに役割の接尾辞を付けてメッセージ id を作る:
 *
 * - `<turn>-u`                 ユーザー入力
 * - `<turn>-a<round>`          assistant 本文
 * - `<turn>-a<round>-<i>`      tool_use
 * - `<turn>-r<round>-<i>`      tool_result
 * - `<turn>-placeholder[-<ts>]` / `<turn>-r-<ts>`  フロントの仮置き
 *
 * ターン id 自体にも `-` が入る (`ai-turn-<ts>-<rand>` / `hb-<ts>-<stamp>`) ので
 * 「最後の `-` で切る」では tool 系が壊れる。接尾辞の形で切り、最長一致で
 * ターン id を残す。
 */

const SUFFIX = /^(.+)-(?:u|a\d+(?:-\d+)?|r\d+-\d+|r-\d+|placeholder(?:-\d+)?)$/

/** 既知の接尾辞を持たない id (旧形式など) は null */
export function turnIdOf(messageId: string): string | null {
  const m = SUFFIX.exec(messageId)
  return m?.[1] ?? null
}

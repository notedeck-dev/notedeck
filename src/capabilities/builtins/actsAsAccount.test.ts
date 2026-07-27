import { describe, expect, it } from 'vitest'
import { ALL_BUILTIN_CAPABILITIES } from './index'

/**
 * actsAsAccount 宣言 (#777) の網羅性検査。
 *
 * `params.accountId` が実行主体を意味する write 系 capability は
 * `actsAsAccount: true` を宣言しなければならない — 宣言漏れは
 * account.actAs ゲートの穴になる。UI スコープの accountId
 * (column.* 等) と「省略 = 全アカウント」セマンティクスの capability は
 * EXEMPT に明示して理由を残す。
 */

// accountId param を持つ要確認 capability のうち、accountId が実行主体では
// ないもの。追加するときは理由をコメントで残すこと。
const EXEMPT: readonly string[] = [
  // column の accountId は「どのアカウントのカラムを作るか」の UI スコープ
  // 指定で、API 実行主体ではない
  'column.add',
  'column.updateSettings',
]

describe('actsAsAccount 宣言 (#777)', () => {
  it('accountId param を持つ要確認 capability は actsAsAccount を宣言する', () => {
    const missing = ALL_BUILTIN_CAPABILITIES.filter(
      (c) =>
        c.signature?.params?.accountId &&
        c.requiresConfirmation &&
        !c.actsAsAccount &&
        !EXEMPT.includes(c.id),
    ).map((c) => c.id)
    expect(missing).toEqual([])
  })

  it('actsAsAccount capability は必ず requiresConfirmation を宣言する', () => {
    // クロスアカウント実行は dispatcher が force confirm するが、write 系で
    // ある以上は同一アカウントでも確認が要る (宣言の整合性検査)
    const bad = ALL_BUILTIN_CAPABILITIES.filter(
      (c) => c.actsAsAccount && !c.requiresConfirmation,
    ).map((c) => c.id)
    expect(bad).toEqual([])
  })
})

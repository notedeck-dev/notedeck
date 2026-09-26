// 「レジストリは import 時に辞書を読まない」を実際に import して確かめる (#135)。
//
// 表示名を辞書から引くレジストリ (カラム / ウィンドウ / capability / コマンド) は
// main.ts の起動待ちより前に評価される。import 時に表示名を引くと、辞書を読む前に
// 参照して起動が落ちる。静的な検査 (i18nDictionary.test.ts) は `i18n.ts` を
// 直接書いた箇所しか見ないので、getter をコピーする退行 (spread や
// Object.fromEntries) はここで拾う。setup が辞書を読んだ後の状態で始まるので、
// モジュールを読み直して「辞書を読む前」から評価し直す。

import { describe, expect, it, vi } from 'vitest'

// モジュールを読み直すので重い。並列実行中は既定の 5 秒を超えることがある
describe('辞書を読む前の import (#135)', { timeout: 30_000 }, () => {
  it('表示名を持つレジストリは import 時に辞書を参照しない', async () => {
    vi.resetModules()
    const { i18n } = await import('@/i18n')
    expect(() => i18n.ts).toThrow()

    await import('@/columns/registry')
    await import('@/windows/registry')
    await import('@/capabilities/builtins')
    await import('@/commands/definitions')
  })

  it('読み直した後で辞書を読めば表示名が引ける', async () => {
    vi.resetModules()
    const { loadLocale } = await import('@/i18n')
    const { COLUMN_LABELS } = await import('@/columns/registry')
    const { WINDOW_LABELS } = await import('@/windows/registry')
    await loadLocale('ja-JP')
    expect(COLUMN_LABELS.timeline).toBe('タイムライン')
    expect(WINDOW_LABELS.login).toBe('アカウント追加')
  })
})

import { describe, expect, it } from 'vitest'
import { MISSKEY_ENDPOINT_RULES } from './misskeyEndpoints.generated'
import { PERMISSION_KEYS } from './schema'

/**
 * 生成表の sanity テスト (#712 §5.5 — PR 1d 必須)。
 * deny-by-default の性質上、表の無言欠損は「全プラグインの Mk:api が理由不明で
 * 全滅」という形でしか顕在化しないため、生成物の妥当性を CI で固定する。
 */
describe('MISSKEY_ENDPOINT_RULES — 生成 sanity', () => {
  const entries = Object.entries(MISSKEY_ENDPOINT_RULES)

  it('エントリ数の下限 (生成の空振り検出)', () => {
    expect(entries.length).toBeGreaterThanOrEqual(350)
  })

  it('アンカー: 既知の対応が表に存在する', () => {
    expect(MISSKEY_ENDPOINT_RULES['notes/create']).toBe('notes.write')
    expect(MISSKEY_ENDPOINT_RULES['notes/delete']).toBe('notes.write')
    expect(MISSKEY_ENDPOINT_RULES['notes/reactions/create']).toBe('notes.react')
    expect(MISSKEY_ENDPOINT_RULES['following/create']).toBe('account.write')
    expect(MISSKEY_ENDPOINT_RULES['i/update']).toBe('account.write')
    expect(MISSKEY_ENDPOINT_RULES.i).toBe('account.read')
    expect(MISSKEY_ENDPOINT_RULES['drive/files']).toBe('drive.read')
    expect(MISSKEY_ENDPOINT_RULES['i/notifications']).toBe('notifications')
    // 公開 read は allow
    expect(MISSKEY_ENDPOINT_RULES['notes/show']).toBe('allow')
    expect(MISSKEY_ENDPOINT_RULES['users/show']).toBe('allow')
    expect(MISSKEY_ENDPOINT_RULES.meta).toBe('allow')
    // 配布プラグイン / ウィジェットが呼ぶトップレベル endpoint (#1250)
    expect(MISSKEY_ENDPOINT_RULES.emojis).toBe('allow')
    expect(MISSKEY_ENDPOINT_RULES.stats).toBe('allow')
    // 高感度 (kind 無し + credential 必須) は deny
    expect(MISSKEY_ENDPOINT_RULES['i/regenerate-token']).toMatch(/^deny:/)
    expect(MISSKEY_ENDPOINT_RULES['i/delete-account']).toMatch(/^deny:/)
  })

  it('admin 系は全て deny', () => {
    const adminEntries = entries.filter(([ep]) => ep.startsWith('admin/'))
    expect(adminEntries.length).toBeGreaterThan(50)
    for (const [ep, rule] of adminEntries) {
      expect(rule, ep).toMatch(/^deny:/)
    }
  })

  it('全ての値が allow / deny:* / 実在する PermissionKey のいずれか', () => {
    const keys = new Set<string>(PERMISSION_KEYS)
    for (const [ep, rule] of entries) {
      const valid =
        rule === 'allow' || rule.startsWith('deny:') || keys.has(rule)
      expect(valid, `${ep}: ${rule}`).toBe(true)
    }
  })
})

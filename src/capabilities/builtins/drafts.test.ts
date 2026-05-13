import { describe, expect, it } from 'vitest'
import {
  DRAFTS_BUILTIN_CAPABILITIES,
  draftsCreateCapability,
  draftsDeleteCapability,
  draftsListCapability,
  draftsUpdateCapability,
} from './drafts'

// Note: execute は useAccountsStore (Pinia) + useDrafts (Tauri command) を
// 呼ぶため unit 環境では走らない。本テストは capability 定義と引数
// バリデーションのみ検証する。実 API 連携は実機で確認。

describe('drafts capabilities — declaration', () => {
  it('drafts.list: read permission, aiTool true, returns array', () => {
    expect(draftsListCapability.id).toBe('drafts.list')
    expect(draftsListCapability.permissions).toEqual(['drafts.read'])
    expect(draftsListCapability.aiTool).toBe(true)
    expect(draftsListCapability.signature?.returns?.type).toBe('array')
    expect(draftsListCapability.signature?.params?.accountId?.optional).toBe(
      true,
    )
  })

  it('drafts.create: write permission, confirmation, requires text', async () => {
    expect(draftsCreateCapability.id).toBe('drafts.create')
    expect(draftsCreateCapability.permissions).toEqual(['drafts.write'])
    expect(draftsCreateCapability.requiresConfirmation).toBe(true)
    expect(draftsCreateCapability.signature?.params?.text?.optional).not.toBe(
      true,
    )
    await expect(draftsCreateCapability.execute({})).rejects.toThrow(
      /text is required/,
    )
    await expect(draftsCreateCapability.execute({ text: '' })).rejects.toThrow(
      /text is required/,
    )
  })

  it('drafts.create: visibility enum is the 4 Misskey visibilities', () => {
    expect(draftsCreateCapability.signature?.params?.visibility?.enum).toEqual([
      'public',
      'home',
      'followers',
      'specified',
    ])
  })

  it('drafts.update: write permission, confirmation, requires draftId', async () => {
    expect(draftsUpdateCapability.id).toBe('drafts.update')
    expect(draftsUpdateCapability.permissions).toEqual(['drafts.write'])
    expect(draftsUpdateCapability.requiresConfirmation).toBe(true)
    expect(
      draftsUpdateCapability.signature?.params?.draftId?.optional,
    ).not.toBe(true)
    await expect(draftsUpdateCapability.execute({})).rejects.toThrow(
      /draftId is required/,
    )
  })

  it('drafts.update: all body fields except draftId are optional (partial patch)', () => {
    const params = draftsUpdateCapability.signature?.params
    expect(params?.text?.optional).toBe(true)
    expect(params?.cw?.optional).toBe(true)
    expect(params?.visibility?.optional).toBe(true)
    expect(params?.scheduledAt?.optional).toBe(true)
    expect(params?.isActuallyScheduled?.optional).toBe(true)
  })

  it('drafts.delete: write permission, danger confirmation function, requires draftId', async () => {
    expect(draftsDeleteCapability.id).toBe('drafts.delete')
    expect(draftsDeleteCapability.permissions).toEqual(['drafts.write'])
    expect(typeof draftsDeleteCapability.requiresConfirmation).toBe('function')
    await expect(draftsDeleteCapability.execute({})).rejects.toThrow(
      /draftId is required/,
    )
  })

  it('drafts.delete confirm: danger type with draftId in message', async () => {
    const confirm = draftsDeleteCapability.requiresConfirmation
    if (typeof confirm !== 'function') throw new Error('expected function')
    const opts = await confirm({ draftId: 'abc123' })
    expect(opts?.type).toBe('danger')
    expect(opts?.message).toContain('abc123')
    expect(opts?.okLabel).toBe('削除')
  })
})

describe('DRAFTS_BUILTIN_CAPABILITIES', () => {
  it('contains all 4 capabilities', () => {
    const ids = DRAFTS_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual([
      'drafts.create',
      'drafts.delete',
      'drafts.list',
      'drafts.update',
    ])
  })

  it('all capabilities are exposed to AI (aiTool: true)', () => {
    for (const cap of DRAFTS_BUILTIN_CAPABILITIES) {
      expect(cap.aiTool, `${cap.id} should be aiTool`).toBe(true)
    }
  })
})

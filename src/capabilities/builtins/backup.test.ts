import { describe, expect, it } from 'vitest'
import { backupCreateCapability } from '@/capabilities/builtins/backup'
import type { CapabilityContext } from '@/capabilities/types'

const confirmFn = backupCreateCapability.requiresConfirmation
if (typeof confirmFn !== 'function') {
  throw new Error('backup.create must decide confirmation per principal')
}

describe('backup.create の確認モーダル', () => {
  // HEARTBEAT は確認スキップが構造的に不可能なため、確認を出すと定期実行の
  // tick ごとに無人環境でモーダルが出て詰む
  it('HEARTBEAT では確認を出さない', async () => {
    const opts = await confirmFn({}, {
      principal: { kind: 'ai.heartbeat' },
    } as CapabilityContext)
    expect(opts).toBeNull()
  })

  it('AI チャットからの実行では確認を出す', async () => {
    const opts = await confirmFn({}, {
      principal: { kind: 'ai.chat' },
    } as CapabilityContext)
    expect(opts).not.toBeNull()
    expect(opts?.message).toContain('認証情報は含まれません')
  })

  it('principal 不明でも確認側に倒す', async () => {
    const opts = await confirmFn({}, {} as CapabilityContext)
    expect(opts).not.toBeNull()
  })

  it('対象の選択が確認文面に反映される', async () => {
    const ctx = { principal: { kind: 'ai.chat' } } as CapabilityContext
    expect((await confirmFn({}, ctx))?.message).toContain('ローカル DB と設定')
    expect(
      (await confirmFn({ includeSettings: false }, ctx))?.message,
    ).toContain('ローカル DB のスナップショット')
    expect((await confirmFn({ includeDb: false }, ctx))?.message).toContain(
      '設定のスナップショット',
    )
  })
})

describe('backup.create の preflight', () => {
  const preflight = backupCreateCapability.preflight
  if (!preflight) throw new Error('backup.create must have preflight')

  it('DB も設定も外したら拒否する', async () => {
    expect(
      await preflight({ includeDb: false, includeSettings: false }),
    ).not.toBeNull()
  })

  it('どちらか一方だけなら通す', async () => {
    expect(await preflight({ includeDb: false })).toBeNull()
    expect(await preflight({ includeSettings: false })).toBeNull()
    expect(await preflight({})).toBeNull()
  })
})

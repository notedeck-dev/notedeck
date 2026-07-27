import { describe, expect, it } from 'vitest'
import { filesExportCapability } from '@/capabilities/builtins/files'
import type { CapabilityContext } from '@/capabilities/types'

const preflight = filesExportCapability.preflight
if (!preflight) throw new Error('files.export must have preflight')

describe('files.export preflight', () => {
  it('fileIds も noteIds も無ければ拒否する', async () => {
    expect(await preflight({})).not.toBeNull()
    expect(await preflight({ fileIds: [], noteIds: [] })).not.toBeNull()
  })

  it('合計 100 件を超えると拒否する', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `f${i}`)
    expect(await preflight({ fileIds: ids })).not.toBeNull()
    expect(await preflight({ fileIds: ids.slice(0, 100) })).toBeNull()
  })

  it('subdir の階層・トラバーサル表現を拒否する', async () => {
    expect(await preflight({ fileIds: ['a'], subdir: 'x/y' })).not.toBeNull()
    expect(await preflight({ fileIds: ['a'], subdir: 'x\\y' })).not.toBeNull()
    expect(await preflight({ fileIds: ['a'], subdir: '..' })).not.toBeNull()
    expect(await preflight({ fileIds: ['a'], subdir: '' })).not.toBeNull()
    expect(await preflight({ fileIds: ['a'], subdir: 'export' })).toBeNull()
  })
})

describe('files.export requiresConfirmation', () => {
  it('件数と保存先を確認メッセージに含める', async () => {
    const fn = filesExportCapability.requiresConfirmation
    if (typeof fn !== 'function') throw new Error('must be a function')
    const opts = await fn(
      { fileIds: ['a', 'b'], noteIds: ['n'] },
      {} as CapabilityContext,
    )
    expect(opts?.message).toContain('ファイル 2 件')
    expect(opts?.message).toContain('ノート 1 件の添付')
    expect(opts?.message).toContain('notedeck/export/')
  })

  // 既定はセンシティブも保存する (本体のドライブ保存と同じ)。除外は opt-out
  it('既定ではセンシティブに触れない (含むのが既定のため)', async () => {
    const fn = filesExportCapability.requiresConfirmation
    if (typeof fn !== 'function') throw new Error('must be a function')
    const opts = await fn({ fileIds: ['a'] }, {} as CapabilityContext)
    expect(opts?.message).not.toContain('センシティブ')
  })

  it('includeSensitive: false のときは除外する旨を明示する', async () => {
    const fn = filesExportCapability.requiresConfirmation
    if (typeof fn !== 'function') throw new Error('must be a function')
    const opts = await fn(
      { fileIds: ['a'], includeSensitive: false },
      {} as CapabilityContext,
    )
    expect(opts?.message).toContain('センシティブ設定のファイルは除きます')
  })
})

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CapabilityContext } from '@/capabilities/types'
import { useThemeStore } from '@/stores/theme'
import {
  STYLES_BUILTIN_CAPABILITIES,
  stylesAppendCapability,
  stylesHistoryCapability,
  stylesReadCapability,
  stylesRevertCapability,
  stylesWriteCapability,
} from './styles'

// Note: execute は内部で useThemeStore (Pinia) を呼ぶため、unit 環境では
// store mock が必要になる。skills.test.ts と同様、本テストは capability 定義
// (id / permissions / signature / aiTool) と引数バリデーションのみ検証する。
// 実 write 挙動は実機 / e2e で確認。

describe('styles capabilities — declaration', () => {
  it('styles.read: no permission, aiTool true, cheap', () => {
    expect(stylesReadCapability.id).toBe('styles.read')
    expect(stylesReadCapability.permissions).toEqual([])
    expect(stylesReadCapability.aiTool).toBe(true)
    expect(stylesReadCapability.signature?.cheap).toBe(true)
    expect(stylesReadCapability.signature?.returns?.type).toBe('object')
  })

  it('styles.write: write permission, confirmation function, requires body', () => {
    expect(stylesWriteCapability.id).toBe('styles.write')
    expect(stylesWriteCapability.permissions).toEqual(['styles.write'])
    expect(stylesWriteCapability.aiTool).toBe(true)
    expect(typeof stylesWriteCapability.requiresConfirmation).toBe('function')
    expect(stylesWriteCapability.signature?.params?.body?.optional).not.toBe(
      true,
    )
  })

  it('styles.append: write permission, confirmation function, requires content', () => {
    expect(stylesAppendCapability.id).toBe('styles.append')
    expect(stylesAppendCapability.permissions).toEqual(['styles.write'])
    expect(typeof stylesAppendCapability.requiresConfirmation).toBe('function')
    expect(() => stylesAppendCapability.execute({})).toThrow(
      /content is required/,
    )
  })

  it('styles.history: no permission, cheap, no params', () => {
    expect(stylesHistoryCapability.id).toBe('styles.history')
    expect(stylesHistoryCapability.permissions).toEqual([])
    expect(stylesHistoryCapability.signature?.cheap).toBe(true)
    expect(
      Object.keys(stylesHistoryCapability.signature?.params ?? {}),
    ).toEqual([])
  })

  it('styles.revert: write permission, confirmation function, requires index>=0', async () => {
    expect(stylesRevertCapability.id).toBe('styles.revert')
    expect(stylesRevertCapability.permissions).toEqual(['styles.write'])
    expect(typeof stylesRevertCapability.requiresConfirmation).toBe('function')
    await expect(stylesRevertCapability.execute({})).rejects.toThrow(
      /index must be/,
    )
    await expect(stylesRevertCapability.execute({ index: -1 })).rejects.toThrow(
      /index must be/,
    )
  })
})

describe('styles capabilities — confirmation params', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('styles.write confirm: 現在の CSS と全置換後を diff で見せる', async () => {
    const confirm = stylesWriteCapability.requiresConfirmation
    if (typeof confirm !== 'function') throw new Error('expected function')
    useThemeStore().customCss = '.old { color: blue; }'
    const ctx: CapabilityContext = {}
    const opts = await confirm({ body: '.foo { color: red; }' }, ctx)
    expect(opts?.diff).toEqual({
      old: '.old { color: blue; }',
      new: '.foo { color: red; }',
      language: 'css',
    })
    expect(opts?.type).toBe('warning')
    expect(ctx.stagedEdit).toEqual({
      baseline: '.old { color: blue; }',
      next: '.foo { color: red; }',
    })
  })

  it('styles.append confirm: 断片ではなく追記後の全文を diff で見せる', async () => {
    const confirm = stylesAppendCapability.requiresConfirmation
    if (typeof confirm !== 'function') throw new Error('expected function')
    useThemeStore().customCss = '.old { color: blue; }'
    const ctx: CapabilityContext = {}
    const opts = await confirm({ content: 'body { margin: 0; }' }, ctx)
    expect(opts?.diff?.old).toBe('.old { color: blue; }')
    expect(opts?.diff?.new).toBe('.old { color: blue; }\nbody { margin: 0; }')
    expect(opts?.diff?.language).toBe('css')
    expect(opts?.type).toBe('normal')
  })

  it('styles.append: 確認後に CSS が変わっていたら書き込まない', () => {
    const store = useThemeStore()
    store.customCss = '.old {}'
    const ctx: CapabilityContext = {
      stagedEdit: { baseline: '.old {}', next: '.old {}\n.added {}' },
    }
    store.customCss = '.changed-by-user {}'
    expect(() =>
      stylesAppendCapability.execute({ content: '.added {}' }, ctx),
    ).toThrow(/確認後/)
    expect(store.customCss).toBe('.changed-by-user {}')
  })

  it('styles.revert confirm: returns null when index < 0', async () => {
    const confirm = stylesRevertCapability.requiresConfirmation
    if (typeof confirm !== 'function') throw new Error('expected function')
    expect(await confirm({}, {})).toBeNull()
    expect(await confirm({ index: -1 }, {})).toBeNull()
  })
})

describe('STYLES_BUILTIN_CAPABILITIES', () => {
  it('contains all 5 capabilities', () => {
    const ids = STYLES_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual([
      'styles.append',
      'styles.history',
      'styles.read',
      'styles.revert',
      'styles.write',
    ])
  })

  it('all capabilities are exposed to AI (aiTool: true)', () => {
    for (const cap of STYLES_BUILTIN_CAPABILITIES) {
      expect(cap.aiTool, `${cap.id} should be aiTool`).toBe(true)
    }
  })
})

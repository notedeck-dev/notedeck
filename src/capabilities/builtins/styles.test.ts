import { describe, expect, it } from 'vitest'
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
  it('styles.write confirm: shows body length and css code', async () => {
    const confirm = stylesWriteCapability.requiresConfirmation
    if (typeof confirm !== 'function') throw new Error('expected function')
    const opts = await confirm({ body: '.foo { color: red; }' })
    expect(opts).not.toBeNull()
    expect(opts?.code).toBe('.foo { color: red; }')
    expect(opts?.codeLanguage).toBe('css')
    expect(opts?.type).toBe('warning')
  })

  it('styles.append confirm: shows content length and css code', async () => {
    const confirm = stylesAppendCapability.requiresConfirmation
    if (typeof confirm !== 'function') throw new Error('expected function')
    const opts = await confirm({ content: 'body { margin: 0; }' })
    expect(opts).not.toBeNull()
    expect(opts?.code).toBe('body { margin: 0; }')
    expect(opts?.codeLanguage).toBe('css')
    expect(opts?.type).toBe('normal')
  })

  it('styles.revert confirm: returns null when index < 0', async () => {
    const confirm = stylesRevertCapability.requiresConfirmation
    if (typeof confirm !== 'function') throw new Error('expected function')
    expect(await confirm({})).toBeNull()
    expect(await confirm({ index: -1 })).toBeNull()
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

import { describe, expect, it } from 'vitest'
import {
  STYLES_BUILTIN_CAPABILITIES,
  stylesHistoryCapability,
  stylesReadCapability,
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

  it('styles.history: no permission, cheap, no params', () => {
    expect(stylesHistoryCapability.id).toBe('styles.history')
    expect(stylesHistoryCapability.permissions).toEqual([])
    expect(stylesHistoryCapability.signature?.cheap).toBe(true)
    expect(
      Object.keys(stylesHistoryCapability.signature?.params ?? {}),
    ).toEqual([])
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

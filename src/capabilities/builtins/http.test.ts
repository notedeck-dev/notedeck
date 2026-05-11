import { describe, expect, it } from 'vitest'
import { HTTP_BUILTIN_CAPABILITIES, httpFetchCapability } from './http'

// Note: execute() は Tauri invoke を呼ぶため、本テストは capability 宣言
// (signature / permissions / aiTool) と引数バリデーションだけを検証する。
// 実際の HTTP 挙動 / SSRF 防御は Rust 側 plugin_http.rs のテストで担保する。

describe('http.fetch capability', () => {
  it('declares network.external permission and aiTool: true', () => {
    expect(httpFetchCapability.permissions).toEqual(['network.external'])
    expect(httpFetchCapability.aiTool).toBe(true)
  })

  it('requires confirmation before each call (任意 URL への外部送信を防ぐ)', () => {
    expect(httpFetchCapability.requiresConfirmation).toBe(true)
  })

  it('uses dot-notation id', () => {
    expect(httpFetchCapability.id).toBe('http.fetch')
  })

  it('rejects empty url before invoking Rust', async () => {
    await expect(httpFetchCapability.execute({ url: '' })).rejects.toThrow(
      /url is required/,
    )
    await expect(httpFetchCapability.execute({})).rejects.toThrow(
      /url is required/,
    )
  })

  it('limits method enum to the standard HTTP verbs', () => {
    const enums = httpFetchCapability.signature?.params?.method?.enum
    expect(enums).toEqual([
      'GET',
      'POST',
      'PUT',
      'DELETE',
      'PATCH',
      'HEAD',
      'OPTIONS',
    ])
  })

  it('marks url as required and others as optional', () => {
    const params = httpFetchCapability.signature?.params
    expect(params?.url?.optional).not.toBe(true)
    expect(params?.method?.optional).toBe(true)
    expect(params?.headers?.optional).toBe(true)
    expect(params?.body?.optional).toBe(true)
    expect(params?.timeoutMs?.optional).toBe(true)
  })
})

describe('HTTP_BUILTIN_CAPABILITIES', () => {
  it('contains http.fetch', () => {
    expect(HTTP_BUILTIN_CAPABILITIES).toContain(httpFetchCapability)
  })
})

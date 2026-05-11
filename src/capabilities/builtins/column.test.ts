import { describe, expect, it } from 'vitest'
import {
  COLUMN_BUILTIN_CAPABILITIES,
  columnAddCapability,
  columnListCapability,
  columnRemoveCapability,
} from './column'

// Note: 実 deckStore が profileStore に深く依存するため、execute() の挙動を
// 真に検証するには Tauri / Pinia の本体を起動する必要がある。本ユニット
// テストは capability 定義 (signature / permissions / enum) と「引数バリデーション
// で deckStore に触る前に throw する経路」だけを検証する。
// 成功ケースの挙動は実機 / E2E で確認する。

describe('column.list capability', () => {
  it('declares no permissions and aiTool: true', () => {
    expect(columnListCapability.permissions).toEqual([])
    expect(columnListCapability.aiTool).toBe(true)
    expect(columnListCapability.signature?.returns?.type).toBe('array')
  })

  it('uses dot-notation id', () => {
    expect(columnListCapability.id).toBe('column.list')
  })

  it('advertises accountHost in signature description and returns', () => {
    // <currentColumn> 補強と対をなす多サーバー対応:
    // AI が account.list を呼ばずに「どれが misskey.io カラムか」判定できる
    expect(columnListCapability.signature?.description).toContain('accountHost')
    expect(columnListCapability.signature?.returns?.description).toContain(
      'accountHost',
    )
  })
})

describe('column.add capability', () => {
  it('declares no permissions and aiTool: true', () => {
    expect(columnAddCapability.permissions).toEqual([])
    expect(columnAddCapability.aiTool).toBe(true)
  })

  it('throws on truly unknown types', () => {
    expect(() => columnAddCapability.execute({ type: 'unknown' })).toThrow(
      /Unsupported/,
    )
    expect(() => columnAddCapability.execute({})).toThrow(/Unsupported/)
  })

  it('declares lookup-ID columns in the enum', () => {
    // PR-2 で旧 Nd:addColumn の機能損失を埋めるために追加した lookup ID 系
    const enums = columnAddCapability.signature?.params?.type?.enum
    expect(enums).toBeDefined()
    expect(enums).toContain('timeline')
    expect(enums).toContain('notifications')
    expect(enums).toContain('list')
    expect(enums).toContain('antenna')
    expect(enums).toContain('channel')
    expect(enums).toContain('clip')
    expect(enums).toContain('user')
  })

  it('marks type as required and others as optional', () => {
    const params = columnAddCapability.signature?.params
    expect(params?.type?.optional).not.toBe(true)
    expect(params?.name?.optional).toBe(true)
    expect(params?.accountId?.optional).toBe(true)
    expect(params?.width?.optional).toBe(true)
    expect(params?.listId?.optional).toBe(true)
  })

  it('rejects lookup-ID column types when the required ID is missing', () => {
    expect(() => columnAddCapability.execute({ type: 'list' })).toThrow(
      /listId is required/,
    )
    expect(() => columnAddCapability.execute({ type: 'antenna' })).toThrow(
      /antennaId is required/,
    )
    expect(() => columnAddCapability.execute({ type: 'channel' })).toThrow(
      /channelId is required/,
    )
    expect(() => columnAddCapability.execute({ type: 'clip' })).toThrow(
      /clipId is required/,
    )
    expect(() => columnAddCapability.execute({ type: 'user' })).toThrow(
      /userId is required/,
    )
  })

  it('does not require lookup IDs for plain column types', () => {
    // バリデーション層では throw しないが、deckStore.addColumn() 呼出で
    // Pinia 未初期化により別エラーが出る。エラー文言で区別する。
    expect(() => columnAddCapability.execute({ type: 'timeline' })).not.toThrow(
      /required/,
    )
  })
})

describe('column.remove capability', () => {
  it('declares no permissions and aiTool: true', () => {
    expect(columnRemoveCapability.permissions).toEqual([])
    expect(columnRemoveCapability.aiTool).toBe(true)
  })

  it('uses dot-notation id', () => {
    expect(columnRemoveCapability.id).toBe('column.remove')
  })

  it('requires id parameter', () => {
    expect(() => columnRemoveCapability.execute({})).toThrow(/id is required/)
    expect(() => columnRemoveCapability.execute({ id: '' })).toThrow(
      /id is required/,
    )
  })
})

describe('COLUMN_BUILTIN_CAPABILITIES', () => {
  it('contains list, add, and remove', () => {
    expect(COLUMN_BUILTIN_CAPABILITIES).toContain(columnListCapability)
    expect(COLUMN_BUILTIN_CAPABILITIES).toContain(columnAddCapability)
    expect(COLUMN_BUILTIN_CAPABILITIES).toContain(columnRemoveCapability)
  })
})

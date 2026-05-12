import { describe, expect, it, vi } from 'vitest'

const readTextMock = vi.fn(async () => 'mocked clipboard text')
const writeTextMock = vi.fn(async (_text: string) => undefined)

vi.stubGlobal('navigator', {
  clipboard: {
    readText: readTextMock,
    writeText: writeTextMock,
  },
})

import {
  CLIPBOARD_BUILTIN_CAPABILITIES,
  clipboardReadCapability,
  clipboardWriteCapability,
} from './clipboard'

describe('clipboard.read capability', () => {
  it('declares clipboard permission, aiTool true, cheap', () => {
    expect(clipboardReadCapability.id).toBe('clipboard.read')
    expect(clipboardReadCapability.permissions).toEqual(['clipboard'])
    expect(clipboardReadCapability.aiTool).toBe(true)
    expect(clipboardReadCapability.signature?.cheap).toBe(true)
  })

  it('returns { text } from navigator.clipboard.readText', async () => {
    const result = (await clipboardReadCapability.execute()) as {
      text: string
    }
    expect(result.text).toBe('mocked clipboard text')
    expect(readTextMock).toHaveBeenCalled()
  })
})

describe('clipboard.write capability', () => {
  it('declares clipboard permission, aiTool true', () => {
    expect(clipboardWriteCapability.id).toBe('clipboard.write')
    expect(clipboardWriteCapability.permissions).toEqual(['clipboard'])
    expect(clipboardWriteCapability.aiTool).toBe(true)
  })

  it('marks text as required (single param)', () => {
    const params = clipboardWriteCapability.signature?.params
    expect(params?.text?.optional).not.toBe(true)
    expect(Object.keys(params ?? {})).toEqual(['text'])
  })

  it('writes to navigator.clipboard.writeText and returns length', async () => {
    writeTextMock.mockClear()
    const result = (await clipboardWriteCapability.execute({
      text: 'hello',
    })) as { written: boolean; length: number }
    expect(writeTextMock).toHaveBeenCalledWith('hello')
    expect(result).toEqual({ written: true, length: 5 })
  })

  it('handles empty string (= 0 length)', async () => {
    writeTextMock.mockClear()
    const result = (await clipboardWriteCapability.execute({ text: '' })) as {
      written: boolean
      length: number
    }
    expect(writeTextMock).toHaveBeenCalledWith('')
    expect(result.length).toBe(0)
  })
})

describe('CLIPBOARD_BUILTIN_CAPABILITIES', () => {
  it('contains read and write', () => {
    expect(CLIPBOARD_BUILTIN_CAPABILITIES).toContain(clipboardReadCapability)
    expect(CLIPBOARD_BUILTIN_CAPABILITIES).toContain(clipboardWriteCapability)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { UI_BUILTIN_CAPABILITIES, uiNotifyCapability } from './ui'

vi.mock('@/utils/desktopNotification', () => ({
  sendDesktopNotification: vi.fn(),
}))

describe('ui.notify capability', () => {
  it('declares notifications permission and aiTool: true', () => {
    expect(uiNotifyCapability.permissions).toEqual(['notifications'])
    expect(uiNotifyCapability.aiTool).toBe(true)
  })

  it('uses dot-notation id', () => {
    expect(uiNotifyCapability.id).toBe('ui.notify')
  })

  it('marks title as required and body as optional', () => {
    const params = uiNotifyCapability.signature?.params
    expect(params?.title?.optional).not.toBe(true)
    expect(params?.body?.optional).toBe(true)
  })

  it('rejects empty title before sending', () => {
    expect(() => uiNotifyCapability.execute({})).toThrow(/title is required/)
    expect(() => uiNotifyCapability.execute({ title: '' })).toThrow(
      /title is required/,
    )
  })

  it('forwards title and body to sendDesktopNotification', async () => {
    const { sendDesktopNotification } = await import(
      '@/utils/desktopNotification'
    )
    const mock = vi.mocked(sendDesktopNotification)
    mock.mockClear()
    uiNotifyCapability.execute({ title: 'Hello', body: 'World' })
    expect(mock).toHaveBeenCalledTimes(1)
    expect(mock).toHaveBeenCalledWith('Hello', 'World')
  })

  it('defaults body to empty string when omitted', async () => {
    const { sendDesktopNotification } = await import(
      '@/utils/desktopNotification'
    )
    const mock = vi.mocked(sendDesktopNotification)
    mock.mockClear()
    uiNotifyCapability.execute({ title: 'Bare' })
    expect(mock).toHaveBeenCalledWith('Bare', '')
  })
})

describe('UI_BUILTIN_CAPABILITIES', () => {
  it('contains ui.notify', () => {
    expect(UI_BUILTIN_CAPABILITIES).toContain(uiNotifyCapability)
  })
})

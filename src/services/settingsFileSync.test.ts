import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  _resetSettingsFileHandlersForTest,
  dispatchSettingsChange,
  registerSettingsFileHandler,
  scopeOf,
} from './settingsFileSync'

afterEach(() => _resetSettingsFileHandlersForTest())

describe('settings file sync registry', () => {
  it('subdir の変更はその scope の handler だけに届き、root は "root" に届く', async () => {
    const skills = vi.fn()
    const root = vi.fn()
    registerSettingsFileHandler('skills', skills)
    registerSettingsFileHandler('root', root)
    await dispatchSettingsChange({
      subdir: 'skills',
      name: 'a.md',
      op: 'write',
    })
    await dispatchSettingsChange({
      subdir: null,
      name: 'keybinds.json5',
      op: 'write',
    })
    await dispatchSettingsChange({
      subdir: 'memos',
      name: 'x.md',
      op: 'delete',
    })
    expect(skills).toHaveBeenCalledTimes(1)
    expect(skills.mock.calls[0]?.[0]).toMatchObject({
      name: 'a.md',
      op: 'write',
    })
    expect(root).toHaveBeenCalledTimes(1)
    expect(scopeOf({ subdir: null })).toBe('root')
  })

  it('解除した handler には届かず、失敗した handler は他を止めない', async () => {
    const failing = vi.fn(() => {
      throw new Error('boom')
    })
    const ok = vi.fn()
    const off = registerSettingsFileHandler('sessions', failing)
    registerSettingsFileHandler('sessions', ok)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await dispatchSettingsChange({
      subdir: 'sessions',
      name: 's.json5',
      op: 'write',
    })
    expect(ok).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
    off()
    await dispatchSettingsChange({
      subdir: 'sessions',
      name: 's.json5',
      op: 'write',
    })
    expect(failing).toHaveBeenCalledTimes(1)
    expect(ok).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

import { describe, expect, it } from 'vitest'
import { type TrayMenuInput, trayMenuState } from './trayMenu'

const labels = {
  show: 'Show',
  offline: 'Offline',
  realtime: 'Realtime',
  heartbeat: 'HEARTBEAT',
  resident: 'Keep running',
  quit: 'Quit',
}

function input(extra: Partial<TrayMenuInput> = {}): TrayMenuInput {
  return {
    labels,
    offline: false,
    realtime: true,
    heartbeatEnabled: true,
    residentInstalled: false,
    relayed: true,
    residentAvailable: true,
    ...extra,
  }
}

describe('trayMenuState (#1174)', () => {
  it('文言とチェック状態をそのまま写す', () => {
    const s = trayMenuState(input({ offline: true, residentInstalled: true }))
    expect(s).toMatchObject({
      showLabel: 'Show',
      offline: true,
      realtime: true,
      heartbeat: true,
      resident: true,
      residentEnabled: true,
      quitLabel: 'Quit',
    })
  })

  it('常駐の切り替えは HEARTBEAT 無効 / in-process / 常駐不可のどれかで押せない', () => {
    expect(
      trayMenuState(input({ heartbeatEnabled: false })).residentEnabled,
    ).toBe(false)
    expect(trayMenuState(input({ relayed: false })).residentEnabled).toBe(false)
    expect(
      trayMenuState(input({ residentAvailable: false })).residentEnabled,
    ).toBe(false)
  })

  it('押せなくても登録済みなら ON のまま見せる (設定の正本を隠さない)', () => {
    const s = trayMenuState(
      input({ heartbeatEnabled: false, residentInstalled: true }),
    )
    expect(s.resident).toBe(true)
    expect(s.residentEnabled).toBe(false)
  })
})

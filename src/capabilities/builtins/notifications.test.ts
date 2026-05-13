import { describe, expect, it } from 'vitest'
import {
  NOTIFICATIONS_BUILTIN_CAPABILITIES,
  notificationsListCapability,
  notificationsMarkReadCapability,
} from './notifications'

describe('notifications.list capability', () => {
  it('declares notifications permission and aiTool: true', () => {
    expect(notificationsListCapability.permissions).toEqual(['notifications'])
    expect(notificationsListCapability.aiTool).toBe(true)
    expect(notificationsListCapability.id).toBe('notifications.list')
    expect(notificationsListCapability.signature?.returns?.type).toBe('array')
  })

  it('marks limit and untilId as optional', () => {
    const params = notificationsListCapability.signature?.params
    expect(params?.limit?.optional).toBe(true)
    expect(params?.untilId?.optional).toBe(true)
  })
})

describe('notifications.markRead capability', () => {
  it('declares notifications permission, warning confirmation, aiTool', () => {
    expect(notificationsMarkReadCapability.id).toBe('notifications.markRead')
    expect(notificationsMarkReadCapability.permissions).toEqual([
      'notifications',
    ])
    expect(notificationsMarkReadCapability.aiTool).toBe(true)
    expect(typeof notificationsMarkReadCapability.requiresConfirmation).toBe(
      'function',
    )
    expect(
      notificationsMarkReadCapability.signature?.params?.accountId?.optional,
    ).toBe(true)
  })

  it('confirm shows account-specific message when accountId provided', async () => {
    const confirm = notificationsMarkReadCapability.requiresConfirmation
    if (typeof confirm !== 'function') throw new Error('expected function')
    const opts = await confirm({ accountId: 'acc-1' })
    expect(opts?.message).toContain('acc-1')
    expect(opts?.type).toBe('warning')
  })

  it('confirm shows全アカウント message when accountId is empty', async () => {
    const confirm = notificationsMarkReadCapability.requiresConfirmation
    if (typeof confirm !== 'function') throw new Error('expected function')
    const opts = await confirm({})
    expect(opts?.message).toContain('全アカウント')
  })
})

describe('NOTIFICATIONS_BUILTIN_CAPABILITIES', () => {
  it('contains list + markRead', () => {
    const ids = NOTIFICATIONS_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual(['notifications.list', 'notifications.markRead'])
  })
})

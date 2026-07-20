import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, describe, expect, it } from 'vitest'
import { MisskeyAuth } from '@/adapters/misskey/auth'
import type { AuthSession } from '@/bindings'

interface IpcCall {
  cmd: string
  args: Record<string, unknown>
}

describe('MisskeyAuth', () => {
  const auth = new MisskeyAuth()

  afterEach(() => {
    clearMocks()
  })

  describe('startAuth', () => {
    it('invokes auth_start and returns session', async () => {
      const mockSession: AuthSession = {
        sessionId: 'session-123',
        url: 'https://example.com/miauth/session-123?name=notedeck&permission=read:account',
        host: 'example.com',
      }
      const calls: IpcCall[] = []
      mockIPC((cmd, args) => {
        calls.push({ cmd, args: args as Record<string, unknown> })
        return mockSession
      })

      const session = await auth.startAuth('example.com')

      expect(session.host).toBe('example.com')
      expect(session.sessionId).toBe('session-123')
      expect(session.url).toContain('https://example.com/miauth/')

      expect(calls).toEqual([
        {
          cmd: 'auth_start',
          args: { host: 'example.com', permissions: null },
        },
      ])
    })

    it('passes custom permissions', async () => {
      const calls: IpcCall[] = []
      mockIPC((cmd, args) => {
        calls.push({ cmd, args: args as Record<string, unknown> })
        return {
          sessionId: 's1',
          url: 'https://example.com/miauth/s1',
          host: 'example.com',
        } satisfies AuthSession
      })

      await auth.startAuth('example.com', ['read:account', 'write:notes'])

      expect(calls).toEqual([
        {
          cmd: 'auth_start',
          args: {
            host: 'example.com',
            permissions: ['read:account', 'write:notes'],
          },
        },
      ])
    })
  })
})

import { describe, expect, it } from 'vitest'
import { skillCodec } from '@/services/distributableCodecs/skillCodec'

/** mode の読み書き (HEARTBEAT を独立フィールドではなく mode で持つ、#411) */
describe('skillCodec / mode', () => {
  const ctx = { filename: 'fallback-id.md', now: 0 }

  it('honors mode: heartbeat (新スキーマ / MisStore 配布)', () => {
    const item = skillCodec.fromFile(
      { meta: { mode: 'heartbeat' }, body: 'body' },
      ctx,
    )
    expect(item.extra.mode).toBe('heartbeat')
  })

  it('unknown mode falls back to manual', () => {
    const item = skillCodec.fromFile(
      { meta: { mode: 'bogus' }, body: 'body' },
      ctx,
    )
    expect(item.extra.mode).toBe('manual')
  })

  it('toFile serializes mode (no separate heartbeat field)', () => {
    const file = skillCodec.toFile({
      id: 'x',
      name: 'X',
      scope: { kind: 'none' },
      content: '',
      createdAt: 0,
      updatedAt: 0,
      extra: {
        version: '0.1.0',
        mode: 'heartbeat',
        triggers: [],
        builtIn: false,
        cheapCheckCapabilities: [],
        isPersona: false,
      },
    })
    expect(file.meta.mode).toBe('heartbeat')
    expect('heartbeat' in file.meta).toBe(false)
  })
})

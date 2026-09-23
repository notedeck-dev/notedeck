import { describe, expect, it } from 'vitest'
import type { Command } from '@/commands/registry'
import { collectDeviceTools, collectRuntimeEnums } from './deviceTools'

function cmd(partial: Partial<Command> & { id: string }): Command {
  return {
    label: partial.id,
    icon: 'ti-bolt',
    category: 'general',
    shortcuts: [],
    visible: false,
    execute: async () => undefined,
    ...partial,
  }
}

describe('collectDeviceTools (#1133: 宣言表に無い AI tool をデバイスが同梱する)', () => {
  it('plugin 由来 (宣言表に無い) の aiTool だけを拾い、getter の enum を値に落とす', () => {
    const dynamicEnum = ['a', 'b']
    const caps = [
      cmd({
        id: 'plugin.hello',
        aiTool: true,
        permissions: ['notes.read'],
        signature: {
          description: 'hello',
          params: {
            name: { type: 'string', description: 'n' },
            mode: {
              type: 'string',
              description: 'm',
              optional: true,
              get enum() {
                return dynamicEnum
              },
            },
          },
        },
      }),
      // 宣言表にある builtin は対象外
      cmd({
        id: 'time.now',
        aiTool: true,
        signature: { description: 'x', params: {} },
      }),
      // aiTool でない plugin capability は対象外
      cmd({ id: 'plugin.hidden', signature: { description: 'x' } }),
    ]
    expect(collectDeviceTools(caps)).toEqual([
      {
        id: 'plugin.hello',
        description: 'hello',
        params: {
          name: { type: 'string', description: 'n' },
          mode: {
            type: 'string',
            description: 'm',
            optional: true,
            enum: ['a', 'b'],
          },
        },
        permissions: ['notes.read'],
      },
    ])
  })
})

describe('collectRuntimeEnums (#1133: 実行時 enum をデバイスが足す)', () => {
  it('宣言に enum が無く実装にある引数だけを集める', () => {
    const caps = [
      cmd({
        id: 'column.add',
        aiTool: true,
        signature: {
          description: 'x',
          params: {
            type: {
              type: 'string',
              description: 't',
              get enum() {
                return ['timeline', 'notifications']
              },
            },
            accountId: { type: 'string', description: 'a', optional: true },
          },
        },
      }),
      // 宣言表に無いものは device_tools 側で運ぶので対象外
      cmd({
        id: 'plugin.x',
        aiTool: true,
        signature: {
          description: 'x',
          params: { p: { type: 'string', description: '', enum: ['1'] } },
        },
      }),
    ]
    expect(collectRuntimeEnums(caps)).toEqual({
      'column.add': { type: ['timeline', 'notifications'] },
    })
    expect(collectRuntimeEnums([])).toBeNull()
  })
})

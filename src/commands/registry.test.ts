import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { type Command, useCommandStore } from './registry'

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: 'ui.only',
    label: 'UI only',
    icon: 'ti-pencil',
    category: 'general',
    shortcuts: [],
    execute: () => undefined,
    ...overrides,
  }
}

// Command はパレットの入口だけで、capability registry とは独立 (#1098 §9)。
// capability にもしたいプラグインは Nd:register_command の options で別に登録する
describe('useCommandStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('register / unregister で一覧が増減する', () => {
    const store = useCommandStore()
    store.register(makeCommand({ id: 'a' }))
    store.register(makeCommand({ id: 'b' }))
    expect([...store.commands.keys()]).toEqual(['a', 'b'])
    store.unregister('a')
    expect([...store.commands.keys()]).toEqual(['b'])
  })

  it('同じ id の再登録は置き換える', () => {
    const store = useCommandStore()
    store.register(makeCommand({ id: 'x', label: 'first' }))
    store.register(makeCommand({ id: 'x', label: 'second' }))
    expect(store.commands.get('x')?.label).toBe('second')
  })

  it('execute は enabled が false の command を走らせない', () => {
    const store = useCommandStore()
    let ran = 0
    store.register(
      makeCommand({ id: 'off', enabled: () => false, execute: () => ran++ }),
    )
    store.register(makeCommand({ id: 'on', execute: () => ran++ }))
    store.execute('off')
    store.execute('on')
    expect(ran).toBe(1)
    expect(store.getEnabled().map((c) => c.id)).toEqual(['on'])
  })
})

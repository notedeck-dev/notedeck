// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCommandStore } from '@/commands/registry'
import { commandsListCapability } from './keybinds'

describe('commands.list', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('パレットに並ぶコマンドを登録元つきで返し、非表示のものは出さない', () => {
    const store = useCommandStore()
    const base = {
      icon: 'pencil',
      category: 'general' as const,
      shortcuts: [],
      execute: () => undefined,
    }
    store.register({ ...base, id: 'sample', label: '投稿' })
    store.register({ ...base, id: 'task.build', label: 'ビルド' })
    store.register({ ...base, id: 'my-plugin:hello', label: 'Hello' })
    store.register({ ...base, id: 'local:abc:hi', label: 'Hi' })
    store.register({ ...base, id: 'hidden', label: 'x', visible: false })

    const rows = commandsListCapability.execute({}) as {
      id: string
      label: string
      source: string
    }[]
    const sources = Object.fromEntries(rows.map((r) => [r.id, r.source]))
    expect(sources).toEqual({
      sample: 'builtin',
      'task.build': 'task',
      'my-plugin:hello': 'my-plugin',
      'local:abc:hi': 'local:abc',
    })
    expect(rows.find((r) => r.id === 'sample')).toMatchObject({
      label: '投稿',
      icon: 'pencil',
      shortcuts: [],
    })
  })
})

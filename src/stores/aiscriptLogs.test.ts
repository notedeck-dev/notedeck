import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAiScriptLogsStore } from './aiscriptLogs'

describe('useAiScriptLogsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('beginRun は system "started" を記録し runId を採番する', () => {
    const store = useAiScriptLogsStore()
    const a = store.beginRun('plugin', 'p1', 'My Plugin')
    const b = store.beginRun('widget', 'w1')
    expect(b.runId).toBeGreaterThan(a.runId)

    const entries = store.entriesFor('plugin', 'p1')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      source: 'plugin',
      sourceId: 'p1',
      name: 'My Plugin',
      runId: a.runId,
      level: 'system',
      message: 'started',
    })
  })

  it('print / error / system がそれぞれの level で記録される', () => {
    const store = useAiScriptLogsStore()
    const run = store.beginRun('play', 'f1')
    run.print('hello')
    run.error('boom')
    run.system('run completed')

    const levels = store.entriesFor('play', 'f1').map((e) => e.level)
    expect(levels).toEqual(['system', 'print', 'error', 'system'])
  })

  it('リング上限を超えたら古い方から破棄する (新しい方は必ず残る)', () => {
    const store = useAiScriptLogsStore()
    const run = store.beginRun('plugin', 'p1')
    for (let i = 0; i < 300; i++) run.print(`msg ${i}`)

    const entries = store.entriesFor('plugin', 'p1')
    expect(entries).toHaveLength(200)
    // 最新は残り、最古 (started と序盤の print) は破棄されている
    expect(entries.at(-1)?.message).toBe('msg 299')
    expect(entries[0]?.message).toBe('msg 100')
  })

  it('リングは source ごとに独立している', () => {
    const store = useAiScriptLogsStore()
    const a = store.beginRun('plugin', 'p1')
    const b = store.beginRun('plugin', 'p2')
    for (let i = 0; i < 300; i++) a.print(`a${i}`)
    b.print('b0')

    expect(store.entriesFor('plugin', 'p1')).toHaveLength(200)
    // p2 は started + b0 のみ
    expect(store.entriesFor('plugin', 'p2')).toHaveLength(2)
  })

  it('長文メッセージは truncate される', () => {
    const store = useAiScriptLogsStore()
    const run = store.beginRun('playground', 'col1')
    run.print('x'.repeat(5000))

    const entry = store.entriesFor('playground', 'col1').at(-1)
    expect(entry?.message.length).toBeLessThan(1100)
    expect(entry?.message.endsWith('… (truncated)')).toBe(true)
  })

  it('recent は新しい順で source / level / limit フィルタが効く', () => {
    const store = useAiScriptLogsStore()
    const p = store.beginRun('plugin', 'p1')
    p.print('p-out')
    p.error('p-err')
    const w = store.beginRun('widget', 'w1')
    w.print('w-out')

    const all = store.recent({})
    expect(all[0]?.message).toBe('w-out')
    expect(all.at(-1)?.message).toBe('started')

    const errorsOnly = store.recent({ level: 'error' })
    expect(errorsOnly.map((e) => e.message)).toEqual(['p-err'])

    const widgetOnly = store.recent({ source: 'widget' })
    expect(widgetOnly.every((e) => e.source === 'widget')).toBe(true)

    const limited = store.recent({ limit: 2 })
    expect(limited).toHaveLength(2)
    expect(limited[0]?.message).toBe('w-out')
  })

  it('recent は sourceId で絞り込める', () => {
    const store = useAiScriptLogsStore()
    store.beginRun('plugin', 'p1').print('one')
    store.beginRun('plugin', 'p2').print('two')

    const p2 = store.recent({ source: 'plugin', sourceId: 'p2' })
    expect(p2.every((e) => e.sourceId === 'p2')).toBe(true)
    expect(p2.map((e) => e.message)).toContain('two')
  })
})

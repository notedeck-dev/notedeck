import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useVaporTransitionGroup } from './useVaporTransition'

describe('useVaporTransitionGroup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('中ほどの要素を消すと、退場中は元の位置に残る', async () => {
    const scope = effectScope()
    const source = ref([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    const group = scope.run(() =>
      useVaporTransitionGroup(source, { leaveDuration: 200 }),
    )
    if (!group) throw new Error('scope did not run')
    const { rendered, leavingIds } = group
    source.value = [{ id: 'a' }, { id: 'c' }]
    await nextTick()
    expect(rendered.value.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(leavingIds.value.has('b')).toBe(true)

    vi.advanceTimersByTime(200)
    expect(rendered.value.map((i) => i.id)).toEqual(['a', 'c'])
    scope.stop()
  })
})

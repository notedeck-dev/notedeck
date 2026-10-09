import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('@/utils/haptics', () => ({
  hapticLight: vi.fn(),
  hapticMedium: vi.fn(),
}))
vi.mock('@/utils/tauriEvents', () => ({
  emitTauri: vi.fn(() => Promise.resolve()),
}))

import type { useDeckStore } from '@/stores/deck'
import { edgeScrollDelta, useColumnDrag } from './useColumnDrag'

const SELECTORS = {
  columns: 'columns',
  columnSection: 'section',
  colResizeHandle: 'handle',
}

function makeDrag(isCompact = false) {
  const deckStore = {
    layout: [['a'], ['b']],
    windowLayout: [['a'], ['b']],
  } as unknown as ReturnType<typeof useDeckStore>
  return useColumnDrag(deckStore, SELECTORS, ref(isCompact))
}

function pointer(
  type: string,
  init: { x?: number; y?: number; pointerType?: string } = {},
) {
  const ev = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.x ?? 0,
    clientY: init.y ?? 0,
    button: 0,
  })
  Object.defineProperty(ev, 'pointerType', {
    value: init.pointerType ?? 'mouse',
  })
  return ev
}

describe('edgeScrollDelta', () => {
  it('端の帯の外では 0', () => {
    expect(edgeScrollDelta(500, 0, 1000)).toBe(0)
  })

  it('左端に寄るほど速く左へ', () => {
    const near = edgeScrollDelta(10, 0, 1000)
    const far = edgeScrollDelta(50, 0, 1000)
    expect(near).toBeLessThan(0)
    expect(far).toBeLessThan(0)
    expect(near).toBeLessThan(far)
  })

  it('右端では右へ、端を越えても上限で頭打ち', () => {
    expect(edgeScrollDelta(990, 0, 1000)).toBeGreaterThan(0)
    expect(edgeScrollDelta(1200, 0, 1000)).toBe(edgeScrollDelta(1000, 0, 1000))
  })
})

describe('useColumnDrag (タッチ)', () => {
  let grabber: HTMLElement

  beforeEach(() => {
    vi.useFakeTimers()
    grabber = document.createElement('i')
    document.body.appendChild(grabber)
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
    document.body.className = ''
  })

  function touchDown(drag: ReturnType<typeof makeDrag>) {
    const ev = pointer('pointerdown', { x: 100, y: 100, pointerType: 'touch' })
    Object.defineProperty(ev, 'target', { value: grabber })
    drag.startDrag('a', ev)
  }

  it('長押しで掴む', () => {
    const drag = makeDrag()
    touchDown(drag)
    expect(drag.dragColumnId.value).toBeNull()
    vi.advanceTimersByTime(500)
    expect(drag.dragColumnId.value).toBe('a')
    document.dispatchEvent(pointer('pointerup', { pointerType: 'touch' }))
    expect(drag.dragColumnId.value).toBeNull()
  })

  it('長押しの前に指が動いたら掴まない', () => {
    const drag = makeDrag()
    touchDown(drag)
    document.dispatchEvent(
      pointer('pointermove', { x: 140, y: 100, pointerType: 'touch' }),
    )
    vi.advanceTimersByTime(500)
    expect(drag.dragColumnId.value).toBeNull()
  })

  it('長押しの前に離したら掴まない', () => {
    const drag = makeDrag()
    touchDown(drag)
    document.dispatchEvent(pointer('pointerup', { pointerType: 'touch' }))
    vi.advanceTimersByTime(500)
    expect(drag.dragColumnId.value).toBeNull()
  })

  it('掴んだあと pointercancel で落とさずに終える', () => {
    const drag = makeDrag()
    touchDown(drag)
    vi.advanceTimersByTime(500)
    document.dispatchEvent(pointer('pointercancel', { pointerType: 'touch' }))
    expect(drag.dragColumnId.value).toBeNull()
  })
})

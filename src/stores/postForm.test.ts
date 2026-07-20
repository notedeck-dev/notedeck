import JSON5 from 'json5'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/settingsFs', () => ({
  isTauri: true,
  readPostForm: vi.fn(async () => ''),
  writePostForm: vi.fn(async () => undefined),
}))

import { PERSIST_DEBOUNCE_MS } from '@/constants/persist'
import {
  ALL_POST_FORM_BUTTONS,
  DEFAULT_POST_FORM_BUTTONS,
  type PostFormButtonId,
  usePostFormStore,
} from '@/stores/postForm'
import { readPostForm, writePostForm } from '@/utils/settingsFs'

describe('usePostFormStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('初期状態はデフォルトボタン構成で isCustomized false', () => {
    const store = usePostFormStore()
    expect(store.buttons).toEqual(DEFAULT_POST_FORM_BUTTONS)
    expect(store.isCustomized).toBe(false)
    // デフォルトは全ボタン一覧の部分集合 (postform.json5 と meta の乖離検知)
    for (const id of DEFAULT_POST_FORM_BUTTONS) {
      expect(ALL_POST_FORM_BUTTONS).toContain(id)
    }
  })

  it('setButtons: 未知 ID・重複・非文字列を除去して順序を保持する', () => {
    const store = usePostFormStore()
    store.setButtons([
      'cw',
      'cw',
      'unknown-id',
      42,
      'emoji',
    ] as PostFormButtonId[])
    expect(store.buttons).toEqual(['cw', 'emoji'])
    expect(store.isCustomized).toBe(true)
  })

  it('setButtons: debounce 後に JSON5 で永続化する', () => {
    const store = usePostFormStore()
    store.setButtons(['cw', 'emoji'])
    expect(writePostForm).not.toHaveBeenCalled()
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)
    expect(writePostForm).toHaveBeenCalledTimes(1)
    expect(writePostForm).toHaveBeenCalledWith(
      JSON5.stringify(['cw', 'emoji'], null, 2),
    )
  })

  it('setButtons 連打は debounce され書き込みは 1 回だけ', () => {
    const store = usePostFormStore()
    store.setButtons(['cw'])
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS - 1)
    store.setButtons(['cw', 'emoji'])
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)
    expect(writePostForm).toHaveBeenCalledTimes(1)
    expect(writePostForm).toHaveBeenCalledWith(
      JSON5.stringify(['cw', 'emoji'], null, 2),
    )
  })

  it('setButtons(undefined): デフォルトに戻しファイルを即時クリアする', () => {
    const store = usePostFormStore()
    store.setButtons(['cw'])
    store.setButtons(undefined)
    expect(store.buttons).toEqual(DEFAULT_POST_FORM_BUTTONS)
    expect(store.isCustomized).toBe(false)
    expect(writePostForm).toHaveBeenCalledWith('')
  })

  it('flushPersist: ペンディングを破棄して即時書き込み、二重書き込みしない', () => {
    const store = usePostFormStore()
    store.setButtons(['cw'])
    store.flushPersist()
    expect(writePostForm).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS * 2)
    expect(writePostForm).toHaveBeenCalledTimes(1)
  })

  it('init: 保存済み JSON5 を読み込んで復元する', async () => {
    vi.mocked(readPostForm).mockResolvedValue("['clear', 'emoji']")
    const store = usePostFormStore()
    await store.init()
    expect(store.buttons).toEqual(['clear', 'emoji'])
    expect(store.isCustomized).toBe(true)
  })

  it('init: 有効な ID が 1 つも無い内容はデフォルトのまま', async () => {
    vi.mocked(readPostForm).mockResolvedValue("['nope', 123]")
    const store = usePostFormStore()
    await store.init()
    expect(store.buttons).toEqual(DEFAULT_POST_FORM_BUTTONS)
    expect(store.isCustomized).toBe(false)
  })

  it('init: 空・空白のみの内容はデフォルトのまま', async () => {
    vi.mocked(readPostForm).mockResolvedValue('   ')
    const store = usePostFormStore()
    await store.init()
    expect(store.buttons).toEqual(DEFAULT_POST_FORM_BUTTONS)
    expect(store.isCustomized).toBe(false)
  })

  it('init: パース不能な内容でも throw せずデフォルトのまま', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined)
    vi.mocked(readPostForm).mockResolvedValue('{{{')
    const store = usePostFormStore()
    await store.init()
    expect(store.buttons).toEqual(DEFAULT_POST_FORM_BUTTONS)
    expect(store.isCustomized).toBe(false)
    warnSpy.mockRestore()
  })
})

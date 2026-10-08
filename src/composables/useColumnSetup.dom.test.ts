// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { type Account, useAccountsStore } from '@/stores/accounts'
import type { DeckColumn } from '@/stores/deck'
import { AppError } from '@/utils/errors'
import { useColumnSetup } from './useColumnSetup'

/**
 * 共通基盤のうち、ノート列以外のカラムが自前で書いていた部分 (#1098 §4):
 * 読み込み中 / エラーの管理 (withLoading)、未ログイン判定、先頭へのスクロール。
 * ノート操作と adapter の生涯は useNoteColumn / useCrossAccountNotes の
 * dom テストが担う。
 */

vi.mock('@/bindings', () => ({
  commands: new Proxy(
    {},
    {
      get: () => () => Promise.resolve({ status: 'ok', data: [] }),
    },
  ),
}))

function account(id: string, hasToken = true): Account {
  return {
    id,
    host: 'example.com',
    userId: `uid-${id}`,
    username: id,
    displayName: null,
    avatarUrl: null,
    software: 'misskey-dev/misskey',
    hasToken,
  } as Account
}

function column(partial: Partial<DeckColumn> = {}): DeckColumn {
  return {
    id: 'col-1',
    type: 'announcements',
    name: null,
    width: 300,
    accountId: 'acc-1',
    ...partial,
  } as DeckColumn
}

/** 基盤を setup した素のコンポーネント。scroller は template ref で結ぶ */
function mountSetup(col: DeckColumn) {
  let setup!: ReturnType<typeof useColumnSetup>
  const Host = defineComponent({
    setup() {
      setup = useColumnSetup(() => col)
      return { scroller: setup.scroller }
    },
    template: '<div ref="scroller" style="overflow:auto"></div>',
  })
  const wrapper = mount(Host, { attachTo: document.body })
  return { wrapper, setup }
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useColumnSetup / withLoading', () => {
  it('実行中は isLoading が立ち、成功したら error は null のまま下りる', async () => {
    const { setup } = mountSetup(column())
    let resolve!: () => void
    const task = new Promise<void>((r) => {
      resolve = r
    })

    const run = setup.withLoading(() => task)
    expect(setup.isLoading.value).toBe(true)
    resolve()
    await run

    expect(setup.isLoading.value).toBe(false)
    expect(setup.error.value).toBeNull()
  })

  it('失敗したら AppError に包んで error に置き、isLoading を下ろす', async () => {
    const { setup } = mountSetup(column())

    await setup.withLoading(async () => {
      throw new Error('boom')
    })

    expect(setup.isLoading.value).toBe(false)
    expect(setup.error.value).toBeInstanceOf(AppError)
    expect(setup.error.value?.message).toContain('boom')
  })

  it('開始時に前回の error を消す', async () => {
    const { setup } = mountSetup(column())
    await setup.withLoading(async () => {
      throw new Error('first')
    })
    expect(setup.error.value).not.toBeNull()

    await setup.withLoading(async () => undefined)

    expect(setup.error.value).toBeNull()
  })

  it('後から始めた読み込みが先に終わったら、古い方の完了は状態を触らない', async () => {
    const { setup } = mountSetup(column())
    let rejectOld!: (e: Error) => void
    const old = new Promise<void>((_, reject) => {
      rejectOld = reject
    })
    const oldRun = setup.withLoading(async (stillCurrent) => {
      await old
      expect(stillCurrent()).toBe(false)
    })
    await setup.withLoading(async (stillCurrent) => {
      expect(stillCurrent()).toBe(true)
    })
    expect(setup.isLoading.value).toBe(false)

    rejectOld(new Error('stale'))
    await oldRun

    // 古い失敗で error が立たず、isLoading も新しい側の結果のまま
    expect(setup.error.value).toBeNull()
    expect(setup.isLoading.value).toBe(false)
  })
})

describe('useColumnSetup / isLoggedOut', () => {
  it('トークンの無いアカウントだけ true (ゲスト / アカウント無しは false)', async () => {
    const accounts = useAccountsStore()
    accounts.accounts.push(account('acc-1', true), account('acc-2', false))

    expect(
      mountSetup(column({ accountId: 'acc-1' })).setup.isLoggedOut.value,
    ).toBe(false)
    expect(
      mountSetup(column({ accountId: 'acc-2' })).setup.isLoggedOut.value,
    ).toBe(true)
    expect(
      mountSetup(column({ accountId: null })).setup.isLoggedOut.value,
    ).toBe(false)
    await flush()
  })
})

describe('useColumnSetup / scrollToTop', () => {
  it('scroller の先頭へ smooth スクロールする', async () => {
    const { setup, wrapper } = mountSetup(column())
    await nextTick()
    const el = wrapper.element as HTMLElement
    const scrollTo = vi.fn()
    el.scrollTo = scrollTo

    setup.scrollToTop()

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })
})

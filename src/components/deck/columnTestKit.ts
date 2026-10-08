import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { type Component, nextTick } from 'vue'
import { type Account, useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'

export { bindings, bindingsMock } from './columnTestKit.bindings'

/**
 * Deck*Column の dom テスト共通部 (#1098 §4)。
 *
 * 「共通基盤 (useColumnSetup / usePaginatedList) に乗っているか」を、カラムを
 * 本物の store の上で mount し、IPC (tauri-specta の commands) の呼び出しと
 * 描画結果で確かめる。IPC は各テストファイルが
 *   vi.mock('@/bindings', async () => (await import('./columnTestKit.bindings')).bindingsMock())
 * で差し替える (vi.mock は hoist されるので helper 側には置けない。factory が
 * import するのはアプリを import しない columnTestKit.bindings だけ)。
 */

export function makeAccount(partial: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    host: 'example.com',
    userId: 'uid-1',
    username: 'alice',
    displayName: null,
    avatarUrl: null,
    software: 'misskey-dev/misskey',
    hasToken: true,
    ...partial,
  } as Account
}

export function makeColumn(
  partial: Partial<DeckColumnType> = {},
): DeckColumnType {
  return {
    id: 'col-1',
    type: 'timeline',
    name: null,
    width: 300,
    accountId: 'acc-1',
    ...partial,
  } as DeckColumnType
}

/** pinia を張り直し、アカウントを 1 件 (または指定分) 入れる */
export function setupStores(accounts: Account[] = [makeAccount()]) {
  setActivePinia(createPinia())
  const store = useAccountsStore()
  store.accounts.push(...accounts)
  return store
}

/** DeckColumn の胴体スロットだけ素通しする stub。props は data 属性で観測できる */
export const DeckColumnStub = {
  props: {
    columnId: String,
    title: String,
    themeVars: Object,
    requireAccount: Boolean,
    pullRefresh: Function,
  },
  template:
    '<div data-deck-column :data-title="title" :data-require-account="requireAccount ? 1 : 0" :data-pull-refresh="pullRefresh ? 1 : 0">' +
    '<slot name="header-icon" /><slot name="header-meta" /><slot name="header-extra" /><slot name="menu-items" /><slot /></div>',
}

export const ColumnEmptyStateStub = {
  props: {
    message: String,
    error: Object,
    isError: Boolean,
    ctaLabel: String,
  },
  template:
    '<div data-empty-state :data-is-error="isError ? 1 : 0">{{ message ?? error?.message }}</div>',
}

export const LoadingSpinnerStub = { template: '<div data-loading-spinner />' }

export async function mountColumn(
  component: Component,
  column: DeckColumnType,
  stubs: Record<string, unknown> = {},
) {
  const wrapper = mount(component, {
    props: { column },
    global: {
      stubs: {
        DeckColumn: DeckColumnStub,
        ColumnEmptyState: ColumnEmptyStateStub,
        LoadingSpinner: LoadingSpinnerStub,
        ...stubs,
      },
    },
    attachTo: document.body,
  })
  await flush()
  return wrapper
}

/** マイクロタスクと描画を数周回す (IPC の mock は即時解決なので数周で収束する) */
export async function flush(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

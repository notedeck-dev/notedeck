import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { destroyAdapter } from '@/adapters/factory'
import type { ServerSoftware } from '@/adapters/types'
import { deleteAllMemos } from '@/composables/useMemos'
import { removeStorage, STORAGE_KEYS } from '@/utils/storage'
import { listenTauri } from '@/utils/tauriEvents'
import { commands, unwrap } from '@/utils/tauriInvoke'

export interface Account {
  id: string
  host: string
  userId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  software: ServerSoftware
  hasToken: boolean
}

const GUEST_USER_ID = '__guest__'

export function isGuestAccount(account: Account): boolean {
  return account.userId === GUEST_USER_ID && !account.hasToken
}

export function getAccountAvatarUrl(account: Account): string {
  if (isGuestAccount(account)) return '/avatar-guest.svg'
  return account.avatarUrl || '/avatar-default.svg'
}

export function getAccountLabel(account: Account): string {
  if (isGuestAccount(account)) {
    const name = account.displayName || 'ゲスト'
    return `${name}@${account.host}`
  }
  return `@${account.username}@${account.host}`
}

// Module-scoped buffer + direct applier for `nd:accounts-early` events.
// The Rust backend (src-tauri/src/lib.rs) emits this event from a background
// thread as soon as DB migrations finish — which can easily race with frontend
// bootstrap. By registering the listener synchronously at module load (before
// Pinia is even created) we can catch the emit deterministically. If the store
// hasn't been instantiated yet, the payload is buffered; otherwise it is
// applied directly through `onEarlyArrive`.
let earlyPayload: Account[] | null = null
let onEarlyArrive: ((payload: Account[]) => void) | null = null
let earlyListenerRegistered = false

export function initEarlyAccountListener(): void {
  if (earlyListenerRegistered) return
  earlyListenerRegistered = true
  void listenTauri('nd:accounts-early', (payload) => {
    if (onEarlyArrive) onEarlyArrive(payload)
    else earlyPayload = payload
  })
}

export const useAccountsStore = defineStore('accounts', () => {
  const accounts = ref<Account[]>([])
  const activeAccountId = ref<string | null>(null)
  const isLoaded = ref(false)
  const modeVersionByAccount = ref<Record<string, number>>({})

  const accountMap = computed(() => {
    const map = new Map<string, Account>()
    for (const acc of accounts.value) map.set(acc.id, acc)
    return map
  })

  const activeAccount = computed(
    () =>
      (activeAccountId.value
        ? accountMap.value.get(activeAccountId.value)
        : null) ?? null,
  )

  const accountsByServer = computed(() => {
    const map = new Map<string, Account[]>()
    for (const acc of accounts.value) {
      const list = map.get(acc.host) ?? []
      list.push(acc)
      map.set(acc.host, list)
    }
    return map
  })

  let loadPromise: Promise<void> | null = null

  function applyAccounts(stored: Account[]): void {
    accounts.value = stored
    if (stored.length > 0 && !activeAccountId.value) {
      activeAccountId.value = accounts.value[0]?.id ?? null
    }
    isLoaded.value = true
  }

  onEarlyArrive = (payload) => {
    if (isLoaded.value) return
    applyAccounts(payload)
  }

  function loadAccounts(): Promise<void> {
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      // Fast path: an `nd:accounts-early` event already arrived before
      // this point.
      if (earlyPayload && !isLoaded.value) {
        applyAccounts(earlyPayload)
        earlyPayload = null
      }
      // Safety net: await the invoke result in case the early event is
      // never emitted (dev reload, error path) or lags behind.
      const stored = unwrap(await commands.loadAccounts()) as Account[]
      if (!isLoaded.value) applyAccounts(stored)
    })()
    return loadPromise
  }

  function addAccount(account: Account): void {
    const idx = accounts.value.findIndex(
      (a) => a.host === account.host && a.userId === account.userId,
    )
    if (idx >= 0) {
      accounts.value[idx] = account
    } else {
      accounts.value.push(account)
    }
    if (!activeAccountId.value) {
      activeAccountId.value = account.id
    }
  }

  // 削除/ログアウトは「資格情報の無効化 → backend 切断」の順に行う (#700)。
  // backend 切断を先にすると、購読の自己回復リトライがまだ有効な資格情報で
  // connect し直して WS が復活し、誰にも切断されないまま残る競合窓がある。
  // 無効化を先にすれば復活は資格情報エラーで失敗し、窓の間に確立済みの
  // 接続も最後の切断がまとめて掃除する。副次効果として、backend 側の
  // 無効化が失敗した場合に adapter を壊さない (アカウントはまだ生きている)。

  async function removeAccount(id: string): Promise<void> {
    unwrap(await commands.deleteAccount(id))
    accounts.value = accounts.value.filter((a) => a.id !== id)
    if (activeAccountId.value === id) {
      activeAccountId.value = accounts.value[0]?.id ?? null
    }
    destroyAdapter(id)
    // Clean up localStorage caches associated with this account
    removeStorage(STORAGE_KEYS.notificationCache(id))
    removeStorage(STORAGE_KEYS.policies(id))
    deleteAllMemos(id)
  }

  async function logoutAccount(id: string): Promise<void> {
    unwrap(await commands.logoutAccount(id))
    const account = accounts.value.find((a) => a.id === id)
    if (account) account.hasToken = false
    destroyAdapter(id)
  }

  function switchAccount(id: string): void {
    if (accounts.value.some((a) => a.id === id)) {
      activeAccountId.value = id
    }
  }

  function getModeVersion(accountId: string): number {
    return modeVersionByAccount.value[accountId] ?? 0
  }

  function bumpModeVersion(accountId: string): void {
    modeVersionByAccount.value = {
      ...modeVersionByAccount.value,
      [accountId]: (modeVersionByAccount.value[accountId] ?? 0) + 1,
    }
  }

  return {
    accounts,
    activeAccountId,
    activeAccount,
    accountMap,
    accountsByServer,
    isLoaded,
    loadAccounts,
    addAccount,
    removeAccount,
    logoutAccount,
    switchAccount,
    modeVersionByAccount,
    getModeVersion,
    bumpModeVersion,
  }
})

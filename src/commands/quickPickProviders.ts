import { reactive } from 'vue'
import { exposedColumnGroups } from '@/columns/exposure'
import {
  ACCOUNT_INDEPENDENT_TYPES,
  ACCOUNT_OPTIONAL_TYPES,
  buildColumnDefaults,
  COLUMN_ICONS,
  COLUMN_LABELS,
  COLUMN_REGISTRY,
  CROSS_ACCOUNT_TYPES,
  GUEST_ALLOWED_TYPES,
  type SelectableItem,
  type SelectableSpec,
} from '@/columns/registry'
import { refreshProfileCommands } from '@/commands/definitions'
import { switchProfileWithWindows } from '@/composables/useDeckWindow'
import { showLoginPrompt } from '@/composables/useLoginPrompt'
import { formatUserHandle, searchUsers } from '@/composables/useUserSearch'
import { SETTINGS_SECTIONS } from '@/settings/sections'
import {
  getAccountAvatarUrl,
  getAccountLabel,
  isGuestAccount,
  useAccountsStore,
} from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import type { ColumnType, DeckColumn } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { useDeckProfileStore } from '@/stores/deckProfile'
import { usePrompt } from '@/stores/prompt'
import { useToast } from '@/stores/toast'
import { useWindowsStore } from '@/stores/windows'
import { proxyThumbUrl } from '@/utils/mediaProxy'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { isWindowExposed } from '@/windows/exposure'
import { WINDOW_ICONS, WINDOW_LABELS } from '@/windows/registry'
import type { QuickPickItem } from './quickPick'
import { useCommandStore } from './registry'

// ============================================================
// Settings (Phase 2)
// ============================================================

export function getSettingsItems(): QuickPickItem[] {
  // 定義元は SETTINGS_SECTIONS 1 本 (#1035)。表示名とアイコンはウィンドウ
  // レジストリから引くので、メニューとパレットで名前がずれない
  return SETTINGS_SECTIONS.filter((section) =>
    isWindowExposed(section.window),
  ).map((section) => ({
    id: section.window,
    label: WINDOW_LABELS[section.window] ?? section.window,
    icon: (WINDOW_ICONS[section.window] ?? 'ti ti-settings').replace(
      /^ti ti-/,
      '',
    ),
    action: () => useWindowsStore().open(section.window),
  }))
}

// ============================================================
// Profiles (Phase 3)
// ============================================================

export function getProfileItems(): QuickPickItem[] {
  const profileStore = useDeckProfileStore()
  const deckStore = useDeckStore()
  const profiles = profileStore.getProfiles()
  const activeId = deckStore.activeProfileId

  const items: QuickPickItem[] = profiles.map((p) => ({
    id: `profile-${p.id}`,
    label: p.name,
    icon: 'layout',
    description: p.id === activeId ? '現在のプロファイル' : undefined,
    children: () => getProfileActions(p.id, p.id === activeId),
  }))

  items.push({
    id: 'profile-new',
    label: '新規プロファイル作成',
    icon: 'plus',
    action: () => {
      deckStore.saveAsProfile()
      refreshProfileCommands()
    },
  })

  return items
}

function getProfileActions(
  profileId: string,
  isActive: boolean,
): QuickPickItem[] {
  const items: QuickPickItem[] = []

  if (!isActive) {
    items.push({
      id: `profile-switch-${profileId}`,
      label: '切替',
      icon: 'switch-horizontal',
      action: () => switchProfileWithWindows(profileId),
    })
  }

  items.push({
    id: `profile-edit-${profileId}`,
    label: '編集',
    icon: 'edit',
    action: () => useWindowsStore().open('profileEditor', { profileId }),
  })

  if (!isActive) {
    items.push({
      id: `profile-delete-${profileId}`,
      label: '削除',
      icon: 'trash',
      action: async () => {
        const { confirm } = useConfirm()
        const ok = await confirm({
          title: 'プロファイルを削除',
          message: 'このプロファイルを削除しますか？',
          okLabel: '削除',
          type: 'danger',
        })
        if (!ok) return
        useDeckStore().deleteProfile(profileId)
        refreshProfileCommands()
      },
    })
  }

  return items
}

// ============================================================
// Add Column (Phase 4)
// ============================================================

export function getColumnTypeItems(): QuickPickItem[] {
  return exposedColumnGroups().flatMap(({ label: group, types }) =>
    types.map((type) => ({
      id: `col-${type}`,
      label: COLUMN_LABELS[type] ?? type,
      icon: COLUMN_ICONS[type] ?? 'dots',
      group,
      children: () => buildAccountStep(type),
    })),
  )
}

async function buildAccountStep(type: ColumnType): Promise<QuickPickItem[]> {
  const accountsStore = useAccountsStore()

  // Account-independent types: skip account selection
  if (ACCOUNT_INDEPENDENT_TYPES.has(type)) {
    finalizeAddColumn(type, null)
    return []
  }

  const authRequired = !GUEST_ALLOWED_TYPES.has(type)
  const accounts = accountsStore.accounts.filter(
    (a) => !(authRequired && isGuestAccount(a)),
  )

  // Account-optional types: always show selection so user can choose "no account"
  const forceShowSelection = ACCOUNT_OPTIONAL_TYPES.has(type)

  // 選べるアカウントが無い (アカウント 0 件 / auth 必須型でゲストのみ):
  // 空のピッカーを出して無言で終わらず、ログイン誘導を返す (#693 と同原則)。
  // cross-account 型は「全アカウント」で 0 件でも開ける (ナビバーのデフォルト
  // 項目がトグルで開けることとの整合)
  if (
    accounts.length === 0 &&
    !forceShowSelection &&
    !CROSS_ACCOUNT_TYPES.has(type)
  ) {
    useToast().show('ログインすると利用できます', 'info')
    return []
  }

  // Single account: auto-select (unless account-optional)
  const account = accounts[0]
  if (!forceShowSelection && accounts.length === 1 && account) {
    if (!account.hasToken && authRequired) {
      showLoginPrompt()
      return []
    }
    return buildDetailStep(type, account.id)
  }

  // Multiple accounts (or account-optional): show selection
  const items: QuickPickItem[] = []

  if (CROSS_ACCOUNT_TYPES.has(type)) {
    items.push({
      id: 'account-all',
      label: '全アカウント',
      icon: 'users',
      children: () => buildDetailStep(type, null),
    })
  }

  if (ACCOUNT_OPTIONAL_TYPES.has(type)) {
    items.push({
      id: 'account-none',
      label: 'アカウントなし',
      icon: 'circle-off',
      children: () => buildDetailStep(type, null),
    })
  }

  for (const account of accounts) {
    items.push({
      id: `account-${account.id}`,
      label: getAccountLabel(account),
      icon: 'user',
      // プロキシは表示側 (AccountAvatar) が寸法に合わせて掛ける
      avatarUrl: getAccountAvatarUrl(account),
      serverHost: account.host,
      children: () => {
        if (!account.hasToken && authRequired) {
          showLoginPrompt()
          return []
        }
        return buildDetailStep(type, account.id)
      },
    })
  }

  return items
}

interface QPSelectable {
  type: ColumnType
  spec: SelectableSpec
}

function getSelectable(type: ColumnType): QPSelectable | null {
  const spec = COLUMN_REGISTRY[type]
  return spec?.selectable ? { type, spec: spec.selectable } : null
}

async function buildDetailStep(
  type: ColumnType,
  accountId: string | null,
): Promise<QuickPickItem[]> {
  // User type: server-side search via onQueryChange (keeps avatar-rich UX)
  if (type === 'user' && accountId) {
    buildUserSearchStep(accountId)
    return []
  }

  const selectable = getSelectable(type)
  if (selectable && accountId) {
    // Searchable config: build step with search input + initial items
    if (selectable.spec.search) {
      buildSearchableStep(selectable, accountId)
      return []
    }
    const items = await selectable.spec.fetch(accountId)
    const icon = COLUMN_ICONS[type] ?? 'dots'
    const label = COLUMN_LABELS[type] ?? type
    const result: QuickPickItem[] = []

    // Add "create new" option if supported
    if (selectable.spec.createEndpoint) {
      result.push({
        id: `create-new-${type}`,
        label: `新しい${label}を作成`,
        icon: 'plus',
        action: () => createNewItem(selectable, accountId),
      })
    }

    for (const item of items) {
      result.push({
        id: `select-${item.id}`,
        label: item.name,
        icon,
        avatarUrl: item.avatarUrl,
        description: item.description,
        group: item.group,
        action: () => {
          useDeckStore().addColumn({
            type,
            name: item.name,
            width: 360,
            accountId,
            [selectable.spec.idKey]: item.id,
            active: true,
          } as Omit<DeckColumn, 'id'>)
        },
      })
    }
    return result
  }

  finalizeAddColumn(type, accountId)
  return []
}

/** Build a searchable Quick Pick step with initial items + server-side search */
function buildSearchableStep(config: QPSelectable, accountId: string) {
  const commandStore = useCommandStore()
  const icon = COLUMN_ICONS[config.type] ?? 'dots'
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  function itemToQuickPick(item: SelectableItem): QuickPickItem {
    return {
      id: `select-${item.id}`,
      label: item.name,
      icon,
      avatarUrl: item.avatarUrl,
      description: item.description,
      group: item.group,
      action: () => {
        useDeckStore().addColumn({
          type: config.type,
          name: item.name,
          width: 360,
          accountId,
          [config.spec.idKey]: item.id,
          active: true,
        } as Omit<DeckColumn, 'id'>)
        useCommandStore().close()
      },
    }
  }

  const step = reactive({
    title: `${COLUMN_LABELS[config.type] ?? config.type}を選択`,
    placeholder: `${COLUMN_LABELS[config.type] ?? config.type}を検索...`,
    items: [] as QuickPickItem[],
    loading: true,
    onQueryChange(q: string) {
      if (debounceTimer) clearTimeout(debounceTimer)
      if (!q.trim()) {
        // Restore initial items
        fetchItems()
        return
      }
      debounceTimer = setTimeout(() => fetchItems(q), 300)
    },
  })

  async function fetchItems(query?: string) {
    step.loading = true
    try {
      const items =
        query && config.spec.search
          ? await config.spec.search(accountId, query)
          : await config.spec.fetch(accountId)
      step.items = items.map(itemToQuickPick)
    } catch {
      step.items = []
    } finally {
      step.loading = false
    }
  }

  commandStore.pushQuickPick(step)
  // Fetch initial items
  fetchItems()
}

function buildUserSearchStep(accountId: string) {
  const commandStore = useCommandStore()
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  const step = reactive({
    title: 'ユーザーを選択',
    placeholder: 'ユーザーを検索...',
    items: [] as QuickPickItem[],
    loading: false,
    onQueryChange(q: string) {
      if (debounceTimer) clearTimeout(debounceTimer)
      if (!q.trim()) {
        step.items = []
        return
      }
      debounceTimer = setTimeout(async () => {
        step.loading = true
        try {
          const users = await searchUsers(accountId, q)
          step.items = users.map((u) => {
            const handle = formatUserHandle(u)
            return {
              id: `user-${u.id}`,
              label: u.name || handle,
              description: u.name ? handle : undefined,
              icon: 'user',
              avatarUrl: u.avatarUrl
                ? proxyThumbUrl(u.avatarUrl, 28)
                : undefined,
              action: () => {
                useDeckStore().addColumn({
                  type: 'user',
                  name: handle,
                  width: 360,
                  accountId,
                  userId: u.id,
                  active: true,
                } as Omit<DeckColumn, 'id'>)
                useCommandStore().close()
              },
            }
          })
        } catch {
          step.items = []
        } finally {
          step.loading = false
        }
      }, 300)
    },
  })

  commandStore.pushQuickPick(step)
}

async function createNewItem(config: QPSelectable, accountId: string) {
  if (!config.spec.createEndpoint) return
  const commandStore = useCommandStore()
  commandStore.close()
  const label = COLUMN_LABELS[config.type] ?? config.type
  const { prompt } = usePrompt()
  const name = await prompt({
    title: `新しい${label}を作成`,
    placeholder: `${label}名を入力...`,
  })
  if (!name) return
  try {
    const created = unwrap(
      await commands.apiRequest(accountId, config.spec.createEndpoint, {
        name,
        ...config.spec.createDefaults,
      }),
    ) as { id: string; name: string }
    useDeckStore().addColumn({
      type: config.type,
      name: created.name,
      width: 360,
      accountId,
      [config.spec.idKey]: created.id,
      active: true,
    } as Omit<DeckColumn, 'id'>)
  } catch (e) {
    console.error(`[command] failed to create ${config.type}:`, e)
  }
}

function finalizeAddColumn(type: ColumnType, accountId: string | null) {
  useDeckStore().addColumn({
    type,
    ...buildColumnDefaults(type, accountId),
  } as Omit<DeckColumn, 'id'>)
  useCommandStore().close()
}

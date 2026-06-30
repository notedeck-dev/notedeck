import { relaunch } from '@tauri-apps/plugin-process'
import { reactive } from 'vue'
import {
  ACCOUNT_INDEPENDENT_TYPES,
  ACCOUNT_OPTIONAL_TYPES,
  buildColumnDefaults,
  COLUMN_ICONS,
  COLUMN_LABELS,
  COLUMN_REGISTRY,
  COLUMN_TYPE_GROUPS,
  CROSS_ACCOUNT_TYPES,
  GUEST_ALLOWED_TYPES,
  type SelectableItem,
  type SelectableSpec,
} from '@/columns/registry'
import { refreshProfileCommands } from '@/commands/definitions'
import { switchProfileWithWindows } from '@/composables/useDeckWindow'
import { showLoginPrompt } from '@/composables/useLoginPrompt'
import { formatUserHandle, searchUsers } from '@/composables/useUserSearch'
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
import { useThemeStore } from '@/stores/theme'
import { useWindowsStore } from '@/stores/windows'
import { proxyThumbUrl } from '@/utils/imageProxy'
import { commands, unwrap } from '@/utils/tauriInvoke'
import type { QuickPickItem } from './quickPick'
import { useCommandStore } from './registry'

// ============================================================
// Settings (Phase 2)
// ============================================================

export function getSettingsItems(): QuickPickItem[] {
  return [
    // Appearance
    {
      id: 'toggle-dark-mode',
      label: 'ダーク / ライトモード切替',
      icon: 'moon',
      group: 'アピアランス',
      action: () => useThemeStore().toggleTheme(),
    },
    {
      id: 'toggle-os-theme-sync',
      label: 'デバイスのダークモードに同期',
      icon: 'device-desktop',
      group: 'アピアランス',
      description: useThemeStore().manualMode == null ? 'オン' : 'オフ',
      action: () => {
        const themeStore = useThemeStore()
        if (themeStore.manualMode == null) {
          themeStore.pinCurrentMode()
        } else {
          themeStore.resetToOsTheme()
        }
      },
    },
    // テーマ選択 / 編集 / 削除はテーマカラム (themeManager) に集約済みのため
    // アピアランス quickPick からは撤去。テーマカラムを開くには
    // 「テーマを管理」コマンドを使う。
    {
      id: 'set-wallpaper',
      label: '壁紙を設定',
      icon: 'photo',
      group: 'アピアランス',
      action: () => pickWallpaperFile(),
    },
    {
      id: 'remove-wallpaper',
      label: '壁紙を削除',
      icon: 'photo-off',
      group: 'アピアランス',
      action: () => useDeckStore().clearWallpaper(),
    },
    // Environment settings
    {
      id: 'ai-settings',
      label: 'AI設定',
      icon: 'robot',
      group: '環境設定',
      action: () => useWindowsStore().open('aiSettings'),
    },
    {
      id: 'connections',
      label: '接続',
      icon: 'plug-connected',
      group: '環境設定',
      action: () => useWindowsStore().open('connections'),
    },
    {
      id: 'keybinds',
      label: 'キーバインド',
      icon: 'keyboard',
      group: '環境設定',
      action: () => useWindowsStore().open('keybinds'),
    },
    {
      id: 'performance',
      label: 'パフォーマンス',
      icon: 'gauge',
      group: '環境設定',
      action: () => useWindowsStore().open('performanceEditor'),
    },
    {
      id: 'css-editor',
      label: 'カスタムCSS',
      icon: 'code',
      group: '環境設定',
      action: () => useWindowsStore().open('cssEditor'),
    },
    {
      id: 'tasks-editor',
      label: 'タスク',
      icon: 'player-play',
      group: '環境設定',
      action: () => useWindowsStore().open('tasksEditor'),
    },
    {
      id: 'snippets-editor',
      label: 'スニペット',
      icon: 'code-plus',
      group: '環境設定',
      action: () => useWindowsStore().open('snippetsEditor'),
    },
    // Cache
    {
      id: 'cache-editor',
      label: 'キャッシュ管理',
      icon: 'eraser',
      group: 'キャッシュ',
      action: () => useWindowsStore().open('cacheEditor'),
    },
    {
      id: 'export-db',
      label: 'DBエクスポート',
      icon: 'database-export',
      group: 'バックアップ',
      action: async () => {
        unwrap(await commands.exportDb())
      },
    },
    {
      id: 'import-db',
      label: 'DBインポート',
      icon: 'database-import',
      group: 'バックアップ',
      action: () =>
        backupWithConfirm(
          'importDb',
          'DBインポート',
          '現在のDBが上書きされます。',
        ),
    },
    {
      id: 'export-settings',
      label: '設定エクスポート',
      icon: 'file-export',
      group: 'バックアップ',
      action: async () => {
        unwrap(await commands.exportSettingsJson())
      },
    },
    {
      id: 'import-settings',
      label: '設定インポート',
      icon: 'file-import',
      group: 'バックアップ',
      action: () =>
        backupWithConfirm(
          'importSettingsJson',
          '設定インポート',
          '現在の設定が上書きされます。',
        ),
    },
  ]
}

function pickWallpaperFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => useDeckStore().setWallpaper(reader.result as string)
    reader.readAsDataURL(file)
  }
  input.click()
}

async function backupWithConfirm(
  command: 'importDb' | 'importSettingsJson',
  title: string,
  message: string,
) {
  const { confirm } = useConfirm()
  const ok = await confirm({
    title,
    message,
    okLabel: 'インポート',
    type: 'danger',
  })
  if (!ok) return
  const result = unwrap(await commands[command]())
  if (result) await relaunch()
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
  return COLUMN_TYPE_GROUPS.flatMap(({ label: group, types }) =>
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
      avatarUrl: proxyThumbUrl(getAccountAvatarUrl(account), 18),
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
  return spec.selectable ? { type, spec: spec.selectable } : null
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

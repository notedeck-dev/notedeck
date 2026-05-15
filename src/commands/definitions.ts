import { useCommandStore } from '@/commands/registry'
import { useAccountActions } from '@/composables/useAccountActions'
import { isEntityType, useEntityCrud } from '@/composables/useEntityCrud'
import { useGuideStore } from '@/composables/useGuide'
import type { NoteAction } from '@/composables/useNoteFocus'
import { getAccountAvatarUrl, useAccountsStore } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import { useDeckStore } from '@/stores/deck'
import { useKeybindsStore } from '@/stores/keybinds'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { useRealtimeModeStore } from '@/stores/realtimeMode'
import { useTaskRunnerStore } from '@/stores/taskRunner'
import { useThemeStore } from '@/stores/theme'
import { useUiStore } from '@/stores/ui'
import { useWindowsStore } from '@/stores/windows'
import { proxyThumbUrl } from '@/utils/imageProxy'

export interface CommandHandlers {
  openCompose: () => void
  openSearch: () => void
  openNotifications: () => void
  toggleAddMenu: () => void
  toggleNav: () => void
  toggleAccountMenu: () => void
}

function dispatchNoteAction(action: NoteAction) {
  document.dispatchEvent(
    new CustomEvent<NoteAction>('nd:note-action', { detail: action }),
  )
}

const NOTE_COMMAND_IDS = [
  'note-next',
  'note-prev',
  'note-reply',
  'note-react',
  'note-renote',
  'note-bookmark',
  'note-open',
  'note-cw',
] as const

export function registerDefaultCommands(handlers: CommandHandlers) {
  const commandStore = useCommandStore()
  const keybindsStore = useKeybindsStore()

  commandStore.register({
    id: 'command-palette',
    label: 'コマンドパレット',
    icon: 'search',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('command-palette'),
    execute: () => commandStore.openWithInput('>'),
    visible: false,
  })

  commandStore.register({
    id: 'search',
    label: '検索',
    icon: 'search',
    category: 'navigation',
    shortcuts: keybindsStore.getShortcuts('search'),
    execute: handlers.openSearch,
  })

  commandStore.register({
    id: 'notifications',
    label: '通知',
    icon: 'bell',
    category: 'navigation',
    shortcuts: keybindsStore.getShortcuts('notifications'),
    execute: handlers.openNotifications,
  })

  commandStore.register({
    id: 'compose',
    label: 'ノート作成',
    icon: 'pencil',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('compose'),
    execute: handlers.openCompose,
  })

  commandStore.register({
    id: 'add-column',
    label: 'カラム追加',
    icon: 'plus',
    category: 'column',
    shortcuts: keybindsStore.getShortcuts('add-column'),
    execute: handlers.toggleAddMenu,
  })

  commandStore.register({
    id: 'move-column-left',
    label: 'カラムを左に移動',
    icon: 'arrow-bar-left',
    category: 'column',
    shortcuts: keybindsStore.getShortcuts('move-column-left'),
    enabled: () => !!deckStore.activeColumnId,
    execute: () => {
      const id = deckStore.activeColumnId
      if (id) deckStore.moveLeft(id)
    },
  })

  commandStore.register({
    id: 'move-column-right',
    label: 'カラムを右に移動',
    icon: 'arrow-bar-right',
    category: 'column',
    shortcuts: keybindsStore.getShortcuts('move-column-right'),
    enabled: () => !!deckStore.activeColumnId,
    execute: () => {
      const id = deckStore.activeColumnId
      if (id) deckStore.moveRight(id)
    },
  })

  commandStore.register({
    id: 'toggle-sidebar',
    label: 'サイドバー切替',
    icon: 'layout-sidebar-left-collapse',
    category: 'navigation',
    shortcuts: keybindsStore.getShortcuts('toggle-sidebar'),
    execute: handlers.toggleNav,
  })

  if (useUiStore().isDesktop) {
    commandStore.register({
      id: 'boss-key',
      label: 'ウィンドウを隠す',
      icon: 'eye-off',
      category: 'general',
      shortcuts: keybindsStore.getShortcuts('boss-key'),
      execute: async () => {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        getCurrentWindow().hide()
      },
    })
  }

  commandStore.register({
    id: 'account-menu',
    label: 'アカウントメニュー',
    icon: 'user',
    category: 'account',
    shortcuts: keybindsStore.getShortcuts('account-menu'),
    execute: () => {
      const accountsStore = useAccountsStore()
      const actions = useAccountActions()

      commandStore.open()
      commandStore.pushQuickPick({
        title: 'アカウント',
        placeholder: 'アカウントを選択…',
        items: [
          ...accountsStore.accounts.map((acc) => ({
            id: acc.id,
            label: actions.getAccountLabel(acc),
            icon: actions.isGuestAccount(acc) ? 'user-off' : 'user',
            avatarUrl: proxyThumbUrl(getAccountAvatarUrl(acc), 18),
            children: () => {
              const items = []
              if (!actions.isGuestAccount(acc)) {
                items.push({
                  id: `${acc.id}-profile`,
                  label: 'プロフィール',
                  icon: 'user',
                  action: () => {
                    commandStore.close()
                    actions.openProfile(acc)
                  },
                })
                if (acc.hasToken) {
                  items.push({
                    id: `${acc.id}-settings`,
                    label: '設定',
                    icon: 'settings',
                    action: () => {
                      commandStore.close()
                      actions.openSettings(acc)
                    },
                  })
                }
              }
              if (acc.hasToken) {
                items.push({
                  id: `${acc.id}-logout`,
                  label: 'ログアウト',
                  icon: 'logout',
                  action: () => {
                    commandStore.close()
                    actions.logout(acc)
                  },
                })
              } else if (actions.isGuestAccount(acc)) {
                items.push({
                  id: `${acc.id}-delete`,
                  label: 'データを削除',
                  icon: 'trash',
                  action: () => {
                    commandStore.close()
                    actions.deleteAccount(acc)
                  },
                })
              } else {
                items.push({
                  id: `${acc.id}-relogin`,
                  label: '再ログイン',
                  icon: 'login',
                  action: () => {
                    commandStore.close()
                    actions.relogin(acc)
                  },
                })
              }
              items.push({
                id: `${acc.id}-clear-cache`,
                label: 'キャッシュ削除',
                icon: 'eraser',
                action: async () => {
                  commandStore.close()
                  const { confirm } = useConfirm()
                  const ok = await confirm({
                    title: 'キャッシュ削除',
                    message: `${actions.getAccountLabel(acc)} のキャッシュを削除しますか？`,
                    okLabel: '削除',
                    type: 'danger',
                  })
                  if (ok) {
                    const { commands, unwrap } = await import(
                      '@/utils/tauriInvoke'
                    )
                    unwrap(await commands.clearAccountCache(acc.id))
                  }
                },
              })
              return items
            },
          })),
          {
            id: 'account-add',
            label: 'アカウント追加',
            icon: 'user-plus',
            action: () => {
              commandStore.close()
              actions.addAccount()
            },
          },
        ],
      })
    },
  })

  commandStore.register({
    id: 'profile-menu',
    label: 'プロファイル切替',
    icon: 'layout',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('profile-menu'),
    execute: () => commandStore.openWithInput('~'),
  })

  commandStore.register({
    id: 'settings-menu',
    label: '設定メニュー',
    icon: 'settings',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('settings-menu'),
    execute: () => commandStore.openWithInput('*'),
  })

  // 新規ユーザー向けセットアップ wizard。AI / capability dispatcher を経由せず、
  // TS state machine + 既存 spotlight 機構で windows.open を案内する。
  // memory: feedback_no_onboarding_ui / feedback_no_welcome_column と整合 (=
  // 自動 popup なし、カラムでもなくユーザー明示起動)
  commandStore.register({
    id: 'guide',
    label: 'ガイド',
    icon: 'help-circle',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('guide'),
    execute: () => useGuideStore().start(),
  })

  commandStore.register({
    id: 'toggle-dark-mode',
    label: 'ダーク/ライトモード切替',
    icon: 'sun-moon',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('toggle-dark-mode'),
    execute: () => useThemeStore().toggleTheme(),
  })

  commandStore.register({
    id: 'toggle-offline-mode',
    label: 'オフラインモード切替',
    icon: 'wifi-off',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('toggle-offline-mode'),
    execute: () => useOfflineModeStore().toggle(),
  })

  commandStore.register({
    id: 'toggle-realtime-mode',
    label: 'リアルタイムモード切替',
    icon: 'bolt',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('toggle-realtime-mode'),
    execute: () => useRealtimeModeStore().toggle(),
  })

  commandStore.register({
    id: 'clear-all-cache',
    label: '全キャッシュ削除',
    icon: 'eraser',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('clear-all-cache'),
    execute: async () => {
      const { confirm } = useConfirm()
      const ok = await confirm({
        title: 'キャッシュ削除',
        message: 'ノートキャッシュとOGPキャッシュをすべて削除しますか？',
        okLabel: '削除',
        type: 'danger',
      })
      if (ok) {
        const { commands, unwrap } = await import('@/utils/tauriInvoke')
        unwrap(await commands.clearAllCache())
      }
    },
  })

  // Note-level shortcuts (dispatched as CustomEvents to active column)
  commandStore.register({
    id: 'note-next',
    label: '次のノート',
    icon: 'arrow-down',
    category: 'note',
    shortcuts: keybindsStore.getShortcuts('note-next'),
    execute: () => dispatchNoteAction('next'),
  })

  commandStore.register({
    id: 'note-prev',
    label: '前のノート',
    icon: 'arrow-up',
    category: 'note',
    shortcuts: keybindsStore.getShortcuts('note-prev'),
    execute: () => dispatchNoteAction('prev'),
  })

  commandStore.register({
    id: 'note-reply',
    label: '返信',
    icon: 'arrow-back-up',
    category: 'note',
    shortcuts: keybindsStore.getShortcuts('note-reply'),
    execute: () => dispatchNoteAction('reply'),
  })

  commandStore.register({
    id: 'note-react',
    label: 'リアクション',
    icon: 'mood-plus',
    category: 'note',
    shortcuts: keybindsStore.getShortcuts('note-react'),
    execute: () => dispatchNoteAction('react'),
  })

  commandStore.register({
    id: 'note-renote',
    label: 'リノート / 引用',
    icon: 'repeat',
    category: 'note',
    shortcuts: keybindsStore.getShortcuts('note-renote'),
    execute: () => dispatchNoteAction('renote'),
  })

  commandStore.register({
    id: 'note-bookmark',
    label: 'ブックマーク',
    icon: 'star',
    category: 'note',
    shortcuts: keybindsStore.getShortcuts('note-bookmark'),
    execute: () => dispatchNoteAction('bookmark'),
  })

  commandStore.register({
    id: 'note-open',
    label: 'ノートを開く',
    icon: 'external-link',
    category: 'note',
    shortcuts: keybindsStore.getShortcuts('note-open'),
    execute: () => dispatchNoteAction('open'),
  })

  commandStore.register({
    id: 'note-cw',
    label: 'CW切替',
    icon: 'eye',
    category: 'note',
    shortcuts: keybindsStore.getShortcuts('note-cw'),
    execute: () => dispatchNoteAction('toggle-cw'),
  })

  commandStore.register({
    id: 'note-delete',
    label: 'ノートを削除',
    icon: 'trash',
    category: 'note',
    shortcuts: keybindsStore.getShortcuts('note-delete'),
    execute: () => dispatchNoteAction('delete'),
  })

  commandStore.register({
    id: 'note-edit',
    label: 'ノートを編集',
    icon: 'edit',
    category: 'note',
    shortcuts: keybindsStore.getShortcuts('note-edit'),
    execute: () => dispatchNoteAction('edit'),
  })

  commandStore.register({
    id: 'note-copy-link',
    label: 'ノートのリンクをコピー',
    icon: 'link',
    category: 'note',
    shortcuts: keybindsStore.getShortcuts('note-copy-link'),
    execute: () => dispatchNoteAction('copy-link'),
  })

  commandStore.register({
    id: 'note-copy-content',
    label: 'ノートの内容をコピー',
    icon: 'copy',
    category: 'note',
    shortcuts: keybindsStore.getShortcuts('note-copy-content'),
    execute: () => dispatchNoteAction('copy-content'),
  })

  // Column navigation
  const deckStore = useDeckStore()

  commandStore.register({
    id: 'column-next',
    label: '次のカラム',
    icon: 'arrow-right',
    category: 'column',
    shortcuts: keybindsStore.getShortcuts('column-next'),
    execute: () => deckStore.focusNextColumn(),
  })

  commandStore.register({
    id: 'column-prev',
    label: '前のカラム',
    icon: 'arrow-left',
    category: 'column',
    shortcuts: keybindsStore.getShortcuts('column-prev'),
    execute: () => deckStore.focusPrevColumn(),
  })

  for (let i = 1; i <= 9; i++) {
    commandStore.register({
      id: `column-${i}`,
      label: `カラム ${i} に移動`,
      icon: 'columns',
      category: 'column',
      shortcuts: keybindsStore.getShortcuts(`column-${i}`),
      execute: () => deckStore.focusColumnByIndex(i - 1),
    })
  }

  // Quick reactions (0-9 keys send pinned reactions to focused note)
  for (let i = 0; i <= 9; i++) {
    commandStore.register({
      id: `quick-react-${i}`,
      label: `クイックリアクション ${i || 10}`,
      icon: 'mood-plus',
      category: 'note',
      shortcuts: keybindsStore.getShortcuts(`quick-react-${i}`),
      execute: () => dispatchNoteAction(`quick-react-${i}` as NoteAction),
    })
  }

  commandStore.register({
    id: 'profile-new',
    label: '新しいプロファイルを作成',
    icon: 'plus',
    category: 'general',
    shortcuts: [],
    execute: () => {
      const deckStore = useDeckStore()
      deckStore.saveAsProfile()
      refreshProfileCommands()
    },
  })

  // Close active column
  commandStore.register({
    id: 'close-column',
    label: 'カラムを削除',
    icon: 'trash',
    category: 'column',
    shortcuts: keybindsStore.getShortcuts('close-column'),
    enabled: () => !!deckStore.activeColumnId,
    execute: async () => {
      const id = deckStore.activeColumnId
      if (!id) return
      const { confirm } = useConfirm()
      const ok = await confirm({
        title: 'カラムを削除',
        message: 'このカラムを削除しますか？',
        okLabel: '削除',
        type: 'danger',
      })
      if (ok) deckStore.removeColumn(id)
    },
  })

  // Rename / delete clip/list/antenna — delegates to useEntityCrud
  function getActiveEntityColumn() {
    const id = deckStore.activeColumnId
    if (!id) return null
    const col = deckStore.getColumn(id)
    if (!col || !isEntityType(col.type)) return null
    return { col, type: col.type }
  }

  commandStore.register({
    id: 'rename-entity',
    label: '名前を変更',
    icon: 'edit',
    category: 'column',
    shortcuts: [],
    enabled: () => !!getActiveEntityColumn(),
    execute: () => {
      const entity = getActiveEntityColumn()
      if (!entity) return
      const { rename } = useEntityCrud(entity.type, () => entity.col)
      rename(() => {
        // no-op callback
      })
    },
  })

  commandStore.register({
    id: 'delete-entity',
    label: 'サーバーから削除',
    icon: 'trash',
    category: 'column',
    shortcuts: [],
    enabled: () => !!getActiveEntityColumn(),
    execute: () => {
      const entity = getActiveEntityColumn()
      if (!entity) return
      const { deleteEntity } = useEntityCrud(entity.type, () => entity.col)
      deleteEntity(() => {
        // no-op callback
      })
    },
  })

  // Column mute toggle
  commandStore.register({
    id: 'toggle-column-mute',
    label: 'カラムのミュート切替',
    icon: 'volume-off',
    category: 'column',
    shortcuts: keybindsStore.getShortcuts('toggle-column-mute'),
    enabled: () => !!deckStore.activeColumnId,
    execute: () => {
      const id = deckStore.activeColumnId
      if (!id) return
      const col = deckStore.getColumn(id)
      if (col) deckStore.updateColumn(id, { soundMuted: !col.soundMuted })
    },
  })

  // Tool windows
  commandStore.register({
    id: 'keybinds',
    label: 'キーバインド設定',
    icon: 'keyboard',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('keybinds'),
    execute: () => useWindowsStore().open('keybinds'),
  })

  commandStore.register({
    id: 'css-editor',
    label: 'カスタムCSS',
    icon: 'code',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('css-editor'),
    execute: () => useWindowsStore().open('cssEditor'),
  })

  commandStore.register({
    id: 'tasks-editor',
    label: 'タスク設定',
    icon: 'player-play',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('tasks-editor'),
    execute: () => useWindowsStore().open('tasksEditor'),
  })

  commandStore.register({
    id: 'snippets-editor',
    label: 'スニペット',
    icon: 'code-plus',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('snippets-editor'),
    execute: () => useWindowsStore().open('snippetsEditor'),
  })

  commandStore.register({
    id: 'tasks.run-default',
    label: 'デフォルトタスクを実行',
    icon: 'player-play-filled',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('tasks.run-default'),
    execute: () => {
      void useTaskRunnerStore().runDefault()
    },
  })

  commandStore.register({
    id: 'plugins',
    label: 'プラグインを管理 (このアカウント)',
    icon: 'puzzle',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('plugins'),
    execute: () => {
      const accountsStore = useAccountsStore()
      const accountId = accountsStore.activeAccount?.id ?? null
      useDeckStore().toggleSidebarColumn('pluginManager', accountId)
    },
  })

  commandStore.register({
    id: 'plugins-global',
    label: 'プラグインを管理 (全アカウント)',
    icon: 'puzzle',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('plugins-global'),
    execute: () => useDeckStore().toggleSidebarColumn('pluginManager', null),
  })

  commandStore.register({
    id: 'theme-manager',
    label: 'テーマを管理 (このアカウント)',
    icon: 'palette',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('theme-manager'),
    execute: () => {
      const accountsStore = useAccountsStore()
      const accountId = accountsStore.activeAccount?.id ?? null
      useDeckStore().toggleSidebarColumn('themeManager', accountId)
    },
  })

  commandStore.register({
    id: 'theme-manager-global',
    label: 'テーマを管理 (全アカウント)',
    icon: 'palette',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('theme-manager-global'),
    execute: () => useDeckStore().toggleSidebarColumn('themeManager', null),
  })

  commandStore.register({
    id: 'settings-editor',
    label: 'アピアランス',
    icon: 'brush',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('settings-editor'),
    execute: () => useWindowsStore().open('appearanceEditor'),
  })

  commandStore.register({
    id: 'login',
    label: 'アカウント追加',
    icon: 'user-plus',
    category: 'account',
    shortcuts: keybindsStore.getShortcuts('login'),
    execute: () => useWindowsStore().open('login'),
  })

  commandStore.register({
    id: 'chat',
    label: 'チャット',
    icon: 'message-circle',
    category: 'navigation',
    shortcuts: keybindsStore.getShortcuts('chat'),
    execute: () => useDeckStore().toggleSidebarColumn('chat', null),
  })

  commandStore.register({
    id: 'ai',
    label: 'AIアシスタント',
    icon: 'robot',
    category: 'navigation',
    shortcuts: keybindsStore.getShortcuts('ai'),
    execute: () => useDeckStore().toggleSidebarColumn('ai', null),
  })

  commandStore.register({
    id: 'close-all-floating-windows',
    label: 'フローティングウィンドウをすべて閉じる',
    icon: 'x',
    category: 'general',
    shortcuts: keybindsStore.getShortcuts('close-all-floating-windows'),
    execute: () => useWindowsStore().closeAll(),
  })

  // Window management (desktop only)
  if (useUiStore().isDesktop) {
    commandStore.register({
      id: 'pop-out-column',
      label: 'カラムを別ウィンドウにポップアウト',
      icon: 'external-link',
      category: 'window',
      shortcuts: keybindsStore.getShortcuts('pop-out-column'),
      enabled: () => !!deckStore.activeColumnId,
      execute: () => {
        const columnId = deckStore.activeColumnId
        if (!columnId) return
        import('@/composables/useDeckWindow').then(
          ({ popOutColumnToWindow }) => {
            popOutColumnToWindow(columnId)
          },
        )
      },
    })

    commandStore.register({
      id: 'new-window',
      label: '新しいウィンドウを開く',
      icon: 'app-window',
      category: 'window',
      shortcuts: keybindsStore.getShortcuts('new-window'),
      enabled: () => !!deckStore.windowProfileId,
      execute: () => {
        const profileId = deckStore.windowProfileId
        if (!profileId) return
        import('@/composables/useDeckWindow').then(({ openDeckWindow }) => {
          openDeckWindow(profileId)
        })
      },
    })

    commandStore.register({
      id: 'close-all-windows',
      label: 'すべてのサブウィンドウを閉じる',
      icon: 'x',
      category: 'window',
      shortcuts: keybindsStore.getShortcuts('close-all-windows'),
      execute: () => {
        import('@/composables/useDeckWindow').then(({ closeAllSubWindows }) => {
          closeAllSubWindows()
        })
      },
    })

    commandStore.register({
      id: 'pip-window',
      label: 'PiPウィンドウを開く',
      icon: 'picture-in-picture',
      category: 'window',
      shortcuts: keybindsStore.getShortcuts('pip-window'),
      execute: () => {
        import('@/composables/usePipWindow').then(({ openPipWindow }) => {
          openPipWindow()
        })
      },
    })

    commandStore.register({
      id: 'devtools',
      label: '開発者ツール',
      icon: 'code',
      category: 'general',
      shortcuts: keybindsStore.getShortcuts('devtools'),
      execute: () => {
        import('@/utils/tauriInvoke').then(({ commands }) => {
          commands.openDevtools()
        })
      },
    })

    // theme-editor (テーマエディタ単独) は theme-manager カラムの「+」「編集」
    // ボタンから開ける導線に集約したため削除。

    commandStore.register({
      id: 'profile-editor',
      label: 'プロファイルエディタ',
      icon: 'layout-columns',
      category: 'column',
      shortcuts: keybindsStore.getShortcuts('profile-editor'),
      execute: () => {
        const profileId = useDeckStore().windowProfileId
        if (profileId) {
          useWindowsStore().open('profileEditor', { profileId })
        }
      },
    })
  }

  // Profile switching (Alt+1-9 to switch deck profiles)
  refreshProfileCommands()
}

export function refreshProfileCommands() {
  const commandStore = useCommandStore()
  const keybindsStore = useKeybindsStore()
  const deckStore = useDeckStore()

  // Unregister existing profile commands
  for (const id of PROFILE_IDS) {
    commandStore.unregister(id)
  }

  // Register commands for current profiles
  const profiles = deckStore.getProfiles()
  for (let i = 1; i <= Math.min(profiles.length, 9); i++) {
    const profile = profiles[i - 1]
    if (!profile) continue
    const profileId = profile.id
    const profileName = profile.name
    commandStore.register({
      id: `profile-${i}`,
      label: `${profileName} に切替`,
      icon: 'layout',
      category: 'general',
      shortcuts: keybindsStore.getShortcuts(`profile-${i}`),
      execute: () => {
        import('@/composables/useDeckWindow').then(
          ({ switchProfileWithWindows }) => {
            switchProfileWithWindows(profileId)
          },
        )
      },
    })
  }
}

const COLUMN_COMMAND_IDS = [
  'column-next',
  'column-prev',
  ...Array.from({ length: 9 }, (_, i) => `column-${i + 1}`),
] as const

const QUICK_REACT_IDS = Array.from(
  { length: 10 },
  (_, i) => `quick-react-${i}`,
) as readonly string[]

const WINDOW_COMMAND_IDS = [
  'pop-out-column',
  'new-window',
  'close-all-windows',
  'pip-window',
  'devtools',
] as const

const PROFILE_IDS = Array.from(
  { length: 9 },
  (_, i) => `profile-${i + 1}`,
) as readonly string[]

export function unregisterDefaultCommands() {
  const commandStore = useCommandStore()
  for (const id of [
    'command-palette',
    'search',
    'notifications',
    'compose',
    'boss-key',
    'add-column',
    'toggle-sidebar',
    'account-menu',
    'profile-menu',
    'settings-menu',
    'guide',
    'toggle-dark-mode',
    'toggle-offline-mode',
    'toggle-realtime-mode',
    'profile-new',
    'close-column',
    'rename-entity',
    'delete-entity',
    'keybinds',
    'css-editor',
    'tasks-editor',
    'plugins',
    'login',
    'chat',
    'ai',
    'close-all-floating-windows',
    'toggle-column-mute',
    'note-delete',
    'note-edit',
    'note-copy-link',
    'note-copy-content',
    ...NOTE_COMMAND_IDS,
    ...COLUMN_COMMAND_IDS,
    ...QUICK_REACT_IDS,
    ...PROFILE_IDS,
    ...WINDOW_COMMAND_IDS,
  ]) {
    commandStore.unregister(id)
  }
}

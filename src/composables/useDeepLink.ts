import { useAccountsStore } from '@/stores/accounts'
import type { ColumnType } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { useMisStoreStore } from '@/stores/misstore'
import type { WindowType } from '@/stores/windows'
import { useWindowsStore } from '@/stores/windows'

/**
 * Parse and handle a notedeck:// deep-link URL.
 *
 * Supported schemes:
 *   notedeck://install-plugin?id=<storeId>
 *   notedeck://install-theme?id=<storeId>
 *   notedeck://<host>/timeline/<tl>
 *   notedeck://<host>/notifications
 *   notedeck://<host>/search?q=<query>
 *   notedeck://<host>/user/<userId>
 *   notedeck://<host>/user/<userId>/following
 *   notedeck://<host>/user/<userId>/followers
 *   notedeck://<host>/note/<noteId>
 *   notedeck://<host>/list/<listId>
 *   notedeck://<host>/antenna/<antennaId>
 *   notedeck://<host>/favorites
 *   notedeck://<host>/clip/<clipId>
 *   notedeck://<host>/channel/<channelId>
 *   notedeck://<host>/mentions
 *   notedeck://<host>/direct
 *   notedeck://<host>/chat
 *   notedeck://<host>/announcements
 *   notedeck://<host>/drive
 *   notedeck://<host>/gallery
 *   notedeck://<host>/gallery/<postId>
 *   notedeck://<host>/page/<pageId>
 *   notedeck://<host>/play/<flashId>
 *   notedeck://<host>/instance/<targetHost>
 */
export async function handleDeepLink(rawUrl: string): Promise<void> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    console.warn('[deep-link] invalid URL:', rawUrl)
    return
  }

  if (url.protocol !== 'notedeck:') return

  const host = url.hostname
  const pathSegments = url.pathname
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)

  // notedeck://install-plugin?id=<storeId>
  if (host === 'install-plugin') {
    const pluginId = url.searchParams.get('id')
    if (pluginId) {
      await handleInstallPlugin(pluginId)
    }
    return
  }

  // notedeck://install-theme?id=<storeId>
  if (host === 'install-theme') {
    const themeId = url.searchParams.get('id')
    if (themeId) {
      await handleInstallTheme(themeId)
    }
    return
  }

  // Account-scoped routes: notedeck://<host>/...
  if (!host) return

  const accountsStore = useAccountsStore()
  const account = accountsStore.accounts.find((a) => a.host === host)
  const accountId = account?.id ?? null

  const [action, ...rest] = pathSegments

  switch (action) {
    case 'timeline':
      handleAddColumn('timeline', accountId, {
        tl: (rest[0] as 'home' | 'local' | 'social' | 'global') || 'home',
      })
      break

    case 'notifications':
      handleAddColumn('notifications', accountId)
      break

    case 'search':
      handleAddColumn('search', accountId, {
        query: url.searchParams.get('q') || undefined,
      })
      break

    case 'user':
      if (rest[0] && accountId) {
        const userId = rest[0]
        const sub = rest[1]
        if (sub === 'following' || sub === 'followers') {
          handleOpenWindow('follow-list', {
            accountId,
            userId,
            initialTab: sub,
          })
        } else {
          handleOpenWindow('user-profile', { accountId, userId })
        }
      }
      break

    case 'note':
      if (rest[0] && accountId) {
        handleOpenWindow('note-detail', { accountId, noteId: rest[0] })
      }
      break

    case 'list':
      if (rest[0] && accountId) {
        handleOpenWindow('list-detail', { accountId, listId: rest[0] })
      }
      break

    case 'antenna':
      if (rest[0]) handleAddColumn('antenna', accountId, { antennaId: rest[0] })
      break

    case 'favorites':
      handleAddColumn('favorites', accountId)
      break

    case 'clip':
      if (rest[0] && accountId) {
        handleOpenWindow('clip-detail', { accountId, clipId: rest[0] })
      }
      break

    case 'channel':
      if (rest[0]) handleAddColumn('channel', accountId, { channelId: rest[0] })
      break

    case 'mentions':
      handleAddColumn('mentions', accountId)
      break

    case 'direct':
      handleAddColumn('specified', accountId)
      break

    case 'chat':
      handleAddColumn('chat', accountId)
      break

    case 'announcements':
      handleAddColumn('announcements', accountId)
      break

    case 'drive':
      handleAddColumn('drive', accountId)
      break

    case 'gallery':
      if (rest[0] && accountId) {
        handleOpenWindow('gallery-detail', { accountId, postId: rest[0] })
      } else {
        handleAddColumn('gallery', accountId)
      }
      break

    case 'page':
      if (rest[0] && accountId) {
        handleOpenWindow('page-detail', { accountId, pageId: rest[0] })
      }
      break

    case 'play':
      if (rest[0] && accountId) {
        handleOpenWindow('play-detail', { accountId, flashId: rest[0] })
      }
      break

    case 'instance':
      if (rest[0] && accountId) {
        handleOpenWindow('federation-instance', {
          accountId,
          host: rest[0],
        })
      }
      break

    default:
      console.warn('[deep-link] unknown action:', action)
  }
}

function handleAddColumn(
  type: ColumnType,
  accountId: string | null,
  extra?: Record<string, unknown>,
) {
  const deckStore = useDeckStore()
  deckStore.addColumn({
    type,
    name: null,
    width: 360,
    accountId,
    ...extra,
  })
}

function handleOpenWindow(type: WindowType, props: Record<string, unknown>) {
  const windowsStore = useWindowsStore()
  windowsStore.open(type, props)
}

async function handleInstallPlugin(pluginId: string): Promise<void> {
  const misStore = useMisStoreStore()
  await misStore.fetchPlugins()
  const entry = misStore.plugins.find((p) => p.id === pluginId)
  if (!entry) {
    console.warn('[deep-link] plugin not found in MisStore:', pluginId)
    return
  }
  if (misStore.isInstalled(entry)) {
    console.info('[deep-link] plugin already installed:', pluginId)
    return
  }
  await misStore.installPlugin(entry)
}

async function handleInstallTheme(themeId: string): Promise<void> {
  const misStore = useMisStoreStore()
  await misStore.fetchThemes()
  const entry = misStore.themes.find((t) => t.id === themeId)
  if (!entry) {
    console.warn('[deep-link] theme not found in MisStore:', themeId)
    return
  }
  if (misStore.isThemeInstalled(entry)) {
    console.info('[deep-link] theme already installed:', themeId)
    return
  }
  await misStore.installTheme(entry)
}

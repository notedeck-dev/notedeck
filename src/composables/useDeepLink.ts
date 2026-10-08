import type { NoteVisibility } from '@/adapters/types'
import {
  ensureMemosLoaded,
  generateMemoKey,
  saveMemo,
} from '@/composables/useMemos'
import { i18n } from '@/i18n'
import { useAccountsStore } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import type { ColumnType } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { useDeckProfileStore } from '@/stores/deckProfile'
import { useMisStoreStore } from '@/stores/misstore'
import { useUiStore } from '@/stores/ui'
import type { WindowType } from '@/stores/windows'
import { useWindowsStore } from '@/stores/windows'

const NOTE_VISIBILITIES: ReadonlyArray<NoteVisibility> = [
  'public',
  'home',
  'followers',
  'specified',
]

/**
 * Parse and handle a notedeck:// deep-link URL.
 *
 * Supported schemes:
 *   notedeck://install-plugin?id=<storeId>
 *   notedeck://install-theme?id=<storeId>
 *   notedeck://compose?text=<text>&cw=<cw>&visibility=<visibility>
 *   notedeck://ai?prompt=<text>
 *   notedeck://memo/new?text=<text>
 *   notedeck://profile/<name or id>
 *   notedeck://column/<columnId>
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

  // アプリ全体向けルート (#512)。投稿系 (compose / ai) はフォームを開く
  // だけで送信は確定しない — 踏ませた URL から無確認で投稿させないため
  if (host === 'compose') {
    handleCompose(url.searchParams)
    return
  }
  if (host === 'ai') {
    handleAiPrompt(url.searchParams.get('prompt'))
    return
  }
  if (host === 'memo') {
    if (pathSegments[0] === 'new') {
      await handleMemoNew(url.searchParams.get('text'))
    }
    return
  }
  if (host === 'profile') {
    if (pathSegments[0]) handleSwitchProfile(decodePathSegment(pathSegments[0]))
    return
  }
  if (host === 'column') {
    if (pathSegments[0]) handleFocusColumn(decodePathSegment(pathSegments[0]))
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

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function handleCompose(params: URLSearchParams) {
  const text = params.get('text')
  const cw = params.get('cw')
  const visibility = params.get('visibility')
  const request: { text?: string; cw?: string; visibility?: NoteVisibility } =
    {}
  if (text) request.text = text
  if (cw) request.cw = cw
  if (visibility && (NOTE_VISIBILITIES as string[]).includes(visibility)) {
    request.visibility = visibility as NoteVisibility
  }
  useUiStore().requestCompose(request)
}

function handleAiPrompt(prompt: string | null) {
  const deckStore = useDeckStore()
  const existing = deckStore.columns.find((c) => c.type === 'ai')
  if (existing) {
    if (prompt) deckStore.updateColumn(existing.id, { aiInitialInput: prompt })
    deckStore.setActiveColumn(existing.id)
    return
  }
  handleAddColumn('ai', null, prompt ? { aiInitialInput: prompt } : undefined)
}

async function handleMemoNew(text: string | null) {
  if (!text) return
  await ensureMemosLoaded()
  saveMemo(generateMemoKey(), {
    text,
    cw: '',
    showCw: false,
    visibility: 'public',
    localOnly: false,
    fileIds: [],
    pollChoices: ['', ''],
    pollMultiple: false,
    showPoll: false,
    scheduledAt: null,
    tags: [],
  })
}

function handleSwitchProfile(nameOrId: string) {
  const profiles = useDeckProfileStore().getProfiles()
  const profile =
    profiles.find((p) => p.name === nameOrId) ??
    profiles.find((p) => p.id === nameOrId)
  if (!profile) {
    console.warn('[deep-link] profile not found:', nameOrId)
    return
  }
  useDeckStore().applyProfile(profile.id)
}

function handleFocusColumn(columnId: string) {
  const deckStore = useDeckStore()
  if (!deckStore.getColumn(columnId)) {
    console.warn('[deep-link] column not found:', columnId)
    return
  }
  deckStore.setActiveColumn(columnId)
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
  // リンクは Web ページに埋め込んで踏ませられるので、何を入れるかを見せて
  // 承認を得てから入れる (#1204)。プラグインは AiScript を実行するため
  const lines = [
    i18n.tsx._deepLinkInstall.message({
      name: entry.name,
      version: entry.version,
      author: entry.author,
    }),
  ]
  if (entry.capabilities?.length) {
    lines.push(
      i18n.tsx._deepLinkInstall.capabilities({
        list: entry.capabilities.join(', '),
      }),
    )
  }
  const ok = await useConfirm().confirm({
    title: i18n.ts._deepLinkInstall.pluginTitle,
    message: lines.join('\n'),
    okLabel: i18n.ts._common.install,
    type: 'warning',
  })
  if (!ok) return
  // deep link はカラム文脈を持たないため全体スコープでインストールする
  await misStore.installPlugin(entry, { kind: 'global' })
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
  const ok = await useConfirm().confirm({
    title: i18n.ts._deepLinkInstall.themeTitle,
    message: i18n.tsx._deepLinkInstall.message({
      name: entry.name,
      version: entry.version,
      author: entry.author,
    }),
    okLabel: i18n.ts._common.install,
  })
  if (!ok) return
  await misStore.installTheme(entry)
}

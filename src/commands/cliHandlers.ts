import type { NoteVisibility } from '@/adapters/types'
import type { useAccountsStore } from '@/stores/accounts'
import type { useDeckStore } from '@/stores/deck'
import { commands, unwrap } from '@/utils/tauriInvoke'

export interface CliHandlerDeps {
  deckStore: ReturnType<typeof useDeckStore>
  accountsStore: ReturnType<typeof useAccountsStore>
  navigateToNote: (accountId: string, noteId: string) => void
  navigateToUser: (accountId: string, userId: string) => void
  toggleAccountMenu: () => void
}

export type CliHandler = (args: string) => void | Promise<void>

interface ParsedFlags {
  flags: Record<string, string | true>
  rest: string
}

const VALID_VISIBILITIES: readonly NoteVisibility[] = [
  'public',
  'home',
  'followers',
  'specified',
]

/** Split input into tokens, respecting quoted strings. */
function tokenize(input: string): string[] {
  return Array.from(input.matchAll(/"([^"]*)"|\S+/g), (m) => m[1] ?? m[0])
}

/**
 * Parse CLI-style flags from an argument string.
 * Supports: --key value, --key "multi word value", --boolean-flag
 * Returns extracted flags and remaining positional text.
 */
function parseFlags(
  input: string,
  knownFlags: Record<string, 'value' | 'boolean'>,
): ParsedFlags {
  const flags: Record<string, string | true> = {}
  const remaining: string[] = []
  const tokens = tokenize(input.trim())

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === undefined) continue
    if (token.startsWith('--')) {
      const flagName = token.slice(2)
      const flagType = knownFlags[flagName]
      if (flagType === 'boolean') {
        flags[flagName] = true
      } else if (flagType === 'value') {
        const next = tokens[i + 1]
        if (next !== undefined && !next.startsWith('--')) {
          flags[flagName] = next
          i++
        }
      } else {
        remaining.push(token)
      }
    } else {
      remaining.push(token)
    }
  }

  return { flags, rest: remaining.join(' ') }
}

export function createCliHandlers(
  deps: CliHandlerDeps,
): Record<string, CliHandler> {
  function activeAccountId(): string | undefined {
    return deps.accountsStore.activeAccount?.id
  }

  return {
    post: async (args) => {
      const accountId = activeAccountId()
      if (!accountId || !args.trim()) return
      const { flags, rest } = parseFlags(args, {
        cw: 'value',
        visibility: 'value',
        'reply-to': 'value',
        'local-only': 'boolean',
      })
      if (!rest) return
      const visibility =
        typeof flags.visibility === 'string' &&
        VALID_VISIBILITIES.includes(flags.visibility as NoteVisibility)
          ? (flags.visibility as NoteVisibility)
          : 'public'
      unwrap(
        await commands.apiCreateNote(
          accountId,
          {
            text: rest,
            cw: (flags.cw as string) ?? null,
            visibility,
            replyId: (flags['reply-to'] as string) ?? null,
            renoteId: null,
            localOnly: flags['local-only'] === true ? true : null,
            modeFlags: null,
            fileIds: null,
            poll: null,
            scheduledAt: null,
          },
          null,
        ),
      )
    },

    search: (args) => {
      const accountId = activeAccountId()
      if (!accountId || !args.trim()) return
      deps.deckStore.addColumn({
        type: 'search',
        accountId,
        query: args.trim(),
        name: null,
        width: 360,
      })
    },

    timeline: (args) => {
      const accountId = activeAccountId()
      if (!accountId) return
      const type = (args.trim() || 'home') as string
      const existing = deps.deckStore.columns.find(
        (c) =>
          c.type === 'timeline' && c.tl === type && c.accountId === accountId,
      )
      if (existing) {
        deps.deckStore.setActiveColumn(existing.id)
      } else {
        deps.deckStore.addColumn({
          type: 'timeline',
          accountId,
          tl: type as 'home' | 'local' | 'social' | 'global',
          name: null,
          width: 360,
        })
      }
    },

    notifications: () => {
      const accountId = activeAccountId()
      if (!accountId) return
      const existing = deps.deckStore.columns.find(
        (c) => c.type === 'notifications' && c.accountId === accountId,
      )
      if (existing) {
        deps.deckStore.setActiveColumn(existing.id)
      } else {
        deps.deckStore.addColumn({
          type: 'notifications',
          accountId,
          name: null,
          width: 360,
        })
      }
    },

    mentions: () => {
      const accountId = activeAccountId()
      if (!accountId) return
      const existing = deps.deckStore.columns.find(
        (c) => c.type === 'mentions' && c.accountId === accountId,
      )
      if (existing) {
        deps.deckStore.setActiveColumn(existing.id)
      } else {
        deps.deckStore.addColumn({
          type: 'mentions',
          accountId,
          name: null,
          width: 360,
        })
      }
    },

    favorites: () => {
      const accountId = activeAccountId()
      if (!accountId) return
      const existing = deps.deckStore.columns.find(
        (c) => c.type === 'favorites' && c.accountId === accountId,
      )
      if (existing) {
        deps.deckStore.setActiveColumn(existing.id)
      } else {
        deps.deckStore.addColumn({
          type: 'favorites',
          accountId,
          name: null,
          width: 360,
        })
      }
    },

    note: (args) => {
      const accountId = activeAccountId()
      if (!accountId || !args.trim()) return
      deps.navigateToNote(accountId, args.trim())
    },

    replies: (args) => {
      const accountId = activeAccountId()
      if (!accountId || !args.trim()) return
      deps.navigateToNote(accountId, args.trim())
    },

    thread: (args) => {
      const accountId = activeAccountId()
      if (!accountId || !args.trim()) return
      deps.navigateToNote(accountId, args.trim())
    },

    delete: async (args) => {
      const accountId = activeAccountId()
      if (!accountId || !args.trim()) return
      unwrap(await commands.apiDeleteNote(accountId, args.trim()))
    },

    update: async (args) => {
      const accountId = activeAccountId()
      if (!accountId) return
      // Format: update <id> [--cw <cw>] <text>
      const trimmed = args.trim()
      const spaceIdx = trimmed.indexOf(' ')
      if (spaceIdx === -1) return
      const noteId = trimmed.slice(0, spaceIdx)
      const afterId = trimmed.slice(spaceIdx + 1)
      if (!noteId || !afterId) return
      const { flags, rest } = parseFlags(afterId, { cw: 'value' })
      if (!rest) return
      unwrap(
        await commands.apiUpdateNote(accountId, noteId, {
          text: rest,
          cw: (flags.cw as string) ?? null,
          visibility: null,
          replyId: null,
          renoteId: null,
          localOnly: null,
          modeFlags: null,
          fileIds: null,
          poll: null,
          scheduledAt: null,
        }),
      )
    },

    react: async (args) => {
      const accountId = activeAccountId()
      if (!accountId) return
      // Format: react <note_id> <reaction>
      const parts = args.trim().split(/\s+/)
      if (parts.length < 2) return
      const noteId = parts[0] as string
      const reaction = parts.slice(1).join(' ')
      unwrap(await commands.apiCreateReaction(accountId, noteId, reaction))
    },

    unreact: async (args) => {
      const accountId = activeAccountId()
      if (!accountId || !args.trim()) return
      unwrap(await commands.apiDeleteReaction(accountId, args.trim()))
    },

    renote: async (args) => {
      const accountId = activeAccountId()
      if (!accountId || !args.trim()) return
      unwrap(
        await commands.apiCreateNote(
          accountId,
          {
            text: null,
            cw: null,
            renoteId: args.trim(),
            visibility: 'public',
            replyId: null,
            localOnly: null,
            modeFlags: null,
            fileIds: null,
            poll: null,
            scheduledAt: null,
          },
          null,
        ),
      )
    },

    user: (args) => {
      const accountId = activeAccountId()
      if (!accountId || !args.trim()) return
      deps.navigateToUser(accountId, args.trim())
    },

    'user-notes': (args) => {
      const accountId = activeAccountId()
      if (!accountId || !args.trim()) return
      deps.deckStore.addColumn({
        type: 'user',
        accountId,
        userId: args.trim(),
        name: null,
        width: 360,
      })
    },

    follow: async (args) => {
      const accountId = activeAccountId()
      if (!accountId || !args.trim()) return
      unwrap(await commands.apiFollowUser(accountId, args.trim()))
    },

    unfollow: async (args) => {
      const accountId = activeAccountId()
      if (!accountId || !args.trim()) return
      unwrap(await commands.apiUnfollowUser(accountId, args.trim()))
    },

    favorite: async (args) => {
      const accountId = activeAccountId()
      if (!accountId || !args.trim()) return
      unwrap(await commands.apiCreateFavorite(accountId, args.trim()))
      deps.deckStore.invalidateColumnByKey('favorites')
    },

    unfavorite: async (args) => {
      const accountId = activeAccountId()
      if (!accountId || !args.trim()) return
      unwrap(await commands.apiDeleteFavorite(accountId, args.trim()))
      deps.deckStore.invalidateColumnByKey('favorites')
    },

    emojis: () => {
      const accountId = activeAccountId()
      if (!accountId) return
      const existing = deps.deckStore.columns.find(
        (c) => c.type === 'emoji' && c.accountId === accountId,
      )
      if (existing) {
        deps.deckStore.setActiveColumn(existing.id)
      } else {
        deps.deckStore.addColumn({
          type: 'emoji',
          accountId,
          name: null,
          width: 360,
        })
      }
    },

    accounts: () => {
      deps.toggleAccountMenu()
    },
  }
}

import type { NoteVisibility, PostVisibility } from '@/adapters/types'
import { dispatchCapability } from '@/capabilities/dispatcher'
import { i18n } from '@/i18n'
import { FAVORITES_CACHE_KEY } from '@/services/columnCacheKey'
import type { useAccountsStore } from '@/stores/accounts'
import type { useDeckStore } from '@/stores/deck'
import { commands, unwrap } from '@/utils/tauriInvoke'

export interface CliHandlerDeps {
  deckStore: ReturnType<typeof useDeckStore>
  accountsStore: ReturnType<typeof useAccountsStore>
  navigateToNote: (accountId: string, noteId: string) => void
  navigateToUser: (accountId: string, userId: string) => void
  toggleAccountMenu: () => void
  /**
   * 認証必須の操作に使うアカウントを選ばせる (#1018)。候補が 1 つなら
   * そのまま返り、キャンセル・候補なしは null。「アクティブアカウント」は
   * 廃止した (#941) ので、文脈の無いコマンドは毎回ここを通る
   */
  pickAccount: (purpose: string) => Promise<string | null>
}

export type CliHandler = (args: string) => void | Promise<void>

/**
 * API を叩く動詞は capability を dispatcher 経由で呼ぶ (#1098 §9)。本人の操作
 * なので principal は user (プロファイルでは縛られない)。宣言が confirm の
 * capability は slash (`/notes.react`) と同じく確認ダイアログを通る。
 * キャンセルは正常な操作なので投げない。失敗は投げて呼び出し側のログに残す
 */
async function run(id: string, params: Record<string, unknown>): Promise<void> {
  const result = await dispatchCapability(id, params, {
    principal: { kind: 'user' },
  })
  if (!result.ok && result.code !== 'user_cancelled') {
    throw new Error(`${id}: ${result.error}`)
  }
}

interface ParsedFlags {
  flags: Record<string, string | true>
  rest: string
}

const VALID_VISIBILITIES: readonly PostVisibility[] = [
  'public',
  'public_non_ltl',
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
  return {
    // post と update は capability (notes.create) に無い引数 (--local-only /
    // 編集) を持つので IPC を直接叩く。宣言に足したら run() に寄せる
    post: async (args) => {
      if (!args.trim()) return
      const accountId = await deps.pickAccount(i18n.ts._cliHandlers.pickPost)
      if (!accountId) return
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

    search: async (args) => {
      if (!args.trim()) return
      const accountId = await deps.pickAccount(i18n.ts._cliHandlers.pickSearch)
      if (!accountId) return
      deps.deckStore.addColumn({
        type: 'search',
        accountId,
        query: args.trim(),
        name: null,
        width: 360,
      })
    },

    timeline: async (args) => {
      const accountId = await deps.pickAccount(
        i18n.ts._cliHandlers.pickTimeline,
      )
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

    notifications: async () => {
      const accountId = await deps.pickAccount(
        i18n.ts._cliHandlers.pickNotifications,
      )
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

    mentions: async () => {
      const accountId = await deps.pickAccount(
        i18n.ts._cliHandlers.pickMentions,
      )
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

    favorites: async () => {
      const accountId = await deps.pickAccount(
        i18n.ts._cliHandlers.pickFavorites,
      )
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

    note: async (args) => {
      if (!args.trim()) return
      const accountId = await deps.pickAccount(i18n.ts._cliHandlers.pickNote)
      if (!accountId) return
      deps.navigateToNote(accountId, args.trim())
    },

    replies: async (args) => {
      if (!args.trim()) return
      const accountId = await deps.pickAccount(i18n.ts._cliHandlers.pickNote)
      if (!accountId) return
      deps.navigateToNote(accountId, args.trim())
    },

    thread: async (args) => {
      if (!args.trim()) return
      const accountId = await deps.pickAccount(i18n.ts._cliHandlers.pickNote)
      if (!accountId) return
      deps.navigateToNote(accountId, args.trim())
    },

    delete: async (args) => {
      if (!args.trim()) return
      const accountId = await deps.pickAccount(i18n.ts._cliHandlers.pickDelete)
      if (!accountId) return
      await run('notes.delete', { noteId: args.trim(), accountId })
    },

    update: async (args) => {
      const accountId = await deps.pickAccount(i18n.ts._cliHandlers.pickEdit)
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
      const accountId = await deps.pickAccount(i18n.ts._cliHandlers.pickReact)
      if (!accountId) return
      // Format: react <note_id> <reaction>
      const parts = args.trim().split(/\s+/)
      if (parts.length < 2) return
      const noteId = parts[0] as string
      const reaction = parts.slice(1).join(' ')
      await run('notes.react', { noteId, reaction, accountId })
    },

    unreact: async (args) => {
      if (!args.trim()) return
      const accountId = await deps.pickAccount(i18n.ts._cliHandlers.pickUnreact)
      if (!accountId) return
      await run('notes.unreact', { noteId: args.trim(), accountId })
    },

    renote: async (args) => {
      if (!args.trim()) return
      const accountId = await deps.pickAccount(i18n.ts._cliHandlers.pickRenote)
      if (!accountId) return
      await run('notes.create', {
        renoteId: args.trim(),
        visibility: 'public',
        accountId,
      })
    },

    user: async (args) => {
      if (!args.trim()) return
      const accountId = await deps.pickAccount(i18n.ts._cliHandlers.pickUser)
      if (!accountId) return
      deps.navigateToUser(accountId, args.trim())
    },

    'user-notes': async (args) => {
      if (!args.trim()) return
      const accountId = await deps.pickAccount(
        i18n.ts._cliHandlers.pickUserNotes,
      )
      if (!accountId) return
      deps.deckStore.addColumn({
        type: 'user',
        accountId,
        userId: args.trim(),
        name: null,
        width: 360,
      })
    },

    follow: async (args) => {
      if (!args.trim()) return
      const accountId = await deps.pickAccount(i18n.ts._cliHandlers.pickCommand)
      if (!accountId) return
      await run('user.follow', { userId: args.trim(), accountId })
    },

    unfollow: async (args) => {
      if (!args.trim()) return
      const accountId = await deps.pickAccount(i18n.ts._cliHandlers.pickCommand)
      if (!accountId) return
      await run('user.unfollow', { userId: args.trim(), accountId })
    },

    favorite: async (args) => {
      if (!args.trim()) return
      const accountId = await deps.pickAccount(i18n.ts._cliHandlers.pickCommand)
      if (!accountId) return
      await run('favorites.add', { noteId: args.trim(), accountId })
      deps.deckStore.invalidateColumnByKey(FAVORITES_CACHE_KEY)
    },

    unfavorite: async (args) => {
      if (!args.trim()) return
      const accountId = await deps.pickAccount(i18n.ts._cliHandlers.pickCommand)
      if (!accountId) return
      await run('favorites.remove', { noteId: args.trim(), accountId })
      deps.deckStore.invalidateColumnByKey(FAVORITES_CACHE_KEY)
    },

    emojis: async () => {
      const accountId = await deps.pickAccount(i18n.ts._cliHandlers.pickEmojis)
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

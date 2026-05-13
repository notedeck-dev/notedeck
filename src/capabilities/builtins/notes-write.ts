import { initAdapterFor } from '@/adapters/factory'
import type {
  ApiAdapter,
  CreateNoteParams,
  NoteVisibility,
} from '@/adapters/types'
import type { Command } from '@/commands/registry'
import { projectVisibleItems } from '@/composables/useAiSystemContext'
import { useAccountsStore } from '@/stores/accounts'

/**
 * Phase 5.0: write 系 capability。すべて `requiresConfirmation: true` を宣言し、
 * dispatcher が実行前に確認モーダルを出す。permissions も `notes.write` /
 * `notes.react` を要求するので、`safe` プリセット下では一部のみ通る:
 *
 * - notes.create → notes.write 必須 (full preset only)
 * - notes.react  → notes.react 必須 (safe + full)
 */

const VALID_VISIBILITIES: readonly NoteVisibility[] = [
  'public',
  'home',
  'followers',
  'specified',
] as const

async function getApiAdapter(
  accountId: string | undefined,
): Promise<ApiAdapter> {
  const store = useAccountsStore()
  const id = accountId ?? store.activeAccountId
  if (!id) throw new Error('No active account')
  const acc = store.accounts.find((a) => a.id === id)
  if (!acc) throw new Error(`Account "${id}" not found`)
  const { adapter } = await initAdapterFor(acc.host, acc.id)
  return adapter.api
}

function pickString(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const t = input.trim()
  return t.length > 0 ? t : undefined
}

const ACCOUNT_ID_PARAM_DESC =
  'どのアカウントで実行するか。未指定なら active アカウント。' +
  ' 別サーバーのカラムから操作するときは `<currentColumn>.accountId` を渡す。'

/** `notes.create` — 新規ノートを投稿する */
export const notesCreateCapability: Command = {
  id: 'notes.create',
  label: 'ノートを投稿',
  icon: 'ti-pencil',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.write'],
  requiresConfirmation: true,
  signature: {
    description:
      'Misskey にノートを投稿する。text 必須。visibility のデフォルトは public。' +
      ' 投稿前に確認モーダルが出る。' +
      ' 別サーバーから投稿するときは accountId を指定する。',
    params: {
      text: {
        type: 'string',
        description: '投稿本文 (空文字は不可)',
      },
      cw: {
        type: 'string',
        description: 'CW (内容警告)。空文字なし',
        optional: true,
      },
      visibility: {
        type: 'string',
        description:
          '公開範囲: public / home / followers / specified (default: public)',
        enum: VALID_VISIBILITIES,
        optional: true,
      },
      replyId: {
        type: 'string',
        description: 'リプライ先の noteId',
        optional: true,
      },
      renoteId: {
        type: 'string',
        description: '引用 / リノートの対象 noteId (text 空ならただのリノート)',
        optional: true,
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description:
        '投稿された note projection (id / userId / username / text / createdAt)',
    },
  },
  visible: false,
  execute: async (params) => {
    const text = pickString(params?.text)
    const renoteId = pickString(params?.renoteId)
    // text 必須。ただし renoteId 指定 + text 空はピュアリノートとして許容
    if (!text && !renoteId) {
      throw new Error(
        'notes.create: text is required (or supply renoteId for pure renote)',
      )
    }
    const visibilityRaw = pickString(params?.visibility) ?? 'public'
    if (!VALID_VISIBILITIES.includes(visibilityRaw as NoteVisibility)) {
      throw new Error(
        `notes.create: invalid visibility "${visibilityRaw}". Valid: ${VALID_VISIBILITIES.join(', ')}`,
      )
    }
    const create: CreateNoteParams = {
      text,
      visibility: visibilityRaw as NoteVisibility,
    }
    const cw = pickString(params?.cw)
    if (cw) create.cw = cw
    const replyId = pickString(params?.replyId)
    if (replyId) create.replyId = replyId
    if (renoteId) create.renoteId = renoteId

    const accountId = pickString(params?.accountId)
    const api = await getApiAdapter(accountId)
    const note = await api.createNote(create)
    return projectVisibleItems([note], 'search', 1)[0] ?? null
  },
}

/** `notes.react` — ノートにリアクションする */
export const notesReactCapability: Command = {
  id: 'notes.react',
  label: 'リアクションする',
  icon: 'ti-mood-smile',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.react'],
  requiresConfirmation: true,
  signature: {
    description:
      'Misskey ノートにリアクションを付ける。reaction は :name: 形式 (`:thinking_face:`)' +
      ' または Unicode 絵文字 (`👍`)。投稿前に確認モーダルが出る。' +
      ' 別サーバーで操作するときは accountId を指定する。',
    params: {
      noteId: {
        type: 'string',
        description: '対象の noteId',
      },
      reaction: {
        type: 'string',
        description: 'リアクション (例: `:thinking_face:` / `👍`)',
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '`{ ok: true, noteId, reaction }`',
    },
  },
  visible: false,
  execute: async (params) => {
    const noteId = pickString(params?.noteId)
    const reaction = pickString(params?.reaction)
    if (!noteId) throw new Error('notes.react: noteId is required')
    if (!reaction) throw new Error('notes.react: reaction is required')
    const accountId = pickString(params?.accountId)
    const api = await getApiAdapter(accountId)
    await api.createReaction(noteId, reaction)
    return { ok: true, noteId, reaction }
  },
}

/** `notes.unreact` — 自分が付けたリアクションを解除する。
 *
 * Misskey の API は `notes/reactions/delete` で reaction 種別を指定せず削除
 * (= 1 ノートに付けられる reaction は 1 つだけだから一意に決まる)。
 * notes.react と対称、可逆操作なので確認 UI は標準 (danger だが内容は軽い)。
 */
export const notesUnreactCapability: Command = {
  id: 'notes.unreact',
  label: 'リアクションを解除',
  icon: 'ti-mood-x',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.react'],
  requiresConfirmation: true,
  signature: {
    description:
      'Misskey ノートに付けた自分のリアクションを解除する。1 ノートに付け' +
      'られる reaction は 1 つだけなので種別指定不要。' +
      ' 別サーバーで操作するときは accountId を指定する。',
    params: {
      noteId: {
        type: 'string',
        description: '対象の noteId',
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '`{ ok: true, noteId }`',
    },
  },
  visible: false,
  execute: async (params) => {
    const noteId = pickString(params?.noteId)
    if (!noteId) throw new Error('notes.unreact: noteId is required')
    const accountId = pickString(params?.accountId)
    const api = await getApiAdapter(accountId)
    await api.deleteReaction(noteId)
    return { ok: true, noteId }
  },
}

export const NOTES_WRITE_BUILTIN_CAPABILITIES: readonly Command[] = [
  notesCreateCapability,
  notesReactCapability,
  notesUnreactCapability,
]

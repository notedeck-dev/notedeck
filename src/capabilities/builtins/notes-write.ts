import type { CreateNoteParams, NoteVisibility } from '@/adapters/types'
import type { Command } from '@/commands/registry'
import { projectVisibleItems } from '@/composables/useAiSystemContext'
import { reactionJoinability } from '@/services/remoteReaction'
import { useAccountsStore } from '@/stores/accounts'
import { useServersStore } from '@/stores/servers'
import {
  ACCOUNT_ID_PARAM_DESC,
  getApiAdapter,
  resolveAccountId,
} from '../accountContext'

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

function pickString(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const t = input.trim()
  return t.length > 0 ? t : undefined
}

/** `notes.create` — 新規ノートを投稿する */
export const notesCreateCapability: Command = {
  id: 'notes.create',
  actsAsAccount: true,
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
  execute: async (params, ctx) => {
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

    const api = await getApiAdapter(params?.accountId, ctx)
    const note = await api.createNote(create)
    return projectVisibleItems([note], 'search', 1)[0] ?? null
  },
}

/** `notes.react` — ノートにリアクションする */
export const notesReactCapability: Command = {
  id: 'notes.react',
  actsAsAccount: true,
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
  execute: async (params, ctx) => {
    const noteId = pickString(params?.noteId)
    const reaction = pickString(params?.reaction)
    if (!noteId) throw new Error('notes.react: noteId is required')
    if (!reaction) throw new Error('notes.react: reaction is required')
    const accountId = resolveAccountId(params?.accountId, ctx)
    // #630: 非対応サーバーはリモート絵文字を ❤ に落とすので、黙って別の
    // リアクションを付けずに弾く。ノートを持たないため絵文字の解決可否は
    // 見ず、サーバーの対応だけ確認する
    const account = useAccountsStore().accountMap.get(accountId)
    if (
      account &&
      reactionJoinability(reaction, {
        serverHost: account.host,
        remoteEmojiReactions:
          useServersStore().getServer(account.host)?.features
            .remoteEmojiReactions === true,
        hasEmojiUrl: true,
      }) !== 'ok'
    ) {
      throw new Error(
        `notes.react: ${account.host} はリモートの絵文字でリアクションできません`,
      )
    }
    const api = await getApiAdapter(accountId, ctx)
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
  actsAsAccount: true,
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
  execute: async (params, ctx) => {
    const noteId = pickString(params?.noteId)
    if (!noteId) throw new Error('notes.unreact: noteId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.deleteReaction(noteId)
    return { ok: true, noteId }
  },
}

/**
 * `notes.delete` — 自分のノートを削除する (慎重カテゴリ、不可逆)。
 *
 * 削除済みノートは復元できない (Misskey の挙動)。確認 UI は関数形式で
 * `type: 'danger'` を明示し、戻せないことをメッセージに書く。AI が
 * 「整理しといて」と気軽に呼ばないよう、permission も notes.write を要求
 * (= safe preset では通らない)。
 */
export const notesDeleteCapability: Command = {
  id: 'notes.delete',
  actsAsAccount: true,
  label: 'ノートを削除',
  icon: 'ti-trash',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.write'],
  requiresConfirmation: (params) => {
    const noteId = typeof params?.noteId === 'string' ? params.noteId : ''
    return {
      title: 'ノートを削除',
      message:
        `noteId \`${noteId}\` を削除します。この操作は元に戻せません ` +
        '(リノート・引用・お気に入り・クリップ等も同時に消えます)。',
      okLabel: '削除',
      cancelLabel: 'やめる',
      type: 'danger',
    }
  },
  signature: {
    description:
      '自分のノートを削除する。**元に戻せない**。リノート / 引用 / お気に入り / ' +
      'クリップに含まれている場合もすべて連鎖して見えなくなる。他人のノートは削除不可。' +
      ' 別サーバーで操作するときは accountId を指定する。',
    params: {
      noteId: {
        type: 'string',
        description: '削除する noteId (自分のノートのみ)',
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '`{ deleted: true, noteId }`',
    },
  },
  visible: false,
  execute: async (params, ctx) => {
    const noteId = pickString(params?.noteId)
    if (!noteId) throw new Error('notes.delete: noteId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.deleteNote(noteId)
    return { deleted: true, noteId }
  },
}

/**
 * `notes.pin` / `notes.unpin` — 自分のプロファイルにノートを pin / 解除する。
 * 公開プロファイルの top に表示される。可逆操作 (unpin あり) なので確認 UI は
 * 標準 (danger だが内容は軽い)。Misskey の上限は通常 5 件。
 */
export const notesPinCapability: Command = {
  id: 'notes.pin',
  actsAsAccount: true,
  label: 'ノートをプロファイルに pin',
  icon: 'ti-pin',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.write'],
  requiresConfirmation: true,
  signature: {
    description:
      '自分のプロファイル top に指定ノートを pin する。Misskey の上限は通常 ' +
      '5 件で、上限超過時はサーバー側でエラーになる。',
    params: {
      noteId: {
        type: 'string',
        description: 'pin する noteId (自分のノートのみ)',
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: { type: 'object', description: '{ pinned: true, noteId }' },
  },
  visible: false,
  execute: async (params, ctx) => {
    const noteId = pickString(params?.noteId)
    if (!noteId) throw new Error('notes.pin: noteId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.pinNote(noteId)
    return { pinned: true, noteId }
  },
}

export const notesUnpinCapability: Command = {
  id: 'notes.unpin',
  actsAsAccount: true,
  label: 'ノートの pin を解除',
  icon: 'ti-pinned-off',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.write'],
  requiresConfirmation: true,
  signature: {
    description: '自分のプロファイル top に pin したノートを解除する。',
    params: {
      noteId: { type: 'string', description: 'pin 解除する noteId' },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: { type: 'object', description: '{ unpinned: true, noteId }' },
  },
  visible: false,
  execute: async (params, ctx) => {
    const noteId = pickString(params?.noteId)
    if (!noteId) throw new Error('notes.unpin: noteId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.unpinNote(noteId)
    return { unpinned: true, noteId }
  },
}

export const NOTES_WRITE_BUILTIN_CAPABILITIES: readonly Command[] = [
  notesCreateCapability,
  notesReactCapability,
  notesUnreactCapability,
  notesDeleteCapability,
  notesPinCapability,
  notesUnpinCapability,
]

import type { CreateNoteParams, NoteVisibility } from '@/adapters/types'
import type { Command } from '@/commands/registry'
import { projectVisibleItems } from '@/composables/useAiSystemContext'
import { reactionJoinability } from '@/services/remoteReaction'
import { useAccountsStore } from '@/stores/accounts'
import { useServersStore } from '@/stores/servers'
import { getApiAdapter, resolveAccountId } from '../accountContext'
import { implement } from '../declare'

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
export const notesCreateCapability = implement('notes.create', {
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
})

/** `notes.react` — ノートにリアクションする */
export const notesReactCapability = implement('notes.react', {
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
})

/** `notes.unreact` — 自分が付けたリアクションを解除する。
 *
 * Misskey の API は `notes/reactions/delete` で reaction 種別を指定せず削除
 * (= 1 ノートに付けられる reaction は 1 つだけだから一意に決まる)。
 * notes.react と対称、可逆操作なので確認 UI は標準 (danger だが内容は軽い)。
 */
export const notesUnreactCapability = implement('notes.unreact', {
  execute: async (params, ctx) => {
    const noteId = pickString(params?.noteId)
    if (!noteId) throw new Error('notes.unreact: noteId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.deleteReaction(noteId)
    return { ok: true, noteId }
  },
})

/**
 * `notes.delete` — 自分のノートを削除する (慎重カテゴリ、不可逆)。
 *
 * 削除済みノートは復元できない (Misskey の挙動)。確認 UI は関数形式で
 * `type: 'danger'` を明示し、戻せないことをメッセージに書く。AI が
 * 「整理しといて」と気軽に呼ばないよう、permission も notes.write を要求
 * (= safe preset では通らない)。
 */
export const notesDeleteCapability = implement('notes.delete', {
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
  execute: async (params, ctx) => {
    const noteId = pickString(params?.noteId)
    if (!noteId) throw new Error('notes.delete: noteId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.deleteNote(noteId)
    return { deleted: true, noteId }
  },
})

/**
 * `notes.pin` / `notes.unpin` — 自分のプロファイルにノートを pin / 解除する。
 * 公開プロファイルの top に表示される。可逆操作 (unpin あり) なので確認 UI は
 * 標準 (danger だが内容は軽い)。Misskey の上限は通常 5 件。
 */
export const notesPinCapability = implement('notes.pin', {
  execute: async (params, ctx) => {
    const noteId = pickString(params?.noteId)
    if (!noteId) throw new Error('notes.pin: noteId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.pinNote(noteId)
    return { pinned: true, noteId }
  },
})

export const notesUnpinCapability = implement('notes.unpin', {
  execute: async (params, ctx) => {
    const noteId = pickString(params?.noteId)
    if (!noteId) throw new Error('notes.unpin: noteId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.unpinNote(noteId)
    return { unpinned: true, noteId }
  },
})

export const NOTES_WRITE_BUILTIN_CAPABILITIES: readonly Command[] = [
  notesCreateCapability,
  notesReactCapability,
  notesUnreactCapability,
  notesDeleteCapability,
  notesPinCapability,
  notesUnpinCapability,
]

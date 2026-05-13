import { initAdapterFor } from '@/adapters/factory'
import type { ApiAdapter } from '@/adapters/types'
import type { Command } from '@/commands/registry'
import { projectVisibleItems } from '@/composables/useAiSystemContext'
import { useAccountsStore } from '@/stores/accounts'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * Clips (Misskey クリップ) 系 capability。
 *
 * AI 経路で塞がっていた「この note を ○○ クリップに入れて」「過去のクリップを
 * 整理して」を開放する (memory: feedback_ai_capability_scope のユーザー操作系)。
 * クリップは公開する場合もあるが基本的にユーザー私的な note 整理機能なので、
 * `notes.write` より弱い `clips.write` 権限で独立管理。
 *
 * 設計判断:
 * - update / delete 用 Rust コマンドはまだ存在しないので本 PR では追加せず、
 *   list / notes / create / addNote / removeNote の 5 つだけ提供
 * - 書込は adapter API 経由 (`addNoteToClip` / `removeNoteFromClip` /
 *   既存コマンド `apiCreateClip`)
 * - notes (= クリップ内のノート) は `notes.read` も併せて要求 (= 中身は note)
 */

const ACCOUNT_ID_PARAM_DESC =
  'どのアカウントで実行するか。未指定なら active アカウント。' +
  ' 別サーバーのカラムから操作するときは `<currentColumn>.accountId` を渡す。'

async function getApiAdapter(
  accountId: string | undefined,
): Promise<{ api: ApiAdapter; resolvedId: string }> {
  const store = useAccountsStore()
  const id = accountId ?? store.activeAccountId
  if (!id) throw new Error('clips: no active account')
  const acc = store.accounts.find((a) => a.id === id)
  if (!acc) throw new Error(`clips: account "${id}" not found`)
  const { adapter } = await initAdapterFor(acc.host, acc.id)
  return { api: adapter.api, resolvedId: id }
}

function pickString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

export const clipsListCapability: Command = {
  id: 'clips.list',
  label: 'クリップ一覧',
  icon: 'ti-paperclip',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['clips.read'],
  signature: {
    description:
      'アクティブアカウントのクリップ一覧を返す。各要素は ' +
      ' { id, name, description, isPublic, lastClippedAt, favoritedCount }。',
    params: {
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'array',
      description: 'クリップの配列',
    },
    cheap: true,
  },
  visible: false,
  execute: async (params) => {
    const accountId = pickString(params?.accountId)
    const { api } = await getApiAdapter(accountId)
    const clips = await api.getClips()
    return clips.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      isPublic: c.isPublic,
      lastClippedAt: c.lastClippedAt,
      favoritedCount: c.favoritedCount,
    }))
  },
}

export const clipsNotesCapability: Command = {
  id: 'clips.notes',
  label: 'クリップ内のノート一覧',
  icon: 'ti-paperclip',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['clips.read', 'notes.read'],
  signature: {
    description:
      '指定 clipId に入っているノートを取得する。limit は 1〜100 (default 20)。' +
      ' クリップは公開設定なら他人のものでも閲覧可能。',
    params: {
      clipId: { type: 'string', description: '対象 clipId' },
      limit: {
        type: 'number',
        description: '取得件数 (default 20、最大 100)',
        optional: true,
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'array',
      description: 'ノート projection の配列',
    },
  },
  visible: false,
  execute: async (params) => {
    const clipId = pickString(params?.clipId)
    if (!clipId) throw new Error('clips.notes: clipId is required')
    const accountId = pickString(params?.accountId)
    const limitRaw = typeof params?.limit === 'number' ? params.limit : 20
    const limit = Math.max(1, Math.min(100, Math.floor(limitRaw)))
    const { api } = await getApiAdapter(accountId)
    const notes = await api.getClipNotes(clipId, { limit })
    return projectVisibleItems(notes, 'search', limit)
  },
}

export const clipsCreateCapability: Command = {
  id: 'clips.create',
  label: 'クリップを作成',
  icon: 'ti-paperclip',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['clips.write'],
  requiresConfirmation: true,
  signature: {
    description:
      '新規クリップを作成する。AI が note 整理を提案するときに使う。',
    params: {
      name: { type: 'string', description: 'クリップ名 (必須)' },
      description: {
        type: 'string',
        description: '説明文',
        optional: true,
      },
      isPublic: {
        type: 'boolean',
        description: '公開クリップとして作成するか (default false)',
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
      description: '作成された clip の id / name / isPublic',
    },
  },
  visible: false,
  execute: async (params) => {
    const name = pickString(params?.name)
    if (!name) throw new Error('clips.create: name is required')
    const accountId = pickString(params?.accountId)
    const { resolvedId } = await getApiAdapter(accountId)
    const description = pickString(params?.description)
    const isPublic = params?.isPublic === true
    const clip = unwrap(
      await commands.apiCreateClip(resolvedId, {
        name,
        description: description ?? null,
        isPublic,
      }),
    )
    return {
      id: clip.id,
      name: clip.name,
      isPublic: clip.isPublic,
      description: clip.description,
    }
  },
}

export const clipsAddNoteCapability: Command = {
  id: 'clips.addNote',
  label: 'クリップにノートを追加',
  icon: 'ti-paperclip',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['clips.write'],
  requiresConfirmation: true,
  signature: {
    description:
      '指定クリップに既存ノートを追加する。clipId は clips.list、noteId は' +
      ' visibleNotes / notes.search 等で取得した値を渡す。',
    params: {
      clipId: { type: 'string', description: '対象 clipId' },
      noteId: { type: 'string', description: '追加する noteId' },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ ok: true, clipId, noteId }',
    },
  },
  visible: false,
  execute: async (params) => {
    const clipId = pickString(params?.clipId)
    const noteId = pickString(params?.noteId)
    if (!clipId) throw new Error('clips.addNote: clipId is required')
    if (!noteId) throw new Error('clips.addNote: noteId is required')
    const accountId = pickString(params?.accountId)
    const { api } = await getApiAdapter(accountId)
    await api.addNoteToClip(clipId, noteId)
    return { ok: true, clipId, noteId }
  },
}

export const clipsRemoveNoteCapability: Command = {
  id: 'clips.removeNote',
  label: 'クリップからノートを削除',
  icon: 'ti-paperclip',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['clips.write'],
  requiresConfirmation: true,
  signature: {
    description: 'クリップからノートを取り除く (ノート自体は削除されない)。',
    params: {
      clipId: { type: 'string', description: '対象 clipId' },
      noteId: { type: 'string', description: '取り除く noteId' },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ ok: true, clipId, noteId }',
    },
  },
  visible: false,
  execute: async (params) => {
    const clipId = pickString(params?.clipId)
    const noteId = pickString(params?.noteId)
    if (!clipId) throw new Error('clips.removeNote: clipId is required')
    if (!noteId) throw new Error('clips.removeNote: noteId is required')
    const accountId = pickString(params?.accountId)
    const { api } = await getApiAdapter(accountId)
    await api.removeNoteFromClip(clipId, noteId)
    return { ok: true, clipId, noteId }
  },
}

export const CLIPS_BUILTIN_CAPABILITIES: readonly Command[] = [
  clipsListCapability,
  clipsNotesCapability,
  clipsCreateCapability,
  clipsAddNoteCapability,
  clipsRemoveNoteCapability,
]

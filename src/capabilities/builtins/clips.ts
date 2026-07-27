import type { Command } from '@/commands/registry'
import { projectVisibleItems } from '@/composables/useAiSystemContext'
import { commands, unwrap } from '@/utils/tauriInvoke'
import {
  ACCOUNT_ID_PARAM_DESC,
  getApiAdapter,
  resolveAccountId,
} from '../accountContext'

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
  execute: async (params, ctx) => {
    const api = await getApiAdapter(params?.accountId, ctx)
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
  execute: async (params, ctx) => {
    const clipId = pickString(params?.clipId)
    if (!clipId) throw new Error('clips.notes: clipId is required')
    const limitRaw = typeof params?.limit === 'number' ? params.limit : 20
    const limit = Math.max(1, Math.min(100, Math.floor(limitRaw)))
    const api = await getApiAdapter(params?.accountId, ctx)
    const notes = await api.getClipNotes(clipId, { limit })
    return projectVisibleItems(notes, 'search', limit)
  },
}

export const clipsCreateCapability: Command = {
  id: 'clips.create',
  actsAsAccount: true,
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
  execute: async (params, ctx) => {
    const name = pickString(params?.name)
    if (!name) throw new Error('clips.create: name is required')
    const resolvedId = resolveAccountId(params?.accountId, ctx)
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
  actsAsAccount: true,
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
  execute: async (params, ctx) => {
    const clipId = pickString(params?.clipId)
    const noteId = pickString(params?.noteId)
    if (!clipId) throw new Error('clips.addNote: clipId is required')
    if (!noteId) throw new Error('clips.addNote: noteId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.addNoteToClip(clipId, noteId)
    return { ok: true, clipId, noteId }
  },
}

export const clipsRemoveNoteCapability: Command = {
  id: 'clips.removeNote',
  actsAsAccount: true,
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
  execute: async (params, ctx) => {
    const clipId = pickString(params?.clipId)
    const noteId = pickString(params?.noteId)
    if (!clipId) throw new Error('clips.removeNote: clipId is required')
    if (!noteId) throw new Error('clips.removeNote: noteId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
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

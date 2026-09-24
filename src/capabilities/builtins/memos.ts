import type { Command } from '@/commands/registry'
import {
  deleteMemo,
  ensureMemosLoaded,
  generateMemoKey,
  loadMemo,
  type MemoData,
  saveMemo,
} from '@/composables/useMemos'
import {
  type Principal,
  principalActorLabel,
  principalAuthorId,
} from '@/permissions/principal'
import { getSnapshotAt } from '@/utils/historyFs'
import { resolveIdentity } from '@/utils/identity'
import { implement } from '../declare'
import { editAttribution } from '../editAttribution'
import { stageEdit, takeStagedEdit } from '../stagedEdit'

/**
 * Phase 5+: AI がローカルメモ (Zettelkasten 形式 markdown) を作成 / 編集する
 * write 系 capability。すべて `requiresConfirmation: true` を宣言し、
 * dispatcher が実行前に確認モーダルを出す。
 *
 * 設計:
 * - text のみ AI 制御。CW / visibility / fileIds / poll 等の post-draft フィールドは
 *   AI から触らせない (デフォルト値で作成、update では既存値を保持)
 * - `memos.create` は memoKey を自動採番 (Zettelkasten id = `YYYYMMDDHHmmss`)
 * - `memos.update` は id と新しい text を取り、他のフィールドは既存を保持
 *
 * 想定ユースケース:
 * - チャット中に「これメモっといて」と言われたら `memos.create`
 * - HEARTBEAT skill が継続観察すべき事項をメモとして残す
 * - ユーザーが書いた指示メモを AI が補足追記する (`memos.update`)
 */

function pickString(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const t = input.trim()
  return t.length > 0 ? t : undefined
}

function pickStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined
  const out: string[] = []
  for (const v of input) {
    if (typeof v !== 'string') continue
    const t = v.trim()
    if (t.length > 0) out.push(t)
  }
  return out
}

/**
 * authorId から memo の author 埋め込みブロックを組み立てる (#493)。
 * 解決不可なら null を返さずエラー (= 偽 ID で memo に「存在しない作者」が
 * 記録されるのを防ぐ)。Identity 解決時点でのスナップショットなので、後で
 * skill / account が削除されても memo の author block は残る (immutable)。
 */
/**
 * 呼び出した principal を著者にする (#1018)。人間の手書きは author を持たない。
 * AI が persona を名乗る場合は authorId が明示されるので、そちらが優先される。
 */
function authorFromPrincipal(
  principal: Principal | undefined,
): MemoData['author'] {
  if (!principal) return undefined
  const id = principalAuthorId(principal)
  if (!id) return undefined
  return { id, displayName: principalActorLabel(principal) ?? id }
}

function buildAuthorBlock(authorId: string): MemoData['author'] {
  const identity = resolveIdentity(authorId)
  if (!identity) {
    throw new Error(
      `memos: authorId "${authorId}" is not resolvable (skill not installed / not isPersona / account not found)`,
    )
  }
  const author: NonNullable<MemoData['author']> = {
    id: identity.id,
    displayName: identity.displayName,
  }
  if (identity.avatarUrl) author.avatarUrl = identity.avatarUrl
  return author
}

function emptyMemoData(
  text: string,
  tags: string[] = [],
  author?: MemoData['author'],
): MemoData {
  return {
    text,
    cw: '',
    showCw: false,
    visibility: 'public',
    localOnly: false,
    fileIds: [],
    pollChoices: [],
    pollMultiple: false,
    showPoll: false,
    scheduledAt: null,
    tags,
    author,
  }
}

/** `memos.create` — 新規メモを作成する */
export const memosCreateCapability = implement('memos.create', {
  execute: async (params, ctx) => {
    const text = pickString(params?.text)
    if (!text) throw new Error('memos.create: text is required')
    const tags = pickStringArray(params?.tags) ?? []
    const authorIdInput = pickString(params?.authorId)
    const author = authorIdInput
      ? buildAuthorBlock(authorIdInput)
      : authorFromPrincipal(ctx?.principal)
    await ensureMemosLoaded()
    const memoKey = generateMemoKey()
    const stored = saveMemo(memoKey, {
      ...emptyMemoData(text, tags, author),
      // tainted なセッションが書いたメモにはラベルを付ける (#1103)
      ...(ctx?.tainted ? { tainted: true } : {}),
    })
    const result: Record<string, unknown> = {
      id: memoKey,
      text: stored.data.text,
      updatedAt: stored.updatedAt,
    }
    if (stored.data.tags.length > 0) result.tags = stored.data.tags
    if (stored.data.author) result.author = stored.data.author
    return result
  },
})

/** `memos.update` — 既存メモの text / tags を更新する */
export const memosUpdateCapability = implement('memos.update', {
  execute: async (params, ctx) => {
    const id = pickString(params?.id)
    if (!id) throw new Error('memos.update: id is required')
    const text = pickString(params?.text)
    const tags = pickStringArray(params?.tags)
    // authorId: 未指定 (param に key 自体ない) = 既存維持、空文字 "" = author 削除、
    // 値あり = resolveIdentity で再 snapshot
    let authorPatch: { author: MemoData['author'] } | undefined
    if (params && 'authorId' in params) {
      const raw = params.authorId
      if (typeof raw === 'string' && raw.trim() === '') {
        authorPatch = { author: undefined }
      } else if (typeof raw === 'string') {
        authorPatch = { author: buildAuthorBlock(raw.trim()) }
      }
    }
    if (text === undefined && tags === undefined && authorPatch === undefined) {
      throw new Error(
        'memos.update: at least one of text / tags / authorId is required',
      )
    }
    await ensureMemosLoaded()
    const existing = loadMemo(id)
    if (!existing) {
      throw new Error(`memos.update: memo "${id}" not found`)
    }
    const stored = saveMemo(id, {
      ...existing.data,
      text: text ?? existing.data.text,
      tags: tags ?? existing.data.tags,
      author: authorPatch ? authorPatch.author : existing.data.author,
      // 一度付いたラベルは外れない
      ...(ctx?.tainted || existing.data.tainted ? { tainted: true } : {}),
    })
    const result: Record<string, unknown> = {
      id,
      text: stored.data.text,
      updatedAt: stored.updatedAt,
    }
    if (stored.data.tags.length > 0) result.tags = stored.data.tags
    if (stored.data.author) result.author = stored.data.author
    return result
  },
})

/** `memos.delete` — 既存メモを削除する */
export const memosDeleteCapability = implement('memos.delete', {
  execute: async (params) => {
    const id = pickString(params?.id)
    if (!id) throw new Error('memos.delete: id is required')
    await ensureMemosLoaded()
    const existing = loadMemo(id)
    if (!existing) {
      throw new Error(`memos.delete: memo "${id}" not found`)
    }
    deleteMemo(id)
    return { ok: true, id }
  },
})

/** `memos.revert` — メモを編集履歴の過去状態に戻す (#981 と同型) */
export const memosRevertCapability = implement('memos.revert', {
  requiresConfirmation: async (params, ctx) => {
    const id = pickString(params?.id) ?? ''
    const index = typeof params?.index === 'number' ? params.index : -1
    await ensureMemosLoaded()
    const cur = loadMemo(id)
    if (!cur || index < 0) return null
    const entry = await getSnapshotAt<{ body: string }>('memo', id, index)
    if (!entry) return null
    stageEdit(ctx, cur.data.text, entry.snapshot.body)
    return {
      title: 'メモを過去の状態に戻す',
      message:
        `メモ ${id} を編集履歴 #${index} ` +
        `(${new Date(entry.at).toLocaleString()}) の状態に戻します。` +
        '現在の本文は上書きされます。',
    }
  },
  execute: async (params, ctx) => {
    const id = pickString(params?.id)
    const index = typeof params?.index === 'number' ? params.index : -1
    if (!id) throw new Error('memos.revert: id is required')
    if (index < 0) throw new Error('memos.revert: index must be >= 0')
    await ensureMemosLoaded()
    const cur = loadMemo(id)
    if (!cur) throw new Error(`memos.revert: memo "${id}" not found`)
    const entry = await getSnapshotAt<{ body: string }>('memo', id, index)
    if (!entry) throw new Error(`memos.revert: no snapshot at index ${index}`)
    const next = takeStagedEdit(
      ctx,
      'memos.revert',
      cur.data.text,
      () => entry.snapshot.body,
    )
    saveMemo(id, { ...cur.data, text: next }, editAttribution(ctx, params))
    return { id, reverted: true, at: entry.at }
  },
})

export const MEMOS_BUILTIN_CAPABILITIES: readonly Command[] = [
  memosCreateCapability,
  memosUpdateCapability,
  memosDeleteCapability,
  memosRevertCapability,
]

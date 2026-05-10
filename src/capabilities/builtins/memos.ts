import type { Command } from '@/commands/registry'
import {
  ensureMemosLoaded,
  generateMemoKey,
  loadMemo,
  type MemoData,
  saveMemo,
} from '@/composables/useMemos'
import { useAccountsStore } from '@/stores/accounts'

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

function resolveAccountId(input: unknown): string {
  const explicit = pickString(input)
  if (explicit) return explicit
  const active = useAccountsStore().activeAccountId
  if (!active) {
    throw new Error(
      'memos: no active account (sign in first or supply accountId)',
    )
  }
  return active
}

function emptyMemoData(text: string): MemoData {
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
  }
}

const ACCOUNT_ID_PARAM_DESC =
  'どのアカウントのメモ空間に保存するか。未指定なら active アカウント。' +
  ' 別アカウントに紐付けたいときだけ明示する。'

/** `memos.create` — 新規メモを作成する */
export const memosCreateCapability: Command = {
  id: 'memos.create',
  label: 'メモを作成',
  icon: 'ti-notes',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['memos.write'],
  requiresConfirmation: true,
  signature: {
    description:
      'NoteDeck のローカル markdown メモを新規作成する。' +
      ' text のみ指定可。CW / visibility / poll 等の投稿用フィールドは触らない' +
      ' (= デフォルト値で作成)。memoKey は Zettelkasten 形式 (`YYYYMMDDHHmmss`) で自動採番。' +
      ' 投稿前に確認モーダルが出る。',
    params: {
      text: {
        type: 'string',
        description: 'メモ本文 (空文字は不可、markdown 可)',
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
        '`{ id, text, updatedAt, accountId }` — id は Zettelkasten 形式の memoKey',
    },
  },
  visible: false,
  execute: async (params) => {
    const text = pickString(params?.text)
    if (!text) throw new Error('memos.create: text is required')
    const accountId = resolveAccountId(params?.accountId)
    await ensureMemosLoaded()
    const memoKey = generateMemoKey()
    const stored = saveMemo(accountId, memoKey, emptyMemoData(text))
    return {
      id: memoKey,
      text: stored.data.text,
      updatedAt: stored.updatedAt,
      accountId,
    }
  },
}

/** `memos.update` — 既存メモの text を更新する */
export const memosUpdateCapability: Command = {
  id: 'memos.update',
  label: 'メモを更新',
  icon: 'ti-edit',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['memos.write'],
  requiresConfirmation: true,
  signature: {
    description:
      '既存ローカルメモの text のみを更新する。CW / visibility 等の他のフィールドは' +
      ' 既存値を保持。id は <memos> ブロックで参照できる Zettelkasten 形式 memoKey。' +
      ' 投稿前に確認モーダルが出る。',
    params: {
      id: {
        type: 'string',
        description: '更新対象の memoKey (Zettelkasten id, `YYYYMMDDHHmmss`)',
      },
      text: {
        type: 'string',
        description: '新しい本文 (空文字は不可)',
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '`{ id, text, updatedAt, accountId }`',
    },
  },
  visible: false,
  execute: async (params) => {
    const id = pickString(params?.id)
    const text = pickString(params?.text)
    if (!id) throw new Error('memos.update: id is required')
    if (!text) throw new Error('memos.update: text is required')
    const accountId = resolveAccountId(params?.accountId)
    await ensureMemosLoaded()
    const existing = loadMemo(accountId, id)
    if (!existing) {
      throw new Error(`memos.update: memo "${id}" not found in account`)
    }
    const stored = saveMemo(accountId, id, { ...existing.data, text })
    return {
      id,
      text: stored.data.text,
      updatedAt: stored.updatedAt,
      accountId,
    }
  },
}

export const MEMOS_BUILTIN_CAPABILITIES: readonly Command[] = [
  memosCreateCapability,
  memosUpdateCapability,
]

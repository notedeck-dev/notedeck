import type { CreateNoteParams } from '@/adapters/types'
import { AppError } from '@/utils/errors'

/**
 * クロスポスト (#626): 複数アカウントへの同時投稿の純ロジック。
 *
 * per-account の「アップロード → createNote → 結果集約」ループを adapter に
 * 依存しない形で持ち、adapter 取得・toast・draft 退避は呼び出し側
 * (usePostFormState) が DI / 後処理する (#782 方針)。
 */

/** 再アップロード可能なローカル添付ソース (useFileAttachment の PendingUpload と同型) */
export type AttachmentSource =
  | { kind: 'path'; path: string }
  | { kind: 'browser'; file: File }

export interface CrosspostAttachment {
  source: AttachmentSource
  /** primary で設定済みのメタ。再アップロード分にも適用する */
  meta: { name: string; comment: string | null; isSensitive: boolean }
}

export interface CrosspostTarget {
  accountId: string
  /**
   * 既にそのアカウントのドライブへアップロード済みの fileIds (primary 用)。
   * undefined なら attachments をそのアカウントのドライブへ再アップロードする。
   */
  fileIds?: string[]
}

export interface CrosspostDeps {
  /** 1 添付をそのアカウントのドライブへアップロードし fileId を返す */
  uploadFile: (
    accountId: string,
    attachment: CrosspostAttachment,
  ) => Promise<string>
  createNote: (accountId: string, params: CreateNoteParams) => Promise<void>
}

export interface CrosspostResult {
  accountId: string
  ok: boolean
  error?: string
  /** そのアカウントのドライブ上で有効な fileIds (createNote 失敗時の draft 救済に使える) */
  fileIds?: string[]
  /** 添付アップロード段階の失敗。draft に fileIds を入れてはいけない */
  uploadFailed?: boolean
}

/**
 * 選択アカウントごとに独立・並列で投稿する。トランザクションは偽装しない:
 * 成功分の取り消しも自動リトライもしない (二重投稿防止)。
 * 各アカウントは全添付のアップロード成功を待ってから createNote する
 * (本文だけ先に出て添付が欠ける片肺投稿の防止)。
 */
export async function runCrosspost(
  opts: {
    targets: CrosspostTarget[]
    attachments: CrosspostAttachment[]
    /** fileIds を除いた共通の投稿パラメータ */
    params: CreateNoteParams
  },
  deps: CrosspostDeps,
): Promise<CrosspostResult[]> {
  return Promise.all(
    opts.targets.map(async (target): Promise<CrosspostResult> => {
      let fileIds = target.fileIds
      if (fileIds == null && opts.attachments.length > 0) {
        try {
          fileIds = await Promise.all(
            opts.attachments.map((a) => deps.uploadFile(target.accountId, a)),
          )
        } catch (e) {
          return {
            accountId: target.accountId,
            ok: false,
            uploadFailed: true,
            error: AppError.from(e).message,
          }
        }
      }
      try {
        await deps.createNote(target.accountId, {
          ...opts.params,
          fileIds: fileIds && fileIds.length > 0 ? fileIds : undefined,
        })
        return { accountId: target.accountId, ok: true, fileIds }
      } catch (e) {
        return {
          accountId: target.accountId,
          ok: false,
          fileIds,
          error: AppError.from(e).message,
        }
      }
    }),
  )
}

/** アカウントごとの投稿制約。選択されたタイミングで取得してマップに保持する */
export type ConstraintState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready'
      maxNoteTextLength: number
      disabledVisibilities: Set<string>
    }

/** ロールポリシーの can*Note=false を disabled visibility 名の集合へ変換する */
export function disabledVisibilitiesFromPolicies(
  policies: Partial<{ [key in string]: boolean }>,
): Set<string> {
  const disabled = new Set<string>()
  if (policies.canPublicNote === false) disabled.add('public')
  for (const [key, value] of Object.entries(policies)) {
    if (value !== false) continue
    const match = key.match(/^can(.+)Note$/)
    if (!match || key === 'canPublicNote') continue
    const name =
      (match[1]?.charAt(0).toLowerCase() ?? '') + (match[1]?.slice(1) ?? '')
    disabled.add(name)
  }
  return disabled
}

/**
 * 文字数カウンタの基準値: 選択中アカウントの min(maxNoteTextLength)。
 * 取得中 (loading) / 失敗 (error) は min には含めない — 送信可否は
 * {@link accountSelectionIssue} が保守側 (不可) に倒す。
 */
export function minMaxTextLength(
  defaultMax: number,
  states: (ConstraintState | undefined)[],
): number {
  let min = defaultMax
  for (const s of states) {
    if (s?.status === 'ready' && s.maxNoteTextLength < min) {
      min = s.maxNoteTextLength
    }
  }
  return min
}

export type SelectionIssue =
  | { kind: 'loading' }
  | { kind: 'blocked'; reason: string }

/**
 * 選択中アカウントの送信可否判定。null なら投稿可。
 * 制約取得中は保守側 (loading = 送信不可) に倒す。
 */
export function accountSelectionIssue(
  state: ConstraintState | undefined,
  textLength: number,
  visibility: string,
): SelectionIssue | null {
  if (!state || state.status === 'loading') return { kind: 'loading' }
  if (state.status === 'error') {
    return { kind: 'blocked', reason: 'サーバー情報を取得できません' }
  }
  if (textLength > state.maxNoteTextLength) {
    return { kind: 'blocked', reason: '文字数超過' }
  }
  if (state.disabledVisibilities.has(visibility)) {
    return { kind: 'blocked', reason: 'この公開範囲は使えません' }
  }
  return null
}

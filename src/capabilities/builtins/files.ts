import { normalizeDriveFile } from '@/adapters/misskey/api/drive'
import type { ExportFileItem, ExportProgress } from '@/bindings'
import { events } from '@/bindings'
import type { Command } from '@/commands/registry'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { resolveAccountId } from '../accountContext'

/**
 * `files.export` — アプリが知っているファイル (fileId / noteId 参照) を
 * `Downloads/notedeck/<subdir>/` へ保存する (#813)。
 *
 * 汎用ダウンローダにしないための制約 (#813 設計):
 * - 任意 URL は受け付けない。URL 解決は本 capability (信頼側) が行い、
 *   呼び出し元 (プラグイン / AI) はコンテンツを注入できない
 * - 保存先は Downloads/notedeck 配下のサブディレクトリ 1 段のみ指定可
 * - 1 呼び出し 100 件まで。センシティブ添付は既定で除外 (opt-in)
 */

const MAX_ITEMS_PER_CALL = 100

interface ResolvedItems {
  items: ExportFileItem[]
  /** 解決できなかった / センシティブ除外された件数 (結果報告用) */
  excludedSensitive: number
  unresolved: string[]
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : []
}

async function resolveItems(
  accountId: string,
  fileIds: string[],
  noteIds: string[],
  includeSensitive: boolean,
): Promise<ResolvedItems> {
  const collected = new Map<
    string,
    { url: string; name: string; isSensitive: boolean }
  >()
  const unresolved: string[] = []

  for (const fileId of fileIds) {
    try {
      const raw = unwrap(
        await commands.apiGetDriveFile(accountId, { fileId } as never),
      )
      const f = normalizeDriveFile(raw as never)
      collected.set(f.id, {
        url: f.url,
        name: f.name,
        isSensitive: f.isSensitive,
      })
    } catch {
      unresolved.push(fileId)
    }
  }

  for (const noteId of noteIds) {
    try {
      const note = unwrap(await commands.apiGetNote(accountId, noteId))
      // 純粋なリノートは添付を内側のノートが持つ (MkNote の effectiveNote と同じ規則)
      const inner = note.renote as { files?: typeof note.files } | null
      const files =
        note.text === null && inner?.files ? inner.files : note.files
      for (const f of files ?? []) {
        if (f.url) {
          collected.set(f.id, {
            url: f.url,
            name: f.name,
            isSensitive: f.isSensitive ?? false,
          })
        }
      }
    } catch {
      unresolved.push(noteId)
    }
  }

  let excludedSensitive = 0
  const items: ExportFileItem[] = []
  for (const [fileId, f] of collected) {
    if (f.isSensitive && !includeSensitive) {
      excludedSensitive++
      continue
    }
    items.push({ fileId, url: f.url, name: f.name })
  }
  return { items, excludedSensitive, unresolved }
}

/** エクスポートを開始し、全件の完了イベントを待って集計を返す */
async function runExportAndWait(
  segments: string[],
  items: ExportFileItem[],
): Promise<{ dir: string; done: number; skipped: number; failed: number }> {
  const taskId = crypto.randomUUID()
  const counts = { done: 0, skipped: 0, failed: 0 }

  // Promise executor が同期実行されるので、直後には必ず差し替わっている
  let resolveFinished: () => void = () => {
    /* replaced by the executor below */
  }
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve
  })
  const unlisten = await events.exportProgress.listen(
    ({ payload }: { payload: ExportProgress }) => {
      if (payload.taskId !== taskId) return
      if (payload.fileId === '') {
        if (payload.status === 'finished' || payload.status === 'cancelled') {
          resolveFinished()
        }
        return
      }
      if (payload.status === 'done') counts.done++
      else if (payload.status === 'skipped') counts.skipped++
      else if (payload.status === 'failed') counts.failed++
    },
  )

  try {
    const dir = unwrap(await commands.exportFilesStart(taskId, segments, items))
    await finished
    return { dir, ...counts }
  } finally {
    unlisten()
  }
}

export const filesExportCapability: Command = {
  id: 'files.export',
  label: 'ファイルをローカルに保存',
  icon: 'ti-download',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  visible: false,
  permissions: ['files.export'],
  signature: {
    description:
      'ドライブファイル (fileIds) やノートの添付 (noteIds) をローカルの' +
      ' ダウンロードフォルダ (Downloads/notedeck/) に保存する。任意 URL の' +
      ' 取得はできない。同一ファイルの再保存はスキップされる (冪等)。' +
      ' センシティブ設定のファイルも既定で保存する (本体のドライブ保存と同じ)。' +
      ' 除外したい場合は includeSensitive: false を指定する。',
    params: {
      fileIds: {
        type: 'array',
        description: '保存するドライブファイルの ID 一覧',
        optional: true,
      },
      noteIds: {
        type: 'array',
        description: '添付ファイルを保存するノートの ID 一覧',
        optional: true,
      },
      subdir: {
        type: 'string',
        description:
          'Downloads/notedeck/ 直下の保存先サブディレクトリ名 (1 段のみ、' +
          " default: 'export')",
        optional: true,
      },
      includeSensitive: {
        type: 'boolean',
        description:
          'センシティブ設定のファイルを含めるか (default: true)。' +
          ' false を指定した分は保存されず excludedSensitive に計上される',
        optional: true,
      },
      accountId: {
        type: 'string',
        description: '対象アカウント ID (省略時はアクティブアカウント)',
        optional: true,
      },
    },
    returns: { type: 'object' },
  },
  preflight: (params) => {
    const fileIds = asStringArray(params?.fileIds)
    const noteIds = asStringArray(params?.noteIds)
    if (fileIds.length === 0 && noteIds.length === 0) {
      return {
        error: 'fileIds か noteIds のどちらかを 1 件以上指定してください',
      }
    }
    if (fileIds.length + noteIds.length > MAX_ITEMS_PER_CALL) {
      return {
        error: `1 回の呼び出しで指定できるのは合計 ${MAX_ITEMS_PER_CALL} 件までです`,
      }
    }
    const subdir = params?.subdir
    if (subdir !== undefined) {
      if (typeof subdir !== 'string' || subdir.length === 0) {
        return { error: 'subdir は空でない文字列で指定してください' }
      }
      if (/[/\\]/.test(subdir) || subdir === '..' || subdir === '.') {
        return { error: 'subdir に階層やパス表現は使えません (1 段の名前のみ)' }
      }
    }
    return null
  },
  // ユーザーのディスクに成果物を作る操作なので、件数と保存先を見せて都度確認
  // させる。「今後確認しない」は dispatcher の汎用スキップ (confirmSkips) 側で
  // ai.chat / plugin 個体単位に付く。
  requiresConfirmation: (params) => {
    const fileCount = asStringArray(params?.fileIds).length
    const noteCount = asStringArray(params?.noteIds).length
    const subdir = typeof params?.subdir === 'string' ? params.subdir : 'export'
    const parts = [
      fileCount > 0 ? `ファイル ${fileCount} 件` : null,
      noteCount > 0 ? `ノート ${noteCount} 件の添付` : null,
    ]
      .filter(Boolean)
      .join('と')
    // 既定でセンシティブも保存する (本体のドライブ保存と同じ) ため、除外する
    // 場合のほうを明示する。含む側を毎回書くと定型文になり読まれなくなる
    const sensitiveNote =
      params?.includeSensitive === false
        ? '。センシティブ設定のファイルは除きます'
        : ''
    return {
      title: 'ファイルをローカルに保存',
      message: `${parts}を ダウンロード/notedeck/${subdir}/ に保存します${sensitiveNote}。`,
      okLabel: '保存',
    }
  },
  execute: async (params, ctx) => {
    const fileIds = asStringArray(params?.fileIds)
    const noteIds = asStringArray(params?.noteIds)
    const includeSensitive = params?.includeSensitive !== false
    const subdir = typeof params?.subdir === 'string' ? params.subdir : 'export'
    const accountId = resolveAccountId(params?.accountId, ctx)

    const { items, excludedSensitive, unresolved } = await resolveItems(
      accountId,
      fileIds,
      noteIds,
      includeSensitive,
    )
    if (items.length === 0) {
      return {
        saved: 0,
        skipped: 0,
        failed: 0,
        excludedSensitive,
        unresolved,
        message: '保存対象がありません',
      }
    }
    const result = await runExportAndWait([subdir], items)
    return {
      saved: result.done,
      skipped: result.skipped,
      failed: result.failed,
      excludedSensitive,
      unresolved,
      dir: result.dir,
    }
  },
}

export const FILES_BUILTIN_CAPABILITIES: readonly Command[] = [
  filesExportCapability,
]

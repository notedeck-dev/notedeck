import type { Command } from '@/commands/registry'
import { formatLocalTimestamp } from '@/utils/aiSessionId'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * `backup.create` — DB と設定を `Downloads/notedeck/backup/<日時>/` に書き出す (#816)。
 *
 * 狙いは手動バックアップではなく自動化で、HEARTBEAT から定期実行できることが
 * 主目的。そのため確認モーダルは principal で出し分ける:
 *
 * - HEARTBEAT は確認スキップが構造的に不可能なため、確認を付けると tick の
 *   たびに無人環境でモーダルが出て詰む。権限 (既定 false) だけで gate する
 * - それ以外 (AI チャット等) は都度確認する
 *
 * plugin / external は権限側で恒久 deny (成果物にノートキャッシュ全量が入る)。
 */
/** 確認モーダルで「何を取るか」を明示する (既定は両方) */
function describeTargets(params?: Record<string, unknown>): string {
  const db = params?.includeDb !== false
  const settings = params?.includeSettings !== false
  if (db && settings) return 'ローカル DB と設定のスナップショット'
  return db ? 'ローカル DB のスナップショット' : '設定のスナップショット'
}

export const backupCreateCapability: Command = {
  id: 'backup.create',
  label: 'バックアップを作成',
  icon: 'ti-database-export',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  visible: false,
  permissions: ['backup.create'],
  signature: {
    description:
      'ローカル DB と設定のスナップショットを Downloads/notedeck/backup/ に' +
      ' 作成する。認証情報は含まれない。デッキ構成やプラグイン登録は対象外。' +
      ' DB と設定はそれぞれ独立して選べる (既定は両方)。' +
      ' 世代は新しい順に keep 件だけ残る。',
    params: {
      includeDb: {
        type: 'boolean',
        description: 'ローカル DB を含める (default: true)',
        optional: true,
      },
      includeSettings: {
        type: 'boolean',
        description: '設定ファイル一式を含める (default: true)',
        optional: true,
      },
      keep: {
        type: 'number',
        description: '残す世代数 (1〜100、default: 10)',
        optional: true,
      },
    },
    returns: { type: 'object' },
  },
  preflight: (params) => {
    if (params?.includeDb === false && params?.includeSettings === false) {
      return {
        error: 'includeDb か includeSettings のどちらかは有効にしてください',
      }
    }
    return null
  },
  requiresConfirmation: (params, ctx) => {
    // 無人実行の HEARTBEAT では確認を出さない (出すと詰む)
    if (ctx?.principal?.kind === 'ai.heartbeat') return null
    return {
      title: 'バックアップを作成',
      message: `${describeTargets(params)}を ダウンロード/notedeck/backup/ に作成します。認証情報は含まれません。`,
      okLabel: '作成',
    }
  },
  execute: async (params) => {
    const keepRaw = params?.keep
    const keep = typeof keepRaw === 'number' ? keepRaw : null
    const stamp = formatLocalTimestamp(new Date())
    const result = unwrap(
      await commands.backupCreate(
        stamp,
        keep,
        params?.includeDb === false ? false : null,
        params?.includeSettings === false ? false : null,
      ),
    )
    return {
      dir: result.dir,
      dbBytes: result.dbBytes,
      settingsFiles: result.settingsFiles,
      rotatedRemoved: result.rotatedRemoved,
    }
  },
}

export const BACKUP_BUILTIN_CAPABILITIES: readonly Command[] = [
  backupCreateCapability,
]

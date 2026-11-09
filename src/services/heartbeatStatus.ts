/**
 * HEARTBEAT の「最後の巡回」の表示 (#1321)。notemaid の `Status` (outcome の文字列 /
 * usage / 待機) を表示の種別に落とす純ロジック。outcome の文字列は開集合
 * (`skip:cheap-check:<reason>` のように理由が付く) なので prefix で見る。
 */

/** 表示の種別 */
export type HeartbeatOutcomeKind =
  | 'never'
  | 'reported'
  | 'suppressed'
  | 'queued'
  | 'error'
  | 'waiting-no-provider'
  | 'waiting-unreachable'
  | 'skipped'

/** 飛ばした理由 (表示用) */
export type HeartbeatSkipReason =
  | 'no-change'
  | 'no-account'
  | 'no-skills'
  | 'disabled'
  | 'daily-limit'
  | 'already-running'
  | 'other'

export function classifyHeartbeatOutcome(
  outcome: string | null | undefined,
): HeartbeatOutcomeKind {
  if (!outcome) return 'never'
  if (outcome === 'reported') return 'reported'
  if (outcome === 'suppressed') return 'suppressed'
  if (outcome === 'queued') return 'queued'
  if (outcome === 'error') return 'error'
  if (outcome === 'skip:no-provider') return 'waiting-no-provider'
  if (outcome === 'skip:unreachable') return 'waiting-unreachable'
  return 'skipped'
}

export function heartbeatSkipReason(
  outcome: string | null | undefined,
): HeartbeatSkipReason {
  if (!outcome) return 'other'
  if (outcome.startsWith('skip:cheap-check:')) return 'no-change'
  if (outcome === 'skip:no-account') return 'no-account'
  if (outcome === 'skip:no-skills') return 'no-skills'
  if (outcome === 'skip:disabled') return 'disabled'
  if (outcome.startsWith('skip:daily-limit')) return 'daily-limit'
  if (outcome === 'skip:already-running') return 'already-running'
  return 'other'
}

/** 最初のラウンドの入力 token と送った量の推定 (Rust の `TickUsage`) */
export interface HeartbeatTickUsage {
  inputTokens: number
  estimatedInputTokens: number
}

/**
 * 入力が切り詰められた可能性 (Rust の `TickUsage::looks_truncated` と同じ閾値)。
 * ローカル接続に限る: prompt caching のある provider は usage に cache の分を含めず
 * 誤検知するため。推定は文字数ベースで揺れるので閾値は保守的に取り、可能性として出す
 */
export const HEARTBEAT_TRUNCATION_RATIO = 0.5

export function heartbeatInputLooksTruncated(
  usage: HeartbeatTickUsage | null | undefined,
  local: boolean,
): boolean {
  if (!local || !usage) return false
  return (
    usage.estimatedInputTokens > 0 &&
    usage.inputTokens < usage.estimatedInputTokens * HEARTBEAT_TRUNCATION_RATIO
  )
}

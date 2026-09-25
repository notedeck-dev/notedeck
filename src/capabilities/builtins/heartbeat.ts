import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

/**
 * HEARTBEAT の応答契約 (#1133 縦切り 5)。AI は報告すべきことがあるときだけ
 * `heartbeat.report` を呼び、通知の有無と本文を返す。本体は notecore の
 * daemon (`crates/notecore/src/heartbeat.rs`) が tool 呼び出しとして受け取る。
 */
export const heartbeatReportCapability = implementCore('heartbeat.report')

export const HEARTBEAT_BUILTIN_CAPABILITIES: readonly Command[] = [
  heartbeatReportCapability,
]

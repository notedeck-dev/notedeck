import type { HealthReport } from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'

/** About の環境情報と自己診断 (#1258) */
export function rustcVersion(): Promise<string> {
  return commands.getRustcVersion()
}

export function runHealthcheck(): Promise<HealthReport> {
  return commands.runHealthcheck().then(unwrap)
}

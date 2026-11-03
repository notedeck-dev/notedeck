/**
 * プラグインの loopback 同意 (#1293) の読み書き。記録は Rust (`loopback_consent`)
 * にあり、ここは command の薄い包み (コンポーネントは IPC を直接叩かない、#1258)。
 * 許可の判定はこの composable を通さず、dispatcher (`capabilities/loopbackGate`)
 * が要求ごとに Rust へ聞く
 */

import type { LoopbackConsentRow, LoopbackConsentStatus } from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'

export function useLoopbackConsent() {
  async function status(pluginId: string): Promise<LoopbackConsentStatus> {
    return unwrap(await commands.loopbackConsentStatus(pluginId))
  }
  async function list(): Promise<LoopbackConsentRow[]> {
    return unwrap(await commands.loopbackConsentList())
  }
  /** 引数は Rust が検証する (宣言に無い / 本文が変わった、は拒まれる) */
  async function grant(
    pluginId: string,
    port: number,
    expectedHash: string,
  ): Promise<void> {
    unwrap(await commands.loopbackConsentGrant(pluginId, port, expectedHash))
  }
  async function revoke(pluginId: string, port: number): Promise<void> {
    unwrap(await commands.loopbackConsentRevoke(pluginId, port))
  }
  return { status, list, grant, revoke }
}

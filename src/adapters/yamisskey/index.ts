import { createMisskeyAdapter } from '../misskey'
import type { ServerAdapter, ServerFeatures, ServerInfo } from '../types'

/**
 * yamisskey (yamisskey-dev/yamisskey) 用アダプター。
 *
 * 叩くエンドポイントは本家と同じ。やみモードやカスタム TL はポリシー API と
 * `/api/endpoints` スキャンで動的に検出しており (`customTimelines.ts`)、
 * 数字の非表示は CSS プリセット側で扱う (#593/#594)。
 * API から判定できない静的な差分だけをここで宣言する。
 */
export const YAMISSKEY_FEATURES: Partial<ServerFeatures> = {
  // 公開範囲「プライベート」(#1265)。値は本家と同じ specified で、yamisskey が
  // 宛先なしを「自分のみ」と呼んで localOnly を強制するだけ。meta にも
  // ポリシーにも手掛かりが無いので静的宣言 — 漏れても「選べない」側に落ちる
  privateNote: true,
}

export function createYamisskeyAdapter(
  serverInfo: ServerInfo,
  accountId: string,
  hasToken = true,
): ServerAdapter {
  return createMisskeyAdapter(serverInfo, accountId, hasToken)
}

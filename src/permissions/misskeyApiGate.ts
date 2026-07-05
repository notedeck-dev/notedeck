/**
 * Mk:api (plugin の生 Misskey API 呼び出し) の endpoint 対応表 gate
 * (#712 §5.5 / #711)。
 *
 * Mk:api は本家 AiScript プラグイン互換面なので撤去せず、plugin principal
 * 文脈でのみ endpoint → PermissionKey の静的対応表で判定してから通す。
 * user 文脈 (playground) は gate 免除 — 本人のコードは本人の操作。
 *
 * 判定に使う granted map は resolveForProfiled('plugin') — 権限設定の
 * plugin 行 / dispatcher の enforce と同じ答えを返す。
 */

import {
  MISSKEY_ENDPOINT_RULES,
  type MisskeyEndpointRule,
} from './misskeyEndpoints.generated'
import { recordPluginDenial } from './pluginDenials'
import type { Principal } from './principal'
import type { PermissionKey } from './schema'
import { resolveForProfiled, whenPermissionsReady } from './store'

/**
 * principal が endpoint を呼んでよいか判定し、拒否なら throw (reject) する。
 * plugin 拒否はプラグインカラムの拒否バッジ (#712 §8.4) にも記録する。
 */
export async function assertMisskeyApiAllowed(
  principal: Principal,
  endpoint: string,
): Promise<void> {
  // user (playground) は gate 免除。ai.chat / ai.heartbeat / external は
  // そもそも Mk:api に到達しない (AiScript env は plugin / user のみ)
  if (principal.kind !== 'plugin') return

  // 起動直後は permissions.json5 の読込 (async) 完了前に autoRun ウィジェット
  // 等がここへ到達しうる。plugin のデフォルトプロファイル (safe) はユーザーの
  // 制限 (readonly 等) より広いため、読込前の判定は許可側に倒れる (#716)。
  // dispatcher と同じく読込完了を待ってから判定する。
  await whenPermissionsReady()

  const rule: MisskeyEndpointRule | undefined = MISSKEY_ENDPOINT_RULES[endpoint]

  if (!rule) {
    recordPluginDenial(principal.pluginId, `Mk:api ${endpoint}`, [])
    throw new Error(
      `Mk:api: unknown endpoint "${endpoint}" — 対応表に無い endpoint は許可されません (deny-by-default)。` +
        ' fork 独自 / 本家新設の endpoint は対応表の再生成が必要です',
    )
  }
  if (rule === 'allow') return
  if (rule.startsWith('deny:')) {
    recordPluginDenial(principal.pluginId, `Mk:api ${endpoint}`, [])
    throw new Error(
      `Mk:api: endpoint "${endpoint}" はプラグインには開放されません (${rule.slice('deny:'.length)})`,
    )
  }

  const requiredKey = rule as PermissionKey
  const granted = resolveForProfiled('plugin')
  if (!granted[requiredKey]) {
    recordPluginDenial(principal.pluginId, `Mk:api ${endpoint}`, [requiredKey])
    throw new Error(
      `Mk:api: permission_denied for "${endpoint}" — requires "${requiredKey}"` +
        ' (permissions.json5 の plugin プロファイルで許可すると使えます)',
    )
  }
}

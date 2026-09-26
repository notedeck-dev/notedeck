/**
 * 生 Misskey API 呼び出しの endpoint 対応表 gate (#712 §5.5 / #711 / #1099)。
 *
 * 入口は 2 つ: plugin の `Mk:api` (本家 AiScript プラグイン互換面なので撤去
 * せず、endpoint → PermissionKey の静的対応表で判定してから通す) と、
 * ユーザー定義タスクを代理実行する `tasks.run` (task の action が叩く method
 * を同じ語彙で検査する — `tasks.run` だけ持てば任意 endpoint に届く抜け道を
 * 塞ぐ)。
 *
 * user 文脈 (playground / 本人の UI 操作) は gate 免除 — 本人のコードは
 * 本人の操作。それ以外の principal は自分のプロファイル (`resolveFor`) で
 * 判定する。権限設定の各行 / dispatcher の enforce と同じ答えを返す。
 */

import {
  MISSKEY_ENDPOINT_RULES,
  type MisskeyEndpointRule,
} from './misskeyEndpoints.generated'
import { recordPluginDenial } from './pluginDenials'
import type { Principal } from './principal'
import type { PermissionKey } from './schema'
import { resolveFor, whenPermissionsReady } from './store'

export interface MisskeyApiGateOptions {
  /** エラー文と拒否バッジに出す入口の名前 (既定 `Mk:api`) */
  source?: string
  /**
   * 実行体を呼び出した上流の principal (#1099)。実効権限は
   * 「呼び出し元 ∩ 実行体」— 全員が endpoint のキーを持たなければ拒否
   */
  onBehalfOf?: readonly Principal[]
}

function denyForPlugin(
  principal: Principal,
  target: string,
  keys: PermissionKey[],
): void {
  if (principal.kind === 'plugin') {
    recordPluginDenial(principal.pluginId, target, keys)
  }
}

/**
 * principal が endpoint を呼んでよいか判定し、拒否なら throw (reject) する。
 * plugin 拒否はプラグインカラムの拒否バッジ (#712 §8.4) にも記録する。
 */
export async function assertMisskeyApiAllowed(
  principal: Principal,
  endpoint: string,
  options?: MisskeyApiGateOptions,
): Promise<void> {
  const source = options?.source ?? 'Mk:api'
  // 起動直後は permissions.json5 の読込 (async) 完了前に autoRun ウィジェット
  // 等がここへ到達しうる。plugin のデフォルトプロファイル (safe) はユーザーの
  // 制限 (readonly 等) より広いため、読込前の判定は許可側に倒れる (#716)。
  // dispatcher と同じく読込完了を待ってから判定する。
  await whenPermissionsReady()

  // 判定対象 = 実行体 + 呼び出し元 (#1099)。user はプロファイルを持たない
  // (本人操作) ので外れる。全員が user なら gate 免除
  const subjects = [principal, ...(options?.onBehalfOf ?? [])].flatMap((p) => {
    const granted = resolveFor(p)
    return granted === null ? [] : [{ principal: p, granted }]
  })
  if (subjects.length === 0) return

  const target = `${source} ${endpoint}`
  const rule: MisskeyEndpointRule | undefined = MISSKEY_ENDPOINT_RULES[endpoint]

  if (!rule) {
    denyForPlugin(principal, target, [])
    throw new Error(
      `${source}: unknown endpoint "${endpoint}" — endpoints missing from the table are denied (deny-by-default).` +
        ' Fork-specific or newly added upstream endpoints need the table to be regenerated',
    )
  }
  if (rule === 'allow') return
  if (rule.startsWith('deny:')) {
    denyForPlugin(principal, target, [])
    throw new Error(
      `${source}: endpoint "${endpoint}" is not open to ${principal.kind} (${rule.slice('deny:'.length)})`,
    )
  }

  const requiredKey = rule as PermissionKey
  const blocked = subjects.find((s) => !s.granted[requiredKey])
  if (blocked) {
    denyForPlugin(principal, target, [requiredKey])
    throw new Error(
      `${source}: permission_denied for "${endpoint}" — requires "${requiredKey}"` +
        ` (allow it in the ${blocked.principal.kind} profile of permissions.json5)`,
    )
  }
}

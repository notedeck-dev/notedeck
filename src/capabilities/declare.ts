/**
 * capability の宣言 (crates/notecore/capabilities.json5 → declarations.generated.ts) と
 * 実装 (execute / 確認内容の組み立て / preflight) を結び付ける (#1133)。
 *
 * メタデータ (権限 / 確認の要否 / cheap / 実行属性 / ツールスキーマ) は宣言ファイルが
 * 正本で、TS と Rust の両方がそこから生成した表を読む。builtins はここだけを書く:
 *
 *   export const notesCreateCapability = implement('notes.create', {
 *     execute: async (params, ctx) => { ... },
 *   })
 *
 * id は生成された union 型なので、宣言に無い id はコンパイルで落ちる。宣言だけあって
 * 実装が無い / 実装だけあって宣言が無い、は tests/lint/capabilityDeclarations.test.ts。
 */

import type { Command } from '@/commands/registry'
import {
  CAPABILITY_DECLARATIONS,
  type CapabilityId,
} from './declarations.generated'

/** builtins が書く部分 = 振る舞いだけ */
export interface CapabilityImpl {
  execute: Command['execute']
  /**
   * 確認ダイアログの内容を組み立てる (関数形)。宣言の `confirm: true` だけなら
   * 省略でき、汎用モーダル (label + 引数 JSON) になる。宣言が `confirm: false`
   * なのに渡すと lint で落ちる。
   */
  requiresConfirmation?: Command['requiresConfirmation']
  onConfirmRemember?: Command['onConfirmRemember']
  preflight?: Command['preflight']
  enabled?: Command['enabled']
  /**
   * 実行時に決まる enum (例: column.add の `type` はカラム種別レジストリ由来で、
   * plugin が登録した種別も AI に見せる)。宣言には enum を書かず、ここで getter を
   * 差す。tool schema は呼び出しのたびに組まれるので最新の一覧が乗る。
   */
  enumOf?: Record<string, () => readonly string[]>
}

export function implement(id: CapabilityId, impl: CapabilityImpl): Command {
  const d = CAPABILITY_DECLARATIONS[id]
  let params = d.params
  if (impl.enumOf) {
    params = { ...d.params }
    for (const [name, enumOf] of Object.entries(impl.enumOf)) {
      const base = params[name]
      if (!base) throw new Error(`${id}: enumOf for unknown param "${name}"`)
      params[name] = {
        ...base,
        get enum() {
          return enumOf()
        },
      }
    }
  }
  const cmd: Command = {
    id,
    label: d.label,
    icon: d.icon,
    category: d.category,
    shortcuts: [],
    visible: d.visible,
    aiTool: d.aiTool,
    permissions: [...d.permissions],
    signature: {
      description: d.description,
      params,
      ...(d.returns ? { returns: d.returns } : {}),
      ...(d.cheap ? { cheap: true } : {}),
    },
    execute: impl.execute,
  }
  if (d.actsAsAccount) cmd.actsAsAccount = true
  if (impl.requiresConfirmation !== undefined) {
    cmd.requiresConfirmation = impl.requiresConfirmation
  } else if (d.confirm) {
    cmd.requiresConfirmation = true
  }
  if (impl.onConfirmRemember) cmd.onConfirmRemember = impl.onConfirmRemember
  if (impl.preflight) cmd.preflight = impl.preflight
  if (impl.enabled) cmd.enabled = impl.enabled
  return cmd
}

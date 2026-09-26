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

import type { JsonValue } from '@/bindings'
import type { Command } from '@/commands/registry'
import { i18n } from '@/i18n'
import type { ConfirmOptions } from '@/stores/confirm'
import { commands, unwrap } from '@/utils/tauriInvoke'
import {
  CAPABILITY_DECLARATIONS,
  type CapabilityId,
} from './declarations.generated'
import type { CapabilityContext } from './types'

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

/** capability の表示名 (辞書の `_capabilities.<id>`、原文は capabilities.json5 の label) */
export function capabilityLabel(id: CapabilityId): string {
  let node: unknown = i18n.ts._capabilities
  for (const part of id.split('.'))
    node = (node as Record<string, unknown> | undefined)?.[part]
  return typeof node === 'string' ? node : CAPABILITY_DECLARATIONS[id].label
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
    // 表示名は辞書から引く (#135)。capability は import 時に組まれるので、
    // 辞書を読む前に触らないよう参照した時点で引く
    get label() {
      return capabilityLabel(id)
    },
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

/**
 * `exec: 'core'` な capability の本体は notecore にある (#1133 縦切り 4)。
 * デバイス側の builtin は本人操作 (パレット / slash / HTTP API) のために
 * 登録だけ残し、実行は RPC で notecore の本体を叩く。AI のターンはこの経路を
 * 通らない (ターン実行器が直接呼ぶ)。
 */
export function implementCore(
  id: CapabilityId,
  impl: Omit<CapabilityImpl, 'execute'> = {},
): Command {
  const d = CAPABILITY_DECLARATIONS[id]
  if (d.exec !== 'core') {
    throw new Error(`${id}: exec が core ではないので implementCore は使えない`)
  }
  const cmd = implement(id, {
    ...impl,
    // 確認内容も本体と同じく notecore が組む (宣言が confirm のときだけ)。
    // 帰属 / 理由 / クロスアカウントの行は dispatcher 側が足す
    ...(d.confirm && !impl.requiresConfirmation
      ? {
          requiresConfirmation: async (params, ctx) =>
            (unwrap(
              await commands.capabilityPreview(
                id,
                (params ?? {}) as JsonValue,
                ctx?.principal?.kind ?? 'user',
                ctx?.accountId ?? null,
                ctx?.tainted === true,
                pluginIdOf(ctx),
              ),
            ) as ConfirmOptions | null) ?? null,
        }
      : {}),
    execute: async (params, ctx) => {
      const outcome = unwrap(
        await commands.capabilityExecute(
          id,
          (params ?? {}) as JsonValue,
          ctx?.principal?.kind ?? 'user',
          ctx?.accountId ?? null,
          ctx?.tainted === true,
          pluginIdOf(ctx),
        ),
      )
      // notecore が「ラベル付き (tainted) の内容を返した」と申告したら呼び出し元へ
      if (outcome.tainted) ctx?.markTainted?.()
      return outcome.value
    },
  })
  CORE_DELEGATES.add(cmd)
  return cmd
}

/** principal が plugin のときの id (編集履歴の帰属に残す)。それ以外は null */
function pluginIdOf(ctx: CapabilityContext | undefined): string | null {
  const p = ctx?.principal
  return p?.kind === 'plugin' ? p.pluginId : null
}

const CORE_DELEGATES = new WeakSet<Command>()

/** builtin が notecore への委譲か (lint 用) */
export function isCoreDelegate(cmd: Command): boolean {
  return CORE_DELEGATES.has(cmd)
}

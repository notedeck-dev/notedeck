/**
 * ターン実行器 (Rust) に渡す「デバイスだけが知っている tool 情報」(#1133)。
 *
 * notecore は宣言表 (capabilities.json5) から tool 一覧を組む。宣言表に無い
 * ものが 2 つある:
 *
 * - plugin が動的登録した capability (`aiTool: true`)。宣言表に載らないので
 *   デバイスが id / 説明 / 引数 / 権限を同梱する
 * - 実行時に決まる enum (`implement(..., { enumOf })`、カラム種別など)。宣言
 *   には書けないので、デバイスが `{ capabilityId: { param: values } }` で足す
 *
 * どちらもデバイスの自己申告で、宣言表にある id は Rust 側で上書きされない。
 */

import type { DeviceTool } from '@/bindings'
import type { Command } from '@/commands/registry'
import { CAPABILITY_DECLARATIONS } from './declarations.generated'
import type { ParameterDef } from './types'

function isDeclared(id: string): boolean {
  return Object.hasOwn(CAPABILITY_DECLARATIONS, id)
}

/** 宣言表に無い AI tool (plugin 由来) */
export function collectDeviceTools(caps: readonly Command[]): DeviceTool[] {
  const out: DeviceTool[] = []
  for (const cap of caps) {
    if (!cap.aiTool || !cap.signature || isDeclared(cap.id)) continue
    const params: Record<string, ParameterDef> = {}
    for (const [name, def] of Object.entries(cap.signature.params ?? {})) {
      // getter (enumOf) を含みうるので値に落とす
      params[name] = {
        type: def.type,
        description: def.description,
        ...(def.optional ? { optional: true } : {}),
        ...(def.enum ? { enum: [...def.enum] } : {}),
      }
    }
    out.push({
      id: cap.id,
      description: cap.signature.description,
      params: params as unknown as DeviceTool['params'],
      permissions: [...(cap.permissions ?? [])],
    })
  }
  return out
}

/** 宣言表にある capability のうち、実行時に決まった enum を持つ引数 */
export function collectRuntimeEnums(
  caps: readonly Command[],
): Record<string, Record<string, string[]>> | null {
  const out: Record<string, Record<string, string[]>> = {}
  for (const cap of caps) {
    if (!cap.signature || !isDeclared(cap.id)) continue
    const declared =
      CAPABILITY_DECLARATIONS[cap.id as keyof typeof CAPABILITY_DECLARATIONS]
    for (const [name, def] of Object.entries(cap.signature.params ?? {})) {
      if (!def.enum || declared.params[name]?.enum) continue
      const values = [...def.enum]
      if (values.length === 0) continue
      out[cap.id] = { ...(out[cap.id] ?? {}), [name]: values }
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

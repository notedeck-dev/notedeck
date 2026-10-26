/**
 * Capability registry — capability 登録・lookup API。AiScript (`Nd:call`) /
 * HTTP API / slash / パレットの CLI / AI tool calling の経路から共通で
 * 参照される (dispatcher を通る)。
 *
 * `aiTool` フラグは「AI tool schema に含めるか」だけを意味し、registry 登録
 * の前提条件ではない。`aiTool: false` でも他経路 (= AiScript / HTTP API /
 * CLI / コマンドパレット) からは引き続き呼べる。AI 本体だけ自発呼出しを
 * 塞ぎたい capability (例: `ai.chat`) を表現するためのフラグ。
 *
 * `time.now` 等の builtin は `registerBuiltinCapabilities()` で起動時にまとめ
 * て登録する。
 */

import type { Capability } from './types'

const capabilities = new Map<string, Capability>()

/** Capability を registry に登録する。`signature` 必須。 */
export function registerCapability(cmd: Capability): void {
  if (!cmd.signature) {
    throw new Error(
      `Capability "${cmd.id}" must have a signature to be registered`,
    )
  }
  capabilities.set(cmd.id, cmd)
}

export function unregisterCapability(id: string): void {
  capabilities.delete(id)
}

export function getCapability(id: string): Capability | undefined {
  return capabilities.get(id)
}

export function listCapabilities(): Capability[] {
  return [...capabilities.values()]
}

/**
 * @internal テスト用。Production code から呼ばないこと。
 * registry をクリアして isolated test を可能にする。
 */
export function _clearCapabilitiesForTest(): void {
  capabilities.clear()
}

/**
 * Capability Registry の型定義 (Phase 2 入口)。
 *
 * Capability = 「NoteDeck で実行できる操作」の単位。
 * 既存の `Command` interface に optional フィールドを追加することで、
 * UI / CLI / HTTP API / AiScript / AI Tool calling の 5 つの呼び出し口で
 * 共通利用できる Single Source of Truth へ進化させる。
 *
 * Phase 2 A-1 (本ファイル): 型定義のみ。実 dispatcher は A-2 で実装。
 *
 * 設計詳細: #408 "Capability Registry as Single Source of Truth"
 *   https://github.com/hitalin/notedeck/issues/408#issuecomment-4334932896
 */

import type { PermissionKey } from '@/composables/useAiConfig'

/**
 * Capability の引数 1 つを表す型情報。
 * - JSON Schema に近いシンプル形式
 * - AI tool schema (Anthropic / OpenAI) や OpenAPI spec への自動変換の元データ
 */
export interface ParameterDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description: string
  /** 省略可能なら true。未指定 = false (= 必須) */
  optional?: boolean
  /** 文字列 enum 風の許容値リスト */
  enum?: readonly string[]
}

/**
 * Capability の戻り値の型情報。
 * 戻り値が無い (副作用のみ) capability は `'void'` を指定する。
 */
export interface ReturnTypeDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'void'
  description?: string
}

/**
 * Capability の型シグネチャ。
 * params / returns がある capability は AI tool schema や OpenAPI を自動生成できる。
 *
 * Phase 1 では値の保存のみ。Phase 2 で実 dispatcher が読み込む。
 */
export interface CapabilitySignature {
  /** ユーザー / AI に見せる説明 (Anthropic `tool description` 相当) */
  description: string
  /** 名前付き引数 (順序ではなく key ベース) */
  params?: Record<string, ParameterDef>
  /** 戻り値の型 */
  returns?: ReturnTypeDef
  /**
   * HEARTBEAT Cheap Check First (#411) で「変化検知」専用に使ってよい
   * capability か。true = ローカル / API 軽量 / 副作用なし / 結果が単純
   * (件数や id 等)。HEARTBEAT runner は cheap=true な capability のみを
   * skill の `cheapCheckCapabilities` 候補として受け入れる (= 重い API を
   * tick ごとに連発するのを防ぐ)。
   *
   * 未指定 = false (= cheap check では使えない、AI tool としては通常通り使用可)。
   */
  cheap?: boolean
}

// 呼び出し元側で permissions 宣言型を参照するときの再 export
export type { PermissionKey }

/**
 * Capability の execute() に渡されるコンテキスト。dispatcher が組み立てる。
 *
 * 多くの capability は `params` だけで完結するが、`ai.chat` のように現在の
 * AI 設定 (provider/endpoint/model) を必要とするものは ctx 経由で受け取る。
 * 未指定でも動く capability が大多数なので optional。
 */
export interface DispatchContext {
  /** dispatch 時の AiConfig (UI / HEARTBEAT で異なる permissions セットが渡る) */
  aiConfig?: import('@/composables/useAiConfig').AiConfig
}

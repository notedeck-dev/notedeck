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
 *   https://github.com/notedeck-dev/notedeck/issues/408#issuecomment-4334932896
 */

import type { Principal } from '@/permissions/principal'
import type { PermissionKey } from '@/permissions/schema'

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
 * Capability の execute() / requiresConfirmation() / onConfirmRemember() に
 * 渡されるコンテキスト。dispatcher が組み立てる。
 *
 * 多くの capability は `params` だけで完結するが、`ai.chat` のように現在の
 * AI 設定 (provider/endpoint/model) を必要とするものは ctx 経由で受け取る。
 * 未指定でも動く capability が大多数なので optional。
 */
export interface CapabilityContext {
  /** dispatch 時の AiConfig (dataSources / activeConnection 参照用) */
  aiConfig?: import('@/composables/useAiConfig').AiConfig
  /** この実行を要求している主体 (#712)。dispatcher 経由なら必ず入る */
  principal?: Principal
  /**
   * principal を呼び出した上流の主体 (#1099)。capability が内側でさらに
   * 権限判定をする (tasks.run の endpoint gate、plugin 登録 command の handler
   * 実行) ときに、直近の呼び出し元だけでなく連鎖全体で AND を取れるようにする
   */
  onBehalfOf?: readonly Principal[]
  /**
   * 呼び出し文脈のアカウント (#821)。プラグインのノート/ユーザーアクション
   * 経由ならそのエンティティの所属アカウントが入る。capability 側は
   * 「明示的な params.accountId → ctx.accountId」の順で解決する
   * (capabilities/accountContext.ts)。per-account の AI カラムはカラムの
   * アカウントを入れる。全アカウントの AI / HEARTBEAT / HTTP 経路では未指定で、
   * capability は params.accountId を必須にする (#941)。
   */
  accountId?: string
  /**
   * 確認ダイアログで見せた「適用後の全文」(#981)。dispatcher は
   * requiresConfirmation と execute に同一の ctx を渡すので、確認を出す側が
   * ここへ置き、execute はそれをそのまま書き込む (承認後に再計算しない)。
   * 読み書きは `capabilities/stagedEdit.ts` の stageEdit / takeStagedEdit 経由。
   */
  stagedEdit?: import('./stagedEdit').StagedEdit
  /**
   * 呼び出し元のセッションが tainted (他人の内容を読んだ後) か (#1103 / #1133)。
   * notecore が実行要求に添える。メモ / skill を書く capability はラベルを付ける
   */
  tainted?: boolean
  /**
   * 返す内容にラベル付き (tainted) のメモ / skill が含まれると申告する。
   * デバイス側の実行要求ハンドラが結果に添え、notecore が読んだセッションを
   * tainted にする
   */
  markTainted?: () => void
}

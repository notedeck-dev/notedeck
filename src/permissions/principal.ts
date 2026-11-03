/**
 * Principal — capability を「誰が」実行しようとしているか (#712)。
 *
 * dispatcher は principal を明示引数として受け取り、権限解決・確認ダイアログの
 * 帰属表示・Spotlight の帰属ラベルすべてに同じ値を流す。従来の
 * 「呼び出し側が permissions セットをすり替えて渡す」暗黙表現を置換する。
 */

import { i18n } from '@/i18n'
import { type PermissionsConfig, parseTokenScope } from './schema'

export type Principal =
  /** ユーザー本人の直接操作 (権限プロファイルを持たず常時許可) */
  | { kind: 'user' }
  /** AI tool calling (chat / command / task セッション) */
  | { kind: 'ai.chat' }
  /** HEARTBEAT daemon の tick 実行 */
  | { kind: 'ai.heartbeat' }
  /**
   * AiScript プラグイン / ウィジェット。pluginId は必須 (帰属表示と将来の
   * per-plugin scope の resolve seam)。ウィジェットは `widget:<id>` 形式、
   * Misskey Play / Page は `play:<id>` / `page:<id>` 形式。
   * name は帰属表示用の配布名 (例: "AtCoder") — 判別不能な installId を
   * ユーザーに見せないため、呼び出し側が分かる範囲で渡す。
   */
  | { kind: 'plugin'; pluginId: string; name?: string }
  /**
   * HTTP API (port 19820) の永続トークン経路 (#1292)。tokenId / tokenName は
   * 帰属表示とメモの著者に使う。tokenScope はそのトークンの scope で、実効権限は
   * 外部アプリの権限との AND (resolveFor)。無いのは scope 無しのトークン
   * (種別導入前に発行したもの) と、起動毎の ephemeral トークン直用 (local trust)
   */
  | {
      kind: 'external'
      tokenId?: string
      tokenName?: string
      tokenScope?: PermissionsConfig | null
    }
  /**
   * スクラッチパッドカラムで本人がその場で書いて実行するコード (#1099)。
   * 以前は `user` (全許可) だったが、全許可は本人の UI 操作にだけ配り、
   * コード実行面はカラムの種類に関わらずプロファイルを持たせる。既定は
   * readonly で、露出 (developer) は入口を隠すだけで認可境界ではない。
   */
  | { kind: 'scratchpad' }

/** 権限プロファイルを持つ principal (user は常時フル、プロファイル不要) */
export type ProfiledPrincipalId =
  | 'ai.chat'
  | 'ai.heartbeat'
  | 'plugin'
  | 'external'
  | 'scratchpad'

/**
 * HTTP API の実行要求に同送されたトークンの正体 (`{ id, name, scope }`、Rust の
 * `PersistentTokenMarker::token_json`) から external principal を組む (#1292)。
 * 正体が無い (ephemeral トークン直用 = local trust) ときは素の external
 */
export function externalTokenPrincipal(token: unknown): Principal {
  if (typeof token !== 'object' || token === null) return { kind: 'external' }
  const t = token as { id?: unknown; name?: unknown; scope?: unknown }
  if (typeof t.id !== 'string') return { kind: 'external' }
  return {
    kind: 'external',
    tokenId: t.id,
    tokenName: typeof t.name === 'string' && t.name ? t.name : undefined,
    tokenScope: parseTokenScope(t.scope),
  }
}

/**
 * 編集履歴などに保存する形 (#1292): scope は実行時の判定にしか要らず、保存すると
 * 発行時の権限表が履歴に残り続けるだけなので落とす
 */
export function principalForRecord(principal: Principal): Principal {
  if (principal.kind !== 'external') return principal
  const { tokenScope: _scope, ...rest } = principal
  return rest
}

/**
 * 確認ダイアログ / Spotlight の帰属表示に使う actor ラベル。
 * user は null (本人操作に帰属表示は不要)。
 *
 * ai.chat と ai.heartbeat は必ず別ラベルにする — 無人 daemon の確認モーダルが
 * 本人のチャット指示への確認と誤認される同意すり替えを防ぐ (#712 §3.3)。
 */
export function principalActorLabel(principal: Principal): string | null {
  switch (principal.kind) {
    case 'user':
      return null
    case 'ai.chat':
      return 'AI'
    case 'ai.heartbeat':
      return 'HEARTBEAT'
    case 'plugin': {
      const { pluginId, name } = principal
      const actor = pluginId.startsWith('widget:')
        ? i18n.tsx._principal.widget
        : pluginId.startsWith('play:')
          ? i18n.tsx._principal.play
          : pluginId.startsWith('page:')
            ? i18n.tsx._principal.page
            : i18n.tsx._principal.plugin
      // 配布名があればそれを、無ければ prefix を落とした id を出す
      const display = name || pluginId.replace(/^(widget|play|page):/, '')
      return actor({ name: display })
    }
    case 'external':
      return principal.tokenName
        ? i18n.tsx._principal.externalToken({ name: principal.tokenName })
        : i18n.ts._principal.externalApp
    case 'scratchpad':
      return i18n.ts._columns.aiscript
  }
}

/**
 * メモの著者ブロックに入れる principal の識別子 (#1018)。
 * 人間 (user) は既定なので null — メモは「誰が書いたか」を持たないのが
 * 人間の手書き、という表現にする。
 */
export function principalAuthorId(principal: Principal): string | null {
  switch (principal.kind) {
    case 'user':
      return null
    case 'plugin':
      return `plugin:${principal.pluginId}`
    case 'external':
      return principal.tokenId ? `token:${principal.tokenId}` : 'external'
    default:
      return principal.kind
  }
}

/**
 * メモの著者名 (#135)。principal が書いたメモの表示名は書いた時点の言語で
 * 保存されているので、id から表示言語で組み直す。persona (`skill:`) と
 * アカウントの著者は保存された表示名のまま。
 */
export function memoAuthorDisplayName(author: {
  id: string
  displayName: string
}): string {
  const { id } = author
  if (id.startsWith('plugin:')) {
    return (
      principalActorLabel({ kind: 'plugin', pluginId: id.slice(7) }) ??
      author.displayName
    )
  }
  // 外部トークン (#1292): 保存された表示名はトークン名
  if (id.startsWith('token:')) {
    return i18n.tsx._principal.externalToken({ name: author.displayName })
  }
  switch (id) {
    case 'ai.chat':
    case 'ai.heartbeat':
    case 'external':
    case 'scratchpad':
      return principalActorLabel({ kind: id }) ?? author.displayName
    default:
      return author.displayName
  }
}

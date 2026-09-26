/**
 * Principal — capability を「誰が」実行しようとしているか (#712)。
 *
 * dispatcher は principal を明示引数として受け取り、権限解決・確認ダイアログの
 * 帰属表示・Spotlight の帰属ラベルすべてに同じ値を流す。従来の
 * 「呼び出し側が permissions セットをすり替えて渡す」暗黙表現を置換する。
 */

import { i18n } from '@/i18n'

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
   * HTTP API (port 19820) の永続トークン経路。tokenId は将来の per-token
   * scope PR で配管する (型にだけ存在、現状は未使用)。
   */
  | { kind: 'external'; tokenId?: string }
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
      return i18n.ts._principal.externalApp
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

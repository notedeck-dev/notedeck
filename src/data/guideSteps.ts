/**
 * /guide コマンドの step 宣言データ。
 *
 * 各 step は宣言的に「何を開く」「何を待つ」「既に済んでいたら skip」を持つ。
 * 実行ロジックは useGuide store 側にある。
 *
 * 設計上の注意:
 * - AI capability dispatcher を経由しない (= ガイドは AI を呼ばない)。
 *   windows.open / column.add などはストア API を直接叩く
 * - spotlight は step の action 内で `useSpotlightStore().highlight()` を
 *   ガイドが自分で emit する (= dispatcher 経由でないため自動 emit されない)
 */

import { WINDOW_LABELS } from '@/components/deck/windowLabels'
import { resolveAiConnection, useAiConfig } from '@/composables/useAiConfig'
import { useSpotlightStore, windowTargetId } from '@/composables/useSpotlight'
import { useVault } from '@/composables/useVault'
import { useAccountsStore } from '@/stores/accounts'
import { useWindowsStore } from '@/stores/windows'

/**
 * step の precheck 戻り値。
 * - `'skip'`: 既に満たされている → ガイドが自動でスキップ
 * - `'show'`: ユーザーに見せる必要あり
 */
export type GuidePrecheck = 'skip' | 'show'

/**
 * 自動進行を仕掛けるための watch ターゲット。
 * `watch()` の戻り値を Vue `watch` で監視し、`isComplete()` が true を返した
 * 瞬間に store が次の step に進める。
 */
export interface GuideCompletionWatcher {
  watch: () => unknown
  isComplete: (value: unknown) => boolean
}

export interface GuideStep {
  /** step id (kebab-case)。テスト・デバッグ用 */
  id: string
  /** カード上部に表示する短いタイトル */
  title: string
  /** カード本文。改行を含んでよい */
  description: string
  /** step に入った時に一度だけ呼ばれるアクション (windows.open など) */
  onEnter?: () => void
  /** 既に満たされていれば skip するかを返す。未指定 = 常に show */
  precheck?: () => GuidePrecheck
  /**
   * 自動進行ウォッチ。手動 [次へ] と併用される (= watch が反応しなければ
   * ユーザーが [次へ] を押せばよい)。
   */
  completion?: GuideCompletionWatcher
  /**
   * 最終 step かどうか。true なら store の finish() を呼んで
   * settings.guide.completed = true を立てる。
   */
  isFinal?: boolean
}

/**
 * 接続のうち、AI プロバイダ (protocol 付き) のものが 1 件以上あるか判定。
 * Vault は AI 用接続 / 一般 fetch 用接続を同居させているので、protocol 有無で
 * AI 用かどうかを判別する。
 */
function hasAnyAiConnection(): boolean {
  return useVault().connections.value.some((c) => c.protocol != null)
}

/** hasToken (= 実認証) 済みの実アカウントが 1 件以上あるか */
function hasAuthenticatedAccount(): boolean {
  return useAccountsStore().accounts.some((a) => a.hasToken)
}

/**
 * ガイド step リスト。順序がそのままユーザー体験の順序になる。
 *
 * 1. welcome — 説明だけ
 * 2. ai-setup — connections window 開いて AI 接続待ち
 * 3. account-login — login window 開いて Misskey ログイン待ち
 * 4. complete — 完了カード
 */
export function buildGuideSteps(): GuideStep[] {
  return [
    {
      id: 'welcome',
      title: 'NoteDeck セットアップ',
      description:
        'NoteDeck を使い始めるために必要な設定を 2 ステップで案内します。' +
        '途中でやめても、設定済みの内容は保たれます。',
    },

    {
      id: 'ai-setup',
      title: 'AI 接続を追加',
      description:
        '右に開いた接続管理ウィンドウで、Anthropic / OpenAI など' +
        ' AI プロバイダの API キーを Vault に登録してください。' +
        '登録すると自動で次へ進みます。',
      precheck: () => {
        const { config } = useAiConfig()
        const resolved = resolveAiConnection(
          config.value,
          useVault().connections.value,
        )
        // active 接続が AI provider として解決済み = setup 済み
        if (resolved) return 'skip'
        // active が未指定でも AI 接続が登録済みなら skip 扱い (= ユーザーが
        // 既に Vault に AI 接続を持っている状態。後で active を選べばよい)
        return hasAnyAiConnection() ? 'skip' : 'show'
      },
      onEnter: () => {
        const id = useWindowsStore().open('connections', {})
        useSpotlightStore().highlight(windowTargetId(id), {
          label: `ガイドが${WINDOW_LABELS.connections}を開きました`,
        })
      },
      completion: {
        // Vault 接続が増えたら次へ
        watch: () => useVault().connections.value.length,
        isComplete: () => hasAnyAiConnection(),
      },
    },

    {
      id: 'account-login',
      title: 'Misskey アカウントを追加',
      description:
        '右に開いたログインウィンドウで、Misskey サーバーのホスト名' +
        ' (例: misskey.io) を入れて認証してください。' +
        'ログインが完了すると自動で次へ進みます。',
      precheck: () => (hasAuthenticatedAccount() ? 'skip' : 'show'),
      onEnter: () => {
        const id = useWindowsStore().open('login', {})
        useSpotlightStore().highlight(windowTargetId(id), {
          label: `ガイドが${WINDOW_LABELS.login}を開きました`,
        })
      },
      completion: {
        watch: () =>
          useAccountsStore().accounts.filter((a) => a.hasToken).length,
        isComplete: () => hasAuthenticatedAccount(),
      },
    },

    {
      id: 'complete',
      title: 'セットアップ完了',
      description:
        'これで NoteDeck を使い始められます。AI チャットや Misskey の' +
        'タイムラインを楽しんでください。',
      isFinal: true,
    },
  ]
}

/**
 * /tutorial コマンドの step 宣言データ。
 *
 * 各 step は宣言的に「何を開く」「何を待つ」「既に済んでいたら skip」を持つ。
 * 実行ロジックは useTutorial store 側にある。
 *
 * 設計上の注意:
 * - AI capability dispatcher を経由しない (= チュートリアルは AI を呼ばない)。
 *   windows.open / column.add などはストア API を直接叩く
 * - spotlight は step の action 内で `useSpotlightStore().highlight()` を
 *   チュートリアルが自分で emit する (= dispatcher 経由でないため自動 emit
 *   されない)
 */

import { useCommandStore } from '@/commands/registry'
import { WINDOW_LABELS } from '@/components/deck/windowLabels'
import { resolveAiConnection, useAiConfig } from '@/composables/useAiConfig'
import {
  commandItemTargetId,
  navbarTargetId,
  useSpotlightStore,
  windowTargetId,
} from '@/composables/useSpotlight'
import { useVault } from '@/composables/useVault'
import { useAccountsStore } from '@/stores/accounts'
import { useDeckStore } from '@/stores/deck'
import { useUiStore } from '@/stores/ui'
import { useWindowsStore } from '@/stores/windows'

/**
 * step の precheck 戻り値。
 * - `'skip'`: 既に満たされている → チュートリアルが自動でスキップ
 * - `'show'`: ユーザーに見せる必要あり
 */
export type TutorialPrecheck = 'skip' | 'show'

/**
 * 自動進行を仕掛けるための watch ターゲット。
 * `watch()` の戻り値を Vue `watch` で監視し、`isComplete()` が true を返した
 * 瞬間に store が次の step に進める。
 */
export interface TutorialCompletionWatcher {
  watch: () => unknown
  isComplete: (value: unknown) => boolean
}

export interface TutorialStep {
  /** step id (kebab-case)。テスト・デバッグ用 */
  id: string
  /** カード上部に表示する短いタイトル */
  title: string
  /** カード本文。改行を含んでよい */
  description: string
  /** step に入った時に一度だけ呼ばれるアクション (windows.open など) */
  onEnter?: () => void
  /** 既に満たされていれば skip するかを返す。未指定 = 常に show */
  precheck?: () => TutorialPrecheck
  /**
   * 自動進行ウォッチ。手動 [次へ] と併用される (= watch が反応しなければ
   * ユーザーが [次へ] を押せばよい)。
   */
  completion?: TutorialCompletionWatcher
  /**
   * 最終 step かどうか。true なら store の finish() を呼んで
   * settings.tutorial.completed = true を立てる。
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

/** カラムが 1 枚以上あるか */
function hasAnyColumn(): boolean {
  return useDeckStore().columns.length > 0
}

/** AI チャットカラム (sidebar スロット) が今開いているか */
function isAiColumnOpen(): boolean {
  return useDeckStore().columns.some((c) => c.sidebar && c.type === 'ai')
}

/** AI プロバイダ (アクティブ接続) が選択・解決済みか */
function hasResolvedAiProvider(): boolean {
  const { config } = useAiConfig()
  return resolveAiConnection(config.value, useVault().connections.value) != null
}

/**
 * チュートリアル step リスト。順序がそのままユーザー体験の順序になる。
 * 最小限で「ログイン → カラム → AI 接続/プロバイダ選択 → AIカラム」まで通す。
 *
 * 1. welcome          — NoteDeck の趣旨を一言
 * 2. account-login    — Misskey にログイン
 * 3. add-first-column — 最初のカラム (ホーム TL) を追加 = デッキを体得
 * 4. ai-setup         — AI プロバイダの API キーを Vault に登録
 * 5. ai-select-provider — AI 設定で接続をプロバイダとして選択
 * 6. ai-column        — サイドバーの AI ボタン (spotlight) から AI カラムを開く
 * 7. complete         — 完了カード
 */
export function buildTutorialSteps(): TutorialStep[] {
  return [
    {
      id: 'welcome',
      title: 'NoteDeck へようこそ',
      description:
        'NoteDeck は Misskey を、カラムを並べたデッキ・コマンドパレット・AI で' +
        '統合した環境です。基本を数ステップで案内します。' +
        '途中でやめても、設定済みの内容は保たれます。',
    },

    {
      id: 'account-login',
      title: 'Misskey アカウントを追加',
      description:
        'ログインウィンドウで Misskey サーバーのホスト名' +
        ' (例: misskey.io) を入れて認証してください。' +
        'ログインが完了すると自動で次へ進みます。',
      precheck: () => (hasAuthenticatedAccount() ? 'skip' : 'show'),
      onEnter: () => {
        const id = useWindowsStore().open('login', {})
        useSpotlightStore().highlight(windowTargetId(id), {
          label: `チュートリアルが${WINDOW_LABELS.login}を開きました`,
        })
      },
      completion: {
        watch: () =>
          useAccountsStore().accounts.filter((a) => a.hasToken).length,
        isComplete: () => hasAuthenticatedAccount(),
      },
    },

    {
      id: 'add-first-column',
      title: '最初のカラムを追加',
      description:
        'NoteDeck はカラムを並べて使います。カラム追加 (＋) から' +
        '「タイムライン」を選ぶとホームタイムラインが表示されます。' +
        '追加すると自動で次へ進みます。',
      precheck: () => (hasAnyColumn() ? 'skip' : 'show'),
      onEnter: () => {
        // カラム追加 UI を開く: desktop はコマンドパレット (+ モード)、compact は
        // AddColumnDialog。どちらも add-column コマンド (toggleAddMenu) 経由で開く。
        // 開いた UI の「タイムライン」項目を spotlight で指し示す (palette/dialog
        // 共通ターゲット)。dialog は遅延ロードなので duration を長めに取る。
        useCommandStore().execute('add-column')
        useSpotlightStore().highlight(commandItemTargetId('col-timeline'), {
          label: 'チュートリアルがタイムラインの項目を示しています',
          durationMs: 6000,
        })
      },
      completion: {
        watch: () => useDeckStore().columns.length,
        isComplete: () => hasAnyColumn(),
      },
    },

    {
      id: 'ai-setup',
      title: 'AI 接続を追加',
      description:
        '接続管理ウィンドウで、Anthropic / OpenAI など' +
        ' AI プロバイダの API キーを Vault に登録してください。' +
        '登録すると自動で次へ進みます。',
      precheck: () => {
        // active 接続が AI provider として解決済み、または AI 接続が登録済みなら skip
        if (hasResolvedAiProvider()) return 'skip'
        return hasAnyAiConnection() ? 'skip' : 'show'
      },
      onEnter: () => {
        const id = useWindowsStore().open('connections', {})
        useSpotlightStore().highlight(windowTargetId(id), {
          label: `チュートリアルが${WINDOW_LABELS.connections}を開きました`,
        })
      },
      completion: {
        // Vault 接続が増えたら次へ
        watch: () => useVault().connections.value.length,
        isComplete: () => hasAnyAiConnection(),
      },
    },

    {
      id: 'ai-select-provider',
      title: 'AI プロバイダを選択',
      description:
        'AI 設定を開きました。登録した接続を AI プロバイダとして選んでください。' +
        '選ぶと自動で次へ進みます。',
      precheck: () => (hasResolvedAiProvider() ? 'skip' : 'show'),
      onEnter: () => {
        const id = useWindowsStore().open('aiSettings', {})
        useSpotlightStore().highlight(windowTargetId(id), {
          label: `チュートリアルが${WINDOW_LABELS.aiSettings}を開きました`,
        })
      },
      completion: {
        watch: () => useAiConfig().config.value.activeConnectionId,
        isComplete: () => hasResolvedAiProvider(),
      },
    },

    {
      id: 'ai-column',
      title: 'AI カラムを開く',
      description:
        'サイドバーの AI ボタン (光っています) から AI カラムを開いて' +
        'みましょう。ここで AI と対話できます。',
      precheck: () => (isAiColumnOpen() ? 'skip' : 'show'),
      onEnter: () => {
        // compact (スマホ) は navbar がドロワーなので、まず開いて AI ボタンを
        // 画面にかぶせて見せる (desktop は navbar 常時表示なので不要)。
        if (useUiStore().isCompactLayout) {
          useUiStore().mobileDrawerOpen = true
        }
        // ナビバーの AI ボタンを spotlight で指し示す (クリックで自動 clear)。
        // 開く動作はユーザーに任せ、completion で開いたことを検知する。
        useSpotlightStore().highlight(navbarTargetId('ai', null), {
          label: 'チュートリアルが AI カラムのボタンを示しています',
        })
      },
      completion: {
        watch: () => isAiColumnOpen(),
        isComplete: () => isAiColumnOpen(),
      },
    },

    {
      id: 'complete',
      title: 'セットアップ完了',
      description:
        'これで NoteDeck を使い始められます。あとは自由に触ってみてください。',
      isFinal: true,
    },
  ]
}

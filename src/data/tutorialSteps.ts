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
import { resolveAiConnection, useAiConfig } from '@/composables/useAiConfig'
import {
  commandItemTargetId,
  navbarTargetId,
  useSpotlightStore,
  windowTargetId,
} from '@/composables/useSpotlight'
import { useVault } from '@/composables/useVault'
import { useAccountsStore } from '@/stores/accounts'
import { type ColumnType, useDeckStore } from '@/stores/deck'
import { useUiStore } from '@/stores/ui'
import { useWindowsStore } from '@/stores/windows'
import { WINDOW_LABELS } from '@/windows/registry'

/**
 * step の precheck 戻り値。
 * - `'skip'`: 既に満たされている → チュートリアルが自動でスキップ
 * - `'show'`: ユーザーに見せる必要あり
 */
export type TutorialPrecheck = 'skip' | 'show'

/**
 * spotlight を出す時間。既定 (2.4 秒) は AI 操作の一時的な可視化に合わせた
 * 値で、カードの説明文を読み終える前に消える。step の案内はもっと長く要る。
 */
const SPOTLIGHT_MS = 12000

/**
 * 自動進行を仕掛けるための watch ターゲット。
 * `watch()` の戻り値を Vue `watch` で監視し、`isComplete()` が true を返した
 * 瞬間に store が次の step に進める。
 */
export interface TutorialCompletionWatcher {
  watch: () => unknown
  isComplete: (value: unknown) => boolean
}

/**
 * チュートリアルのカテゴリ。チェックリストの見出し単位であり、
 * 完走すると NoteDeck 独自実績が 1 つ解除される単位でもある (#1029)。
 *
 * 並びと区切りは公式ドキュメント (site/ の VitePress) のサイドバーに合わせて
 * ある。ドキュメントを読み進める順序と、アプリを触って覚える順序が同じもの
 * になるようにするため。カテゴリと step はそれぞれ対応するページを持ち、
 * チュートリアルから直接開ける。
 */
export type TutorialCategoryId = 'getting-started' | 'mastery' | 'extend'

export interface TutorialCategory {
  id: TutorialCategoryId
  /** チェックリストの見出し。ドキュメントのセクション名に揃える */
  title: string
  /** 見出し下の 1 行説明 */
  description: string
  /** カテゴリ完走で解除される実績の表示名 */
  achievementName: string
  /** 実績バッジの絵文字 */
  achievementEmoji: string
  /** 対応するドキュメントのパス */
  docsPath: string
}

export interface TutorialStep {
  /** step id (kebab-case)。テスト・デバッグ用 */
  id: string
  /** カード上部に表示する短いタイトル */
  title: string
  /** カード本文。改行を含んでよい */
  description: string
  /**
   * 所属カテゴリ。未指定 = チェックリストに出さない (welcome / complete like
   * な、完了検知を持たない wizard 専用カード)。
   */
  category?: TutorialCategoryId
  /** この step を詳しく説明しているドキュメントのパス */
  docsPath?: string
  /**
   * 初回ウィザードの必須線に含めるか。既定 true。
   * API キーを要する AI などは false にして任意線 (カテゴリ) に置く (#1012)。
   */
  wizard?: boolean
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

/** hasToken (= 実認証) 済みの実アカウントが 1 件以上あるか */
function hasAuthenticatedAccount(): boolean {
  return useAccountsStore().accounts.some((a) => a.hasToken)
}

/** カラムが 1 枚以上あるか */
function hasAnyColumn(): boolean {
  return useDeckStore().columns.length > 0
}

/** 通知カラム (sidebar スロット) が今開いているか */
function isNotificationsColumnOpen(): boolean {
  return useDeckStore().columns.some(
    (c) => c.sidebar && c.type === 'notifications',
  )
}

/** 指定種別のカラムが今開いているか */
function isColumnOpen(type: ColumnType): boolean {
  return useDeckStore().columns.some((c) => c.type === type)
}

/**
 * カラム追加 UI を開き、指定種別の項目を spotlight で指し示す。
 * desktop はコマンドパレット (+ モード)、compact は AddColumnDialog。どちらも
 * add-column コマンド (toggleAddMenu) 経由で開く。dialog は遅延ロードなので
 * duration を長めに取る。
 */
function openAddColumnAndPoint(type: ColumnType, label: string): void {
  // 既に開いているなら開き直さない。compact のダイアログはトグルなので
  // 素通しに呼ぶと次の step で閉じてしまい、desktop のパレットは開き直すと
  // 入力途中の内容が消える。開閉の持ち主がレイアウトで違うので両方見る
  const ui = useUiStore()
  const commands = useCommandStore()
  const alreadyOpen = ui.isCompactLayout
    ? ui.compactAddMenuOpen
    : commands.isOpen
  if (!alreadyOpen) commands.execute('add-column')
  useSpotlightStore().highlight(commandItemTargetId(`col-${type}`), {
    label: `チュートリアルが${label}の項目を示しています`,
    durationMs: SPOTLIGHT_MS,
  })
}

/**
 * 接続のうち、AI プロバイダ (protocol 付き) のものが 1 件以上あるか判定。
 * Vault は AI 用接続 / 一般 fetch 用接続を同居させているので、protocol 有無で
 * AI 用かどうかを判別する。
 */
function hasAnyAiConnection(): boolean {
  return useVault().connections.value.some((c) => c.protocol != null)
}

/** AI プロバイダ (アクティブ接続) が選択・解決済みか */
function hasResolvedAiProvider(): boolean {
  const { config } = useAiConfig()
  return resolveAiConnection(config.value, useVault().connections.value) != null
}

/** AI チャットカラム (sidebar スロット) が今開いているか */
function isAiColumnOpen(): boolean {
  return useDeckStore().columns.some((c) => c.sidebar && c.type === 'ai')
}

/**
 * カテゴリ定義。表示順がそのまま学習の順序になる。
 * ドキュメントのサイドバー (はじめに → 使いこなす → 拡張をつくる) と
 * 同じ区切り・同じ並び。デッキを組む工程は初回に必ず通るので「はじめに」に
 * まとめている。
 */
export const TUTORIAL_CATEGORIES: TutorialCategory[] = [
  {
    id: 'getting-started',
    title: 'はじめに',
    description: 'アカウントをつなぎ、カラムを並べて使い始める',
    achievementName: 'はじめの一歩',
    achievementEmoji: '🎴',
    docsPath: '/docs/first-run',
  },
  {
    id: 'mastery',
    title: '使いこなす',
    description: '外部の AI をつないで自分の環境を動かす',
    achievementName: '使い手',
    achievementEmoji: '⌨️',
    docsPath: '/docs/guide/ai',
  },
  {
    id: 'extend',
    title: '拡張をつくる',
    description: 'プロトコルを覗き、自分だけのカラムを組み立てる',
    achievementName: '拡張の作者',
    achievementEmoji: '🔧',
    docsPath: '/docs/dev/',
  },
]

/** ドキュメントのパスから公開 URL を作る */
export function tutorialDocsUrl(docsPath: string): string {
  return `https://notedeck.io${docsPath}`
}

/**
 * チュートリアル step リスト。順序がそのままユーザー体験の順序になる。
 *
 * AI の設定は初回ウィザードの必須線に置かない (#1012)。API キーを持たない
 * 利用者がここで止まるため、ウィザードは API キー不要の範囲 (wizard: true)
 * だけで完走できるようにする。AI は任意線として「使いこなす」に置き、
 * チェックリストから後で出会う。
 *
 * 初回ウィザード (wizard: true):
 *   welcome → account-login → add-first-column → open-notifications → complete
 *
 * チェックリスト (category 付き): はじめに → 使いこなす → 拡張をつくる
 */
export function buildTutorialSteps(): TutorialStep[] {
  return [
    {
      id: 'welcome',
      title: 'NoteDeck へようこそ',
      description:
        'NoteDeck は Misskey を、カラムを並べたデッキとコマンドパレットで' +
        '統合した環境です。基本を数ステップで案内します。' +
        '途中でやめても、設定済みの内容は保たれます。',
    },

    {
      id: 'account-login',
      category: 'getting-started',
      docsPath: '/docs/first-run',
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
      category: 'getting-started',
      docsPath: '/docs/deck/columns',
      title: '最初のカラムを追加',
      description:
        'NoteDeck はカラムを並べて使います。カラム追加 (＋) から' +
        '「タイムライン」を選ぶとホームタイムラインが表示されます。' +
        '追加すると自動で次へ進みます。',
      precheck: () => (hasAnyColumn() ? 'skip' : 'show'),
      onEnter: () => openAddColumnAndPoint('timeline', 'タイムライン'),
      completion: {
        watch: () => useDeckStore().columns.length,
        isComplete: () => hasAnyColumn(),
      },
    },

    {
      id: 'open-notifications',
      category: 'getting-started',
      docsPath: '/docs/deck/navbar',
      title: '通知をサイドバーに開く',
      description:
        'ナビバーの通知ボタン (光っています) を押してみましょう。' +
        'ナビバーのボタンは、カラムをサイドバーに開いたり閉じたりします。' +
        '開くと自動で次へ進みます。',
      precheck: () => (isNotificationsColumnOpen() ? 'skip' : 'show'),
      onEnter: () => {
        // compact (スマホ) は navbar がドロワーなので、まず開いて通知ボタンを
        // 画面にかぶせて見せる (desktop は navbar 常時表示なので不要)。
        if (useUiStore().isCompactLayout) {
          useUiStore().mobileDrawerOpen = true
        }
        // ナビバーの通知ボタンを spotlight で指し示す (クリックで自動 clear)。
        // 開く動作はユーザーに任せ、completion で開いたことを検知する。
        useSpotlightStore().highlight(navbarTargetId('notifications', null), {
          label: 'チュートリアルが通知カラムのボタンを示しています',
          // 説明文に「光っています」と書く以上、読み終える前に消さない
          durationMs: SPOTLIGHT_MS,
        })
      },
      completion: {
        watch: () => isNotificationsColumnOpen(),
        isComplete: () => isNotificationsColumnOpen(),
      },
    },

    // --- 拡張をつくる (任意線) ---
    // API キー不要で効く差別化。AI と並列に最初から見えるようにする (#1012)。

    {
      id: 'open-stream-inspector',
      category: 'extend',
      docsPath: '/docs/dev/',
      wizard: false,
      title: 'Stream Inspector を開く',
      description:
        'カラム追加から「Stream Inspector」を開くと、Misskey との' +
        'WebSocket イベントが流れるまま見えます。',
      precheck: () => (isColumnOpen('streamInspector') ? 'skip' : 'show'),
      onEnter: () =>
        openAddColumnAndPoint('streamInspector', 'Stream Inspector'),
      completion: {
        watch: () => isColumnOpen('streamInspector'),
        isComplete: () => isColumnOpen('streamInspector'),
      },
    },

    {
      id: 'open-api-console',
      category: 'extend',
      docsPath: '/docs/dev/',
      wizard: false,
      title: 'API コンソールを開く',
      description:
        'カラム追加から「API コンソール」を開くと、Misskey の API を' +
        '直接叩いて応答を確かめられます。',
      precheck: () => (isColumnOpen('apiConsole') ? 'skip' : 'show'),
      onEnter: () => openAddColumnAndPoint('apiConsole', 'API コンソール'),
      completion: {
        watch: () => isColumnOpen('apiConsole'),
        isComplete: () => isColumnOpen('apiConsole'),
      },
    },

    {
      id: 'open-query-manager',
      category: 'extend',
      docsPath: '/docs/dev/query',
      wizard: false,
      title: 'カラムクエリを開く',
      description:
        'カラム追加から「カラムクエリ」を開くと、AiScript で' +
        '自分だけのタイムラインを組み立てられます。',
      precheck: () => (isColumnOpen('queryManager') ? 'skip' : 'show'),
      onEnter: () => openAddColumnAndPoint('queryManager', 'カラムクエリ'),
      completion: {
        watch: () => isColumnOpen('queryManager'),
        isComplete: () => isColumnOpen('queryManager'),
      },
    },

    // --- 使いこなす (任意線) ---
    // 外部 LLM の API キーを要するため、初回ウィザードには置かない (#1012)。

    {
      id: 'ai-setup',
      category: 'mastery',
      docsPath: '/docs/guide/ai',
      wizard: false,
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
      category: 'mastery',
      docsPath: '/docs/guide/ai',
      wizard: false,
      title: 'AI プロバイダを選択',
      description:
        'エージェント設定を開きました。登録した接続を AI プロバイダとして選んでください。' +
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
      category: 'mastery',
      docsPath: '/docs/guide/ai',
      wizard: false,
      title: 'AI カラムを開く',
      description:
        'ナビバーの AI ボタン (光っています) から AI カラムを開いて' +
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
          durationMs: SPOTLIGHT_MS,
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

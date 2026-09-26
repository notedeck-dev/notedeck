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
import { i18n } from '@/i18n'
import type { ExposureTag } from '@/settings/exposure'
import { useAccountsStore } from '@/stores/accounts'
import { useColumnQueriesStore } from '@/stores/columnQueries'
import {
  type ColumnType,
  DEFAULT_DECK_COLUMNS,
  useDeckStore,
} from '@/stores/deck'
import { useDeckProfileStore } from '@/stores/deckProfile'
import { usePluginsStore } from '@/stores/plugins'
import { useSkillsStore } from '@/stores/skills'
import { useThemeStore } from '@/stores/theme'
import { useUiStore } from '@/stores/ui'
import { useWidgetsStore } from '@/stores/widgets'
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
  /**
   * このカテゴリを実行できる条件 (#1034)。'developer' のカテゴリは開発者モードが
   * 無効なとき、案内を始めずに「開発者モードで開放」として見せる。案内先の面が
   * 隠れている状態で始めると、spotlight が存在しない項目を指して詰む。
   */
  exposure?: ExposureTag
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

/**
 * デッキが既定構成 (#1011) のままか。表示順に種別・対象アカウント・TL 種別を
 * 並べて比べる。「デッキを自分のものにする」step の達成 = 既定から変えたこと
 */
function isDefaultDeck(): boolean {
  const key = (c: {
    type: string
    accountId: string | null
    tl?: string
  }): string => `${c.type}/${c.accountId ?? ''}/${c.tl ?? ''}`
  const deck = useDeckStore()
  const current = deck.layout
    .flat()
    .map((id) => deck.getColumn(id))
    .filter((c) => c !== undefined)
    .map(key)
  return current.join(',') === DEFAULT_DECK_COLUMNS.map(key).join(',')
}

/** 既定デッキから並び替え・削除・追加のどれかをしたか */
function hasCustomizedDeck(): boolean {
  return hasAnyColumn() && !isDefaultDeck()
}

/** 通知カラム (sidebar スロット) が今開いているか */
function isNotificationsColumnOpen(): boolean {
  return useDeckStore().columns.some(
    (c) => c.sidebar && c.type === 'notifications',
  )
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
    label: i18n.tsx._tutorialSteps.pointingItem({ label }),
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

/** プロファイルを 2 つ以上持っているか (= 使い分けを作った) */
function hasExtraProfile(): boolean {
  return useDeckProfileStore().getProfiles().length > 1
}

/** AI チャットカラム (sidebar スロット) が今開いているか */
function isAiColumnOpen(): boolean {
  return useDeckStore().columns.some((c) => c.sidebar && c.type === 'ai')
}

/**
 * カテゴリ定義。表示順がそのまま学習の順序になる。
 *
 * ドキュメント (site/) の章立てを参考にしているが、1 対 1 には縛らない。
 * 教える価値のある操作とドキュメントの構成は別物で、揃えようとすると
 * 「ページがあるから step を足す」side に引っぱられる。各 step が対応
 * ページを持つことだけを保証する (リンク切れはテストで落とす)。
 */
export const TUTORIAL_CATEGORIES: TutorialCategory[] = [
  {
    id: 'getting-started',
    get title() {
      return i18n.ts._tutorialSteps.gettingStartedTitle
    },
    get description() {
      return i18n.ts._tutorialSteps.gettingStartedDescription
    },
    get achievementName() {
      return i18n.ts._tutorialSteps.gettingStartedAchievementName
    },
    achievementEmoji: '🎴',
    docsPath: '/docs/first-run',
  },
  {
    id: 'mastery',
    get title() {
      return i18n.ts._tutorialSteps.masteryTitle
    },
    get description() {
      return i18n.ts._tutorialSteps.masteryDescription
    },
    get achievementName() {
      return i18n.ts._tutorialSteps.masteryAchievementName
    },
    achievementEmoji: '⌨️',
    docsPath: '/docs/guide/ai',
  },
  {
    id: 'extend',
    exposure: 'developer',
    get title() {
      return i18n.ts._tutorialSteps.extendTitle
    },
    get description() {
      return i18n.ts._tutorialSteps.extendDescription
    },
    get achievementName() {
      return i18n.ts._tutorialSteps.extendAchievementName
    },
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
 *   welcome → account-login → customize-deck → open-notifications → complete
 *
 * チェックリスト (category 付き): はじめに → 使いこなす → 拡張をつくる
 */
export function buildTutorialSteps(): TutorialStep[] {
  return [
    {
      id: 'welcome',
      get title() {
        return i18n.ts._tutorialSteps.welcomeTitle
      },
      get description() {
        return i18n.ts._tutorialSteps.welcomeDescription
      },
    },

    {
      id: 'account-login',
      category: 'getting-started',
      docsPath: '/docs/first-run',
      get title() {
        return i18n.ts._tutorialSteps.accountLoginTitle
      },
      get description() {
        return i18n.ts._tutorialSteps.accountLoginDescription
      },
      precheck: () => (hasAuthenticatedAccount() ? 'skip' : 'show'),
      onEnter: () => {
        const id = useWindowsStore().open('login', {})
        useSpotlightStore().highlight(windowTargetId(id), {
          label: i18n.tsx._tutorialSteps.openedWindow({
            name: String(WINDOW_LABELS.login),
          }),
        })
      },
      completion: {
        watch: () =>
          useAccountsStore().accounts.filter((a) => a.hasToken).length,
        isComplete: () => hasAuthenticatedAccount(),
      },
    },

    {
      id: 'customize-deck',
      category: 'getting-started',
      docsPath: '/docs/deck/columns',
      get title() {
        return i18n.ts._tutorialSteps.customizeDeckTitle
      },
      get description() {
        return i18n.ts._tutorialSteps.customizeDeckDescription
      },
      precheck: () => (hasCustomizedDeck() ? 'skip' : 'show'),
      onEnter: () => {
        // 空デッキ (全部消した後のやり直し) なら追加の入口を示す
        if (!hasAnyColumn())
          openAddColumnAndPoint('timeline', i18n.ts._columns.timeline)
      },
      completion: {
        watch: () => hasCustomizedDeck(),
        isComplete: () => hasCustomizedDeck(),
      },
    },

    {
      id: 'open-notifications',
      category: 'getting-started',
      docsPath: '/docs/deck/navbar',
      get title() {
        return i18n.ts._tutorialSteps.openNotificationsTitle
      },
      get description() {
        return i18n.ts._tutorialSteps.openNotificationsDescription
      },
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
          label: i18n.ts._tutorialSteps.pointingNotificationsButton,
          // 説明文に「光っています」と書く以上、読み終える前に消さない
          durationMs: SPOTLIGHT_MS,
        })
      },
      completion: {
        watch: () => isNotificationsColumnOpen(),
        isComplete: () => isNotificationsColumnOpen(),
      },
    },

    {
      id: 'create-profile',
      category: 'getting-started',
      wizard: false,
      docsPath: '/docs/deck/profiles',
      get title() {
        return i18n.ts._tutorialSteps.createProfileTitle
      },
      get description() {
        return i18n.ts._tutorialSteps.createProfileDescription
      },
      precheck: () => (hasExtraProfile() ? 'skip' : 'show'),
      onEnter: () => {
        const id = useWindowsStore().open('profileEditor', {})
        useSpotlightStore().highlight(windowTargetId(id), {
          label: i18n.tsx._tutorialSteps.openedWindow({
            name: String(WINDOW_LABELS.profileEditor),
          }),
          durationMs: SPOTLIGHT_MS,
        })
      },
      completion: {
        watch: () => useDeckProfileStore().getProfiles().length,
        isComplete: () => hasExtraProfile(),
      },
    },

    // --- 拡張をつくる (任意線) ---
    // AiScript で自分の道具を作る流れを、作るものの単位で並べる。

    {
      id: 'create-plugin',
      category: 'extend',
      wizard: false,
      docsPath: '/docs/dev/plugin',
      get title() {
        return i18n.ts._tutorialSteps.createPluginTitle
      },
      get description() {
        return i18n.ts._tutorialSteps.createPluginDescription
      },
      precheck: () => (usePluginsStore().plugins.length > 0 ? 'skip' : 'show'),
      onEnter: () =>
        openAddColumnAndPoint('pluginManager', i18n.ts._columns.pluginManager),
      completion: {
        watch: () => usePluginsStore().plugins.length,
        isComplete: () => usePluginsStore().plugins.length > 0,
      },
    },

    {
      id: 'create-widget',
      category: 'extend',
      wizard: false,
      docsPath: '/docs/dev/widget',
      get title() {
        return i18n.ts._tutorialSteps.createWidgetTitle
      },
      get description() {
        return i18n.ts._tutorialSteps.createWidgetDescription
      },
      precheck: () => (useWidgetsStore().widgets.length > 0 ? 'skip' : 'show'),
      onEnter: () => openAddColumnAndPoint('widget', i18n.ts._columns.widget),
      completion: {
        watch: () => useWidgetsStore().widgets.length,
        isComplete: () => useWidgetsStore().widgets.length > 0,
      },
    },

    {
      id: 'create-theme',
      category: 'extend',
      wizard: false,
      docsPath: '/docs/dev/theme',
      get title() {
        return i18n.ts._tutorialSteps.createThemeTitle
      },
      get description() {
        return i18n.ts._tutorialSteps.createThemeDescription
      },
      precheck: () =>
        useThemeStore().installedThemes.length > 0 ? 'skip' : 'show',
      onEnter: () =>
        openAddColumnAndPoint('themeManager', i18n.ts._columns.themeManager),
      completion: {
        watch: () => useThemeStore().installedThemes.length,
        isComplete: () => useThemeStore().installedThemes.length > 0,
      },
    },

    {
      id: 'create-query',
      category: 'extend',
      wizard: false,
      docsPath: '/docs/dev/query',
      get title() {
        return i18n.ts._tutorialSteps.createQueryTitle
      },
      get description() {
        return i18n.ts._tutorialSteps.createQueryDescription
      },
      precheck: () =>
        useColumnQueriesStore().queries.length > 0 ? 'skip' : 'show',
      onEnter: () =>
        openAddColumnAndPoint(
          'queryManager',
          i18n.ts._tutorialSteps.columnQueryItem,
        ),
      completion: {
        watch: () => useColumnQueriesStore().queries.length,
        isComplete: () => useColumnQueriesStore().queries.length > 0,
      },
    },

    {
      id: 'create-skill',
      category: 'extend',
      wizard: false,
      docsPath: '/docs/dev/skill',
      get title() {
        return i18n.ts._tutorialSteps.createSkillTitle
      },
      get description() {
        return i18n.ts._tutorialSteps.createSkillDescription
      },
      precheck: () => (useSkillsStore().skills.length > 0 ? 'skip' : 'show'),
      onEnter: () => openAddColumnAndPoint('skill', i18n.ts._columns.skill),
      completion: {
        watch: () => useSkillsStore().skills.length,
        isComplete: () => useSkillsStore().skills.length > 0,
      },
    },

    // --- 使いこなす (任意線) ---

    {
      id: 'ai-setup',
      category: 'mastery',
      docsPath: '/docs/guide/ai',
      wizard: false,
      get title() {
        return i18n.ts._tutorialSteps.aiSetupTitle
      },
      get description() {
        return i18n.ts._tutorialSteps.aiSetupDescription
      },
      precheck: () => {
        // active 接続が AI provider として解決済み、または AI 接続が登録済みなら skip
        if (hasResolvedAiProvider()) return 'skip'
        return hasAnyAiConnection() ? 'skip' : 'show'
      },
      onEnter: () => {
        const id = useWindowsStore().open('connections', {})
        useSpotlightStore().highlight(windowTargetId(id), {
          label: i18n.tsx._tutorialSteps.openedWindow({
            name: String(WINDOW_LABELS.connections),
          }),
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
      get title() {
        return i18n.ts._tutorialSteps.aiSelectProviderTitle
      },
      get description() {
        return i18n.ts._tutorialSteps.aiSelectProviderDescription
      },
      precheck: () => (hasResolvedAiProvider() ? 'skip' : 'show'),
      onEnter: () => {
        const id = useWindowsStore().open('aiSettings', {})
        useSpotlightStore().highlight(windowTargetId(id), {
          label: i18n.tsx._tutorialSteps.openedWindow({
            name: String(WINDOW_LABELS.aiSettings),
          }),
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
      get title() {
        return i18n.ts._tutorialSteps.aiColumnTitle
      },
      get description() {
        return i18n.ts._tutorialSteps.aiColumnDescription
      },
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
          label: i18n.ts._tutorialSteps.pointingAiButton,
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
      get title() {
        return i18n.ts._tutorialSteps.completeTitle
      },
      get description() {
        return i18n.ts._tutorialSteps.completeDescription
      },
      isFinal: true,
    },
  ]
}

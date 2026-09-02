<script setup lang="ts">
import { getTauriVersion } from '@tauri-apps/api/app'
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { Check, HealthReport, Status } from '@/bindings'
import type { MetricsSnapshot } from '@/capabilities/builtins/metrics'
import { dispatchCapability } from '@/capabilities/dispatcher'
import AiSwitchRow from '@/components/window/ai-settings/AiSwitchRow.vue'
import { useDeveloperMode } from '@/composables/useDeveloperMode'
import { useUpdater } from '@/composables/useUpdater'
import {
  formatHealthDuration,
  getStreamHealth,
  type OverallStreamHealth,
} from '@/core/streamHealth'
import type { QualityLevel } from '@/engine/telemetry/frameTelemetry'
import { getAccountLabel, useAccountsStore } from '@/stores/accounts'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { useUiStore } from '@/stores/ui'
import { useWindowsStore } from '@/stores/windows'
import { AppError } from '@/utils/errors'
import { highlightCode, highlightRevision } from '@/utils/highlight'
import { getStartupEntries, getWebviewFixedCost } from '@/utils/startupTrace'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { openSafeUrl } from '@/utils/url'
import { version as appVersion } from '../../../package.json'

const emit = defineEmits<{
  close: []
}>()

const tauriVersion = ref('')
const rustVersion = ref('')
const copied = ref(false)
const uiStore = useUiStore()
const windowsStore = useWindowsStore()

const { enabled: developerMode, toggle: toggleDeveloperMode } =
  useDeveloperMode()

const accountsStore = useAccountsStore()

const REPO_URL = 'https://github.com/notedeck-dev/notedeck'
const SITE_URL = 'https://notedeck.io'
const SPONSOR_URL = 'https://github.com/sponsors/hitalin'

// バージョン情報テーブルは普段は畳んでおく (必要なのはバグ報告・コピー時で、
// その2つは表示に依存せず infoRows から本文を生成する)
const infoOpen = ref(false)
// 自己診断 / 起動パフォーマンスも同じ方針で畳む。閉じたままでも要点
// (ステータス / 合計) はヘッダ右端のバッジで分かる
const diagOpen = ref(false)
const startupOpen = ref(false)

// ロゴのイースターエッグ: クリックすると HEARTBEAT にちなんだ鼓動を打つ。
// 一度 class を外してから付け直すことで、連打や中断後も確実に再発火させる
const logoBeating = ref(false)
function beatLogo(): void {
  logoBeating.value = false
  requestAnimationFrame(() => {
    logoBeating.value = true
  })
}

// 自己診断 (#644): notecli doctor + ランタイム状態。About を開いた時に走らせ、
// 「情報をコピー」「バグを報告」の本文に診断を同梱する (VS Code Report Issue モデル)。
const health = shallowRef<HealthReport | null>(null)
const healthLoading = ref(false)
const healthError = ref<string | null>(null)

const STATUS_ICON: Record<Status, string> = {
  ok: 'ti ti-circle-check',
  warn: 'ti ti-alert-triangle',
  fail: 'ti ti-circle-x',
}

const STATUS_SYM: Record<Status, string> = {
  ok: '[OK]  ',
  warn: '[WARN]',
  fail: '[FAIL]',
}

function formatCheck(c: Check): string {
  return `${STATUS_SYM[c.status]} ${c.account ? `${c.account} ` : ''}${c.name}: ${c.message}${c.fix ? ` (→ ${c.fix})` : ''}`
}

// ストリーミング接続の診断 (#698)。doctor の checks と同じ形に整形して
// 合流させる: connected / 状態記録なし (カラム未表示等) は正常として出さず、
// reconnecting / disconnected だけを継続時間つきで出す。恒久障害の
// 「気づき」自体はカラムのオフラインバッジが担い、ここは診断・報告用。
const healthCheckedAt = ref(0)
const streamChecks = computed<Check[]>(() => {
  // 再診断ボタンで継続時間の表示を更新するための依存
  void healthCheckedAt.value
  // 手動オフラインモードは意図した切断なので、障害として診断やバグ報告に
  // 混ぜない
  if (useOfflineModeStore().isOfflineMode) return []
  const checks: Check[] = []
  for (const acc of accountsStore.accounts) {
    if (!acc.hasToken) continue
    const h = getStreamHealth(acc.id)
    if (!h || h.state === 'connected' || h.state === 'initializing') continue
    checks.push({
      name: 'streaming',
      status: h.state === 'disconnected' ? 'fail' : 'warn',
      message:
        h.state === 'disconnected'
          ? `ストリーム切断 (${formatHealthDuration(h.since)})`
          : `ストリーム再接続中 (${formatHealthDuration(h.since)})`,
      account: getAccountLabel(acc),
      fix: 'ネットワークとサーバーの状態を確認',
    })
  }
  return checks
})

/**
 * 記録されている Rust panic (#644)。adb を繋げない Android でも
 * 「前回落ちた理由」をここから読めるようにするのが主目的。
 * 次の panic が来るまで残るので、いつのものかを日時で示す。
 */
const crashChecks = computed<Check[]>(() => {
  const panic = health.value?.lastPanic
  if (!panic) return []
  // 1 行目に "panicked at <file>:<line>: <msg>" が入る。詳細は診断ログ側で見る
  const headline = panic.message.split('\n')[0]?.trim() ?? 'panic'
  const when = panic.at > 0 ? new Date(panic.at).toLocaleString() : '時刻不明'
  return [
    {
      name: 'crash',
      status: 'warn',
      message: `${when} に異常終了しました: ${headline}`,
      fix: '下の診断ログをコピーして報告',
    },
  ]
})

// 正常な項目は畳んで、注意・問題だけ出す (健康なら "正常" の一行で済む)。
const problemChecks = computed(() => [
  ...(health.value?.doctor.checks ?? []).filter((c) => c.status !== 'ok'),
  ...streamChecks.value,
  ...crashChecks.value,
])

const overallStatus = computed<Status>(() => {
  if (problemChecks.value.some((c) => c.status === 'fail')) return 'fail'
  if (problemChecks.value.some((c) => c.status === 'warn')) return 'warn'
  return 'ok'
})

const healthSummary = computed(() => {
  if (healthLoading.value) return '診断中...'
  if (healthError.value) return '診断に失敗しました'
  if (!health.value) return ''
  const fails = problemChecks.value.filter((c) => c.status === 'fail').length
  const warns = problemChecks.value.filter((c) => c.status === 'warn').length
  if (fails > 0) return `${fails} 件の問題`
  if (warns > 0) return `${warns} 件の警告`
  return '正常'
})

async function runHealthcheck() {
  if (healthLoading.value) return
  healthLoading.value = true
  healthError.value = null
  healthCheckedAt.value = Date.now()
  try {
    health.value = unwrap(await commands.runHealthcheck())
  } catch (e) {
    healthError.value = AppError.from(e).message
  } finally {
    healthLoading.value = false
  }
}

// 問題のある行だけをデバッグログ体裁に整形。正常時は空文字なので
// ブロックも本文の診断セクションも出ない。
const checkLines = computed<string>(() =>
  problemChecks.value.map(formatCheck).join('\n'),
)

/**
 * UI 表示とクリップボードコピー用。panic は 1 行に畳むと file:line しか
 * 残らないので backtrace ごと付ける (Android は adb が使えず、これがスタックを
 * 持ち出す唯一の経路になる)。どちらもローカルに留まる用途。
 */
const diagnosticsLog = computed<string>(() => {
  const panic = health.value?.lastPanic
  if (!panic) return checkLines.value
  const parts = [
    checkLines.value,
    '--- last panic ---',
    panic.message.trimEnd(),
  ]
  return parts.filter((p) => p).join('\n\n')
})

/**
 * GitHub issue の URL に載せる分。backtrace は入れない — URL 長を食い潰すうえ、
 * ローカルのパスやユーザー名が外部へ出る。本人が「情報をコピー」から
 * 貼り付けるかどうかを選べる形にする。
 */
const reportDiagnostics = computed<string>(() => checkLines.value)
const {
  isChecking,
  isUpToDate,
  updateAvailable,
  updateVersion,
  isInstalling,
  updateReady,
  downloadProgress,
  updateError,
  checkForUpdate,
  installUpdate,
  restartToUpdate,
} = useUpdater()

const showUpdateSection = computed(
  () => updateAvailable.value || isInstalling.value || updateReady.value,
)
const updateIcon = computed(() => {
  if (updateReady.value) return 'ti ti-refresh'
  if (isInstalling.value) return 'ti ti-download'
  return 'ti ti-arrow-up-circle'
})

const buildDate = __BUILD_DATE__
const gitCommit = __GIT_COMMIT__

// 起動パフォーマンス (#985、#732 の一部)。VS Code の Startup Performance
// 踏襲: 起動クリティカルパスの計測点をウォーターフォール付きの表で出す。
// prod ビルドではコンソールが落ちるため、実機の起動実測はここが唯一の面。
// 値はセッション固有の静的データ (About を開いた時点の記録を表示)。
// 行名は「計測点」ではなく「その行の区間で何をしていたか」で付ける。
// 例: main-eval の mark は評価開始点なので、区間の実体は「そこに到達する
// までのモジュール読み込み + 依存の評価」(dev では vite の変換時間が乗る)
const STARTUP_LABELS: Record<string, string> = {
  'main-eval': 'スクリプト読み込み',
  'settings-await': '初期化処理',
  'settings-loaded': '設定読み込み',
  mounted: 'Vue マウント',
  'window-shown': 'ウィンドウ表示',
  'deck-mounted': 'デッキ表示',
}

interface StartupRow {
  label: string
  /** 前区間との差 (ms)。計測不能 (リロード後の WebView 起動) は null */
  delta: number | null
  /** プロセス起動からの累計 (ms)。WebView 起動が取れない場合は navigation 起点 */
  cum: number | null
  /** ウォーターフォールバーの位置 (全体比 %) */
  left: string
  width: string
  emphasis: boolean
}

const webviewFixedCost = getWebviewFixedCost()
// セクションを開くたびに最新の計測点を読み直す (deck-mounted のように
// About を開いた後に記録されるマークを取りこぼさないため)
const startupRows = computed<StartupRow[]>(() => {
  void startupOpen.value
  const entries = getStartupEntries()
  if (entries.length === 0) return []
  const base = webviewFixedCost ?? 0
  const total = base + (entries[entries.length - 1]?.at ?? 0)
  const seg = (start: number, end: number) => ({
    left: `${(start / total) * 100}%`,
    // 数 ms の区間も見えるよう最小幅を確保する
    width: `${Math.max(((end - start) / total) * 100, 0.75)}%`,
  })
  const rows: StartupRow[] = [
    {
      label: 'WebView 起動',
      delta: webviewFixedCost,
      cum: webviewFixedCost,
      ...(webviewFixedCost !== null
        ? seg(0, webviewFixedCost)
        : { left: '0%', width: '0%' }),
      emphasis: false,
    },
  ]
  let prev = 0
  for (const e of entries) {
    rows.push({
      label: STARTUP_LABELS[e.name] ?? e.name,
      delta: Math.round(e.at - prev),
      cum: Math.round(base + e.at),
      ...seg(base + prev, base + e.at),
      emphasis: e.name === 'deck-mounted',
    })
    prev = e.at
  }
  return rows
})

const startupTotalMs = computed(() => {
  const last = startupRows.value[startupRows.value.length - 1]
  return last?.cum ?? null
})

// 実行時パフォーマンス (#732)。metrics.read capability を UI からも同じ経路で
// 呼び、AI に見せている実測値と同一の snapshot を表示する。point-in-time
// snapshot なので、セクションを開いている間だけ定期更新する (フレーム
// サンプリングは毎秒 + staleness 判定 3 秒なので 2 秒間隔で追えば十分)
const metricsOpen = ref(false)
const metrics = shallowRef<MetricsSnapshot | null>(null)
const metricsError = ref<string | null>(null)
let metricsTimer: ReturnType<typeof setInterval> | null = null

function stopMetricsTimer(): void {
  if (metricsTimer !== null) {
    clearInterval(metricsTimer)
    metricsTimer = null
  }
}

async function refreshMetrics(): Promise<void> {
  const result = await dispatchCapability(
    'metrics.read',
    {},
    { principal: { kind: 'user' } },
  )
  if (result.ok) {
    metrics.value = result.result as MetricsSnapshot
    metricsError.value = null
  } else {
    metricsError.value = result.error
    // 権限拒否・未登録は再試行で変わらないのでポーリングを止める
    if (
      result.code === 'permission_denied' ||
      result.code === 'unknown_capability'
    ) {
      stopMetricsTimer()
    }
  }
}

watch(metricsOpen, (open) => {
  if (open) {
    void refreshMetrics()
    metricsTimer = setInterval(() => void refreshMetrics(), 2_000)
  } else {
    stopMetricsTimer()
  }
})

onUnmounted(stopMetricsTimer)

const QUALITY_LABELS: Record<QualityLevel, string> = {
  low: '低',
  balanced: 'バランス',
  high: '高',
}

const STREAM_HEALTH_LABELS: Record<OverallStreamHealth, string> = {
  unknown: '接続なし',
  initializing: '接続中',
  healthy: '正常',
  degraded: '一部切断',
  offline: '切断',
  'manual-offline': 'オフラインモード',
}

interface MetricsRow {
  label: string
  value: string
  /** 予算比の判定。付けない行 (FPS 等) は素の情報として出す */
  status?: Status
}

const metricsRows = computed<MetricsRow[]>(() => {
  const m = metrics.value
  if (!m) return []
  const ms = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}ms`)
  const f = m.frame
  // フレーム時間は予算 (1000/リフレッシュレート) 内なら ok、jank 判定と
  // 同じ 2 倍超で fail。fps は「描画作業をした frame 数」なので低くても
  // 問題とは限らず、判定を付けない
  const timeStatus = (v: number | null): Status | undefined =>
    v === null
      ? undefined
      : v <= f.frameBudgetMs
        ? 'ok'
        : v <= f.frameBudgetMs * 2
          ? 'warn'
          : 'fail'
  const jank = f.jankCount ?? 0
  const frameRows: MetricsRow[] = f.available
    ? [
        { label: 'FPS', value: String(f.fps ?? '—') },
        {
          label: 'フレーム時間',
          value: `${ms(f.frameTimeEmaMs)} (予算 ${ms(f.frameBudgetMs)})`,
          status: timeStatus(f.frameTimeEmaMs),
        },
        {
          label: 'p95 フレーム時間',
          value: `${ms(f.p95FrameTimeMs)} (${f.sampleCount} サンプル)`,
          status: timeStatus(f.p95FrameTimeMs),
        },
        {
          label: 'フレーム落ち',
          value: `${jank} 回/秒`,
          // 閾値は snapshot が返す実効値 (performance.json5 で変更可能) を
          // 使い、自動調整の判定と診断がずれないようにする
          status:
            jank === 0
              ? 'ok'
              : jank <= f.jankDowngradeThreshold
                ? 'warn'
                : 'fail',
        },
      ]
    : [{ label: 'フレーム計測', value: 'アイドル (描画作業なし)' }]
  const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`
  const memoryRows: MetricsRow[] = []
  // JS ヒープは Chromium 系 WebView のみ。取れない環境では行ごと出さない
  if (m.memory.jsHeap) {
    memoryRows.push({
      label: 'JS ヒープ',
      value: `${mb(m.memory.jsHeap.usedBytes)} / ${mb(m.memory.jsHeap.totalBytes)}`,
    })
  }
  memoryRows.push({
    label: '画像メモリ (推定)',
    value: `${mb(m.memory.images.estimatedDecodedBytes)} (${m.memory.images.uniqueCount} URL / ${m.memory.images.elementCount} 要素)`,
  })
  return [
    ...frameRows,
    {
      label: '描画品質',
      value: `${QUALITY_LABELS[m.adaptiveQuality.currentLevel]} (自動調整${m.adaptiveQuality.autoAdjustEnabled ? 'あり' : 'なし'})`,
    },
    {
      label: 'ストリーム接続',
      value: `${STREAM_HEALTH_LABELS[m.streaming.overallHealth]} (${m.streaming.observedConnectionCount} 接続)`,
    },
    ...memoryRows,
  ]
})

// 「この数値を見てどう設定を動かすか」への橋渡し。自動調整の有無で
// 文言を変える (ありなら品質は勝手に追従するので、手を動かすべきは
// 自動調整が追従しきれない場合だけ)
const metricsAdvice = computed<{ status: Status; text: string } | null>(() => {
  const m = metrics.value
  if (!m) return null
  if (!m.frame.available) {
    return {
      status: 'ok',
      text: 'アイドル中です。デッキを操作すると計測が始まります',
    }
  }
  const statuses = metricsRows.value.map((r) => r.status)
  const auto = m.adaptiveQuality.autoAdjustEnabled
  if (statuses.includes('fail')) {
    return {
      status: 'fail',
      text: auto
        ? '描画が追いついていません。自動調整が品質を下げて追従します。改善しない場合はパフォーマンス設定を省電力寄りにしてください'
        : '描画が追いついていません。パフォーマンス設定で品質を下げるとカクつきが減ります',
    }
  }
  if (statuses.includes('warn')) {
    return {
      status: 'warn',
      text: '描画にやや負荷がかかっています。カクつきを感じる場合はパフォーマンス設定で品質を下げてください',
    }
  }
  if (m.adaptiveQuality.currentLevel !== 'high') {
    return {
      status: 'ok',
      text: auto
        ? '描画に余裕があります。安定が続けば自動調整が品質を上げます'
        : '描画に余裕があります。パフォーマンス設定で品質を上げても快適に動く見込みです',
    }
  }
  return { status: 'ok', text: '描画は良好です' }
})

const fmtMs = (ms: number) => `${ms.toLocaleString()}ms`

function getStartupText(): string {
  const lines = startupRows.value.map(
    (r) =>
      `${r.label}: ${r.cum !== null ? fmtMs(r.cum) : 'N/A (リロード後)'}${r.delta !== null ? ` (+${fmtMs(r.delta)})` : ''}`,
  )
  if (startupTotalMs.value !== null)
    lines.push(`合計: ${fmtMs(startupTotalMs.value)}`)
  return lines.join('\n')
}

function parseWebView(ua: string): string {
  const webkit = ua.match(/AppleWebKit\/([\d.]+)/)
  return webkit ? `WebKit ${webkit[1]}` : 'N/A'
}

function parseOS(ua: string): string {
  const linux = ua.match(/Linux ([^\s;)]+)/)
  if (linux) return `Linux ${linux[1]}`
  const win = ua.match(/Windows NT ([\d.]+)/)
  if (win) return `Windows NT ${win[1]}`
  const mac = ua.match(/Mac OS X ([\d_]+)/)
  if (mac?.[1]) return `macOS ${mac[1].replace(/_/g, '.')}`
  return navigator.platform || 'N/A'
}

const webView = parseWebView(navigator.userAgent)
const os = parseOS(navigator.userAgent)

onMounted(async () => {
  try {
    tauriVersion.value = await getTauriVersion()
  } catch {
    // Fallback for environments where Tauri API is unavailable
  }
  try {
    rustVersion.value = await commands.getRustcVersion()
  } catch {
    // Fallback for environments where Tauri API is unavailable
  }
  runHealthcheck()
})

const infoRows = [
  { label: 'Version', get: () => appVersion },
  { label: 'Commit', get: () => gitCommit.slice(0, 12) },
  { label: 'Date', get: () => buildDate },
  { label: 'Tauri', get: () => tauriVersion.value || '...' },
  { label: 'Rust', get: () => rustVersion.value || '...' },
  { label: 'WebView', get: () => webView },
  { label: 'OS', get: () => os },
]

function getInfoText() {
  const info = infoRows.map((r) => `${r.label}: ${r.get()}`).join('\n')
  const diag = diagnosticsLog.value
  const parts = [info]
  if (startupRows.value.length > 0) parts.push(`# 起動\n${getStartupText()}`)
  if (diag) parts.push(`# 診断\n\`\`\`\n${diag}\n\`\`\``)
  return parts.join('\n\n')
}

async function copyInfo() {
  await navigator.clipboard.writeText(getInfoText())
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}

function reportBug() {
  const env = infoRows.map((r) => `- **${r.label}**: ${r.get()}`).join('\n')
  const diag = reportDiagnostics.value
  const diagSection = diag ? `\n\n## 診断\n\n\`\`\`\n${diag}\n\`\`\`` : ''
  // backtrace は URL に載せない。貼るかどうかは本人に委ねる
  const panicNote = health.value?.lastPanic
    ? '\n\n<!-- 異常終了の backtrace は「情報をコピー」で取得して貼り付けてください -->'
    : ''
  const body = `## 現象\n\n<!-- 何が起きたか -->\n\n## 再現手順\n\n1.\n2.\n3.\n\n## 期待する動作\n\n<!-- 本来どうなるべきか -->\n\n## 環境\n\n${env}${diagSection}${panicNote}\n\n## スクリーンショット\n\n<!-- あれば添付 -->`
  const url = `${REPO_URL}/issues/new?labels=bug&body=${encodeURIComponent(body)}`
  openSafeUrl(url)
}
</script>

<template>
  <div :class="$style.aboutContent">
    <!-- 本家 about-misskey ページ踏襲の hero: アイコン + 名前 + バージョン薄字 -->
    <div :class="$style.aboutHero">
      <button type="button" class="_button" :class="$style.logoBtn" aria-label="NoteDeck" @click="beatLogo">
        <img
          src="/favicon.svg"
          :class="[$style.aboutLogo, logoBeating && $style.beating]"
          alt=""
          @animationend="logoBeating = false"
        />
      </button>
      <button
        type="button"
        class="_button"
        :class="$style.aboutTitle"
        title="公式サイトを開く"
        @click="openSafeUrl(SITE_URL)"
      >
        NoteDeck
      </button>
      <!-- バージョン表記自体がアップデート確認のタッチポイント。更新が待機中は
           アクションを更新セクションに一本化するので、ここは表示だけに戻す
           (モバイルも表示のみ) -->
      <button
        v-if="!uiStore.isMobilePlatform && !showUpdateSection"
        type="button"
        class="_button"
        :class="[$style.aboutVersion, isUpToDate && $style.versionOk]"
        title="アップデートを確認"
        :disabled="isChecking"
        @click="checkForUpdate(true)"
      >
        v{{ appVersion }}
        <i
          :class="[
            isChecking ? 'ti ti-loader-2 nd-spin' : isUpToDate ? 'ti ti-check' : 'ti ti-refresh',
            $style.versionIcon,
          ]"
        />
        <span v-if="isUpToDate">最新</span>
      </button>
      <div v-else :class="$style.aboutVersion">v{{ appVersion }}</div>
    </div>

    <!-- アップデートは hero から切り離した独立セクション (VSCode の
         「バッジで気づく → 明示的な行で実行」モデル)。hero にアクションを
         置かないことでチュートリアルとの誤タップも防ぐ -->
    <div v-if="showUpdateSection" :class="$style.formSection">
      <div :class="$style.formSectionLabel">アップデート</div>
      <div :class="$style.sectionBody">
        <div :class="$style.updateRow">
          <i :class="[updateIcon, $style.updateIcon]" />
          <span :class="$style.updateText">
            <template v-if="updateReady">更新の準備ができました</template>
            <template v-else-if="isInstalling">v{{ updateVersion }} をダウンロード中</template>
            <template v-else>{{ appVersion }} → {{ updateVersion }}</template>
          </span>
          <span v-if="isInstalling && downloadProgress !== null" :class="$style.updatePercent">
            {{ downloadProgress }}%
          </span>
          <button
            v-else-if="!isInstalling"
            type="button"
            class="_button"
            :class="$style.updateAction"
            @click="updateReady ? restartToUpdate() : installUpdate()"
          >
            {{ updateReady ? '再起動' : '更新' }}
          </button>
        </div>
        <div v-if="isInstalling" :class="$style.progressTrack">
          <div
            :class="[$style.progressBar, downloadProgress === null && $style.progressIndeterminate]"
            :style="downloadProgress !== null ? { width: `${downloadProgress}%` } : undefined"
          />
        </div>
        <div v-if="updateError" :class="$style.updateError">{{ updateError }}</div>
      </div>
    </div>

    <!-- 開発者モード (#1034)。パレットのトグルコマンドと並ぶ唯一の入口なので、
         off の状態からも見つかる場所に置く。行の型は他の設定と同じスイッチ -->
    <div :class="$style.formSection">
      <div :class="$style.sectionBody">
        <AiSwitchRow
          label="開発者モード"
          icon="ti-code"
          :on="developerMode"
          @toggle="toggleDeveloperMode"
        />
      </div>
    </div>

    <!-- 本家 about-misskey の projectMembers 踏襲 (行の型は formLink に統一)。
         飛び先を Sponsors にすることで寄付導線を兼ねる -->
    <div :class="$style.formSection">
      <div :class="$style.formSectionLabel">開発者</div>
      <div :class="$style.sectionBody">
        <button type="button" class="_button" :class="$style.formLink" @click="openSafeUrl(SPONSOR_URL)">
          <img src="https://github.com/hitalin.png?size=48" :class="$style.devAvatar" alt="" />
          <span>@hitalin</span>
          <span :class="$style.formLinkSuffix">GitHub Sponsors <i class="ti ti-external-link" /></span>
        </button>
      </div>
    </div>

    <!-- 本家 FormSection 踏襲 (DeckServerInfoColumn の formSection と同型) -->
    <div :class="$style.formSection">
      <div :class="$style.infoHead">
        <button
          type="button"
          class="_button"
          :class="[$style.formSectionLabel, $style.infoToggle, infoOpen && $style.infoOpen]"
          @click="infoOpen = !infoOpen"
        >
          バージョン情報
          <i class="ti ti-chevron-down" :class="$style.infoChevron" />
        </button>
        <!-- コピーされる本体はこのセクションの infoRows なのでここに置く -->
        <button
          class="_button"
          :class="[$style.infoCopy, copied && $style.infoCopied]"
          :title="copied ? 'コピーしました' : '情報をコピー'"
          @click="copyInfo"
        >
          <i :class="copied ? 'ti ti-check' : 'ti ti-copy'" />
        </button>
      </div>
      <div v-if="infoOpen" :class="$style.aboutInfo">
        <div v-for="row in infoRows" :key="row.label" :class="$style.aboutRow">
          <span :class="$style.aboutLabel">{{ row.label }}:</span>
          <span :class="$style.aboutValue">{{ row.get() }}</span>
        </div>
      </div>
      <!-- バグ報告はバージョン情報 (と診断結果) を本文に同梱するのでこのセクションに置く -->
      <div :class="$style.sectionBody">
        <button type="button" class="_button" :class="$style.formLink" @click="reportBug">
          <i class="ti ti-bug" :class="$style.formLinkIcon" />
          <span>バグを報告</span>
          <span :class="$style.formLinkSuffix">GitHub Issues <i class="ti ti-external-link" /></span>
        </button>
      </div>
    </div>

    <!-- 自己診断 / 起動パフォーマンスは畳んでおく (バージョン情報と同じ
         infoToggle パターン)。閉じたまま要点が分かるよう、ヘッダ右端に
         ステータス / 合計をバッジ的に出す -->
    <div :class="$style.formSection">
      <div :class="$style.infoHead">
        <button
          type="button"
          class="_button"
          :class="[$style.formSectionLabel, $style.infoToggle, diagOpen && $style.infoOpen]"
          @click="diagOpen = !diagOpen"
        >
          自己診断
          <i class="ti ti-chevron-down" :class="$style.infoChevron" />
        </button>
        <span :class="$style.headBadge">
          <i
            :class="[
              healthLoading ? 'ti ti-loader-2 nd-spin' : healthError ? STATUS_ICON.fail : STATUS_ICON[overallStatus],
              $style.diagIcon,
              !healthLoading && !healthError && $style[overallStatus],
              healthError && $style.fail,
            ]"
          />
          {{ healthSummary }}
        </span>
      </div>
      <div v-if="diagOpen" :class="$style.diag">
        <div :class="$style.diagHead">
          <span :class="$style.diagSummary">{{ problemChecks.length === 0 && !healthError ? '問題は見つかりませんでした' : healthSummary }}</span>
          <button class="_button" :class="$style.diagRefresh" :disabled="healthLoading" title="再診断" @click="runHealthcheck">
            <i class="ti ti-refresh" />
          </button>
        </div>
        <div v-if="healthError" :class="$style.diagError">{{ healthError }}</div>
        <!-- 問題のある行だけを log 言語でシンタックスハイライト (正常時は非表示) -->
        <div
          v-else-if="diagnosticsLog"
          :key="`diag-${highlightRevision}`"
          :class="$style.logBlock"
          v-html="highlightCode(diagnosticsLog, 'log')"
        />
      </div>
    </div>

    <!-- VS Code の Startup Performance 踏襲 (#985/#732)。表示のみ・設定なし。
         「情報をコピー」の本文にも同梱されるので、実機確認 issue やバグ報告に
         そのまま貼れる -->
    <div v-if="startupRows.length > 0" :class="$style.formSection">
      <div :class="$style.infoHead">
        <button
          type="button"
          class="_button"
          :class="[$style.formSectionLabel, $style.infoToggle, startupOpen && $style.infoOpen]"
          @click="startupOpen = !startupOpen"
        >
          起動パフォーマンス
          <i class="ti ti-chevron-down" :class="$style.infoChevron" />
        </button>
        <span v-if="startupTotalMs !== null" :class="[$style.headBadge, $style.startupTotal]">{{ fmtMs(startupTotalMs) }}</span>
      </div>
      <div v-if="startupOpen" :class="$style.startupTable">
        <div :class="[$style.startupRow, $style.startupHeader]" aria-hidden="true">
          <span :class="$style.startupLabel">フェーズ</span>
          <span :class="$style.startupTrack" />
          <span :class="$style.startupDelta">区間</span>
          <span :class="$style.startupAt">累計</span>
        </div>
        <div
          v-for="row in startupRows"
          :key="row.label"
          :class="[$style.startupRow, row.emphasis && $style.startupEmphasis]"
        >
          <span :class="$style.startupLabel">{{ row.label }}</span>
          <span :class="$style.startupTrack">
            <span
              v-if="row.delta !== null"
              :class="$style.startupSeg"
              :style="{ left: row.left, width: row.width }"
            />
          </span>
          <span :class="$style.startupDelta">{{ row.delta !== null ? `+${fmtMs(row.delta)}` : '—' }}</span>
          <span :class="$style.startupAt">{{ row.cum !== null ? fmtMs(row.cum) : '—' }}</span>
        </div>
        <div v-if="webviewFixedCost === null" :class="$style.startupNote">
          WebView 起動はプロセス初回のナビゲーションでのみ計測されます (累計は画面読み込み起点)
        </div>
      </div>
    </div>

    <!-- 実行時パフォーマンス (#732)。metrics.read capability の実測値を
         AI と同じ経路で表示する。開いている間だけ定期更新 -->
    <div :class="$style.formSection">
      <div :class="$style.infoHead">
        <button
          type="button"
          class="_button"
          :class="[$style.formSectionLabel, $style.infoToggle, metricsOpen && $style.infoOpen]"
          @click="metricsOpen = !metricsOpen"
        >
          実行時パフォーマンス
          <i class="ti ti-chevron-down" :class="$style.infoChevron" />
        </button>
        <span v-if="metricsOpen && metrics?.frame.available" :class="$style.headBadge">{{ metrics.frame.fps }}fps</span>
      </div>
      <div v-if="metricsOpen" :class="$style.aboutInfo">
        <div v-if="metricsError" :class="$style.diagError">{{ metricsError }}</div>
        <div v-else-if="!metrics">計測中...</div>
        <template v-else>
          <div v-for="row in metricsRows" :key="row.label" :class="$style.aboutRow">
            <span :class="$style.aboutLabel">{{ row.label }}:</span>
            <span :class="$style.aboutValue">
              <i
                v-if="row.status"
                :class="[STATUS_ICON[row.status], $style.diagIcon, $style[row.status]]"
              />
              {{ row.value }}
            </span>
          </div>
        </template>
      </div>
      <div v-if="metricsOpen" :class="$style.sectionBody">
        <div v-if="metrics && metricsAdvice" :class="$style.metricsAdvice">
          <i
            :class="[STATUS_ICON[metricsAdvice.status], $style.diagIcon, $style[metricsAdvice.status]]"
          />
          <span>{{ metricsAdvice.text }}</span>
        </div>
        <button
          type="button"
          class="_button"
          :class="$style.formLink"
          @click="windowsStore.open('performanceEditor')"
        >
          <i class="ti ti-gauge" :class="$style.formLinkIcon" />
          <span>パフォーマンス設定を開く</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
// ウィンドウ chrome (DeckWindow) の windowBody は overflow: hidden で、
// スクロールは content 側の責務 (NavEditorContent 等と同じ)。
// maxHeight を超えたときに見切れず縦スクロールできるようにする
.aboutContent {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
}

// 本家 about-misskey の hero (container) 踏襲: 中央寄せ、アイコンの下に
// 名前、その下にバージョンを opacity 0.5 で置く
.aboutHero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 20px 16px 12px;
}

.logoBtn {
  display: block;
  border-radius: 10px;
}

.aboutLogo {
  display: block;
  width: 48px;
  height: 48px;
  border-radius: 10px;
}

.beating {
  animation: heartbeat 0.9s ease-in-out;
}

@keyframes heartbeat {
  0%, 100% { transform: scale(1); }
  15% { transform: scale(1.12); }
  30% { transform: scale(0.98); }
  45% { transform: scale(1.18); }
  70% { transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .beating {
    animation: none;
  }
}

// タイトル自体が公式サイトへの導線 (ロゴは鼓動イースターエッグに割り当て済み)
.aboutTitle {
  margin-top: 0.75em;
  color: var(--nd-fg);

  &:hover {
    color: var(--nd-accent);
    text-decoration: underline;
  }
}

.aboutVersion {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.85em;
  color: var(--nd-fg);
  opacity: 0.5;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &.versionOk {
    color: var(--nd-accent);
    opacity: 0.9;
  }
}

.versionIcon {
  font-size: 0.9em;
}

// 更新セクション: formLink と同じ「1 行」の型に揃え、hero には出さない
.updateRow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9em;
}

.updateIcon {
  color: var(--nd-accent);
}

.updateText {
  flex: 1;
  min-width: 0;
  font-variant-numeric: tabular-nums;
}

.updatePercent {
  font-size: 0.85em;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}

.updateAction {
  padding: 4px 12px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent);
  font-weight: bold;
  font-size: 0.85em;
  transition: background var(--nd-duration-base);

  &:hover {
    background: hsl(from var(--nd-accent) h s calc(l + 5));
  }
}

.progressTrack {
  margin-top: 8px;
  height: 2px;
  border-radius: 1px;
  overflow: hidden;
  background: var(--nd-divider);
}

.progressBar {
  height: 100%;
  background: var(--nd-accent);
  transition: width var(--nd-duration-base);
}

// contentLength 不明でパーセントが出せない間は流れるバーで生存を示す
.progressIndeterminate {
  width: 40%;
  animation: about-progress-slide 1.2s ease-in-out infinite;
}

@keyframes about-progress-slide {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}

.updateError {
  margin-top: 6px;
  font-size: 0.8em;
  color: var(--nd-error, var(--nd-love));
}

// 本家 about-misskey の「I ❤ #Misskey」ボタン (MkButton rounded) 踏襲:
// 中央寄せのピル型ボタン。導線が増えてもピルを足すだけにする。
.aboutLinks {
  display: flex;
  justify-content: center;
  gap: 6px;
  padding: 0 16px 16px;
}

// 本家 FormSection 踏襲 (DeckServerInfoColumn の formSection と同型)
.formSection {
  border-top: solid 0.5px var(--nd-divider);
}

.formSectionLabel {
  font-weight: bold;
  padding: 1em 16px 0;
  font-size: 0.85em;
}

// セクション本文の共通余白。行 (formLink) はこの中に置く
.sectionBody {
  padding: 10px 16px 14px;
}

.formLink {
  display: flex;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  padding: 10px 14px;
  background: var(--nd-buttonBg);
  border-radius: var(--nd-radius-sm);
  font-size: 0.9em;
  color: var(--nd-fg);
  text-align: left;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.formLinkIcon {
  margin-right: 0.75em;
  flex-shrink: 0;
  opacity: 0.75;
}

.formLinkSuffix {
  margin-left: auto;
  opacity: 0.7;
  white-space: nowrap;
  flex-shrink: 0;
  font-size: 0.9em;
}

// 開発者行のアバター (formLink 行の高さに合わせた小サイズ)
.devAvatar {
  width: 22px;
  height: 22px;
  border-radius: var(--nd-radius-full);
  margin-right: 0.75em;
  flex-shrink: 0;
}

.infoHead {
  position: relative;
}

// 情報コピー (対象 = このセクションの infoRows)。diagRefresh と同型のアイコンボタン
.infoCopy {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--nd-fg);
  opacity: 0.6;
  padding: 2px 4px;

  &:hover {
    opacity: 1;
  }

  &.infoCopied {
    color: var(--nd-accent);
    opacity: 1;
  }
}

// バージョン情報の折りたたみトグル (DeckServerInfoColumn の rulesToggle と同型)
.infoToggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  color: var(--nd-fg);
  padding-bottom: 1em;

  &.infoOpen .infoChevron {
    transform: rotate(180deg);
  }
}

.infoChevron {
  opacity: 0.6;
  transition: transform var(--nd-duration-slow);
}

// 本家 MkButton (primary rounded) と同じ色使い: accent 背景 + fgOnAccent 太字、
// hover は明度 +5
.pillBtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  border-radius: var(--nd-radius-full);
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent);
  font-weight: bold;
  font-size: 0.85em;
  transition: background var(--nd-duration-base);

  &:hover {
    background: hsl(from var(--nd-accent) h s calc(l + 5));
  }
}

.aboutInfo {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 16px 12px;
  font-size: 0.85em;
  font-family: var(--nd-font-mono);
}

.aboutRow {
  display: flex;
  gap: 8px;
}

.aboutLabel {
  color: var(--nd-fg);
  opacity: 0.5;
  min-width: 72px;
}

.aboutValue {
  color: var(--nd-fg);
  user-select: all;
}

.diag {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 16px 14px;
  font-size: 0.85em;
}

.diagHead {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.diagIcon {
  font-size: 1em;

  &.ok { color: var(--nd-success); }
  &.warn { color: var(--nd-warn); }
  &.fail { color: var(--nd-error); }
}

.diagSummary {
  color: var(--nd-fg);
  font-weight: 600;
}

.diagRefresh {
  position: absolute;
  right: 0;
  background: transparent;
  border: none;
  color: var(--nd-fg);
  opacity: 0.6;
  cursor: pointer;
  padding: 2px 4px;

  &:hover { opacity: 1; }
  &:disabled { opacity: 0.3; cursor: default; }
}

.diagError {
  color: var(--nd-error);
  font-size: 0.9em;
}

// 実測値から設定操作への橋渡し文。数値行 (mono) と区別して通常フォントのまま
.metricsAdvice {
  display: flex;
  gap: 6px;
  align-items: baseline;
  margin-bottom: 8px;
  font-size: 0.85em;
  line-height: 1.5;
  opacity: 0.85;
}

// 折りたたみヘッダ右端のバッジ (診断ステータス / 起動合計)。
// infoCopy と同じ絶対配置で、トグルのクリック領域を妨げない
.headBadge {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  pointer-events: none;
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.75;
}

// 起動合計 (プロセス起動 → デッキ表示)。これが「起動は一瞬」の実測値
.startupTotal {
  font-weight: bold;
  color: var(--nd-accent);
  opacity: 1;
  font-family: var(--nd-font-mono);
  font-variant-numeric: tabular-nums;
}

// 起動パフォーマンス (VS Code Startup Performance の表体裁):
// ヘッダ行 + 薄い行区切り + 行ホバー + ウォーターフォールバー。
// 数値は mono + tabular-nums の右揃え
.startupTable {
  display: flex;
  flex-direction: column;
  margin: 8px 16px 14px;
  font-size: 0.8em;
  border: 1px solid var(--nd-panelBorder);
  border-radius: var(--nd-radius-sm);
  overflow: hidden;
}

.startupRow {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 5px 10px;
  font-family: var(--nd-font-mono);

  & + & {
    border-top: solid 0.5px var(--nd-divider);
  }

  &:not(.startupHeader):hover {
    background: var(--nd-panelHighlight);
  }
}

.startupHeader {
  font-size: 0.9em;
  color: var(--nd-fg);
  opacity: 0.5;
  background: var(--nd-panelHighlight);
}

.startupLabel {
  flex: 0 0 8.5em;
  min-width: 0;
  color: var(--nd-fg);
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// ウォーターフォールのトラック。セグメント位置は全体 (プロセス起動 →
// デッキ表示) に対する割合
.startupTrack {
  position: relative;
  flex: 1;
  min-width: 40px;
  height: 5px;
  border-radius: 2.5px;
  background: var(--nd-divider);
  opacity: 0.9;
}

.startupSeg {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 2.5px;
  background: var(--nd-accent);
}

.startupDelta {
  flex: 0 0 68px;
  text-align: right;
  color: var(--nd-fg);
  opacity: 0.55;
  font-variant-numeric: tabular-nums;
}

.startupAt {
  flex: 0 0 62px;
  text-align: right;
  color: var(--nd-fg);
  font-variant-numeric: tabular-nums;
  user-select: all;
}

// 最終行 (デッキ表示) = ユーザーが操作可能になる点を強調する
.startupEmphasis {
  .startupLabel {
    opacity: 1;
    font-weight: 600;
  }

  .startupAt {
    color: var(--nd-accent);
    font-weight: 600;
  }
}

// 注記は本文フォントのまま (mono は行側にだけ効かせている)
.startupNote {
  padding: 5px 10px 6px;
  border-top: solid 0.5px var(--nd-divider);
  font-size: 0.9em;
  color: var(--nd-fg);
  opacity: 0.5;
}

.logBlock {
  text-align: left;
  font-size: 0.75em;
  line-height: 1.5;
  border-radius: var(--nd-radius-sm);
  border: 1px solid var(--nd-panelBorder);
  overflow: hidden;

  // 面はハイライトの有無とテーマに関係なく揃える (トークン色がダーク固定)
  :global(pre) {
    margin: 0;
    padding: 8px 10px;
    max-height: 200px;
    overflow: auto;
    background: var(--nd-codeEditorBg);
    color: var(--nd-codeEditorFg);
    scrollbar-width: thin;
  }

  :global(code) {
    font-family: var(--nd-font-mono);
    white-space: pre-wrap;
    word-break: break-word;
    user-select: all;
  }
}

</style>

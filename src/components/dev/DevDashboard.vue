<script setup lang="ts">
import { json as jsonLang } from '@codemirror/lang-json'
import {
  computed,
  defineAsyncComponent,
  onMounted,
  onUnmounted,
  ref,
} from 'vue'

/**
 * Dev Dashboard (#977) — ブラウザ (5173) から実行中アプリの内蔵 HTTP サーバー
 * (19820, #940) を覗く開発者ダッシュボード。認証は Vite の dev proxy が
 * tokenPath から Bearer を注入する (vite.config.ts)。
 *
 * external API の dogfooding クライアントを兼ねる: ここで不足を踏んだら、
 * それが 19820 側の次の改善点になる。
 */

interface ApiIndex {
  name?: string
  version?: string
}

interface DeckColumn {
  id: string
  type: string
  accountId: string | null
  active?: boolean
  name?: string | null
}

interface SseRow {
  seq: number
  ts: number
  time: string
  type: string
  data: string
  expanded: boolean
}

// JSON 表示は RawJsonView と同じ CodeMirror でシンタックスハイライトする
const CodeEditor = defineAsyncComponent(
  () => import('@/components/deck/widgets/CodeEditor.vue'),
)
const lang = jsonLang()

const app = ref<ApiIndex | null>(null)
const columns = ref<DeckColumn[]>([])
const health = ref('')
const showHealth = ref(false)
const spec = ref('')
const showSpec = ref(false)

async function toggleSpec() {
  showSpec.value = !showSpec.value
  if (showSpec.value && !spec.value) {
    try {
      const res = await fetch('/api/openapi.json')
      if (res.ok) spec.value = JSON.stringify(await res.json(), null, 2)
    } catch {
      // アプリ未起動 — 次のトグルで再試行
    }
  }
}

// --- 起動計測 (#985) ---
// About ウィンドウにしか出ていなかった startupTrace の露出面。
// 開くたびに取り直す (アプリ再起動をまたいでも古い値を見せない)

interface StartupTrace {
  entries: { name: string; at: number }[]
  webviewFixedCost: number | null
}

const showStartup = ref(false)
const startup = ref<StartupTrace | null>(null)

const startupRows = computed(() => {
  const entries = startup.value?.entries ?? []
  return entries.map((m, i) => ({
    ...m,
    delta: i > 0 ? m.at - (entries[i - 1]?.at ?? 0) : 0,
  }))
})

/** ウォーターフォールバーの正規化基準 (最長区間 = 100%) */
const startupMaxDelta = computed(() =>
  Math.max(1, ...startupRows.value.map((r) => r.delta)),
)

async function toggleStartup() {
  showStartup.value = !showStartup.value
  if (!showStartup.value) return
  try {
    const res = await fetch('/api/startup/trace')
    if (res.ok) startup.value = await res.json()
  } catch {
    // アプリ未起動
  }
}

// --- HEARTBEAT 状態 (#411) ---
// daemon の silent fail 防止機構 (連続失敗 auto-disable) の観測面

interface HeartbeatStatusView {
  mounted: boolean
  running: boolean
  lastTickAt: number | null
  lastTickSource: string | null
  lastOutcome: string | null
  consecutiveFailures: number
  dailyCount: number
  config: {
    enabled: boolean
    intervalMinutes: number
    target: string
    dailyMaxAiRuns: number
  }
}

const showHeartbeat = ref(false)
const heartbeat = ref<HeartbeatStatusView | null>(null)

async function toggleHeartbeat() {
  showHeartbeat.value = !showHeartbeat.value
  if (!showHeartbeat.value) return
  try {
    const res = await fetch('/api/heartbeat/status')
    if (res.ok) heartbeat.value = await res.json()
  } catch {
    // アプリ未起動
  }
}

function relativeTime(epochMs: number | null): string {
  if (epochMs === null) return '—'
  const mins = Math.floor((Date.now() - epochMs) / 60_000)
  if (mins >= 60) return `${Math.floor(mins / 60)} 時間前`
  if (mins >= 1) return `${mins} 分前`
  return 'たった今'
}

// SSE ビューア。EventSource は event: 名ごとの addEventListener が必要で
// 動的な main-{eventType} を受けられないため、fetch + ReadableStream で
// SSE をパースする (Authorization は proxy が注入するので相対 fetch でよい)
const SSE_BUFFER_MAX = 300
const sseRows = ref<SseRow[]>([])
const sseState = ref<'stopped' | 'connecting' | 'open'>('stopped')
const sseFilter = ref('')
const sseCount = ref(0)
const sseTypeCounts = ref<Record<string, number>>({})
const sseRatePerMin = ref(0)
let sseRecentTimes: number[] = []
let sseAbort: AbortController | null = null
let sseSeq = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let statusTimer: ReturnType<typeof setInterval> | null = null

/** 到着数の多い順の種別チップ (クリックでフィルタ適用) */
const sseTopTypes = computed(() =>
  Object.entries(sseTypeCounts.value)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6),
)

function filterByType(type: string) {
  sseFilter.value = type
  connectSse()
}

async function refreshStatus() {
  try {
    const [indexRes, colsRes, healthRes] = await Promise.all([
      fetch('/api'),
      fetch('/api/deck/columns'),
      fetch('/api/health'),
    ])
    if (indexRes.ok) app.value = await indexRes.json()
    if (colsRes.ok) {
      const data: unknown = await colsRes.json()
      if (Array.isArray(data)) columns.value = data as DeckColumn[]
    }
    if (healthRes.ok)
      health.value = JSON.stringify(await healthRes.json(), null, 2)
  } catch {
    // アプリ再起動中など — 次の周期更新で回復する
  }
}

function pushRow(type: string, data: string) {
  sseCount.value++
  sseTypeCounts.value[type] = (sseTypeCounts.value[type] ?? 0) + 1
  const now = Date.now()
  sseRecentTimes.push(now)
  while (sseRecentTimes.length && now - (sseRecentTimes[0] ?? now) > 60_000)
    sseRecentTimes.shift()
  sseRatePerMin.value = sseRecentTimes.length
  sseRows.value.unshift({
    seq: ++sseSeq,
    ts: now,
    time: new Date(now).toLocaleTimeString('ja-JP', { hour12: false }),
    type,
    data,
    expanded: false,
  })
  if (sseRows.value.length > SSE_BUFFER_MAX)
    sseRows.value.length = SSE_BUFFER_MAX
}

async function connectSse() {
  stopSse()
  sseState.value = 'connecting'
  const ctrl = new AbortController()
  sseAbort = ctrl
  const filter = sseFilter.value.trim()
  const url = filter
    ? `/api/events?type=${encodeURIComponent(filter)}`
    : '/api/events'
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    sseState.value = 'open'
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      // SSE はイベント間を空行で区切る。':' 始まり行は keep-alive コメント
      for (;;) {
        const sep = buf.indexOf('\n\n')
        if (sep < 0) break
        const block = buf.slice(0, sep)
        buf = buf.slice(sep + 2)
        let type = 'message'
        const dataLines: string[] = []
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) type = line.slice(6).trim()
          else if (line.startsWith('data:'))
            dataLines.push(line.slice(5).trim())
        }
        if (dataLines.length) pushRow(type, dataLines.join('\n'))
      }
    }
    throw new Error('stream closed')
  } catch {
    if (ctrl.signal.aborted) return // 手動停止
    // アプリ再起動等による切断 — 少し待って自動再接続
    sseState.value = 'connecting'
    reconnectTimer = setTimeout(connectSse, 3000)
  }
}

function stopSse() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  sseAbort?.abort()
  sseAbort = null
  sseState.value = 'stopped'
}

function clearSse() {
  sseRows.value = []
  sseCount.value = 0
  sseTypeCounts.value = {}
  sseRecentTimes = []
  sseRatePerMin.value = 0
}

/** バッファを古い順の JSON Lines でダウンロード (バグ報告への添付用) */
function exportSse() {
  const lines = [...sseRows.value].reverse().map((r) =>
    JSON.stringify({
      time: r.time,
      type: r.type,
      data: tryParseJson(r.data),
    }),
  )
  downloadText(`sse-events-${Date.now()}.jsonl`, lines.join('\n'))
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'application/x-ndjson' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function toggleRow(row: SseRow) {
  row.expanded = !row.expanded
}

function prettyData(row: SseRow): string {
  try {
    return JSON.stringify(JSON.parse(row.data), null, 2)
  } catch {
    return row.data
  }
}

// --- Capabilities 実行盤 ---
// external principal として dispatcher を通る = 権限ゲート (#712) と
// 確認ダイアログの実挙動をそのまま目視テストできる

interface Capability {
  id: string
  name: string
  label: string
  category: string
  description: string
  params: Record<string, unknown>
  returns: unknown
  permissions: string[]
  requiresConfirmation: boolean
}

const capabilities = ref<Capability[]>([])
const selectedCapId = ref('')
const selectedCap = computed(
  () => capabilities.value.find((c) => c.id === selectedCapId.value) ?? null,
)
const capParams = ref('{}')
const capResult = ref('')
const capStatus = ref<number | null>(null)
const capRunning = ref(false)
const capCategories = computed(() => {
  const map = new Map<string, Capability[]>()
  for (const c of capabilities.value) {
    const list = map.get(c.category) ?? []
    list.push(c)
    map.set(c.category, list)
  }
  return [...map.entries()]
})

async function loadCapabilities() {
  try {
    const res = await fetch('/api/capabilities')
    if (res.ok) {
      const data: unknown = await res.json()
      if (Array.isArray(data)) capabilities.value = data as Capability[]
    }
  } catch {
    // アプリ未起動
  }
}

function onSelectCap() {
  capResult.value = ''
  capStatus.value = null
  capParams.value = '{}'
}

// 実行履歴 (直近 20 件)。クリックで結果を呼び戻せる
interface CapHistoryEntry {
  seq: number
  time: string
  capId: string
  status: number | null
  result: string
}

const CAP_HISTORY_MAX = 20
const capHistory = ref<CapHistoryEntry[]>([])
let capHistSeq = 0

function restoreCapHistory(entry: CapHistoryEntry) {
  if (capabilities.value.some((c) => c.id === entry.capId))
    selectedCapId.value = entry.capId
  capStatus.value = entry.status
  capResult.value = entry.result
}

async function executeCap() {
  const cap = selectedCap.value
  if (!cap || capRunning.value) return
  capRunning.value = true
  capResult.value = ''
  capStatus.value = null
  try {
    const parsed: unknown = capParams.value.trim()
      ? JSON.parse(capParams.value)
      : null
    const res = await fetch(
      `/api/capabilities/${encodeURIComponent(cap.id)}/execute`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      },
    )
    capStatus.value = res.status
    capResult.value = JSON.stringify(await res.json(), null, 2)
  } catch (e) {
    capResult.value = String(e)
  } finally {
    capRunning.value = false
    capHistory.value.unshift({
      seq: ++capHistSeq,
      time: new Date().toLocaleTimeString('ja-JP', { hour12: false }),
      capId: cap.id,
      status: capStatus.value,
      result: capResult.value,
    })
    if (capHistory.value.length > CAP_HISTORY_MAX)
      capHistory.value.length = CAP_HISTORY_MAX
  }
}

// --- principal 別実効権限 (#712) ---
// 実行盤で 403 が返ったとき「なぜ deny か」をその場で照合するための
// 読み取りマトリクス。選択中 capability の要求キー行をハイライトする

interface ResolvedPermissions {
  keys: string[]
  principals: Record<string, Record<string, boolean>>
}

const PERM_PRINCIPALS = ['ai.chat', 'ai.heartbeat', 'plugin', 'external']

const showPerms = ref(false)
const perms = ref<ResolvedPermissions | null>(null)

async function togglePerms() {
  showPerms.value = !showPerms.value
  if (!showPerms.value) return
  try {
    const res = await fetch('/api/permissions/resolved')
    if (res.ok) perms.value = await res.json()
  } catch {
    // アプリ未起動
  }
}

// --- Rust ログ tail ---
// /dev/logs は Vite dev server の面 (vite.config.ts)。tracing の
// 日次ローテートログを SSE で流してくる。イベント名なしなので EventSource でよい

interface LogRow {
  seq: number
  ts: number
  line: string
  level: 'error' | 'warn' | 'info' | 'debug'
}

const LOG_BUFFER_MAX = 500
const logRows = ref<LogRow[]>([])
const logState = ref<'stopped' | 'connecting' | 'open'>('stopped')
const logFilter = ref('')
const logWarnOnly = ref(false)
let logEs: EventSource | null = null
let logSeq = 0

// tracing 行頭の ISO タイムスタンプ (統合タイムラインのソート基準)
const LOG_ISO_RE = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)/

// --- 統合タイムライン ---
// Rust ログ (SSE tail) + Rust イベントバス (SSE) + フロント in-app ログを
// 単一時系列にマージし、「どの層でイベントが消えたか」を 1 画面で追う

interface FrontLogEntry {
  at: number
  level: 'warn' | 'error'
  scope?: string
  message: string
}

interface UnifiedRow {
  key: string
  ts: number
  source: 'rust' | 'sse' | 'front'
  label: string
  text: string
  level: 'error' | 'warn' | 'info' | 'debug'
}

const timelineSources = ref({ rust: true, sse: true, front: true })
const frontRows = ref<FrontLogEntry[]>([])
let frontTimer: ReturnType<typeof setInterval> | null = null

// --- 見た目まわり (#977 UI 磨き) ---

/** SSE 流量スパークライン用の 1 秒 tick (バケット再計算の駆動) */
const nowTick = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null

const SPARK_BUCKETS = 30
const SPARK_BUCKET_MS = 2000

/** 直近 60 秒の到着数を 2 秒バケットに畳んだ正規化列 (0..1) */
const sparkBars = computed(() => {
  const now = nowTick.value
  const buckets = new Array(SPARK_BUCKETS).fill(0) as number[]
  for (const t of sseRecentTimes) {
    const idx = SPARK_BUCKETS - 1 - Math.floor((now - t) / SPARK_BUCKET_MS)
    if (idx >= 0 && idx < SPARK_BUCKETS) buckets[idx] = (buckets[idx] ?? 0) + 1
  }
  const max = Math.max(1, ...buckets)
  return buckets.map((n) => n / max)
})

/** イベント種別 → 安定した色相 (同じ種別は常に同じ色で追える) */
function typeColor(type: string): string {
  let h = 0
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) % 360
  return `hsl(${h} 65% 62%)`
}

async function refreshFrontLogs() {
  try {
    const res = await fetch('/api/logs/recent')
    if (res.ok) {
      const data: unknown = await res.json()
      if (Array.isArray(data)) frontRows.value = data as FrontLogEntry[]
    }
  } catch {
    // アプリ再起動中など — 次の周期更新で回復する
  }
}

const unifiedRows = computed<UnifiedRow[]>(() => {
  const q = logFilter.value.trim().toLowerCase()
  const warnOnly = logWarnOnly.value
  const src = timelineSources.value
  const rows: UnifiedRow[] = []
  if (src.rust) {
    for (const r of logRows.value)
      rows.push({
        key: `r${r.seq}`,
        ts: r.ts,
        source: 'rust',
        label: r.level.toUpperCase(),
        text: r.line,
        level: r.level,
      })
  }
  if (src.sse) {
    for (const r of sseRows.value)
      rows.push({
        key: `s${r.seq}`,
        ts: r.ts,
        source: 'sse',
        label: r.type,
        text: r.data,
        level: 'info',
      })
  }
  if (src.front) {
    for (const [i, e] of frontRows.value.entries()) {
      rows.push({
        key: `f${e.at}-${i}`,
        ts: e.at,
        source: 'front',
        label: e.level.toUpperCase(),
        text: (e.scope ? `[${e.scope}] ` : '') + e.message,
        level: e.level,
      })
    }
  }
  const filtered = rows.filter((r) => {
    if (warnOnly && r.level !== 'error' && r.level !== 'warn') return false
    return (
      !q ||
      r.text.toLowerCase().includes(q) ||
      r.label.toLowerCase().includes(q)
    )
  })
  filtered.sort((a, b) => b.ts - a.ts)
  return filtered.slice(0, LOG_BUFFER_MAX)
})

function detectLevel(line: string): LogRow['level'] {
  const m = line.match(/\b(ERROR|WARN|INFO|DEBUG|TRACE)\b/)
  const level = m?.[1]?.toLowerCase()
  if (level === 'error' || level === 'warn' || level === 'debug') return level
  return 'info'
}

function connectLogs() {
  stopLogs()
  logState.value = 'connecting'
  const es = new EventSource('/dev/logs')
  logEs = es
  es.onopen = () => {
    logState.value = 'open'
  }
  es.onmessage = (e) => {
    const iso = e.data.match(LOG_ISO_RE)?.[1]
    logRows.value.unshift({
      seq: ++logSeq,
      ts: iso ? Date.parse(iso) : Date.now(),
      line: e.data,
      level: detectLevel(e.data),
    })
    if (logRows.value.length > LOG_BUFFER_MAX)
      logRows.value.length = LOG_BUFFER_MAX
  }
  es.onerror = () => {
    // EventSource は自動再接続する
    logState.value = 'connecting'
  }
}

function stopLogs() {
  logEs?.close()
  logEs = null
  logState.value = 'stopped'
}

function clearLogs() {
  logRows.value = []
}

// --- キャッシュ観測 (#987) / Query Bridge トレース / Inspector 突き合わせ ---

interface CacheStat {
  name: string
  size: number
  limit: number
}

const showCaches = ref(false)
const caches = ref<CacheStat[]>([])

async function toggleCaches() {
  showCaches.value = !showCaches.value
  if (!showCaches.value) return
  try {
    const res = await fetch('/api/perf/caches')
    if (res.ok) {
      const data: unknown = await res.json()
      if (Array.isArray(data)) caches.value = data as CacheStat[]
    }
  } catch {
    // アプリ未起動
  }
}

interface QbTraceRow {
  at: number
  type: string
  ms: number
  error: boolean
}

const showQbTrace = ref(false)
const qbTrace = ref<QbTraceRow[]>([])

async function toggleQbTrace() {
  showQbTrace.value = !showQbTrace.value
  if (!showQbTrace.value) return
  try {
    const res = await fetch('/api/querybridge/trace')
    if (res.ok) {
      const data: unknown = await res.json()
      if (Array.isArray(data)) qbTrace.value = data as QbTraceRow[]
    }
  } catch {
    // アプリ未起動
  }
}

interface InspectorRecent {
  total: number
  counts: Record<string, number>
  oldestTs: number | null
}

const showInspector = ref(false)
const inspector = ref<InspectorRecent | null>(null)

async function toggleInspector() {
  showInspector.value = !showInspector.value
  if (!showInspector.value) return
  try {
    const res = await fetch('/api/inspector/recent')
    if (res.ok) inspector.value = await res.json()
  } catch {
    // アプリ未起動
  }
}

onMounted(() => {
  refreshStatus()
  statusTimer = setInterval(refreshStatus, 5000)
  connectSse()
  loadCapabilities()
  connectLogs()
  refreshFrontLogs()
  frontTimer = setInterval(refreshFrontLogs, 3000)
  // スパークラインの時間窓を進め、静かな期間も流量表示を減衰させる
  tickTimer = setInterval(() => {
    nowTick.value = Date.now()
    while (
      sseRecentTimes.length &&
      nowTick.value - (sseRecentTimes[0] ?? 0) > 60_000
    )
      sseRecentTimes.shift()
    sseRatePerMin.value = sseRecentTimes.length
  }, 1000)
})

onUnmounted(() => {
  if (statusTimer) clearInterval(statusTimer)
  if (frontTimer) clearInterval(frontTimer)
  if (tickTimer) clearInterval(tickTimer)
  stopSse()
  stopLogs()
})
</script>

<template>
  <div :class="$style.dashboard">
    <header :class="$style.header">
      <img
        src="/favicon.svg"
        alt=""
        :class="[$style.logo, sseState === 'open' && $style.logoLive]"
      />
      <div :class="$style.headText">
        <h1 :class="$style.title">
          NoteDeck <span :class="$style.titleAccent">Dev Dashboard</span>
        </h1>
        <p :class="$style.subtitle">
          <span :class="[$style.led, sseState === 'open' && $style.ledOpen]" />
          <span :class="$style.mono">{{ sseState === 'open' ? 'LIVE' : sseState.toUpperCase() }}</span>
          · 127.0.0.1:19820<template v-if="app?.version"> · v{{ app.version }}</template>
        </p>
      </div>
      <nav :class="$style.links">
        <a href="/api/docs" target="_blank" rel="noopener">
          <i class="ti ti-book-2" /> API ドキュメント
        </a>
      </nav>
    </header>

    <div :class="$style.grid">
      <section :class="[$style.panel, $style.gridDeck]">
        <h2 :class="$style.panelTitle">
          <i class="ti ti-layout-columns" :class="$style.panelIcon" />
          デッキ状態 — カラム {{ columns.length }} 本
        </h2>
        <div :class="$style.tableWrap">
          <table :class="$style.table">
            <thead>
              <tr><th>type</th><th>id</th><th>account</th></tr>
            </thead>
            <tbody>
              <tr v-for="col in columns" :key="col.id">
                <td>{{ col.type }}</td>
                <td :class="$style.mono">{{ col.id }}</td>
                <td :class="$style.mono">{{ col.accountId ?? '(cross-account)' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <button
          type="button"
          :class="$style.summary"
          @click="showHealth = !showHealth"
        >
          <i :class="showHealth ? 'ti ti-chevron-down' : 'ti ti-chevron-right'" />
          /api/health raw
        </button>
        <CodeEditor
          v-if="showHealth && health"
          :model-value="health"
          :language="lang"
          read-only
          auto-height
        />
        <button type="button" :class="$style.summary" @click="toggleSpec">
          <i :class="showSpec ? 'ti ti-chevron-down' : 'ti ti-chevron-right'" />
          /api/openapi.json
        </button>
        <CodeEditor
          v-if="showSpec && spec"
          :model-value="spec"
          :language="lang"
          read-only
          max-height="48vh"
        />
        <button type="button" :class="$style.summary" @click="toggleStartup">
          <i :class="showStartup ? 'ti ti-chevron-down' : 'ti ti-chevron-right'" />
          起動計測 (#985)
        </button>
        <template v-if="showStartup && startup">
          <p v-if="startup.webviewFixedCost !== null" :class="$style.capDesc">
            WebView 起動固定費 ~{{ startup.webviewFixedCost }}ms
          </p>
          <div :class="$style.tableWrap">
            <table :class="$style.table">
              <thead>
                <tr><th>mark</th><th>at</th><th>+Δ</th><th /></tr>
              </thead>
              <tbody>
                <tr v-for="row in startupRows" :key="row.name">
                  <td :class="$style.mono">{{ row.name }}</td>
                  <td :class="$style.mono">{{ Math.round(row.at) }}ms</td>
                  <td :class="$style.mono">+{{ Math.round(row.delta) }}ms</td>
                  <td :class="$style.barCell">
                    <span
                      :class="$style.bar"
                      :style="{ width: `${(row.delta / startupMaxDelta) * 100}%` }"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
        <button type="button" :class="$style.summary" @click="toggleHeartbeat">
          <i :class="showHeartbeat ? 'ti ti-chevron-down' : 'ti ti-chevron-right'" />
          HEARTBEAT 状態 (#411)
          <i
            v-if="heartbeat?.config.enabled"
            class="ti ti-heartbeat"
            :class="$style.beat"
          />
        </button>
        <div v-if="showHeartbeat && heartbeat" :class="$style.tableWrap">
          <table :class="$style.table">
            <tbody>
              <tr>
                <td>daemon</td>
                <td :class="$style.mono">
                  {{ heartbeat.mounted ? (heartbeat.config.enabled ? 'enabled' : 'disabled') : 'not mounted' }}{{ heartbeat.running ? ' (tick 実行中)' : '' }}
                </td>
              </tr>
              <tr>
                <td>interval / target</td>
                <td :class="$style.mono">{{ heartbeat.config.intervalMinutes }} 分 / {{ heartbeat.config.target }}</td>
              </tr>
              <tr>
                <td>最終 tick</td>
                <td :class="$style.mono">
                  {{ relativeTime(heartbeat.lastTickAt) }}<template v-if="heartbeat.lastTickSource"> ({{ heartbeat.lastTickSource }})</template>
                </td>
              </tr>
              <tr>
                <td>直近の結末</td>
                <td :class="$style.mono">{{ heartbeat.lastOutcome ?? '—' }}</td>
              </tr>
              <tr>
                <td>連続失敗</td>
                <td :class="$style.mono">{{ heartbeat.consecutiveFailures }}</td>
              </tr>
              <tr>
                <td>本日の AI 起動</td>
                <td :class="$style.mono">{{ heartbeat.dailyCount }} / {{ heartbeat.config.dailyMaxAiRuns }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <button type="button" :class="$style.summary" @click="toggleCaches">
          <i :class="showCaches ? 'ti ti-chevron-down' : 'ti ti-chevron-right'" />
          キャッシュ観測 (#987)
        </button>
        <div v-if="showCaches" :class="$style.tableWrap">
          <table v-if="caches.length" :class="$style.table">
            <thead>
              <tr><th>name</th><th>size</th><th>limit</th><th /></tr>
            </thead>
            <tbody>
              <tr v-for="(c, i) in caches" :key="`${c.name}-${i}`">
                <td :class="$style.mono">{{ c.name }}</td>
                <td :class="$style.mono">{{ c.size }}</td>
                <td :class="$style.mono">{{ c.limit }}</td>
                <td :class="$style.barCell">
                  <span
                    :class="[$style.bar, c.size / c.limit > 0.9 && $style.barHot]"
                    :style="{ width: `${Math.min(100, (c.size / Math.max(1, c.limit)) * 100)}%` }"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else :class="$style.capDesc">登録済みキャッシュなし</p>
        </div>
        <button type="button" :class="$style.summary" @click="toggleQbTrace">
          <i :class="showQbTrace ? 'ti ti-chevron-down' : 'ti ti-chevron-right'" />
          Query Bridge トレース
        </button>
        <div v-if="showQbTrace" :class="$style.tableWrap">
          <table v-if="qbTrace.length" :class="$style.table">
            <thead>
              <tr><th>time</th><th>type</th><th>ms</th></tr>
            </thead>
            <tbody>
              <tr v-for="(t, i) in qbTrace" :key="`${t.at}-${i}`">
                <td :class="$style.mono">{{ new Date(t.at).toLocaleTimeString('ja-JP', { hour12: false }) }}</td>
                <td :class="[$style.mono, t.error && $style.logError]">{{ t.type }}</td>
                <td :class="$style.mono">{{ t.ms }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else :class="$style.capDesc">まだ記録なし</p>
        </div>
      </section>

      <section :class="[$style.panel, $style.ssePanel, $style.gridSse]">
        <h2 :class="$style.panelTitle">
          <i class="ti ti-broadcast" :class="$style.panelIcon" />
          SSE ライブビューア (/api/events)
          <span :class="[$style.sseBadge, sseState === 'open' && $style.sseOpen]">{{ sseState }}</span>
          <span :class="$style.sseCount">{{ sseCount }} events</span>
          <span :class="$style.spark" title="直近 60 秒の流量">
            <span
              v-for="(h, i) in sparkBars"
              :key="i"
              :class="$style.sparkBar"
              :style="{ height: `${Math.max(8, h * 100)}%`, opacity: h > 0 ? 1 : 0.25 }"
            />
          </span>
        </h2>
        <div :class="$style.sseControls">
          <input
            v-model="sseFilter"
            :class="$style.filterInput"
            placeholder="type prefix フィルタ (例: note,notification,main-)"
            @keydown.enter="connectSse"
          />
          <button type="button" :class="$style.btn" @click="connectSse">適用 / 再接続</button>
          <button type="button" :class="$style.btn" @click="stopSse">停止</button>
          <button type="button" :class="$style.btn" @click="clearSse">クリア</button>
          <button
            type="button"
            :class="$style.btn"
            :disabled="!sseRows.length"
            title="バッファを JSON Lines でダウンロード"
            @click="exportSse"
          >
            <i class="ti ti-download" /> JSONL
          </button>
        </div>
        <div v-if="sseTopTypes.length" :class="$style.chipRow">
          <span :class="$style.rateChip">{{ sseRatePerMin }}/min</span>
          <button
            v-for="[t, n] in sseTopTypes"
            :key="t"
            type="button"
            :class="$style.typeChip"
            :style="{ color: typeColor(t) }"
            title="クリックでこの種別に絞る"
            @click="filterByType(t)"
          >
            {{ t }} ×{{ n }}
          </button>
        </div>
        <button type="button" :class="$style.summary" @click="toggleInspector">
          <i :class="showInspector ? 'ti ti-chevron-down' : 'ti ti-chevron-right'" />
          Inspector 突き合わせ (アダプタ層 vs SSE)
        </button>
        <div v-if="showInspector" :class="$style.inspectorCompare">
          <div :class="$style.tableWrap">
            <p :class="$style.capDesc">アダプタ層 (Misskey WS raw)</p>
            <table v-if="inspector?.total" :class="$style.table">
              <tbody>
                <tr v-for="(n, kind) in inspector.counts" :key="kind">
                  <td :class="$style.mono">{{ kind }}</td>
                  <td :class="$style.mono">{{ n }}</td>
                </tr>
              </tbody>
            </table>
            <p v-else :class="$style.capDesc">
              バッファ空 — Stream Inspector カラムを開くと流入します
            </p>
          </div>
          <div :class="$style.tableWrap">
            <p :class="$style.capDesc">SSE (Rust イベントバス)</p>
            <table v-if="sseTopTypes.length" :class="$style.table">
              <tbody>
                <tr v-for="[t, n] in sseTopTypes" :key="t">
                  <td :class="$style.mono">{{ t }}</td>
                  <td :class="$style.mono">{{ n }}</td>
                </tr>
              </tbody>
            </table>
            <p v-else :class="$style.capDesc">受信なし</p>
          </div>
        </div>
        <div :class="$style.sseList">
          <div
            v-for="row in sseRows"
            :key="row.seq"
            :class="[$style.sseRow, nowTick - row.ts < 1200 && $style.rowNew]"
          >
            <button
              type="button"
              :class="$style.sseRowHead"
              @click="toggleRow(row)"
            >
              <span :class="$style.sseTime">{{ row.time }}</span>
              <span :class="$style.sseType" :style="{ color: typeColor(row.type) }">{{ row.type }}</span>
              <code :class="$style.sseData">{{ row.data }}</code>
            </button>
            <CodeEditor
              v-if="row.expanded"
              :model-value="prettyData(row)"
              :language="lang"
              read-only
              auto-height
            />
          </div>
          <p v-if="!sseRows.length" :class="$style.sseEmpty">
            イベント待機中 — デッキにノートや通知が流れると表示されます
          </p>
        </div>
      </section>

      <section :class="[$style.panel, $style.gridCaps]">
        <h2 :class="$style.panelTitle">
          <i class="ti ti-bolt" :class="$style.panelIcon" />
          Capabilities 実行盤
          <span :class="$style.sseCount">{{ capabilities.length }} 件</span>
        </h2>
        <select
          v-model="selectedCapId"
          :class="$style.capSelect"
          @change="onSelectCap"
        >
          <option value="" disabled>capability を選択…</option>
          <optgroup
            v-for="[cat, caps] in capCategories"
            :key="cat"
            :label="cat"
          >
            <option v-for="c in caps" :key="c.id" :value="c.id">
              {{ c.id }} — {{ c.label }}
            </option>
          </optgroup>
        </select>
        <template v-if="selectedCap">
          <p :class="$style.capDesc">
            {{ selectedCap.description || selectedCap.label }}
          </p>
          <p :class="$style.capMeta">
            <span
              v-for="p in selectedCap.permissions"
              :key="p"
              :class="$style.permChip"
            >{{ p }}</span>
            <span
              v-if="selectedCap.requiresConfirmation"
              :class="$style.confirmChip"
            >確認ダイアログあり (アプリ側に表示)</span>
          </p>
          <details v-if="Object.keys(selectedCap.params).length">
            <summary :class="$style.summary">params スキーマ</summary>
            <CodeEditor
              :model-value="JSON.stringify(selectedCap.params, null, 2)"
              :language="lang"
              read-only
              auto-height
            />
          </details>
          <CodeEditor v-model="capParams" :language="lang" auto-height />
          <div :class="$style.sseControls">
            <button
              type="button"
              :class="$style.btn"
              :disabled="capRunning"
              @click="executeCap"
            >
              {{ capRunning ? '実行中…' : '実行' }}
            </button>
            <span
              v-if="capStatus !== null"
              :class="[
                $style.capStatus,
                capStatus < 300
                  ? $style.statusOk
                  : capStatus < 500
                    ? $style.statusWarn
                    : $style.statusErr,
              ]"
            >
              HTTP {{ capStatus }}
            </span>
          </div>
          <CodeEditor
            v-if="capResult"
            :model-value="capResult"
            :language="lang"
            read-only
            auto-height
          />
        </template>
        <div v-if="capHistory.length" :class="$style.capHistory">
          <button
            v-for="h in capHistory"
            :key="h.seq"
            type="button"
            :class="$style.capHistoryRow"
            title="クリックで結果を呼び戻す"
            @click="restoreCapHistory(h)"
          >
            <span :class="$style.sseTime">{{ h.time }}</span>
            <span :class="[$style.mono, $style.capHistoryId]">{{ h.capId }}</span>
            <span
              :class="[
                $style.capStatus,
                h.status !== null && h.status < 300
                  ? $style.statusOk
                  : h.status !== null && h.status < 500
                    ? $style.statusWarn
                    : $style.statusErr,
              ]"
            >{{ h.status ?? 'ERR' }}</span>
          </button>
        </div>
        <button type="button" :class="$style.summary" @click="togglePerms">
          <i :class="showPerms ? 'ti ti-chevron-down' : 'ti ti-chevron-right'" />
          principal 別実効権限 (#712)
        </button>
        <div v-if="showPerms && perms" :class="$style.tableWrap">
          <table :class="$style.table">
            <thead>
              <tr>
                <th>permission</th>
                <th v-for="p in PERM_PRINCIPALS" :key="p">{{ p }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="key in perms.keys"
                :key="key"
                :class="selectedCap?.permissions.includes(key) && $style.permRowRelevant"
              >
                <td :class="$style.mono">{{ key }}</td>
                <td
                  v-for="p in PERM_PRINCIPALS"
                  :key="p"
                  :class="perms.principals[p]?.[key] ? $style.permOk : $style.permNo"
                >
                  {{ perms.principals[p]?.[key] ? '✓' : '–' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section :class="[$style.panel, $style.ssePanel, $style.gridLogs]">
        <h2 :class="$style.panelTitle">
          <i class="ti ti-terminal-2" :class="$style.panelIcon" />
          統合タイムライン
          <span :class="[$style.sseBadge, logState === 'open' && $style.sseOpen]">rust: {{ logState }}</span>
        </h2>
        <div :class="$style.sseControls">
          <input
            v-model="logFilter"
            :class="$style.filterInput"
            placeholder="絞り込み (部分一致)"
          />
          <button
            type="button"
            :class="[$style.btn, logWarnOnly && $style.btnActive]"
            title="WARN 以上のみ表示 (SSE イベントも隠れる)"
            @click="logWarnOnly = !logWarnOnly"
          >
            WARN+
          </button>
          <button type="button" :class="$style.btn" @click="connectLogs">再接続</button>
          <button type="button" :class="$style.btn" @click="stopLogs">停止</button>
          <button type="button" :class="$style.btn" @click="clearLogs">クリア</button>
        </div>
        <div :class="$style.chipRow">
          <label
            v-for="(label, key) in { rust: 'Rust ログ', sse: 'SSE', front: 'フロント' }"
            :key="key"
            :class="$style.sourceToggle"
          >
            <input v-model="timelineSources[key]" type="checkbox" />
            {{ label }}
          </label>
        </div>
        <div :class="$style.sseList">
          <div
            v-for="row in unifiedRows"
            :key="row.key"
            :class="[
              $style.logLine,
              nowTick - row.ts < 1200 && $style.rowNew,
              row.level === 'error'
                ? $style.logError
                : row.level === 'warn'
                  ? $style.logWarn
                  : '',
            ]"
          ><span
            :class="[
              $style.sourceBadge,
              row.source === 'sse'
                ? $style.sourceSse
                : row.source === 'front'
                  ? $style.sourceFront
                  : $style.sourceRust,
            ]"
          >{{ row.source }}</span> <span :class="$style.sseTime">{{ new Date(row.ts).toLocaleTimeString('ja-JP', { hour12: false }) }}</span> <span :class="$style.sseType" :style="row.source === 'sse' ? { color: typeColor(row.label) } : undefined">{{ row.label }}</span> {{ row.text }}</div>
          <p v-if="!unifiedRows.length" :class="$style.sseEmpty">
            待機中 — Rust ログ / SSE イベント / フロントログがここに時系列で流れます
          </p>
        </div>
      </section>
    </div>
  </div>
</template>

<style lang="scss" module>
.dashboard {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 24px;
  background: var(--nd-bg);
  color: var(--nd-fg);
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: none;
}

.logo {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  transition: filter 250ms ease-out;
}

.logoLive {
  filter: drop-shadow(0 0 8px color-mix(in srgb, var(--nd-accent) 55%, transparent));
}

.headText {
  flex: 1;
  min-width: 0;
}

.title {
  font-size: 1.25rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--nd-fgHighlighted);
}

.titleAccent {
  color: var(--nd-accent);
}

.subtitle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  opacity: 0.7;
}

.led {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--nd-fg);
  opacity: 0.3;
  flex: none;
  transition: background 150ms ease-out;
}

.ledOpen {
  background: var(--nd-success);
  opacity: 1;
  animation: ledPulse 2s ease-out infinite;
}

@keyframes ledPulse {
  0%,
  100% {
    box-shadow: 0 0 2px var(--nd-success);
  }
  50% {
    box-shadow: 0 0 8px var(--nd-success);
  }
}

.links {
  display: flex;
  gap: 16px;

  a {
    color: var(--nd-accent);
    font-size: 0.85rem;

    &:hover {
      text-decoration: underline;
    }
  }
}

.grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(300px, 1fr) minmax(0, 1.6fr);
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-areas:
    'deck sse'
    'caps logs';
  gap: 16px;
}

.gridDeck {
  grid-area: deck;
}

.gridSse {
  grid-area: sse;
}

.gridCaps {
  grid-area: caps;
}

.gridLogs {
  grid-area: logs;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 14px 16px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius);
  background:
    linear-gradient(var(--nd-panelHighlight), transparent 48px),
    var(--nd-panel);
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--nd-divider) transparent;
  transition: border-color 150ms ease-out;

  &:hover {
    border-color: color-mix(in srgb, var(--nd-accent) 25%, var(--nd-divider));
  }
}

.panelTitle {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--nd-fgHighlighted);
}

.panelIcon {
  color: var(--nd-accent);
  font-size: 1rem;
}

.spark {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 16px;
  margin-left: auto;
  flex: none;
}

.sparkBar {
  width: 3px;
  border-radius: 1px;
  background: var(--nd-accent);
  transition: height 250ms ease-out;
}

.tableWrap {
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;

  th,
  td {
    padding: 4px 8px;
    text-align: left;
    border-bottom: 1px solid var(--nd-divider);
    white-space: nowrap;
  }

  th {
    opacity: 0.6;
    font-weight: 600;
  }
}

.mono {
  font-family: var(--nd-font-mono);
  font-size: 0.75rem;
}

.summary {
  display: flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  border: none;
  background: none;
  color: var(--nd-fg);
  cursor: pointer;
  font-size: 0.8rem;
  opacity: 0.7;

  &:hover {
    opacity: 1;
  }
}

.ssePanel {
  overflow: hidden;
}

.sseBadge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--nd-buttonBg);
  opacity: 0.8;
}

.sseOpen {
  background: var(--nd-success, #6c6);
  color: #fff;
  opacity: 1;
}

.sseCount {
  font-size: 0.75rem;
  font-weight: 400;
  opacity: 0.5;
  font-variant-numeric: tabular-nums;
}

.sseControls {
  display: flex;
  gap: 8px;
  flex: none;
}

.filterInput {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-md);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-family: var(--nd-font-mono);
  font-size: 0.8rem;
  transition: border-color 150ms ease-out;

  &:focus-visible {
    outline: none;
    border-color: var(--nd-focusRing);
  }
}

.btn {
  padding: 6px 12px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-md);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: 0.8rem;
  cursor: pointer;
  transition:
    background 150ms ease-out,
    border-color 150ms ease-out;

  &:hover {
    background: var(--nd-buttonHoverBg, var(--nd-buttonBg));
    border-color: color-mix(in srgb, var(--nd-accent) 35%, var(--nd-divider));
  }

  &:focus-visible {
    outline: 2px solid var(--nd-focusRing);
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
}

.sseList {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  scrollbar-width: thin;
  scrollbar-color: var(--nd-divider) transparent;
}

/* 新着ハイライト: 到着 1 秒間だけ着色し transition で退色する。
   CSS animation だと行挿入のたびに既存行でも再始動してしまうため、
   recency クラス + transition で表現する */
.rowNew {
  background: var(--nd-accentedBg);
}

.sseRow {
  border-bottom: 1px solid var(--nd-divider);
  transition: background 250ms ease-out;
}

.sseRowHead {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  padding: 4px 6px;
  border: none;
  background: none;
  color: var(--nd-fg);
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--nd-buttonBg);
  }
}

.sseTime {
  font-family: var(--nd-font-mono);
  font-size: 0.72rem;
  opacity: 0.5;
  flex: none;
}

.sseType {
  font-family: var(--nd-font-mono);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--nd-accent);
  flex: none;
}

.sseData {
  font-family: var(--nd-font-mono);
  font-size: 0.72rem;
  opacity: 0.75;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sseEmpty {
  padding: 24px;
  text-align: center;
  font-size: 0.85rem;
  opacity: 0.5;
}

.capSelect {
  padding: 6px 10px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-md);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-family: var(--nd-font-mono);
  font-size: 0.8rem;
}

.capDesc {
  font-size: 0.8rem;
  opacity: 0.75;
}

.capMeta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.permChip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--nd-buttonBg);
  font-family: var(--nd-font-mono);
  font-size: 0.7rem;
}

.confirmChip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--nd-warn, #c90);
  color: #fff;
  font-size: 0.7rem;
}

.capStatus {
  align-self: center;
  font-family: var(--nd-font-mono);
  font-size: 0.8rem;
  opacity: 0.7;
}

.logLine {
  padding: 1px 6px;
  font-family: var(--nd-font-mono);
  font-size: 0.72rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  border-bottom: 1px solid var(--nd-divider);
  transition: background 250ms ease-out;
}

.logError {
  color: #f66;
}

.logWarn {
  color: #da3;
}

.permOk {
  color: var(--nd-success, #6c6);
}

.permNo {
  opacity: 0.35;
}

.permRowRelevant {
  background: color-mix(in srgb, var(--nd-accent) 12%, transparent);
}

.btnActive {
  background: var(--nd-accent);
  color: #fff;
  border-color: var(--nd-accent);
}

.chipRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  flex: none;
}

.rateChip {
  font-family: var(--nd-font-mono);
  font-size: 0.7rem;
  opacity: 0.5;
  font-variant-numeric: tabular-nums;
}

.typeChip {
  padding: 2px 8px;
  border: none;
  border-radius: 999px;
  background: var(--nd-buttonBg);
  color: var(--nd-accent);
  font-family: var(--nd-font-mono);
  font-size: 0.7rem;
  cursor: pointer;

  &:hover {
    background: var(--nd-buttonHoverBg, var(--nd-buttonBg));
  }
}

.capHistory {
  display: flex;
  flex-direction: column;
  flex: none;
  max-height: 130px;
  overflow-y: auto;
  border-top: 1px solid var(--nd-divider);
}

.capHistoryRow {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 2px 6px;
  border: none;
  background: none;
  color: var(--nd-fg);
  text-align: left;
  font-size: 0.75rem;
  cursor: pointer;

  &:hover {
    background: var(--nd-buttonBg);
  }
}

.capHistoryId {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sourceToggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  opacity: 0.8;
  cursor: pointer;
  user-select: none;
}

.sourceBadge {
  display: inline-block;
  min-width: 40px;
  text-align: center;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 0.65rem;
  font-weight: 600;
}

.sourceRust {
  background: var(--nd-buttonBg);
  opacity: 0.8;
}

.sourceSse {
  background: color-mix(in srgb, var(--nd-accent) 25%, transparent);
  color: var(--nd-accent);
}

.sourceFront {
  background: color-mix(in srgb, #4a9eda 25%, transparent);
  color: #4a9eda;
}

.inspectorCompare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  flex: none;
  max-height: 40%;
  overflow-y: auto;
}

.barCell {
  width: 30%;
  min-width: 60px;
}

.bar {
  display: block;
  height: 6px;
  min-width: 2px;
  border-radius: 3px;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--nd-accent) 55%, transparent),
    var(--nd-accent)
  );
  transition: width 250ms ease-out;
}

.barHot {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--nd-warn) 55%, transparent),
    var(--nd-warn)
  );
}

.statusOk {
  color: var(--nd-success);
}

.statusWarn {
  color: var(--nd-warn);
}

.statusErr {
  color: var(--nd-error);
}

/* HEARTBEAT 有効時の鼓動 (スプラッシュの nd-heartbeat と同じリズム) */
.beat {
  display: inline-block;
  color: var(--nd-accent);
  animation: beat 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  transform-origin: center;
}

@keyframes beat {
  0%,
  55%,
  100% {
    transform: scale(1);
  }
  10% {
    transform: scale(1.25);
  }
  22% {
    transform: scale(1);
  }
  32% {
    transform: scale(1.12);
  }
  44% {
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ledOpen,
  .beat {
    animation: none;
  }

  .sseRow,
  .logLine {
    transition: none;
  }

  .sparkBar,
  .bar,
  .logo,
  .panel,
  .btn,
  .filterInput {
    transition: none;
  }
}
</style>

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

// SSE ビューア。EventSource は event: 名ごとの addEventListener が必要で
// 動的な main-{eventType} を受けられないため、fetch + ReadableStream で
// SSE をパースする (Authorization は proxy が注入するので相対 fetch でよい)
const SSE_BUFFER_MAX = 300
const sseRows = ref<SseRow[]>([])
const sseState = ref<'stopped' | 'connecting' | 'open'>('stopped')
const sseFilter = ref('')
const sseCount = ref(0)
let sseAbort: AbortController | null = null
let sseSeq = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let statusTimer: ReturnType<typeof setInterval> | null = null

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
  sseRows.value.unshift({
    seq: ++sseSeq,
    time: new Date().toLocaleTimeString('ja-JP', { hour12: false }),
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
  }
}

// --- Rust ログ tail ---
// /dev/logs は Vite dev server の面 (vite.config.ts)。tracing の
// 日次ローテートログを SSE で流してくる。イベント名なしなので EventSource でよい

interface LogRow {
  seq: number
  line: string
  level: 'error' | 'warn' | 'info' | 'debug'
}

const LOG_BUFFER_MAX = 500
const logRows = ref<LogRow[]>([])
const logState = ref<'stopped' | 'connecting' | 'open'>('stopped')
const logFilter = ref('')
let logEs: EventSource | null = null
let logSeq = 0

const filteredLogRows = computed(() => {
  const q = logFilter.value.trim().toLowerCase()
  if (!q) return logRows.value
  return logRows.value.filter((r) => r.line.toLowerCase().includes(q))
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
    logRows.value.unshift({
      seq: ++logSeq,
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

onMounted(() => {
  refreshStatus()
  statusTimer = setInterval(refreshStatus, 5000)
  connectSse()
  loadCapabilities()
  connectLogs()
})

onUnmounted(() => {
  if (statusTimer) clearInterval(statusTimer)
  stopSse()
  stopLogs()
})
</script>

<template>
  <div :class="$style.dashboard">
    <header :class="$style.header">
      <img src="/favicon.svg" alt="" :class="$style.logo" />
      <div :class="$style.headText">
        <h1 :class="$style.title">NoteDeck Dev Dashboard</h1>
        <p :class="$style.subtitle">
          実行中のアプリ (127.0.0.1:19820) に接続中<template v-if="app?.version"> — v{{ app.version }}</template>
        </p>
      </div>
      <nav :class="$style.links">
        <a href="/api/docs" target="_blank" rel="noopener">API ドキュメント</a>
      </nav>
    </header>

    <div :class="$style.grid">
      <section :class="[$style.panel, $style.gridDeck]">
        <h2 :class="$style.panelTitle">デッキ状態 — カラム {{ columns.length }} 本</h2>
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
      </section>

      <section :class="[$style.panel, $style.ssePanel, $style.gridSse]">
        <h2 :class="$style.panelTitle">
          SSE ライブビューア (/api/events)
          <span :class="[$style.sseBadge, sseState === 'open' && $style.sseOpen]">{{ sseState }}</span>
          <span :class="$style.sseCount">{{ sseCount }} events</span>
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
        </div>
        <div :class="$style.sseList">
          <div v-for="row in sseRows" :key="row.seq" :class="$style.sseRow">
            <button
              type="button"
              :class="$style.sseRowHead"
              @click="toggleRow(row)"
            >
              <span :class="$style.sseTime">{{ row.time }}</span>
              <span :class="$style.sseType">{{ row.type }}</span>
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
            <span v-if="capStatus !== null" :class="$style.capStatus">
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
      </section>

      <section :class="[$style.panel, $style.ssePanel, $style.gridLogs]">
        <h2 :class="$style.panelTitle">
          Rust ログ tail (notedeck.log)
          <span :class="[$style.sseBadge, logState === 'open' && $style.sseOpen]">{{ logState }}</span>
        </h2>
        <div :class="$style.sseControls">
          <input
            v-model="logFilter"
            :class="$style.filterInput"
            placeholder="絞り込み (部分一致)"
          />
          <button type="button" :class="$style.btn" @click="connectLogs">再接続</button>
          <button type="button" :class="$style.btn" @click="stopLogs">停止</button>
          <button type="button" :class="$style.btn" @click="clearLogs">クリア</button>
        </div>
        <div :class="$style.sseList">
          <div
            v-for="row in filteredLogRows"
            :key="row.seq"
            :class="[
              $style.logLine,
              row.level === 'error'
                ? $style.logError
                : row.level === 'warn'
                  ? $style.logWarn
                  : '',
            ]"
          >{{ row.line }}</div>
          <p v-if="!filteredLogRows.length" :class="$style.sseEmpty">
            ログ待機中 — アプリ側の tracing 出力がここに流れます
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

.subtitle {
  font-size: 0.8rem;
  opacity: 0.6;
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
  background: var(--nd-panel);
  overflow: auto;
}

.panelTitle {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--nd-fgHighlighted);
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
}

.btn {
  padding: 6px 12px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-md);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: 0.8rem;
  cursor: pointer;

  &:hover {
    background: var(--nd-buttonHoverBg, var(--nd-buttonBg));
  }
}

.sseList {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.sseRow {
  border-bottom: 1px solid var(--nd-divider);
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
}

.logError {
  color: #f66;
}

.logWarn {
  color: #da3;
}
</style>

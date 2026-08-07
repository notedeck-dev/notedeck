<script setup lang="ts">
import { json as jsonLang } from '@codemirror/lang-json'
import { defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue'

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

onMounted(() => {
  refreshStatus()
  statusTimer = setInterval(refreshStatus, 5000)
  connectSse()
})

onUnmounted(() => {
  if (statusTimer) clearInterval(statusTimer)
  stopSse()
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
      <section :class="$style.panel">
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

      <section :class="[$style.panel, $style.ssePanel]">
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
  grid-template-columns: minmax(280px, 1fr) minmax(0, 2fr);
  gap: 16px;
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
</style>

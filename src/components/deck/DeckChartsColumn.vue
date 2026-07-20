<script setup lang="ts">
import {
  Chart,
  type ChartConfiguration,
  type ScriptableContext,
} from 'chart.js'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import type {
  ActiveUsersChart,
  ApRequestChart,
  FederationChart,
  ServerDriveChart,
  ServerNotesChart,
  ServerUsersChart,
} from '@/adapters/types'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import RawJsonView from '@/components/common/RawJsonView.vue'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { useServerImages } from '@/composables/useServerImages'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useServersStore } from '@/stores/servers'
import { AppError } from '@/utils/errors'
import { applyAlpha } from '@/utils/initChart'
// side-effect: Chart.register
import '@/utils/initChart'
import type { ColumnTabDef } from './ColumnTabs.vue'
import ColumnTabs from './ColumnTabs.vue'
import DeckColumn from './DeckColumn.vue'
import DeckHeaderAccount from './DeckHeaderAccount.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const { account, columnThemeVars } = useColumnTheme(() => props.column)
const { serverErrorImageUrl } = useServerImages(() => props.column)
const serversStore = useServersStore()
const serverIconUrl = computed(() => {
  const host = account.value?.host
  if (!host) return undefined
  return serversStore.getServer(host)?.iconUrl ?? undefined
})

type Tab =
  | 'charts'
  | 'active-users'
  | 'federation'
  | 'ap-request'
  | 'notes'
  | 'users'
  | 'drive'
type Span = 'day' | 'hour'
type ViewState = 'loading' | 'ok' | 'error'
type UsersView = 'inc-dec' | 'total'
type NotesView = 'inc-dec' | 'breakdown' | 'total'
type DriveView = 'files' | 'size'

const TAB_DEFS: ColumnTabDef[] = [
  { value: 'charts', label: 'チャート', icon: 'chart-line' },
  { value: 'active-users', label: 'active-users', icon: 'code' },
  { value: 'federation', label: 'federation', icon: 'code' },
  { value: 'ap-request', label: 'ap-request', icon: 'code' },
  { value: 'notes', label: 'notes', icon: 'code' },
  { value: 'users', label: 'users', icon: 'code' },
  { value: 'drive', label: 'drive', icon: 'code' },
]

const activeTab = ref<Tab>('charts')
const span = ref<Span>('hour')
const state = ref<ViewState>('loading')
const errorMessage = ref<string>('サーバー統計を取得できません')

const usersView = ref<UsersView>('inc-dec')
const notesView = ref<NotesView>('inc-dec')
const driveView = ref<DriveView>('files')

const activeUsersRaw = ref<ActiveUsersChart | null>(null)
const federationRaw = ref<FederationChart | null>(null)
const apRequestRaw = ref<ApRequestChart | null>(null)
const notesRaw = ref<ServerNotesChart | null>(null)
const usersRaw = ref<ServerUsersChart | null>(null)
const driveRaw = ref<ServerDriveChart | null>(null)

const activeUsersCanvasRef = useTemplateRef<HTMLCanvasElement>('activeUsersRef')
const federationCanvasRef = useTemplateRef<HTMLCanvasElement>('federationRef')
const apRequestCanvasRef = useTemplateRef<HTMLCanvasElement>('apRequestRef')
const notesCanvasRef = useTemplateRef<HTMLCanvasElement>('notesRef')
const usersCanvasRef = useTemplateRef<HTMLCanvasElement>('usersRef')
const driveCanvasRef = useTemplateRef<HTMLCanvasElement>('driveRef')
// 常に DOM 上に存在する ref。override / IntersectionObserver の起点として使う。
const bodyRef = useTemplateRef<HTMLElement>('bodyRef')

// biome-ignore lint/suspicious/noExplicitAny: chart.js の ChartType union 保持のため
const chartInstances = new Map<string, Chart<any>>()

// Misskey 本家 admin/overview.*.vue の配色を踏襲。
const COLOR_READ = '#3498db'
const COLOR_WRITE = '#2ecc71'
const COLOR_SUCC = '#87e000'
const COLOR_FAIL = '#ff4400'
const COLOR_INBOX = '#00d3ff'
const COLOR_SUB = '#3498db'
const COLOR_PUB = '#e67e22'
const COLOR_LOCAL = '#2b95ff'
const COLOR_REMOTE = '#ff9800'
const COLOR_NORMAL = '#008fff'
const COLOR_REPLY = '#feb019'
const COLOR_RENOTE = '#00e396'
const COLOR_FILE = '#e300db'

/** index 0 = 今日 の配列を {x, y} 化。signMul で正負反転。 */
function formatPoints(
  values: number[],
  unit: Span,
  signMul = 1,
  now: Date = new Date(),
): { x: number; y: number }[] {
  if (unit === 'hour') {
    const base = now.getTime()
    return values.map((v, i) => ({
      x: base - i * 60 * 60 * 1000,
      y: v * signMul,
    }))
  }
  const y0 = now.getFullYear()
  const m0 = now.getMonth()
  const d0 = now.getDate()
  return values.map((v, i) => ({
    x: new Date(y0, m0, d0 - i).getTime(),
    y: v * signMul,
  }))
}

/**
 * canvas 2D の linearGradient を scriptable で返す。本家と同じ上→下フェード。
 * `animation: false` 環境下でも初回描画から確実に適用される。
 * @param topAlpha グラデーション上端の alpha
 * @param bottomAlpha グラデーション下端の alpha
 */
function makeGradient(color: string, topAlpha = 0.95, bottomAlpha = 0.15) {
  // biome-ignore lint/suspicious/noExplicitAny: ScriptableContext union 複雑
  return (ctx: ScriptableContext<any>) => {
    const chart = ctx.chart
    const area = chart.chartArea
    if (!area) return applyAlpha(color, (topAlpha + bottomAlpha) / 2)
    const canvasCtx = chart.ctx as CanvasRenderingContext2D
    const g = canvasCtx.createLinearGradient(0, area.top, 0, area.bottom)
    g.addColorStop(0, applyAlpha(color, topAlpha))
    g.addColorStop(1, applyAlpha(color, bottomAlpha))
    return g
  }
}

// biome-ignore lint/suspicious/noExplicitAny: bar/line + parsing:false の data 型は {x,y}[] を直接受けない
type DatasetCfg = any

function barDataset(
  label: string,
  values: number[],
  color: string,
  signMul = 1,
  opts: { dim?: boolean } = {},
): DatasetCfg {
  // Inc は濃く、Dec (dim) は薄くして Inc/Dec ペアを視覚的にグループ化する。
  const grad = opts.dim
    ? makeGradient(color, 0.5, 0.2)
    : makeGradient(color, 0.95, 0.6)
  return {
    label,
    data: formatPoints(values, span.value, signMul).reverse(),
    parsing: false,
    backgroundColor: grad,
    borderWidth: 0,
    borderRadius: 4,
    barPercentage: 0.7,
    categoryPercentage: 0.5,
    hoverBackgroundColor: applyAlpha(color, opts.dim ? 0.7 : 1),
  }
}

function lineDataset(
  label: string,
  values: number[],
  color: string,
  opts: { fill?: boolean; borderWidth?: number } = {},
): DatasetCfg {
  const fill = opts.fill ?? true
  return {
    type: 'line' as const,
    label,
    data: formatPoints(values, span.value).reverse(),
    parsing: false,
    borderColor: color,
    backgroundColor: fill ? makeGradient(color) : 'transparent',
    borderWidth: opts.borderWidth ?? (fill ? 2 : 2.5),
    pointRadius: 0,
    pointHoverRadius: 4,
    pointHoverBackgroundColor: color,
    pointHoverBorderColor: '#fff',
    pointHoverBorderWidth: 2,
    tension: 0.3,
    fill,
  }
}

interface ConfigOptions {
  stacked?: boolean
  yCallback?: (v: number | string) => string
}

function buildConfig<T extends 'bar' | 'line'>(
  type: T,
  datasets: DatasetCfg[],
  opts: ConfigOptions = {},
  // biome-ignore lint/suspicious/noExplicitAny: bar/line union の options 型推論が過剰で扱いにくいため
): any {
  const stacked = opts.stacked ?? false
  return {
    type,
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 0, right: 6, top: 4, bottom: 0 } },
      scales: {
        x: {
          type: 'time',
          offset: type === 'bar',
          stacked,
          time: {
            unit: span.value === 'hour' ? 'hour' : 'day',
            displayFormats: {
              hour: 'HH:mm',
              day: 'M/d',
              month: 'Y/M',
            },
          },
          grid: { display: false },
          border: { display: false },
          ticks: {
            maxRotation: 0,
            autoSkipPadding: 8,
            font: { size: 10 },
            color: 'rgba(128, 128, 128, 0.7)',
          },
        },
        y: {
          position: 'left',
          stacked,
          beginAtZero: true,
          grid: {
            display: true,
            color: 'rgba(128, 128, 128, 0.12)',
          },
          border: { display: false },
          ticks: (() => {
            const cb =
              opts.yCallback ??
              ((v: number | string) => formatCompactNumber(Number(v)))
            return {
              display: true,
              font: { size: 10 },
              color: 'rgba(128, 128, 128, 0.75)',
              callback: cb,
            }
          })(),
        },
      },
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            font: { size: 11 },
            color: 'rgba(128, 128, 128, 0.95)',
          },
        },
        tooltip: {
          enabled: true,
          mode: 'index',
          intersect: false,
          boxPadding: 6,
          padding: 10,
          cornerRadius: 6,
        },
      },
    },
  }
}

function formatBytesFromKb(kb: number): string {
  const bytes = kb * 1000
  if (bytes < 1000) return `${bytes.toFixed(0)} B`
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} KB`
  if (bytes < 1000 * 1000 * 1000)
    return `${(bytes / 1000 / 1000).toFixed(1)} MB`
  return `${(bytes / 1000 / 1000 / 1000).toFixed(2)} GB`
}

const compactNumberFormat = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** 数値を 1.2K / 3.4M 形式に (narrow column の y 軸/tooltip 用)。 */
function formatCompactNumber(v: number): string {
  if (Math.abs(v) < 1000) return String(v)
  return compactNumberFormat.format(v)
}

// ── セクションごとの chart.js config ビルダー ──────────────────

// biome-ignore lint/suspicious/noExplicitAny: 返却型は bar/line union
function buildActiveUsers(): any | null {
  if (!activeUsersRaw.value) return null
  return buildConfig(
    'bar',
    [
      barDataset('Read', activeUsersRaw.value.read, COLOR_READ),
      barDataset('Write', activeUsersRaw.value.write, COLOR_WRITE),
    ],
    { stacked: true },
  )
}

// biome-ignore lint/suspicious/noExplicitAny: 返却型は bar/line union
function buildFederation(): any | null {
  if (!federationRaw.value) return null
  return buildConfig(
    'line',
    [
      lineDataset('Pub', federationRaw.value.pubActive, COLOR_PUB),
      lineDataset('Sub', federationRaw.value.subActive, COLOR_SUB),
    ],
    { stacked: false },
  )
}

// biome-ignore lint/suspicious/noExplicitAny: 返却型は bar/line union
function buildApRequest(): any | null {
  if (!apRequestRaw.value) return null
  return buildConfig(
    'bar',
    [
      barDataset('Succeeded', apRequestRaw.value.deliverSucceeded, COLOR_SUCC),
      barDataset('Inbox', apRequestRaw.value.inboxReceived, COLOR_INBOX),
      barDataset('Failed', apRequestRaw.value.deliverFailed, COLOR_FAIL, -1),
    ],
    { stacked: false },
  )
}

// biome-ignore lint/suspicious/noExplicitAny: 返却型は bar/line union
function buildUsers(view: UsersView): any | null {
  if (!usersRaw.value) return null
  if (view === 'total') {
    return buildConfig(
      'line',
      [
        lineDataset('Remote', usersRaw.value.remote.total, COLOR_REMOTE, {
          fill: true,
        }),
        lineDataset('Local', usersRaw.value.local.total, COLOR_LOCAL, {
          fill: true,
        }),
      ],
      { stacked: true },
    )
  }
  return buildConfig(
    'bar',
    [
      barDataset('Remote Inc', usersRaw.value.remote.inc, COLOR_REMOTE),
      barDataset('Local Inc', usersRaw.value.local.inc, COLOR_LOCAL),
      barDataset('Remote Dec', usersRaw.value.remote.dec, COLOR_REMOTE, -1, {
        dim: true,
      }),
      barDataset('Local Dec', usersRaw.value.local.dec, COLOR_LOCAL, -1, {
        dim: true,
      }),
    ],
    { stacked: true },
  )
}

// biome-ignore lint/suspicious/noExplicitAny: 返却型は bar/line union
function buildNotes(view: NotesView): any | null {
  if (!notesRaw.value) return null
  if (view === 'breakdown') {
    // local.diffs + remote.diffs の合算を stack 表示 (local/remote 両方を足し合わせる)。
    const d = notesRaw.value
    const sum = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] ?? 0))
    return buildConfig(
      'bar',
      [
        barDataset(
          'Normal',
          sum(d.local.diffs.normal, d.remote.diffs.normal),
          COLOR_NORMAL,
        ),
        barDataset(
          'Reply',
          sum(d.local.diffs.reply, d.remote.diffs.reply),
          COLOR_REPLY,
        ),
        barDataset(
          'Renote',
          sum(d.local.diffs.renote, d.remote.diffs.renote),
          COLOR_RENOTE,
        ),
        barDataset(
          'File',
          sum(d.local.diffs.withFile, d.remote.diffs.withFile),
          COLOR_FILE,
        ),
      ],
      { stacked: true },
    )
  }
  if (view === 'total') {
    return buildConfig(
      'line',
      [
        lineDataset('Remote', notesRaw.value.remote.total, COLOR_REMOTE, {
          fill: true,
        }),
        lineDataset('Local', notesRaw.value.local.total, COLOR_LOCAL, {
          fill: true,
        }),
      ],
      { stacked: true },
    )
  }
  return buildConfig(
    'bar',
    [
      barDataset('Remote Inc', notesRaw.value.remote.inc, COLOR_REMOTE),
      barDataset('Local Inc', notesRaw.value.local.inc, COLOR_LOCAL),
      barDataset('Remote Dec', notesRaw.value.remote.dec, COLOR_REMOTE, -1, {
        dim: true,
      }),
      barDataset('Local Dec', notesRaw.value.local.dec, COLOR_LOCAL, -1, {
        dim: true,
      }),
    ],
    { stacked: true },
  )
}

// biome-ignore lint/suspicious/noExplicitAny: 返却型は bar/line union
function buildDrive(view: DriveView): any | null {
  if (!driveRaw.value) return null
  if (view === 'size') {
    return buildConfig(
      'bar',
      [
        barDataset('Remote Inc', driveRaw.value.remote.incSize, COLOR_REMOTE),
        barDataset('Local Inc', driveRaw.value.local.incSize, COLOR_LOCAL),
        barDataset(
          'Remote Dec',
          driveRaw.value.remote.decSize,
          COLOR_REMOTE,
          -1,
          { dim: true },
        ),
        barDataset('Local Dec', driveRaw.value.local.decSize, COLOR_LOCAL, -1, {
          dim: true,
        }),
      ],
      {
        stacked: true,
        yCallback: (v) => formatBytesFromKb(Number(v)),
      },
    )
  }
  return buildConfig(
    'bar',
    [
      barDataset('Remote Inc', driveRaw.value.remote.incCount, COLOR_REMOTE),
      barDataset('Local Inc', driveRaw.value.local.incCount, COLOR_LOCAL),
      barDataset(
        'Remote Dec',
        driveRaw.value.remote.decCount,
        COLOR_REMOTE,
        -1,
        { dim: true },
      ),
      barDataset('Local Dec', driveRaw.value.local.decCount, COLOR_LOCAL, -1, {
        dim: true,
      }),
    ],
    { stacked: true },
  )
}

function mountChart(
  key: string,
  canvas: HTMLCanvasElement | null,
  // biome-ignore lint/suspicious/noExplicitAny: bar/line union
  config: any | null,
): void {
  if (!canvas || !config) return
  chartInstances.get(key)?.destroy()
  chartInstances.set(key, new Chart(canvas, config as ChartConfiguration))
}

function destroyChart(key: string): void {
  chartInstances.get(key)?.destroy()
  chartInstances.delete(key)
}

function destroyAllCharts(): void {
  for (const chart of chartInstances.values()) chart.destroy()
  chartInstances.clear()
}

function renderAll(): void {
  mountChart('activeUsers', activeUsersCanvasRef.value, buildActiveUsers())
  mountChart('federation', federationCanvasRef.value, buildFederation())
  mountChart('apRequest', apRequestCanvasRef.value, buildApRequest())
  mountChart('users', usersCanvasRef.value, buildUsers(usersView.value))
  mountChart('notes', notesCanvasRef.value, buildNotes(notesView.value))
  mountChart('drive', driveCanvasRef.value, buildDrive(driveView.value))
}

async function fetchAll(): Promise<void> {
  const acc = account.value
  if (!acc) {
    state.value = 'error'
    errorMessage.value = 'アカウントが見つかりません'
    return
  }

  state.value = 'loading'
  destroyAllCharts()

  try {
    const { adapter } = await initAdapterFor(acc.host, acc.id, {
      hasToken: acc.hasToken,
    })
    // narrow column で bar が潰れないよう、span ごとに読める密度に絞る。
    // hour: 48 点 (2 日分) / day: 90 点 (3 か月分)。
    const limit = span.value === 'hour' ? 48 : 90
    const [au, fed, ap, nts, usr, drv] = await Promise.all([
      adapter.api.getActiveUsersChart(span.value, limit),
      adapter.api.getFederationChart(span.value, limit),
      adapter.api.getApRequestChart(span.value, limit),
      adapter.api.getServerNotesChart(span.value, limit),
      adapter.api.getServerUsersChart(span.value, limit),
      adapter.api.getServerDriveChart(span.value, limit),
    ])
    activeUsersRaw.value = au
    federationRaw.value = fed
    apRequestRaw.value = ap
    notesRaw.value = nts
    usersRaw.value = usr
    driveRaw.value = drv
  } catch (e) {
    const err = AppError.from(e)
    // ゲスト / 未ログインで charts/* が制限されているサーバーは AUTH 系の
    // エラーを返すことがある。ログインを促すメッセージに切り替える。
    errorMessage.value = err.isAuth
      ? 'このサーバーのチャートはログインユーザー限定です'
      : 'このサーバーはチャート API を無効にしています'
    state.value = 'error'
    return
  }

  state.value = 'ok'
  await nextTick()
  renderAll()
  // 初期 mount が useColumnMount の shell 状態から復帰した直後だと canvas が
  // 0×0 でレイアウトされる場合がある。次フレームでサイズ確定後に再描画して
  // 「軸だけ出てバーが無い」状態を回避する。
  requestAnimationFrame(redrawAllCharts)
}

const federationStats = computed(() => {
  if (!federationRaw.value) return null
  const sub = federationRaw.value.subActive
  const pub = federationRaw.value.pubActive
  return {
    subActive: sub[0] ?? 0,
    subDiff: (sub[0] ?? 0) - (sub[1] ?? 0),
    pubActive: pub[0] ?? 0,
    pubDiff: (pub[0] ?? 0) - (pub[1] ?? 0),
  }
})

function formatDiff(v: number): string {
  if (v === 0) return '±0'
  return v > 0 ? `+${v}` : `${v}`
}

function prettyJson(v: unknown): string {
  return v ? JSON.stringify(v, null, 2) : ''
}

function redrawAllCharts(): void {
  for (const chart of chartInstances.values()) {
    chart.resize()
    chart.update('none')
  }
}

let visibilityObserver: IntersectionObserver | null = null

onMounted(() => {
  fetchAll()

  // IntersectionObserver で viewport 再突入を検知し、chart を強制再描画。
  // canvas が 0×0 に陥ったケースの safety net (chart.js の resize/update 保証)。
  if (bodyRef.value && 'IntersectionObserver' in window) {
    visibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            requestAnimationFrame(redrawAllCharts)
          }
        }
      },
      { threshold: 0.01 },
    )
    visibilityObserver.observe(bodyRef.value)
  }
})

onBeforeUnmount(() => {
  visibilityObserver?.disconnect()
  visibilityObserver = null
  destroyAllCharts()
})

// accountId / span 変化 → 全 fetch + 全描画
watch(
  () => [props.column.accountId, span.value],
  () => {
    fetchAll()
  },
)

// JSON タブ ↔ チャートタブの切替で .chartsList の display が none↔block に
// なる。chart.js はこの遷移を検知しないため、タブが 'charts' に戻ってきた
// タイミングで強制再描画する。
watch(activeTab, (v) => {
  if (v !== 'charts' || state.value !== 'ok') return
  nextTick(() => requestAnimationFrame(redrawAllCharts))
})

// サブ切替 → 該当セクションだけ再描画 (fetch なし)
watch(usersView, (v) => {
  if (state.value !== 'ok') return
  nextTick(() => {
    destroyChart('users')
    mountChart('users', usersCanvasRef.value, buildUsers(v))
  })
})
watch(notesView, (v) => {
  if (state.value !== 'ok') return
  nextTick(() => {
    destroyChart('notes')
    mountChart('notes', notesCanvasRef.value, buildNotes(v))
  })
})
watch(driveView, (v) => {
  if (state.value !== 'ok') return
  nextTick(() => {
    destroyChart('drive')
    mountChart('drive', driveCanvasRef.value, buildDrive(v))
  })
})
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name || 'チャート'"
    :theme-vars="columnThemeVars"
    require-account
    @refresh="fetchAll"
  >
    <template #header-icon>
      <i class="ti ti-chart-line" />
    </template>

    <template #header-meta>
      <DeckHeaderAccount :account="account" :server-icon-url="serverIconUrl" />
    </template>

    <div ref="bodyRef" :class="$style.body">
      <ColumnTabs
        :tabs="TAB_DEFS"
        :model-value="activeTab"
        scrollable
        compact
        @update:model-value="(v) => (activeTab = v as Tab)"
      />

      <div v-show="activeTab === 'charts'" :class="$style.controlBar">
        <div :class="$style.pillGroup">
          <button
            class="_button"
            :class="[$style.pill, span === 'hour' && $style.pillActive]"
            @click="span = 'hour'"
          >
            時
          </button>
          <button
            class="_button"
            :class="[$style.pill, span === 'day' && $style.pillActive]"
            @click="span = 'day'"
          >
            日
          </button>
        </div>
      </div>

      <div :class="$style.content">
        <div v-if="state === 'loading'" :class="$style.overlay">
          <LoadingSpinner />
        </div>
        <ColumnEmptyState
          v-else-if="state === 'error'"
          :message="errorMessage"
          :image-url="serverErrorImageUrl"
          is-error
          cta-label="再試行"
          cta-icon="ti-refresh"
          @cta="fetchAll"
        />
        <template v-else>
          <!-- Charts tab: 6 sections stacked -->
          <div v-show="activeTab === 'charts'" :class="$style.chartsList">
            <section :class="$style.section">
              <header :class="$style.sectionHeader">
                <span :class="$style.sectionTitle">
                  <i class="ti ti-users" />
                  Active users
                </span>
              </header>
              <div :class="$style.canvasWrap">
                <canvas ref="activeUsersRef" />
              </div>
            </section>

            <section :class="$style.section">
              <header :class="$style.sectionHeader">
                <span :class="$style.sectionTitle">
                  <i class="ti ti-planet" />
                  Federation
                </span>
              </header>
              <div v-if="federationStats" :class="$style.statCards">
                <div :class="$style.statCard">
                  <div :class="$style.statIcon">
                    <i class="ti ti-world-download" />
                  </div>
                  <div :class="$style.statBody">
                    <div :class="$style.statValue">
                      {{ federationStats.subActive.toLocaleString() }}
                      <span
                        :class="[
                          $style.statDiff,
                          federationStats.subDiff > 0 && $style.diffUp,
                          federationStats.subDiff < 0 && $style.diffDown,
                        ]"
                      >
                        {{ formatDiff(federationStats.subDiff) }}
                      </span>
                    </div>
                    <div :class="$style.statLabel">Sub</div>
                  </div>
                </div>
                <div :class="$style.statCard">
                  <div :class="$style.statIcon">
                    <i class="ti ti-world-upload" />
                  </div>
                  <div :class="$style.statBody">
                    <div :class="$style.statValue">
                      {{ federationStats.pubActive.toLocaleString() }}
                      <span
                        :class="[
                          $style.statDiff,
                          federationStats.pubDiff > 0 && $style.diffUp,
                          federationStats.pubDiff < 0 && $style.diffDown,
                        ]"
                      >
                        {{ formatDiff(federationStats.pubDiff) }}
                      </span>
                    </div>
                    <div :class="$style.statLabel">Pub</div>
                  </div>
                </div>
              </div>
              <div :class="$style.canvasWrap">
                <canvas ref="federationRef" />
              </div>
            </section>

            <section :class="$style.section">
              <header :class="$style.sectionHeader">
                <span :class="$style.sectionTitle">
                  <i class="ti ti-arrows-exchange" />
                  AP requests
                </span>
              </header>
              <div :class="$style.canvasWrap">
                <canvas ref="apRequestRef" />
              </div>
            </section>

            <section :class="$style.section">
              <header :class="$style.sectionHeader">
                <span :class="$style.sectionTitle">
                  <i class="ti ti-user-plus" />
                  Users
                </span>
                <div :class="$style.pillGroup">
                  <button
                    class="_button"
                    :class="[$style.pill, usersView === 'inc-dec' && $style.pillActive]"
                    @click="usersView = 'inc-dec'"
                  >
                    Inc/Dec
                  </button>
                  <button
                    class="_button"
                    :class="[$style.pill, usersView === 'total' && $style.pillActive]"
                    @click="usersView = 'total'"
                  >
                    Total
                  </button>
                </div>
              </header>
              <div :class="$style.canvasWrap">
                <canvas ref="usersRef" />
              </div>
            </section>

            <section :class="$style.section">
              <header :class="$style.sectionHeader">
                <span :class="$style.sectionTitle">
                  <i class="ti ti-pencil" />
                  Notes
                </span>
                <div :class="$style.pillGroup">
                  <button
                    class="_button"
                    :class="[$style.pill, notesView === 'inc-dec' && $style.pillActive]"
                    @click="notesView = 'inc-dec'"
                  >
                    Inc/Dec
                  </button>
                  <button
                    class="_button"
                    :class="[$style.pill, notesView === 'breakdown' && $style.pillActive]"
                    @click="notesView = 'breakdown'"
                  >
                    内訳
                  </button>
                  <button
                    class="_button"
                    :class="[$style.pill, notesView === 'total' && $style.pillActive]"
                    @click="notesView = 'total'"
                  >
                    Total
                  </button>
                </div>
              </header>
              <div :class="$style.canvasWrap">
                <canvas ref="notesRef" />
              </div>
            </section>

            <section :class="$style.section">
              <header :class="$style.sectionHeader">
                <span :class="$style.sectionTitle">
                  <i class="ti ti-cloud" />
                  Drive
                </span>
                <div :class="$style.pillGroup">
                  <button
                    class="_button"
                    :class="[$style.pill, driveView === 'files' && $style.pillActive]"
                    @click="driveView = 'files'"
                  >
                    Files
                  </button>
                  <button
                    class="_button"
                    :class="[$style.pill, driveView === 'size' && $style.pillActive]"
                    @click="driveView = 'size'"
                  >
                    Size
                  </button>
                </div>
              </header>
              <div :class="$style.canvasWrap">
                <canvas ref="driveRef" />
              </div>
            </section>
          </div>

          <!-- Raw JSON tabs (one per endpoint) -->
          <div v-show="activeTab === 'active-users'" :class="$style.jsonTab">
            <RawJsonView :json="prettyJson(activeUsersRaw)">
              <template #hint>charts/active-users</template>
            </RawJsonView>
          </div>
          <div v-show="activeTab === 'federation'" :class="$style.jsonTab">
            <RawJsonView :json="prettyJson(federationRaw)">
              <template #hint>charts/federation</template>
            </RawJsonView>
          </div>
          <div v-show="activeTab === 'ap-request'" :class="$style.jsonTab">
            <RawJsonView :json="prettyJson(apRequestRaw)">
              <template #hint>charts/ap-request</template>
            </RawJsonView>
          </div>
          <div v-show="activeTab === 'notes'" :class="$style.jsonTab">
            <RawJsonView :json="prettyJson(notesRaw)">
              <template #hint>charts/notes</template>
            </RawJsonView>
          </div>
          <div v-show="activeTab === 'users'" :class="$style.jsonTab">
            <RawJsonView :json="prettyJson(usersRaw)">
              <template #hint>charts/users</template>
            </RawJsonView>
          </div>
          <div v-show="activeTab === 'drive'" :class="$style.jsonTab">
            <RawJsonView :json="prettyJson(driveRaw)">
              <template #hint>charts/drive</template>
            </RawJsonView>
          </div>
        </template>
      </div>
    </div>
  </DeckColumn>
</template>

<style module lang="scss">
.body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.controlBar {
  display: flex;
  justify-content: flex-end;
  padding: 8px 12px 4px;
  flex-shrink: 0;
}

.content {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chartsList {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 12px 20px;
  display: flex;
  flex-direction: column;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 0;

  & + & {
    border-top: 1px solid var(--nd-divider);
  }

  &:first-child {
    padding-top: 8px;
  }
}

.sectionHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 24px;
}

.sectionTitle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 13px;
  color: var(--nd-fg);
  opacity: 0.9;
  letter-spacing: 0.01em;

  i {
    color: var(--nd-accent);
    font-size: 15px;
  }
}

.pillGroup {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--nd-panel);
  border: 1px solid var(--nd-divider);
  border-radius: 999px;
}

.pill {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  background: transparent;
  color: var(--nd-fg);
  opacity: 0.55;
  min-width: 32px;
  font-weight: 500;

  &:hover {
    opacity: 0.85;
  }
}

.pillActive {
  background: var(--nd-accent);
  color: #fff;
  opacity: 1;
}

.canvasWrap {
  position: relative;
  width: 100%;
  height: 200px;

  canvas {
    width: 100% !important;
    height: 100% !important;
  }
}

.statCards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.statCard {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--nd-panel);
  border-radius: 10px;
}

.statIcon {
  font-size: 22px;
  color: var(--nd-accent);
  opacity: 0.85;
}

.statBody {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.statValue {
  font-size: 20px;
  font-weight: 700;
  color: var(--nd-fg);
  display: flex;
  align-items: baseline;
  gap: 8px;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.statDiff {
  font-size: 11px;
  font-weight: 500;
  opacity: 0.6;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.12);
}

.diffUp {
  color: #2ecc71;
  background: rgba(46, 204, 113, 0.14);
  opacity: 1;
}

.diffDown {
  color: #ff4400;
  background: rgba(255, 68, 0, 0.14);
  opacity: 1;
}

.statLabel {
  font-size: 11px;
  color: var(--nd-fg);
  opacity: 0.55;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.jsonTab {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>

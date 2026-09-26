<script setup lang="ts">
import { Chart, type ChartConfiguration } from 'chart.js'
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import type { UserNotesChart } from '@/adapters/types'
import { i18n } from '@/i18n'
import { useAccountsStore } from '@/stores/accounts'
import { useServersStore } from '@/stores/servers'
import { useThemeStore } from '@/stores/theme'
// side-effect: Chart.register (heatmap に必要な controller/element を登録)
import { applyAlpha, getHeatmapColor } from '@/utils/initChart'
import {
  computeMaxMin,
  formatMatrixData,
  getWeeksConfig,
} from './userActivityHeatmap.utils'

const props = defineProps<{
  accountId: string
  userId: string
}>()

const accountsStore = useAccountsStore()
const serversStore = useServersStore()
const themeStore = useThemeStore()

const rootRef = useTemplateRef<HTMLDivElement>('rootRef')
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasRef')

type ViewState = 'loading' | 'ok' | 'error'
const state = ref<ViewState>('loading')
const serverErrorImageUrl = ref<string | undefined>(undefined)
let chartInstance: Chart | null = null
let resizeObserver: ResizeObserver | null = null
let currentWeeks = 0
let debounceTimer: ReturnType<typeof setTimeout> | null = null

/** 現在のテーマがダークかどうか (本家 store.s.darkMode 相当) */
function isDarkMode(): boolean {
  return themeStore.manualMode != null
    ? themeStore.manualMode === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches
}

async function render(): Promise<void> {
  if (!rootRef.value || !canvasRef.value) return

  const account = accountsStore.accounts.find((a) => a.id === props.accountId)
  if (!account) {
    state.value = 'error'
    return
  }

  state.value = 'loading'
  chartInstance?.destroy()
  chartInstance = null

  const width = rootRef.value.offsetWidth
  const { weeks, aspectRatio } = getWeeksConfig(width)
  currentWeeks = weeks
  const chartLimit = 7 * weeks

  let raw: UserNotesChart
  try {
    const { adapter } = await initAdapterFor(account.host, account.id, {
      pinnedReactions: false,
      hasToken: account.hasToken,
    })
    raw = await adapter.api.getUserNotesChart(props.userId, 'day', chartLimit)
  } catch {
    // yamisskey 等でユーザーがチャート公開を無効にしていると API がエラーを返す。
    // サーバーカスタム画像があれば見せる (本家 Web UI でも notFound/error 画像を出す)
    serverErrorImageUrl.value = serversStore.getServer(
      account.host,
    )?.serverErrorImageUrl
    state.value = 'error'
    return
  }

  const values = raw.inc
  state.value = 'ok'
  // canvas を display:none から可視化するまで待つ。これをしないと
  // canvas.offsetWidth が 0 のまま new Chart() が走り、1×1 描画になる
  await nextTick()
  if (!canvasRef.value) return

  const data = formatMatrixData(values)
  const { max, min } = computeMaxMin(values)
  const color = getHeatmapColor(isDarkMode())
  const marginEachCell = 4

  const config: ChartConfiguration<'matrix'> = {
    type: 'matrix',
    data: {
      datasets: [
        {
          label: i18n.ts._userActivityHeatmap.activity,
          // biome-ignore lint/suspicious/noExplicitAny: chartjs-chart-matrix の型定義が弱いためキャスト
          data: data as any,
          borderWidth: 0,
          borderRadius: 3,
          backgroundColor(c) {
            const v = (c.dataset.data[c.dataIndex] as unknown as { v: number })
              .v
            let a = (v - min) / max
            if (v !== 0) a = Math.max(a, 0.05)
            return applyAlpha(color, a)
          },
          width(c) {
            const area = c.chart.chartArea
            if (!area) return 0
            return (area.right - area.left) / weeks - marginEachCell
          },
          height(c) {
            const area = c.chart.chartArea
            if (!area) return 0
            return (area.bottom - area.top) / 7 - marginEachCell
          },
        },
      ],
    },
    options: {
      aspectRatio,
      layout: { padding: { left: 8, right: 0, top: 0, bottom: 0 } },
      scales: {
        x: {
          type: 'time',
          offset: true,
          position: 'bottom',
          time: {
            unit: 'week',
            round: 'week',
            isoWeekday: 0,
            displayFormats: { day: 'M/d', month: 'Y/M', week: 'M/d' },
          },
          grid: { display: false },
          ticks: { maxRotation: 0, autoSkipPadding: 8 },
        },
        // y は type 未指定で LinearScale がデフォルト適用 (本家 MkHeatmap.vue と同一)
        y: {
          offset: true,
          reverse: true,
          position: 'right',
          grid: { display: false },
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            padding: 1,
            font: { size: 9 },
            callback: (value) =>
              ['', 'Mon', '', 'Wed', '', 'Fri', ''][value as number] ?? '',
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          callbacks: {
            title(ctx) {
              const item = ctx[0]
              if (!item) return ''
              return (
                item.dataset.data[item.dataIndex] as unknown as { d: string }
              ).d
            },
            label(ctx) {
              const v = (
                ctx.dataset.data[ctx.dataIndex] as unknown as { v: number }
              ).v
              return `${v} notes`
            },
          },
        },
      },
    },
  }

  chartInstance = new Chart(canvasRef.value, config)
}

function scheduleResize(): void {
  if (!rootRef.value) return
  const { weeks } = getWeeksConfig(rootRef.value.offsetWidth)
  if (weeks === currentWeeks) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    render()
  }, 100)
}

onMounted(() => {
  render()
  if (rootRef.value) {
    resizeObserver = new ResizeObserver(scheduleResize)
    resizeObserver.observe(rootRef.value)
  }
})

onBeforeUnmount(() => {
  chartInstance?.destroy()
  chartInstance = null
  resizeObserver?.disconnect()
  resizeObserver = null
  if (debounceTimer) clearTimeout(debounceTimer)
})

watch(
  () => [props.accountId, props.userId],
  () => {
    render()
  },
)
</script>

<template>
  <div ref="rootRef" :class="$style.root">
    <header :class="$style.header">
      <i class="ti ti-activity" /> Heatmap
    </header>
    <div :class="$style.canvasWrap">
      <!-- canvas は常時マウント。状態表示は overlay で重ねる -->
      <canvas ref="canvasRef" />
      <div v-if="state !== 'ok'" :class="$style.overlay">
        <span v-if="state === 'loading'">{{ i18n.ts._common.loading }}</span>
        <template v-else-if="state === 'error'">
          <img
            v-if="serverErrorImageUrl"
            :src="serverErrorImageUrl"
            :class="$style.errorImage"
            alt=""
          />
          <span :class="$style.errorText">
            {{ i18n.ts._userActivityHeatmap.unavailable }}
          </span>
        </template>
      </div>
    </div>
  </div>
</template>

<style module lang="scss">
.root {
  padding: 12px 16px;
  width: 100%;
  box-sizing: border-box;
}

.header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 14px;
  color: var(--nd-fg);
  margin-bottom: 8px;

  i {
    color: var(--nd-accent);
  }
}

.canvasWrap {
  position: relative;
  width: 100%;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--nd-panel);
  color: var(--nd-fg);
  opacity: 0.9;
  font-size: 13px;
  pointer-events: none;
}

.errorImage {
  max-width: 160px;
  max-height: 120px;
  object-fit: contain;
}

.errorText {
  opacity: 0.8;
}
</style>

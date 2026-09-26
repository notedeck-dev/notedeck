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
import type { UserPvChart } from '@/adapters/types'
import { i18n } from '@/i18n'
import { useAccountsStore } from '@/stores/accounts'
import { useServersStore } from '@/stores/servers'
// side-effect: Chart.register
import '@/utils/initChart'

const props = defineProps<{
  accountId: string
  userId: string
}>()

const accountsStore = useAccountsStore()
const serversStore = useServersStore()

const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasRef')

type ViewState = 'loading' | 'ok' | 'error'
const state = ref<ViewState>('loading')
const serverErrorImageUrl = ref<string | undefined>(undefined)
let chartInstance: Chart | null = null

const CHART_LIMIT = 30

// Misskey 本家 activity.pv.vue と同じ固定色。
// UPV (Unique PV) は濃色、NPV (Natural PV) は半透明で視覚分離。
const COLOR_USER = '#3498db'
const COLOR_VISITOR = '#2ecc71'
const COLOR_USER_NPV = '#3498db88'
const COLOR_VISITOR_NPV = '#2ecc7188'

function formatBarData(
  values: number[],
  now: Date = new Date(),
): { x: number; y: number }[] {
  const y0 = now.getFullYear()
  const m0 = now.getMonth()
  const d0 = now.getDate()
  return values.map((v, i) => ({
    x: new Date(y0, m0, d0 - i).getTime(),
    y: v,
  }))
}

async function render(): Promise<void> {
  const account = accountsStore.accounts.find((a) => a.id === props.accountId)
  if (!account) {
    state.value = 'error'
    return
  }

  state.value = 'loading'
  chartInstance?.destroy()
  chartInstance = null

  let raw: UserPvChart
  try {
    const { adapter } = await initAdapterFor(account.host, account.id, {
      pinnedReactions: false,
      hasToken: account.hasToken,
    })
    raw = await adapter.api.getUserPvChart(props.userId, 'day', CHART_LIMIT)
  } catch {
    serverErrorImageUrl.value = serversStore.getServer(
      account.host,
    )?.serverErrorImageUrl
    state.value = 'error'
    return
  }

  state.value = 'ok'
  await nextTick()
  if (!canvasRef.value) return

  const makeDataset = (
    label: string,
    values: number[],
    color: string,
    stack: 'u' | 'n',
    // biome-ignore lint/suspicious/noExplicitAny: bar + parsing:false 時の data 型
  ): any => ({
    label,
    data: formatBarData(values).reverse(),
    parsing: false,
    backgroundColor: color,
    borderWidth: 0,
    borderRadius: 4,
    barPercentage: 0.7,
    categoryPercentage: 0.7,
    stack,
  })

  const config: ChartConfiguration<'bar'> = {
    type: 'bar',
    data: {
      datasets: [
        makeDataset('UPV (user)', raw.upv.user, COLOR_USER, 'u'),
        makeDataset('UPV (visitor)', raw.upv.visitor, COLOR_VISITOR, 'u'),
        makeDataset('NPV (user)', raw.pv.user, COLOR_USER_NPV, 'n'),
        makeDataset('NPV (visitor)', raw.pv.visitor, COLOR_VISITOR_NPV, 'n'),
      ],
    },
    options: {
      aspectRatio: 3,
      layout: { padding: { left: 0, right: 8, top: 0, bottom: 0 } },
      scales: {
        x: {
          type: 'time',
          offset: true,
          stacked: true,
          time: {
            unit: 'day',
            displayFormats: { day: 'M/d', month: 'Y/M' },
          },
          grid: { display: false },
          ticks: { maxRotation: 0, autoSkipPadding: 8 },
        },
        y: {
          position: 'left',
          stacked: true,
          suggestedMax: 10,
          grid: { display: true },
          ticks: { display: true },
        },
      },
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        title: {
          display: true,
          text: 'Unique/Natural PV',
          padding: { top: 0, bottom: 12 },
        },
        legend: {
          display: true,
          position: 'bottom',
          labels: { boxWidth: 12, font: { size: 11 } },
        },
        tooltip: { enabled: true, mode: 'index' },
      },
    },
  }

  chartInstance = new Chart(canvasRef.value, config)
}

onMounted(() => {
  render()
})

onBeforeUnmount(() => {
  chartInstance?.destroy()
  chartInstance = null
})

watch(
  () => [props.accountId, props.userId],
  () => {
    render()
  },
)
</script>

<template>
  <div :class="$style.root">
    <header :class="$style.header">
      <i class="ti ti-eye" /> PV
    </header>
    <div :class="$style.canvasWrap">
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
            {{ i18n.ts._userActivityPvChart.unavailable }}
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

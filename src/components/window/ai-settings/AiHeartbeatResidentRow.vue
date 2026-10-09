<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import FormSwitchRow from '@/components/common/form/FormSwitchRow.vue'
import { i18n } from '@/i18n'
import { useClientLayerStore } from '@/stores/clientLayer'

/**
 * 「アプリを終了しても続ける」(#1106 案 B): AI (notemaid) を OS のログイン時タスクとして
 * 常駐させるトグル。利用者にとっての意味は HEARTBEAT の巡回がアプリ終了後も続くことなので、
 * HEARTBEAT の設定の中に置く。下の 1 行は AI が今どこで動いているか (別プロセス / 接続 / 版)。
 * 再起動は要らない。データ面は常にこの端末で動く。
 */

const store = useClientLayerStore()
const busy = ref(false)
const errorMessage = ref('')

onMounted(() => {
  store.start()
  void store.refreshState()
  void store.refreshResident()
})

const state = computed(() => store.state)
const resident = computed(() => store.resident)
const relayed = computed(() => state.value?.backend === 'resident')
const residentOn = computed(() => resident.value?.installed ?? false)
const canToggle = computed(
  () => !busy.value && relayed.value && (resident.value?.available ?? false),
)

/** 今どこで動いているかの 1 行 (状態表示。設定項目ではない) */
const runtimeLine = computed(() => {
  if (!relayed.value) return i18n.ts._aiHeartbeatSection.runtimeEmbedded
  const s = state.value
  if (!s?.connected) {
    return s?.lastError
      ? i18n.tsx._aiHeartbeatSection.runtimeDisconnected({
          reason: s.lastError,
        })
      : i18n.ts._aiHeartbeatSection.runtimeConnecting
  }
  const where = residentOn.value
    ? i18n.ts._aiHeartbeatSection.runtimeResident
    : i18n.ts._aiHeartbeatSection.runtimeChild
  const r = resident.value
  const service =
    r?.installed && !r.active
      ? ` · ${i18n.ts._aiHeartbeatSection.residentStopped}`
      : ''
  const version = s.daemonVersion ? ` · v${s.daemonVersion}` : ''
  return `${where}${service}${version}`
})

async function toggleResident(): Promise<void> {
  if (!canToggle.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    await store.setResident(!residentOn.value)
  } catch (e) {
    errorMessage.value =
      typeof e === 'object' && e !== null && 'message' in e
        ? String((e as { message: unknown }).message)
        : String(e)
    await store.refreshResident()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <FormSwitchRow
    icon="ti-moon-stars"
    :label="busy ? i18n.ts._aiHeartbeatSection.keepRunningSwitching : i18n.ts._aiHeartbeatSection.keepRunning"
    :sub-label="i18n.ts._aiHeartbeatSection.keepRunningDescription"
    :on="residentOn"
    :disabled="!canToggle"
    @toggle="toggleResident"
  />
  <p v-if="relayed && state?.fingerprintMatch === false" :class="$style.warn">
    <i class="ti ti-alert-triangle" />
    {{ i18n.ts._aiHeartbeatSection.versionMismatch }}
  </p>
  <p v-if="resident && !resident.available" :class="$style.hint">
    <i class="ti ti-info-circle" />
    {{ i18n.tsx._aiHeartbeatSection.keepRunningUnavailable({ reason: resident.reason ?? '' }) }}
  </p>
  <p v-else :class="$style.hint">
    <i class="ti" :class="relayed && state?.connected ? 'ti-plug-connected' : 'ti-box'" />
    {{ runtimeLine }}
  </p>
  <p v-if="errorMessage" :class="$style.warn">
    <i class="ti ti-alert-triangle" />
    {{ errorMessage }}
  </p>
</template>

<style lang="scss" module>
@use '@/styles/settingsFields' as *;

.hint {
  @include key-hint;
  font-variant-numeric: tabular-nums;
}

.warn { @include key-warn; }
</style>

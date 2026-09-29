<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { i18n } from '@/i18n'
import { useClientLayerStore } from '@/stores/clientLayer'
import { useToast } from '@/stores/toast'
import AiSettingsSection from './AiSettingsSection.vue'
import AiSwitchRow from './AiSwitchRow.vue'

/**
 * AI をどこで動かしているか (#1106 案 B): アプリの中か、別プロセスの notemaid (子プロセス / 常駐) か。
 * 「アプリを閉じても動かす」はログイン時タスクの登録 / 解除で、再起動は要らない。
 * データ面は常にこの端末で動くので、ここには AI の実行の話しか無い。
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

const badge = computed(() => {
  if (!relayed.value) return i18n.ts._aiRuntime.modeEmbedded
  return state.value?.connected
    ? i18n.ts._aiRuntime.connected
    : i18n.ts._aiRuntime.disconnected
})

const residentSummary = computed(() => {
  const r = resident.value
  if (!r?.available) return ''
  const installed = r.installed
    ? i18n.ts._aiRuntime.residentInstalled
    : i18n.ts._aiRuntime.residentNotInstalled
  const active = r.active
    ? i18n.ts._aiRuntime.residentActive
    : i18n.ts._aiRuntime.residentInactive
  return `${installed} · ${active}${r.detail ? ` (${r.detail})` : ''}`
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

async function copyJournalHint(): Promise<void> {
  try {
    await navigator.clipboard.writeText('journalctl --user -u notemaid -e')
    useToast().show(i18n.ts._aiRuntime.copied, 'success')
  } catch {
    // clipboard が使えない環境では黙る (文言は画面に出ている)
  }
}
</script>

<template>
  <AiSettingsSection
    icon="ti-cpu"
    :title="i18n.ts._aiRuntime.title"
    :badge="badge"
    :badge-icon="relayed ? 'ti-plug-connected' : 'ti-box'"
    :badge-ok="!relayed || (state?.connected ?? false)"
  >
    <p :class="$style.hint">
      {{ relayed ? i18n.ts._aiRuntime.modeResident : i18n.ts._aiRuntime.modeEmbedded }}
      <span v-if="relayed && state?.daemonVersion" :class="$style.version">v{{ state.daemonVersion }}</span>
    </p>
    <p v-if="relayed && state?.fingerprintMatch === false" :class="$style.warn">
      {{ i18n.ts._aiRuntime.fingerprintMismatch }}
    </p>
    <p v-else-if="relayed && !state?.connected && state?.lastError" :class="$style.hint">
      {{ state.lastError }}
    </p>
    <p v-else-if="!relayed && resident?.reason" :class="$style.hint">
      {{ resident.reason }}
    </p>

    <AiSwitchRow
      icon="ti-moon-stars"
      :label="busy ? i18n.ts._aiRuntime.residentSwitching : i18n.ts._aiRuntime.residentToggle"
      :sub-label="i18n.ts._aiRuntime.residentHint"
      :on="residentOn"
      :disabled="!canToggle"
      @toggle="toggleResident"
    />
    <p v-if="resident && !resident.available" :class="$style.hint">
      {{ i18n.tsx._aiRuntime.residentUnavailable({ reason: resident.reason ?? '' }) }}
    </p>
    <p v-else-if="residentSummary" :class="$style.hint">
      {{ i18n.ts._aiRuntime.residentService }}: {{ residentSummary }}
    </p>
    <p v-if="errorMessage" :class="$style.warn">{{ errorMessage }}</p>
    <button v-if="residentOn" class="_button" :class="$style.linkBtn" @click="copyJournalHint">
      <i class="ti ti-clipboard" />
      {{ i18n.ts._aiRuntime.copyJournal }}
    </button>
  </AiSettingsSection>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.hint {
  font-size: 0.8em;
  color: var(--nd-fgMuted);
  line-height: 1.5;
  margin: 0;
}

.version {
  margin-left: 6px;
  font-variant-numeric: tabular-nums;
}

.warn {
  font-size: 0.8em;
  color: var(--nd-error, #ec4137);
  line-height: 1.5;
  margin: 0;
}

.linkBtn {
  @include btn-secondary;
  align-self: flex-start;
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { i18n } from '@/i18n'
import { useClientLayerStore } from '@/stores/clientLayer'
import { useToast } from '@/stores/toast'

/**
 * 「コア」の状態面 (#1106 案 B): AI 系のコマンドを in-process で回しているか、別プロセスの
 * notemaid (子プロセス / 常駐) に中継しているかと、その接続の様子。データ面は常にこの端末で動く。
 * 「アプリを閉じても AI を動かす」トグルはログイン時タスクの登録 / 解除で、再起動は要らない。
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

const modeLabel = computed(() =>
  relayed.value
    ? i18n.ts._coreContent.modeResident
    : i18n.ts._coreContent.modeEmbedded,
)

const connectionLabel = computed(() => {
  if (!relayed.value) return ''
  return state.value?.connected
    ? i18n.ts._coreContent.connected
    : i18n.ts._coreContent.disconnected
})

/** トグルの現在値 = ログイン時タスクが登録されているか */
const residentOn = computed(() => resident.value?.installed ?? false)
const canToggle = computed(
  () => !busy.value && relayed.value && (resident.value?.available ?? false),
)

const residentSummary = computed(() => {
  const r = resident.value
  if (!r?.available) return ''
  const installed = r.installed
    ? i18n.ts._coreContent.residentInstalled
    : i18n.ts._coreContent.residentNotInstalled
  const active = r.active
    ? i18n.ts._coreContent.residentActive
    : i18n.ts._coreContent.residentInactive
  const detail = r.detail ? ` (${r.detail})` : ''
  return `${i18n.ts._coreContent.residentService}: ${installed} · ${active}${detail}`
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
    useToast().show(i18n.ts._coreContent.copied, 'success')
  } catch {
    // clipboard が使えない環境では黙る (文言は画面に出ている)
  }
}
</script>

<template>
  <div :class="$style.content">
    <section :class="$style.section">
      <div :class="$style.sectionHeader">
        <i class="ti ti-server" :class="$style.sectionIcon" />
        <span :class="$style.sectionTitle">{{ i18n.ts._coreContent.current }}</span>
      </div>
      <p :class="$style.mode">
        {{ modeLabel }}
        <span v-if="connectionLabel" :class="[$style.badge, state?.connected ? $style.badgeOk : $style.badgeBad]">{{ connectionLabel }}</span>
        <span v-if="relayed && state?.daemonVersion" :class="$style.hint">({{ state.daemonVersion }})</span>
      </p>
      <p :class="$style.hint">{{ i18n.ts._coreContent.description }}</p>
      <p v-if="relayed && state?.fingerprintMatch === false" :class="$style.warn">
        {{ i18n.ts._coreContent.fingerprintMismatch }}
      </p>
      <p v-if="relayed && state?.lastError" :class="$style.hint">
        {{ state.lastError }}
      </p>
    </section>

    <section :class="$style.section">
      <div :class="$style.sectionHeader">
        <i class="ti ti-moon-stars" :class="$style.sectionIcon" />
        <span :class="$style.sectionTitle">{{ i18n.ts._coreContent.residentTitle }}</span>
      </div>
      <label :class="[$style.toggleRow, !canToggle && $style.toggleDisabled]">
        <input
          type="checkbox"
          :checked="residentOn"
          :disabled="!canToggle"
          @change="toggleResident"
        />
        <span>{{ busy ? i18n.ts._coreContent.residentSwitching : i18n.ts._coreContent.residentToggle }}</span>
      </label>
      <p :class="$style.hint">{{ i18n.ts._coreContent.residentHint }}</p>
      <p v-if="resident && !resident.available" :class="$style.warn">
        {{ i18n.tsx._coreContent.residentUnavailable({ reason: resident.reason ?? '' }) }}
      </p>
      <p v-if="residentSummary" :class="$style.hint">{{ residentSummary }}</p>
      <p v-if="residentOn" :class="$style.hint">{{ i18n.ts._coreContent.lingerHint }}</p>
      <p v-if="errorMessage" :class="$style.warn">{{ errorMessage }}</p>
      <div v-if="residentOn" :class="$style.btnRow">
        <button class="_button" type="button" :class="$style.secondaryBtn" @click="copyJournalHint">
          {{ i18n.ts._coreContent.copyJournal }}
        </button>
      </div>
    </section>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  gap: 16px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sectionHeader {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sectionIcon {
  font-size: 16px;
  color: var(--nd-fgMuted);
}

.sectionTitle {
  font-weight: bold;
  font-size: 0.95em;
  color: var(--nd-fg);
}

.mode {
  margin: 0;
  font-size: 1.05em;
  color: var(--nd-fg);
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge {
  font-size: 0.75em;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--nd-divider);
}

.badgeOk {
  color: var(--nd-accent);
  border-color: var(--nd-accent);
}

.badgeBad {
  color: var(--nd-error, #ec4137);
  border-color: var(--nd-error, #ec4137);
}

.hint {
  font-size: 0.8em;
  color: var(--nd-fgMuted);
  line-height: 1.5;
  margin: 0;
}

.warn {
  font-size: 0.8em;
  color: var(--nd-error, #ec4137);
  line-height: 1.5;
  margin: 0;
}

.btnRow {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.toggleRow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9em;
  color: var(--nd-fg);
  cursor: pointer;
}

.toggleDisabled {
  opacity: 0.6;
  cursor: default;
}

.secondaryBtn {
  @include btn-action;
}
</style>

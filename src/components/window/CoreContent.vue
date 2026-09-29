<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { i18n } from '@/i18n'
import { useClientLayerStore } from '@/stores/clientLayer'
import { useToast } from '@/stores/toast'

/**
 * 「コア」(#1106 案 B): AI をアプリの中で回しているか別プロセスの notemaid に中継しているかと、
 * 「アプリを閉じても動かす」(ログイン時タスク) のトグル。データ面は常にこの端末。
 * 見た目は隣の設定ウィンドウ (バックアップ / 接続) と同じ部品で組む。
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

const modeLabel = computed(() =>
  relayed.value
    ? i18n.ts._coreContent.modeResident
    : i18n.ts._coreContent.modeEmbedded,
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
    useToast().show(i18n.ts._coreContent.copied, 'success')
  } catch {
    // clipboard が使えない環境では黙る (文言は画面に出ている)
  }
}
</script>

<template>
  <div :class="$style.content">
    <!-- AI をどこで回しているか -->
    <div :class="$style.section">
      <div :class="$style.sectionHeader">
        <i class="ti ti-cpu" :class="$style.sectionIcon" />
        <span :class="$style.sectionTitle">{{ i18n.ts._coreContent.current }}</span>
        <span :class="$style.sectionDesc">{{ i18n.ts._coreContent.currentDesc }}</span>
      </div>
      <div :class="$style.statusRow">
        <span :class="$style.statusMain">{{ modeLabel }}</span>
        <span
          v-if="relayed"
          :class="[$style.badge, state?.connected ? $style.badgeOk : $style.badgeBad]"
        >
          {{ state?.connected ? i18n.ts._coreContent.connected : i18n.ts._coreContent.disconnected }}
        </span>
        <span v-if="relayed && state?.daemonVersion" :class="$style.statusSub">v{{ state.daemonVersion }}</span>
      </div>
      <p v-if="relayed && state?.fingerprintMatch === false" :class="$style.warn">
        {{ i18n.ts._coreContent.fingerprintMismatch }}
      </p>
      <p v-else-if="relayed && !state?.connected && state?.lastError" :class="$style.hint">
        {{ state.lastError }}
      </p>
      <p v-else-if="!relayed && resident?.reason" :class="$style.hint">
        {{ resident.reason }}
      </p>
    </div>

    <div :class="$style.divider" />

    <!-- アプリを閉じても動かす -->
    <div :class="$style.section">
      <div :class="$style.sectionHeader">
        <i class="ti ti-moon-stars" :class="$style.sectionIcon" />
        <span :class="$style.sectionTitle">{{ i18n.ts._coreContent.residentTitle }}</span>
        <span :class="$style.sectionDesc">{{ i18n.ts._coreContent.residentDesc }}</span>
      </div>
      <label :class="[$style.toggleRow, !canToggle && $style.toggleDisabled]">
        <input
          type="checkbox"
          :checked="residentOn"
          :disabled="!canToggle"
          @change="toggleResident"
        />
        <span>
          <span :class="$style.toggleLabel">
            {{ busy ? i18n.ts._coreContent.residentSwitching : i18n.ts._coreContent.residentToggle }}
          </span>
          <span :class="$style.toggleHint">{{ i18n.ts._coreContent.residentHint }}</span>
        </span>
      </label>
      <p v-if="resident && !resident.available" :class="$style.hint">
        {{ i18n.tsx._coreContent.residentUnavailable({ reason: resident.reason ?? '' }) }}
      </p>
      <p v-else-if="residentSummary" :class="$style.hint">
        {{ i18n.ts._coreContent.residentService }}: {{ residentSummary }}
      </p>
      <p v-if="errorMessage" :class="$style.warn">{{ errorMessage }}</p>
      <div v-if="residentOn" :class="$style.btnRow">
        <button class="_button" :class="$style.actionBtn" @click="copyJournalHint">
          <i class="ti ti-clipboard" />
          {{ i18n.ts._coreContent.copyJournal }}
        </button>
      </div>
    </div>
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

.sectionDesc {
  font-size: 0.8em;
  color: var(--nd-fgMuted);
}

.statusRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--nd-divider);
  border-radius: 6px;
  background: var(--nd-bg);
}

.statusMain {
  font-size: 0.9em;
  color: var(--nd-fg);
}

.statusSub {
  margin-left: auto;
  font-size: 0.75em;
  color: var(--nd-fgMuted);
  font-variant-numeric: tabular-nums;
}

.badge {
  font-size: 0.72em;
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

.toggleRow {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
  user-select: none;

  input {
    margin: 3px 0 0;
  }
}

.toggleDisabled {
  opacity: 0.6;
  cursor: default;
}

.toggleLabel {
  display: block;
  font-size: 0.9em;
  color: var(--nd-fg);
}

.toggleHint {
  display: block;
  margin-top: 2px;
  font-size: 0.78em;
  color: var(--nd-fgMuted);
  line-height: 1.5;
}

.btnRow {
  display: flex;
  gap: 8px;
}

.actionBtn {
  @include btn-action;
}

.divider {
  height: 1px;
  background: var(--nd-divider);
  margin: 16px 0;
}
</style>

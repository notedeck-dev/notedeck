<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { i18n } from '@/i18n'
import { useClientLayerStore } from '@/stores/clientLayer'
import { useToast } from '@/stores/toast'

/**
 * 「コア」の状態面 (#1106 案 B): AI 系のコマンドをこの端末で回しているか、常駐の
 * notecored に中継しているかと、その接続の様子。データ面は常にこの端末で動く。
 * 構成の切り替えは client.json5 と notecored の CLI で行い、ここでは表示だけ
 * (sidecar の子プロセス化と「アプリを閉じても動かす」トグルは次の段)。
 */

const store = useClientLayerStore()

onMounted(() => {
  store.start()
  void store.refreshState()
})

const state = computed(() => store.state)
const resident = computed(() => state.value?.backend === 'resident')

const modeLabel = computed(() =>
  resident.value
    ? i18n.ts._coreContent.modeResident
    : i18n.ts._coreContent.modeEmbedded,
)

const connectionLabel = computed(() => {
  if (!resident.value) return ''
  return state.value?.connected
    ? i18n.ts._coreContent.connected
    : i18n.ts._coreContent.disconnected
})

async function copyJournalHint(): Promise<void> {
  try {
    await navigator.clipboard.writeText('journalctl --user -u notecored -e')
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
        <span v-if="resident && state?.daemonVersion" :class="$style.hint">({{ state.daemonVersion }})</span>
      </p>
      <p :class="$style.hint">{{ i18n.ts._coreContent.description }}</p>
      <p v-if="resident && state?.fingerprintMatch === false" :class="$style.warn">
        {{ i18n.ts._coreContent.fingerprintMismatch }}
      </p>
      <p v-if="resident && state?.lastError" :class="$style.hint">
        {{ state.lastError }}
      </p>
    </section>

    <section :class="$style.section">
      <div :class="$style.sectionHeader">
        <i class="ti ti-terminal-2" :class="$style.sectionIcon" />
        <span :class="$style.sectionTitle">{{ i18n.ts._coreContent.howToTitle }}</span>
      </div>
      <p :class="$style.hint">{{ i18n.ts._coreContent.howTo }}</p>
      <pre :class="$style.code">notecored service enable
# settings/client.json5: { backend: "resident" }</pre>
      <p :class="$style.hint">{{ i18n.ts._coreContent.lingerHint }}</p>
      <div :class="$style.btnRow">
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

.code {
  margin: 0;
  padding: 8px;
  font-size: 0.8em;
  background: var(--nd-bg);
  border: 1px solid var(--nd-divider);
  border-radius: 6px;
  overflow-x: auto;
  user-select: all;
}

.btnRow {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.secondaryBtn {
  @include btn-action;
}
</style>

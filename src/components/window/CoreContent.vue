<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { i18n } from '@/i18n'
import { useClientLayerStore } from '@/stores/clientLayer'
import { useConfirm } from '@/stores/confirm'
import { useToast } from '@/stores/toast'

/**
 * 「コア」設定 (#1106 段階 3a 順序 7): このデバイスが使うコアを、アプリに埋め込んだ
 * notecore と常駐の notecored の間で切り替える。切替はアプリの再起動で完了する。
 * 文言はすべて Rust の状態面 (coreStatus / clientLayerState) から組む。
 */

const store = useClientLayerStore()
const { confirm } = useConfirm()
const busy = ref(false)
const notice = ref('')
const errorMessage = ref('')

onMounted(() => {
  store.start()
  void store.refreshCore()
})

const core = computed(() => store.core)
const state = computed(() => store.state)
const configured = computed(() => core.value?.configured ?? 'embedded')
const supported = computed(() => core.value?.platformSupported ?? false)
const found = computed(() => !!core.value?.notecoredPath)

const modeLabel = computed(() => {
  if (configured.value === 'resident') return i18n.ts._coreContent.modeResident
  if (configured.value === 'pending-resident')
    return i18n.ts._coreContent.modePending
  return i18n.ts._coreContent.modeEmbedded
})

const connectionLabel = computed(() => {
  if (!state.value || state.value.backend !== 'resident') return ''
  return state.value.connected
    ? i18n.ts._coreContent.connected
    : i18n.ts._coreContent.disconnected
})

function describeError(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as { message: unknown }).message)
  }
  return String(e)
}

async function run(action: () => Promise<string>): Promise<void> {
  busy.value = true
  errorMessage.value = ''
  notice.value = ''
  try {
    notice.value = await action()
  } catch (e) {
    errorMessage.value = describeError(e)
  } finally {
    busy.value = false
    await store.refreshCore()
    await store.refreshState()
  }
}

async function switchToResident(): Promise<void> {
  const ok = await confirm({
    title: i18n.ts._coreContent.switchTitle,
    message: i18n.ts._coreContent.switchMessage,
    okLabel: i18n.ts._coreContent.switchOk,
    type: 'warning',
  })
  if (!ok) return
  await run(async () => {
    const summary = await store.switchToResident()
    return i18n.tsx._coreContent.exportedRestart_plural({
      count: summary.written.length,
    })
  })
}

async function switchToEmbedded(): Promise<void> {
  const ok = await confirm({
    title: i18n.ts._coreContent.backTitle,
    message: i18n.ts._coreContent.backMessage,
    okLabel: i18n.ts._coreContent.backOk,
    type: 'warning',
  })
  if (!ok) return
  await run(async () => {
    const result = await store.switchToEmbedded()
    if (result.remaining.length > 0) {
      return i18n.tsx._coreContent.backRemaining_plural({
        count: result.remaining.length,
      })
    }
    return i18n.tsx._coreContent.importedRestart_plural({
      count: result.imported.length,
    })
  })
}

async function cancelPending(): Promise<void> {
  await run(async () => {
    await store.cancelPending()
    return i18n.ts._coreContent.cancelled
  })
}

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
      </p>
      <p :class="$style.hint">{{ i18n.ts._coreContent.description }}</p>
      <p v-if="state?.backend === 'resident' && state.fingerprintMatch === false" :class="$style.warn">
        {{ i18n.ts._coreContent.fingerprintMismatch }}
      </p>
      <p v-if="state?.backend === 'resident' && state.lastError" :class="$style.hint">
        {{ state.lastError }}
      </p>
      <p v-if="core?.switchError" :class="$style.warn">
        {{ i18n.ts._coreContent.switchFailed }} {{ core.switchError }}
      </p>
    </section>

    <section v-if="!supported" :class="$style.section">
      <p :class="$style.hint">{{ i18n.ts._coreContent.unsupported }}</p>
    </section>

    <template v-else>
      <section :class="$style.section">
        <div :class="$style.sectionHeader">
          <i class="ti ti-package" :class="$style.sectionIcon" />
          <span :class="$style.sectionTitle">{{ i18n.ts._coreContent.binary }}</span>
        </div>
        <p v-if="found" :class="$style.hint">
          <code>{{ core?.notecoredPath }}</code>
          <span v-if="core?.notecoredVersion"> ({{ core.notecoredVersion }})</span>
        </p>
        <template v-else>
          <p :class="$style.hint">{{ i18n.ts._coreContent.notFound }}</p>
          <pre :class="$style.code">nix profile install 'github:notedeck-dev/notedeck#notecored'</pre>
        </template>
      </section>

      <section :class="$style.section">
        <div :class="$style.btnRow">
          <button
            v-if="configured === 'embedded'"
            type="button"
            :class="$style.actionBtn"
            :disabled="busy || !found"
            @click="switchToResident"
          >
            {{ i18n.ts._coreContent.switchOk }}
          </button>
          <template v-else-if="configured === 'pending-resident'">
            <button type="button" :class="$style.actionBtn" :disabled="busy || !found" @click="switchToResident">
              {{ i18n.ts._coreContent.retry }}
            </button>
            <button type="button" :class="$style.secondaryBtn" :disabled="busy" @click="cancelPending">
              {{ i18n.ts._coreContent.cancel }}
            </button>
          </template>
          <button
            v-else
            type="button"
            :class="$style.dangerBtn"
            :disabled="busy || !found"
            @click="switchToEmbedded"
          >
            {{ i18n.ts._coreContent.backOk }}
          </button>
        </div>
        <p v-if="configured === 'pending-resident' && !core?.switchError" :class="$style.hint">
          {{ i18n.ts._coreContent.restartToFinish }}
        </p>
        <p v-if="notice" :class="$style.notice">{{ notice }}</p>
        <p v-if="errorMessage" :class="$style.warn">{{ errorMessage }}</p>
      </section>

      <section v-if="found" :class="$style.section">
        <div :class="$style.sectionHeader">
          <i class="ti ti-stethoscope" :class="$style.sectionIcon" />
          <span :class="$style.sectionTitle">{{ i18n.ts._coreContent.diagnostics }}</span>
        </div>
        <p :class="$style.hint">
          {{ i18n.ts._coreContent.serviceState }}:
          {{ core?.serviceActive ? i18n.ts._coreContent.serviceActive : i18n.ts._coreContent.serviceInactive }}
          · {{ i18n.ts._coreContent.secrets }}:
          {{ core?.secretsPresent ? i18n.ts._coreContent.secretsPresent : i18n.ts._coreContent.secretsAbsent }}
        </p>
        <div :class="$style.btnRow">
          <button type="button" :class="$style.secondaryBtn" @click="copyJournalHint">
            {{ i18n.ts._coreContent.copyJournal }}
          </button>
        </div>
      </section>
    </template>
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

.notice {
  font-size: 0.85em;
  color: var(--nd-fg);
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

// 隣の設定ウィンドウ (バックアップ / キャッシュ / 権限) と同じ見た目に揃える
.actionBtn {
  @include btn-action;
}

.secondaryBtn {
  @include btn-action;
}

.dangerBtn {
  @include btn-danger-ghost;
}
</style>

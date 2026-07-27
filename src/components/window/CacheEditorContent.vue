<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useConfirm } from '@/stores/confirm'
import { usePerformanceStore } from '@/stores/performance'
import { useSettingsStore } from '@/stores/settings'
import {
  type EvictionPreset,
  PRESET_OPTIONS,
  resolveEvictionConfig,
} from '@/utils/cacheEviction'
import { commands, unwrap } from '@/utils/tauriInvoke'

const { confirm } = useConfirm()
const settingsStore = useSettingsStore()

// --- 統計表示 ---
const noteCount = ref<number | null>(null)
const dbBytes = ref<number | null>(null)
const imageBytes = ref<number | null>(null)
const imageFiles = ref<number | null>(null)
const isClearing = ref(false)
const isClearingImages = ref(false)
const errorMessage = ref('')

// 画像キャッシュの上限は performance 設定が正本 (Rust へ同期される)
const performanceStore = usePerformanceStore()
const imageCacheMaxMB = computed({
  get: () => performanceStore.get('imageCacheMaxMB'),
  set: (v: number) => performanceStore.set('imageCacheMaxMB', v),
})
const imageCacheTTLDays = computed({
  get: () => performanceStore.get('imageCacheTTLDays'),
  set: (v: number) => performanceStore.set('imageCacheTTLDays', v),
})

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

async function refreshStats() {
  try {
    const stats = unwrap(await commands.cacheStats())
    noteCount.value = stats.noteCount
    dbBytes.value = stats.dbSizeBytes
    const img = unwrap(await commands.imageCacheStats())
    imageBytes.value = img.bytes
    imageFiles.value = img.files
  } catch (e) {
    if (import.meta.env.DEV) console.debug('[cache-editor] fetch failed:', e)
  }
}

async function clearAll() {
  const ok = await confirm({
    title: 'キャッシュ削除',
    message: 'ノートキャッシュとOGPキャッシュをすべて削除しますか？',
    okLabel: '削除',
    type: 'danger',
  })
  if (!ok) return
  isClearing.value = true
  errorMessage.value = ''
  try {
    unwrap(await commands.clearAllCache())
    await refreshStats()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  } finally {
    isClearing.value = false
  }
}

async function clearImages() {
  const ok = await confirm({
    title: '画像キャッシュ削除',
    message:
      'ディスク上の画像キャッシュをすべて削除しますか？表示のたびにサーバーから再取得されます。',
    okLabel: '削除',
    type: 'danger',
  })
  if (!ok) return
  isClearingImages.value = true
  errorMessage.value = ''
  try {
    unwrap(await commands.clearImageCache())
    await refreshStats()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  } finally {
    isClearingImages.value = false
  }
}

// --- eviction policy ---
const preset = computed<EvictionPreset>(
  () => settingsStore.get('cache.evictionPreset') ?? 'balanced',
)
const customLimit = computed(
  () => settingsStore.get('cache.perAccountLimit') ?? null,
)
const customTtl = computed(() => settingsStore.get('cache.ttlDays') ?? null)

const PER_ACCOUNT_OPTIONS: ReadonlyArray<{
  value: number | null
  label: string
}> = [
  { value: 10_000, label: '10,000 件' },
  { value: 50_000, label: '50,000 件' },
  { value: 100_000, label: '100,000 件' },
  { value: 1_000_000, label: '1,000,000 件' },
  { value: null, label: '無制限' },
]
const TTL_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: 30, label: '30 日' },
  { value: 90, label: '90 日' },
  { value: 180, label: '180 日' },
  { value: 365, label: '365 日' },
  { value: null, label: '無期限' },
]

async function applyAndPersist() {
  errorMessage.value = ''
  try {
    const config = resolveEvictionConfig(settingsStore.settings)
    unwrap(await commands.applyEvictionConfig(config))
    await refreshStats()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

function selectPreset(value: EvictionPreset) {
  if (preset.value === value) return
  settingsStore.set('cache.evictionPreset', value)
  // custom 以外に切り替えるときは preset 値で書き戻す (混乱防止)
  if (value !== 'custom') {
    settingsStore.set('cache.perAccountLimit', undefined)
    settingsStore.set('cache.ttlDays', undefined)
  }
  void applyAndPersist()
}

function setCustomLimit(value: number | null) {
  settingsStore.set('cache.perAccountLimit', value)
  if (preset.value !== 'custom')
    settingsStore.set('cache.evictionPreset', 'custom')
  void applyAndPersist()
}

function setCustomTtl(value: number | null) {
  settingsStore.set('cache.ttlDays', value)
  if (preset.value !== 'custom')
    settingsStore.set('cache.evictionPreset', 'custom')
  void applyAndPersist()
}

const presetHint = computed(
  () => PRESET_OPTIONS.find((p) => p.value === preset.value)?.hint ?? '',
)

// custom 切替時の初期値を埋める (UI が空のままにならないように)
watch(
  preset,
  (next) => {
    if (next === 'custom') {
      if (customLimit.value === undefined)
        settingsStore.set('cache.perAccountLimit', 1_000_000)
      if (customTtl.value === undefined)
        settingsStore.set('cache.ttlDays', null)
    }
  },
  { immediate: true },
)

onMounted(refreshStats)
</script>

<template>
  <div :class="$style.content">
    <!-- 統計 -->
    <div :class="$style.section">
      <div :class="$style.sectionHeader">
        <i class="ti ti-chart-bar" :class="$style.sectionIcon" />
        <span :class="$style.sectionTitle">使用状況</span>
      </div>
      <div :class="$style.statsRow">
        <div :class="$style.statBox">
          <span :class="$style.statLabel">ノート</span>
          <span :class="$style.statValue">
            {{ noteCount == null ? '—' : noteCount.toLocaleString() }}
          </span>
        </div>
        <div :class="$style.statBox">
          <span :class="$style.statLabel">DB サイズ</span>
          <span :class="$style.statValue">
            {{ dbBytes == null ? '—' : formatBytes(dbBytes) }}
          </span>
        </div>
        <div :class="$style.statBox">
          <span :class="$style.statLabel">画像キャッシュ</span>
          <span :class="$style.statValue">
            {{ imageBytes == null ? '—' : formatBytes(imageBytes) }}
          </span>
        </div>
      </div>
    </div>

    <div :class="$style.divider" />

    <!-- 画像キャッシュ (#815) -->
    <div :class="$style.section">
      <div :class="$style.sectionHeader">
        <i class="ti ti-photo" :class="$style.sectionIcon" />
        <span :class="$style.sectionTitle">画像キャッシュ</span>
      </div>
      <div :class="$style.fieldRow">
        <label :class="$style.field">
          <span :class="$style.fieldLabel">上限</span>
          <input
            v-model.number="imageCacheMaxMB"
            type="number"
            min="64"
            max="4096"
            step="64"
            :class="$style.numberInput"
          />
          <span :class="$style.fieldUnit">MB</span>
        </label>
        <label :class="$style.field">
          <span :class="$style.fieldLabel">保持期間</span>
          <input
            v-model.number="imageCacheTTLDays"
            type="number"
            min="1"
            max="30"
            step="1"
            :class="$style.numberInput"
          />
          <span :class="$style.fieldUnit">日</span>
        </label>
      </div>
      <div :class="$style.btnRow">
        <button
          class="_button"
          :class="$style.actionBtn"
          :disabled="isClearingImages"
          @click="clearImages"
        >
          <i class="ti ti-trash" />
          {{ isClearingImages ? '処理中...' : `画像キャッシュ削除${imageFiles ? ` (${imageFiles.toLocaleString()} 件)` : ''}` }}
        </button>
      </div>
    </div>

    <div :class="$style.divider" />

    <!-- 保存粒度プリセット -->
    <div :class="$style.section">
      <div :class="$style.sectionHeader">
        <i class="ti ti-recycle" :class="$style.sectionIcon" />
        <span :class="$style.sectionTitle">保存粒度</span>
      </div>
      <p :class="$style.hint">{{ presetHint }}</p>
      <div :class="$style.presetRow">
        <button
          v-for="opt in PRESET_OPTIONS"
          :key="opt.value"
          class="_button"
          :class="[$style.presetBtn, { [$style.presetActive]: preset === opt.value }]"
          @click="selectPreset(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>

      <!-- custom: 詳細スライダー -->
      <div v-if="preset === 'custom'" :class="$style.customGrid">
        <label :class="$style.customLabel">
          <span>アカウントあたり上限</span>
          <select
            :value="String(customLimit)"
            :class="$style.select"
            @change="setCustomLimit(
              ($event.target as HTMLSelectElement).value === 'null'
                ? null
                : Number(($event.target as HTMLSelectElement).value),
            )"
          >
            <option v-for="opt in PER_ACCOUNT_OPTIONS" :key="String(opt.value)" :value="String(opt.value)">
              {{ opt.label }}
            </option>
          </select>
        </label>
        <label :class="$style.customLabel">
          <span>TTL</span>
          <select
            :value="String(customTtl)"
            :class="$style.select"
            @change="setCustomTtl(
              ($event.target as HTMLSelectElement).value === 'null'
                ? null
                : Number(($event.target as HTMLSelectElement).value),
            )"
          >
            <option v-for="opt in TTL_OPTIONS" :key="String(opt.value)" :value="String(opt.value)">
              {{ opt.label }}
            </option>
          </select>
        </label>
      </div>
    </div>

    <div :class="$style.divider" />

    <!-- 手動削除 -->
    <div :class="$style.section">
      <div :class="$style.sectionHeader">
        <i class="ti ti-eraser" :class="$style.sectionIcon" />
        <span :class="$style.sectionTitle">手動削除</span>
      </div>
      <p :class="$style.hint">
        ノートと OGP のキャッシュをすべて削除します。サーバーから再取得すれば復元されます。
      </p>
      <div :class="$style.btnRow">
        <button
          class="_button"
          :class="$style.actionBtn"
          :disabled="isClearing"
          @click="clearAll"
        >
          <i class="ti ti-trash" />
          {{ isClearing ? '処理中...' : '全キャッシュ削除' }}
        </button>
      </div>
    </div>

    <div v-if="errorMessage" :class="$style.error">{{ errorMessage }}</div>
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
  gap: 0;
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

.hint {
  font-size: 0.8em;
  color: var(--nd-fgMuted);
  line-height: 1.5;
  margin: 0;
}

.statsRow {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.statBox {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-panelBg, var(--nd-bgTransparentWeak));
}

.statLabel {
  font-size: 0.75em;
  color: var(--nd-fgMuted);
}

.statValue {
  font-size: 1.2em;
  font-weight: bold;
  color: var(--nd-fg);
  font-variant-numeric: tabular-nums;
}

.presetRow {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.presetBtn {
  padding: 8px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
  font-size: 0.8em;
  color: var(--nd-fg);
  cursor: pointer;
}

.presetActive {
  background: var(--nd-accent, var(--nd-link));
  color: var(--nd-onAccent, white);
  font-weight: bold;
}

.customGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 4px;
}

.customLabel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8em;
  color: var(--nd-fgMuted);
}

.select {
  padding: 6px 8px;
  border-radius: var(--nd-radius-sm);
  border: 1px solid var(--nd-divider);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.85em;
}

.btnRow {
  display: flex;
  gap: 8px;
}

.actionBtn {
  @include btn-action;
}

.fieldRow {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}

.field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.fieldLabel {
  font-size: 13px;
  color: var(--fgTransparentWeak, #888);
}

.numberInput {
  width: 80px;
  padding: 4px 8px;
  border: 1px solid var(--divider, #ddd);
  border-radius: 6px;
  background: var(--panel, #fff);
  color: var(--fg, #000);
  font-size: 13px;
}

.fieldUnit {
  font-size: 13px;
  color: var(--fgTransparentWeak, #888);
}

.divider {
  height: 1px;
  background: var(--nd-divider);
  margin: 16px 0;
}

.error {
  margin-top: 12px;
  padding: 8px 12px;
  font-size: 0.8em;
  color: var(--nd-love);
  background: color-mix(in srgb, var(--nd-love) 10%, transparent);
  border-radius: var(--nd-radius-sm);
}
</style>

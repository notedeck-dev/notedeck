<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { dispatchCapability } from '@/capabilities/dispatcher'
import { useEditTargetText } from '@/composables/useEditTargetText'
import { EDIT_HISTORY_SPECS, historyDiffPair } from '@/services/editHistory'
import { type HistoryEntry, listSnapshots } from '@/utils/historyFs'
import type { HistoryKind } from '@/utils/settingsFs'

/**
 * 編集履歴ウィンドウ (#981)。
 *
 * 履歴は capability (`*.history`) からしか読めず、AI が何を変えたかを人間が
 * 後から追う手段が無かった。各 snapshot を「その編集で何が変わったか」の
 * diff で見せ、戻す操作を同居させる。
 *
 * 選んだ snapshot は「その編集の直前の状態」なので、比較相手は 1 つ新しい
 * snapshot (無ければ現在の内容) になる。これで snapshot 間・snapshot vs
 * 現在の両方が同じ 1 つの見え方に収まる。
 */

const CodeDiffView = defineAsyncComponent(
  () => import('@/components/common/CodeDiffView.vue'),
)

const props = defineProps<{
  kind: HistoryKind
  /** 履歴サイドカーの basename (#913 の fileBase)。css は 'custom.css' */
  basename: string
  /** revert capability に渡す対象 id。css では未使用 */
  itemId?: string
  /** ヘッダに出す対象名 */
  name?: string
}>()

defineEmits<{
  close: []
}>()

const spec = computed(() => EDIT_HISTORY_SPECS[props.kind])

// 最新 snapshot の比較相手。開いた時点のコピーではなく store から読むので、
// revert / AI 編集の後もそのまま実態を指す
const current = useEditTargetText(
  () => props.kind,
  () => props.itemId,
)

const entries = ref<HistoryEntry[]>([])
const selected = ref(0)
const loading = ref(true)

async function reload() {
  loading.value = true
  entries.value = await listSnapshots(props.kind, props.basename)
  if (selected.value >= entries.value.length) selected.value = 0
  loading.value = false
}

watch(() => [props.kind, props.basename], reload, { immediate: true })

const snapshotTexts = computed(() =>
  entries.value.map((e) => spec.value.snapshotText(e.snapshot)),
)

/** 選択 snapshot = その編集の「前」。比較相手は 1 つ新しい状態。 */
const diff = computed(() =>
  historyDiffPair(snapshotTexts.value, selected.value, current.value),
)

const compareLabel = computed(() =>
  selected.value > 0
    ? `編集履歴 #${selected.value - 1} との差分`
    : '現在の内容との差分',
)

const reverting = ref(false)
const revertError = ref('')

async function revert(index: number) {
  reverting.value = true
  revertError.value = ''
  // 確認ダイアログ・権限・「見せたものを書く」不変条件を capability 側に
  // 通すため、store を直接触らず dispatcher 経由で戻す
  const result = await dispatchCapability(
    spec.value.revertCapabilityId,
    spec.value.revertParams(props.itemId ?? '', index),
    { principal: { kind: 'user' } },
  )
  reverting.value = false
  if (!result.ok && result.code !== 'user_cancelled') {
    revertError.value = result.error
    return
  }
  if (result.ok) await reload()
}

function formatAt(at: number): string {
  return new Date(at).toLocaleString()
}
</script>

<template>
  <div :class="$style.content">
    <div :class="$style.header">
      <i class="ti ti-history" />
      <span :class="$style.title">{{ name || spec.label }}</span>
      <span :class="$style.sub">{{ spec.label }}の編集履歴</span>
    </div>

    <div v-if="loading" :class="$style.empty">
      <span>読み込み中…</span>
    </div>
    <div v-else-if="entries.length === 0" :class="$style.empty">
      <i class="ti ti-history-off" />
      <span>編集履歴はまだありません</span>
    </div>

    <template v-else>
      <div :class="$style.list">
        <button
          v-for="(entry, i) in entries"
          :key="entry.at"
          type="button"
          class="_button"
          :class="[$style.entry, i === selected && $style.entrySelected]"
          @click="selected = i"
        >
          <span :class="$style.entryIndex">#{{ i }}</span>
          <span :class="$style.entryAt">{{ formatAt(entry.at) }}</span>
          <span v-if="i === 0" :class="$style.entryTag">直前</span>
        </button>
      </div>

      <div v-if="diff" :class="$style.diffPanel">
        <div :class="$style.diffLabel">{{ compareLabel }}</div>
        <CodeDiffView
          :old-text="diff.old"
          :new-text="diff.new"
          :language="spec.language"
          :class="$style.diffView"
        />
      </div>

      <div v-if="revertError" :class="$style.error">
        <i class="ti ti-alert-triangle" />
        <span>{{ revertError }}</span>
      </div>

      <div :class="$style.footer">
        <button
          type="button"
          class="_button"
          :class="$style.revertBtn"
          :disabled="reverting"
          @click="revert(selected)"
        >
          <i class="ti ti-arrow-back-up" />
          <span>#{{ selected }} の状態に戻す</span>
        </button>
      </div>
    </template>
  </div>
</template>

<style module lang="scss">
.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--nd-bg);
}

.header {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--nd-divider);
  color: var(--nd-fg);

  i {
    align-self: center;
    opacity: 0.6;
  }
}

.title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub {
  font-size: 11px;
  opacity: 0.6;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 40px 20px;
  color: var(--nd-fg);
  opacity: 0.5;
  font-size: 13px;
}

// 履歴は「上が新しい」縦の時系列。横スクロールのチップだと件数が増えたとき
// 見えない項目が出るうえ、時系列の向きが読み取れない
.list {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
  max-height: 30%;
  overflow-y: auto;
  border-bottom: 1px solid var(--nd-divider);
  flex-shrink: 0;
}

.entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 14px;
  border: none;
  border-left: 2px solid transparent;
  background: transparent;
  color: var(--nd-fg);
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--nd-fg) 6%, transparent);
  }
}

.entrySelected {
  border-left-color: var(--nd-accent);
  background: color-mix(in srgb, var(--nd-accent) 12%, transparent);
}

.entryTag {
  margin-left: auto;
  padding: 0 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--nd-fg) 10%, transparent);
  font-size: 10px;
  opacity: 0.8;
}

.entryIndex {
  font-variant-numeric: tabular-nums;
  opacity: 0.6;
}

.entryAt {
  font-variant-numeric: tabular-nums;
}

.diffPanel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.diffLabel {
  padding: 6px 14px 0;
  font-size: 11px;
  color: var(--nd-fg);
  opacity: 0.6;
}

.diffView {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 10px;
  padding: 6px 8px;
  font-size: 11px;
  color: var(--nd-error, #f66);
  background: color-mix(in srgb, var(--nd-error, #f66) 10%, transparent);
  border-radius: 3px;
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid var(--nd-divider);
}

.revertBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid var(--nd-divider);
  border-radius: 3px;
  background: transparent;
  color: var(--nd-fg);
  font-size: 12px;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}
</style>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NormalizedNote } from '@/adapters/types'
import AiScriptEditor from '@/components/deck/widgets/AiScriptEditor.vue'
import { compileColumnQuery } from '@/services/columnQuery/compiler'
import { evaluateQirQuery } from '@/services/columnQuery/evaluator'
import { useColumnQueriesStore } from '@/stores/columnQueries'
import { useDeckStore } from '@/stores/deck'
import { useToast } from '@/stores/toast'

/**
 * 名前付きクエリ編集ウィンドウ (#783)。
 *
 * クエリの定義・編集はクエリ管理カラムに一元化されており、ここはその
 * 編集面 (名前・説明・AiScript ソース)。カラムへの適用はタイムライン
 * カラムのフィルタメニューのトグルで行う (このウィンドウでは扱わない)。
 *
 * 保存すると参照している全カラムに伝播する (シグネチャ変化 → refetch)。
 * 保存できるのは QIR コンパイルが通る式のみ (Phase 2 で降格対応予定)。
 * dry-run は直近フォーカスしたタイムラインカラムのロード済みノートに
 * 適用した通過数を出す (仕様追補 E)。
 */

const props = defineProps<{
  queryId: string
}>()

const emit = defineEmits<{
  close: []
}>()

const deckStore = useDeckStore()
const queriesStore = useColumnQueriesStore()
const toast = useToast()

queriesStore.ensureLoaded()

const namedQuery = computed(() => queriesStore.getQuery(props.queryId))
const queryName = ref(namedQuery.value?.name ?? '')
const queryDescription = ref(namedQuery.value?.description ?? '')
const source = ref(namedQuery.value?.src ?? '')

const compiled = computed(() => {
  const src = source.value
  if (src.trim() === '') return null
  return compileColumnQuery(src)
})

const diagnostics = computed(() =>
  compiled.value && !compiled.value.ok ? compiled.value.diagnostics : [],
)

/** 直近フォーカスした TL カラムのロード済みノートに対する dry-run。 */
const dryRun = computed(() => {
  const c = compiled.value
  if (!c?.ok) return null
  const columnId = deckStore.lastFocusedTimelineColumnId
  if (!columnId) return null
  const notes = (deckStore.visibleNotesByColumn[columnId] ??
    []) as NormalizedNote[]
  if (notes.length === 0) return null
  let match = 0
  let error = 0
  for (const note of notes) {
    const v = evaluateQirQuery(c.query, note)
    if (v === 'match') match++
    else if (v === 'error') error++
  }
  return { total: notes.length, match, error }
})

const canSave = computed(
  () =>
    compiled.value?.ok === true &&
    queryName.value.trim() !== '' &&
    source.value.trim() !== '',
)

const isDirty = computed(() => {
  const q = namedQuery.value
  return (
    source.value !== (q?.src ?? '') ||
    queryName.value !== (q?.name ?? '') ||
    queryDescription.value !== (q?.description ?? '')
  )
})

async function save(): Promise<void> {
  if (!canSave.value) return
  await queriesStore.updateQuery(props.queryId, {
    name: queryName.value.trim(),
    description: queryDescription.value.trim() || undefined,
    src: source.value,
  })
  toast.show('クエリを保存しました', 'success')
  emit('close')
}
</script>

<template>
  <div :class="$style.root">
    <input
      v-model="queryName"
      :class="$style.nameInput"
      type="text"
      placeholder="クエリ名"
    />
    <input
      v-model="queryDescription"
      :class="$style.descInput"
      type="text"
      placeholder="説明 (任意)"
    />

    <div :class="$style.hint">
      AiScript 式でカラムに流すノートを定義します (true = 表示)。
      例: <code>note.text != null && note.text.incl("misskey")</code>。
      カラムへの適用はタイムラインカラムのフィルタメニューで切り替えます。
    </div>

    <AiScriptEditor
      v-model="source"
      placeholder="note.text != null && note.text.incl(&quot;キーワード&quot;)"
      max-height="320px"
      auto-height
    />

    <!-- コンパイル状態 -->
    <div v-if="source.trim() !== ''" :class="$style.status">
      <template v-if="compiled?.ok">
        <span :class="$style.statusFast">
          <i class="ti ti-bolt" />高速クエリ (QIR {{ compiled.nodeCount }} ノード)
        </span>
        <span v-if="dryRun" :class="$style.dryRun">
          直近の TL カラム {{ dryRun.total }} 件中 {{ dryRun.match }} 件通過<template
            v-if="dryRun.error > 0"
          >・エラー {{ dryRun.error }} 件 (除外)</template>
        </span>
      </template>
      <ul v-else :class="$style.diagnostics">
        <li v-for="(d, i) in diagnostics" :key="i">
          <i class="ti ti-alert-triangle" />
          <span v-if="d.line != null" :class="$style.diagLoc">{{ d.line }}行:</span>
          {{ d.message }}
        </li>
      </ul>
    </div>

    <div :class="$style.actions">
      <button
        class="_button"
        :class="$style.saveButton"
        :disabled="!canSave || !isDirty"
        @click="save"
      >
        保存
      </button>
    </div>
  </div>
</template>

<style lang="scss" module>
.root {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.nameInput,
.descInput {
  width: 100%;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--nd-divider, rgba(128, 128, 128, 0.3));
  background: var(--nd-panel);
  color: inherit;
  font: inherit;
}

.nameInput {
  font-weight: 600;
}

.descInput {
  font-size: 0.85em;
}

.hint {
  font-size: 0.8em;
  opacity: 0.7;
  line-height: 1.5;

  code {
    background: var(--nd-bg-secondary, rgba(128, 128, 128, 0.15));
    border-radius: 4px;
    padding: 1px 4px;
  }
}

.status {
  font-size: 0.82em;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.statusFast {
  color: var(--nd-accent, #86b300);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dryRun {
  opacity: 0.75;
}

.diagnostics {
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--nd-love, #ff6b6b);
  display: flex;
  flex-direction: column;
  gap: 2px;

  li {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }
}

.diagLoc {
  opacity: 0.7;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.saveButton {
  padding: 6px 16px;
  border-radius: 6px;
  background: var(--nd-accent, #86b300);
  color: #fff;
  font-weight: 600;

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
}
</style>

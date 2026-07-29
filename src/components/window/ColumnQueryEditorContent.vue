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
 * カラムクエリ編集ウィンドウ (#783)。2 形態を扱う:
 *
 * - columnId 指定: カラムのクエリ設定。インライン式 + 名前付きクエリの
 *   トグル (仕様追補 B の And 合成)。dry-run はロード済みノートに適用
 * - queryId 指定: 名前付きクエリ本体の編集 (名前・説明・ソース)。
 *   保存すると参照している全カラムに伝播する (fetchKey 経由で refetch)
 *
 * 保存できるのは QIR コンパイルが通る式のみ (Phase 2 で降格対応予定)。
 */

const props = defineProps<{
  columnId?: string
  queryId?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const deckStore = useDeckStore()
const queriesStore = useColumnQueriesStore()
const toast = useToast()

queriesStore.ensureLoaded()

const isQueryMode = computed(() => props.queryId !== undefined)

// --- カラム形態 ---
const column = computed(() =>
  props.columnId ? deckStore.getColumn(props.columnId) : undefined,
)
const enabledRefs = ref<string[]>([...(column.value?.noteQueryRefs ?? [])])

function toggleRef(id: string): void {
  enabledRefs.value = enabledRefs.value.includes(id)
    ? enabledRefs.value.filter((x) => x !== id)
    : [...enabledRefs.value, id]
}

// --- 名前付きクエリ形態 ---
const namedQuery = computed(() =>
  props.queryId ? queriesStore.getQuery(props.queryId) : undefined,
)
const queryName = ref(namedQuery.value?.name ?? '')
const queryDescription = ref(namedQuery.value?.description ?? '')

// --- 共通: ソースとコンパイル ---
const source = ref(
  (isQueryMode.value ? namedQuery.value?.src : column.value?.noteQuery) ?? '',
)

const compiled = computed(() => {
  const src = source.value
  if (src.trim() === '') return null
  return compileColumnQuery(src)
})

const diagnostics = computed(() =>
  compiled.value && !compiled.value.ok ? compiled.value.diagnostics : [],
)

/** ロード済みノートに対する dry-run (カラム形態のみ)。 */
const dryRun = computed(() => {
  const c = compiled.value
  if (!c?.ok || !props.columnId) return null
  const notes = (deckStore.visibleNotesByColumn[props.columnId] ??
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

const sourceValid = computed(
  () => source.value.trim() === '' || compiled.value?.ok === true,
)
const canSave = computed(() => {
  if (!sourceValid.value) return false
  if (isQueryMode.value) {
    // 名前付きクエリは空ソース・空名を許さない
    return queryName.value.trim() !== '' && source.value.trim() !== ''
  }
  return true
})

const isDirty = computed(() => {
  if (isQueryMode.value) {
    const q = namedQuery.value
    return (
      source.value !== (q?.src ?? '') ||
      queryName.value !== (q?.name ?? '') ||
      queryDescription.value !== (q?.description ?? '')
    )
  }
  const refsChanged =
    JSON.stringify([...enabledRefs.value].sort()) !==
    JSON.stringify([...(column.value?.noteQueryRefs ?? [])].sort())
  return source.value !== (column.value?.noteQuery ?? '') || refsChanged
})

async function save(): Promise<void> {
  if (!canSave.value) return
  if (isQueryMode.value && props.queryId) {
    await queriesStore.updateQuery(props.queryId, {
      name: queryName.value.trim(),
      description: queryDescription.value.trim() || undefined,
      src: source.value,
    })
    toast.show('クエリを保存しました', 'success')
    emit('close')
    return
  }
  if (!props.columnId) return
  const trimmed = source.value.trim()
  deckStore.updateColumn(props.columnId, {
    noteQuery: trimmed === '' ? undefined : source.value,
    noteQueryRefs:
      enabledRefs.value.length > 0 ? [...enabledRefs.value] : undefined,
  })
  toast.show(
    trimmed === '' && enabledRefs.value.length === 0
      ? 'クエリを解除しました'
      : 'クエリを保存しました',
    'success',
  )
  emit('close')
}

function clear(): void {
  source.value = ''
}
</script>

<template>
  <div :class="$style.root">
    <!-- 名前付きクエリ形態: 名前・説明 -->
    <template v-if="isQueryMode">
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
    </template>

    <!-- カラム形態: 対象カラム名 -->
    <div v-else :class="$style.columnName">
      <i class="ti ti-layout-columns" />
      <span>{{ column?.name || 'カラム' }}</span>
    </div>

    <div :class="$style.hint">
      AiScript 式でこのカラムに流すノートを定義します (true = 表示)。
      例: <code>note.text != null && note.text.incl("misskey")</code>
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
          ロード済み {{ dryRun.total }} 件中 {{ dryRun.match }} 件通過<template
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

    <!-- カラム形態: 名前付きクエリのトグル (And 合成) -->
    <div
      v-if="!isQueryMode && queriesStore.queries.length > 0"
      :class="$style.refsSection"
    >
      <div :class="$style.refsHeader">名前付きクエリ (AND 合成)</div>
      <label
        v-for="q in queriesStore.queries"
        :key="q.id"
        :class="$style.refItem"
      >
        <input
          type="checkbox"
          :checked="enabledRefs.includes(q.id)"
          @change="toggleRef(q.id)"
        />
        <span :class="$style.refName">{{ q.name }}</span>
        <span v-if="q.description" :class="$style.refDesc">{{ q.description }}</span>
      </label>
    </div>

    <div :class="$style.actions">
      <button
        v-if="!isQueryMode && source.trim() !== ''"
        class="_button"
        :class="$style.clearButton"
        @click="clear"
      >
        クリア
      </button>
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

.columnName {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 0.95em;
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

.refsSection {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid var(--nd-divider, rgba(128, 128, 128, 0.2));
  padding-top: 8px;
}

.refsHeader {
  font-size: 0.78em;
  font-weight: 600;
  opacity: 0.7;
}

.refItem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 2px;
  cursor: pointer;
  border-radius: 6px;

  &:hover {
    background: color-mix(in srgb, currentcolor 6%, transparent);
  }
}

.refName {
  font-size: 0.88em;
}

.refDesc {
  font-size: 0.75em;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.clearButton {
  padding: 6px 14px;
  border-radius: 6px;
  opacity: 0.8;
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

<script setup lang="ts">
import { Parser } from '@syuilo/aiscript'
import { computed, ref } from 'vue'
import type { NormalizedNote } from '@/adapters/types'
import AiScriptEditor from '@/components/deck/widgets/AiScriptEditor.vue'
import EditorActionBar from '@/components/window/EditorActionBar.vue'
import EditorItemHeader from '@/components/window/EditorItemHeader.vue'
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

/**
 * QIR にできないが純粋な式は 🐢 逐次適用として保存できる (#783 Phase 2)。
 * 診断は「なぜ降格したか」の説明であって、保存を止める理由ではない。
 */
const isDegraded = computed(
  () => compiled.value?.ok === false && compiled.value.degradable,
)

/**
 * null ガード漏れの警告 (V25)。コンパイルは通るが、そのまま保存すると
 * 画像のみのノートや純リノートが丸ごと消えるので保存前に気づかせる。
 */
const warnings = computed(() =>
  compiled.value?.ok ? compiled.value.warnings : [],
)

/**
 * ガードを差し込んだソースを組み立てる。適用できない形なら null。
 *
 * 末尾式 (最後の非空行) を括弧で包んでから前置する。括弧が要るのは
 * `A || B` のような式で、括弧なしだと && が || より強く結合してガードが
 * 左辺にしか掛からないため。
 *
 * 末尾行が式として閉じていない形 (`@(note) { ... }` の `}` など) では
 * 壊れた式になるので、組み立て結果をパースして通ったときだけ返す。
 * AST の位置情報は式全体の範囲ではなく演算子や引数の位置を指すので、
 * 位置ベースで囲む方法は採れない。
 */
function buildGuarded(guard: string): string | null {
  const lines = source.value.split('\n')
  let i = lines.length - 1
  while (i >= 0 && lines[i]?.trim() === '') i--
  const target = lines[i]
  if (i < 0 || target === undefined) return null
  const next = [...lines]
  next[i] = `${guard} && (${target.trim()})`
  const candidate = next.join('\n')
  try {
    new Parser().parse(candidate)
  } catch {
    return null
  }
  return candidate
}

function applyGuard(guard: string): void {
  const next = buildGuarded(guard)
  if (next !== null) source.value = next
}

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
    (compiled.value?.ok === true || isDegraded.value) &&
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
    <!-- カラムのカードと同じアイコン表示でアイテムを識別できるようにする (#955) -->
    <EditorItemHeader
      v-if="namedQuery"
      :class="$style.headerBleed"
      :icon-url="namedQuery.iconUrl"
      fallback-icon="filter"
      :name="queryName || namedQuery.name"
    >
      <template #sub>
        <span v-if="namedQuery.storeId" :class="$style.headerBadge">ストア</span>
        <span v-else-if="namedQuery.builtIn" :class="$style.headerBadge">ビルドイン</span>
        <span v-else :class="$style.headerBadge">ローカル</span>
      </template>
    </EditorItemHeader>

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
          <i class="ti ti-filter-check" />高速クエリ (QIR {{ compiled.nodeCount }} ノード)
        </span>
        <span v-if="dryRun" :class="$style.dryRun">
          直近の TL カラム {{ dryRun.total }} 件中 {{ dryRun.match }} 件通過<template
            v-if="dryRun.error > 0"
          >・エラー {{ dryRun.error }} 件 (除外)</template>
        </span>
        <!-- null ガード漏れ (V25): 保存はできるが、まず直す導線を出す -->
        <ul v-if="warnings.length > 0" :class="$style.warnings">
          <li v-for="w in warnings" :key="w.field">
            <i class="ti ti-alert-triangle" />
            <span v-if="w.line != null" :class="$style.diagLoc">{{ w.line }}行:</span>
            {{ w.message }}
            <button
              v-if="buildGuarded(w.guard) !== null"
              class="_button"
              :class="$style.fixButton"
              :title="`末尾の式を ${w.guard} で守ります`"
              @click="applyGuard(w.guard)"
            >
              ガードを入れる
            </button>
          </li>
        </ul>
      </template>
      <template v-else-if="isDegraded">
        <span :class="$style.statusSlow">
          <i class="ti ti-hourglass" />逐次適用 (1 件ずつ判定するため検索では使えません)
        </span>
        <ul :class="$style.degradedReasons">
          <li v-for="(d, i) in diagnostics" :key="i">
            <span v-if="d.line != null" :class="$style.diagLoc">{{ d.line }}行:</span>
            {{ d.message }}
          </li>
        </ul>
      </template>
      <ul v-else :class="$style.diagnostics">
        <li v-for="(d, i) in diagnostics" :key="i">
          <i class="ti ti-alert-triangle" />
          <span v-if="d.line != null" :class="$style.diagLoc">{{ d.line }}行:</span>
          {{ d.message }}
        </li>
      </ul>
    </div>

    <EditorActionBar
      :class="$style.barBleed"
      :primary="{
        key: 'save',
        label: warnings.length > 0 ? 'このまま保存' : '保存',
        icon: 'device-floppy',
        disabled: !canSave || !isDirty,
      }"
      @action="save"
    />
  </div>
</template>

<style lang="scss" module>
.root {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

/* root が padding を持つので、ヘッダとアクションバーだけ
   他の編集ウィンドウと同じ全幅に戻す */
.headerBleed {
  margin: -12px -12px 0;
}

.barBleed {
  margin: 0 -12px -12px;
}

.headerBadge {
  font-size: 0.85em;
  padding: 0 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--nd-fg) 10%, transparent);
  line-height: 1.6;
  flex-shrink: 0;
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

/* 🐢 逐次適用 (#783 Phase 2)。エラーではないので警告色で出す */
.statusSlow {
  color: var(--nd-warn);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}


.degradedReasons {
  margin: 0;
  padding: 0;
  list-style: none;
  opacity: 0.75;
  font-size: 0.9em;
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

/* null ガード漏れ (V25)。エラーではないので warn 色 + quick-fix を並べる */
.warnings {
  composes: diagnostics;
  color: var(--nd-warn);

  li {
    flex-wrap: wrap;
  }
}

.fixButton {
  padding: 2px 8px;
  border-radius: var(--nd-radius-full);
  font-size: 0.9em;
  color: var(--nd-warn);
  background: color-mix(in srgb, var(--nd-warn) 14%, transparent);

  &:hover {
    background: color-mix(in srgb, var(--nd-warn) 24%, transparent);
  }
}

</style>

<script setup lang="ts">
/**
 * 検索カラムの絞り込みパネル (#1180)。サーバー検索とクライアント検索で 1 つを
 * 共有し、面が宣言した行だけを出す。面に意味の無い行に値が残っていれば
 * 「効かない」と見せて外せるようにする (黙って無視しない)。
 *
 * 行の意味は面で違う (範囲 = 索引のサーバー / アカウント か 返すノートのホスト、
 * 投稿者 = 表記 か 解決済み ID)。ここは入力と表示だけで、評価は面が担う。
 */
import { computed, ref, watch } from 'vue'
import ConditionBuilder from '@/components/common/ConditionBuilder.vue'
import { i18n } from '@/i18n'
import {
  clearPanelRows,
  clearRow,
  FACE_ROWS,
  hasActiveFilter,
  rowHasValue,
  type SearchFace,
  type SearchFilter,
  type SearchFilterRow,
  type ServerHostOption,
  staleRows,
  type TextCondition,
} from '@/services/searchFilter'

const props = defineProps<{
  face: SearchFace
  filter: SearchFilter
  /** クライアント検索の範囲の選択肢 */
  scopeOptions?: {
    servers: string[]
    accounts: { id: string; label: string }[]
  }
  /** サーバー検索の範囲の選択肢。1 つしか無ければ行を出さない (選ぶものが無い) */
  hostOptions?: ServerHostOption[]
  /** 全アカウント面: 「すべて」「ローカル」が各サーバーの束ねになるので語を変える */
  crossAccount?: boolean
  /** サーバー検索の投稿者の解決状態 */
  authorState?: 'resolving' | 'resolved' | 'unresolved' | null
  authorResolvedLabel?: string
  /**
   * 面が宣言した行のうち、このカラムでは出さない行 (全アカウントのサーバー検索の
   * 投稿者 / ホスト)。値が残っていれば効かない行として見せる
   */
  hiddenRows?: SearchFilterRow[]
}>()

const emit = defineEmits<{
  /** 条件が変わった。確定した値だけを渡す (入力途中は渡さない) */
  update: [filter: SearchFilter]
}>()

const rows = computed<SearchFilterRow[]>(() =>
  FACE_ROWS[props.face].filter(
    (row) =>
      !props.hiddenRows?.includes(row) &&
      (row !== 'host' || (props.hostOptions?.length ?? 0) > 1),
  ),
)
const stale = computed(() => [
  ...staleRows(props.filter, props.face),
  ...(props.hiddenRows ?? []).filter(
    (row) =>
      FACE_ROWS[props.face].includes(row) && rowHasValue(props.filter, row),
  ),
])
const active = computed(() => hasActiveFilter(props.filter))

function update(patch: Partial<SearchFilter>) {
  const next: SearchFilter = { ...props.filter, ...patch }
  for (const key of Object.keys(next) as (keyof SearchFilter)[]) {
    if (next[key] === undefined || next[key] === '') delete next[key]
  }
  emit('update', next)
}

// --- 範囲 (クライアント検索: 索引のサーバー / アカウント) ---
const scopeValue = computed(() => props.filter.scope ?? '')
function onScopeChange(e: Event) {
  update({ scope: (e.target as HTMLSelectElement).value || undefined })
}

// --- 範囲 (サーバー検索: 返すノートのホスト) ---
const hostKind = computed<ServerHostOption>(() => {
  const h = props.filter.host
  if (!h) return 'all'
  if (h === '.') return 'local'
  return 'host'
})
const hostDraft = ref(
  hostKind.value === 'host' ? (props.filter.host ?? '') : '',
)
const hostKindDraft = ref<ServerHostOption>(hostKind.value)
watch(hostKind, (k) => {
  hostKindDraft.value = k
  if (k === 'host') hostDraft.value = props.filter.host ?? ''
})
function onHostKindChange(e: Event) {
  const kind = (e.target as HTMLSelectElement).value as ServerHostOption
  hostKindDraft.value = kind
  if (kind === 'all') update({ host: undefined })
  else if (kind === 'local') update({ host: '.' })
  // 'host' は名前を確定するまで条件にしない
}
function commitHost() {
  const h = hostDraft.value.trim().toLowerCase()
  if (hostKindDraft.value !== 'host') return
  if (!h) return
  if (h !== props.filter.host) update({ host: h })
}

// --- 投稿者 ---
const authorDraft = ref(props.filter.author ?? '')
watch(
  () => props.filter.author,
  (a) => {
    authorDraft.value = a ?? ''
  },
)
function commitAuthor() {
  const a = authorDraft.value.trim()
  if (a === (props.filter.author ?? '')) return
  // 表記が変わったら解決し直す (解決済み ID は捨てる)
  update({ author: a || undefined, authorIds: undefined })
}
const authorHint = computed(() => {
  if (props.face !== 'server') return ''
  switch (props.authorState) {
    case 'resolving':
      return i18n.ts._searchFilterPanel.authorResolving
    case 'unresolved':
      return i18n.ts._searchFilterPanel.authorUnresolved
    case 'resolved':
      return props.authorResolvedLabel ?? ''
    default:
      return ''
  }
})

// --- 期間 ---
// 日付入力は年の桁を打つ途中も有効な値になる (0002 → 0020 → 2026) ので、
// 確定 (欄を離れた / Enter) で反映する。カレンダーからの選択は年が揃うので
// change の時点で反映してよい
const sinceDraft = ref(props.filter.since ?? '')
const untilDraft = ref(props.filter.until ?? '')
watch(
  () => [props.filter.since, props.filter.until],
  ([s, u]) => {
    sinceDraft.value = s ?? ''
    untilDraft.value = u ?? ''
  },
)
function yearSettled(v: string): boolean {
  const y = Number.parseInt(v.slice(0, 4), 10)
  return !v || (Number.isFinite(y) && y >= 1000)
}
function commitPeriod(force: boolean) {
  const since = sinceDraft.value
  const until = untilDraft.value
  if (!force && !(yearSettled(since) && yearSettled(until))) return
  if (
    since === (props.filter.since ?? '') &&
    until === (props.filter.until ?? '')
  )
    return
  update({ since: since || undefined, until: until || undefined })
}

// --- 添付 ---
const hasFilesValue = computed(() =>
  props.filter.hasFiles === undefined ? '' : String(props.filter.hasFiles),
)
function onHasFilesChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  update({ hasFiles: v === '' ? undefined : v === 'true' })
}

// --- 本文の条件 (検索語に加える条件。構造が正本) ---
const NO_CONDITIONS: TextCondition[] = []
function onConditionsUpdate(conditions: TextCondition[]) {
  // 本人が触ったので、外部差し替えで止めていた印は外す
  const next: SearchFilter = { ...props.filter }
  delete next.conditionsPaused
  if (conditions.length > 0) next.conditions = conditions
  else delete next.conditions
  emit('update', next)
}

// --- 面に意味の無い行 ---
function staleLabel(row: SearchFilterRow): string {
  const t = i18n.ts._searchFilterPanel
  switch (row) {
    case 'scope':
      return `${t.scope}: ${props.filter.scope ?? ''}`
    case 'host':
      return `${t.scope}: ${props.filter.host ?? ''}`
    case 'author':
      return `${t.author}: ${props.filter.author ?? ''}`
    case 'period':
      return `${t.period}: ${props.filter.since ?? ''} - ${props.filter.until ?? ''}`
    case 'attachments':
      return `${t.attachments}: ${props.filter.hasFiles ? t.attachmentsYes : t.attachmentsNo}`
    case 'conditions':
      return `${i18n.ts._conditionBuilder.title}: ${(
        props.filter.conditions ?? []
      )
        .map((c) => c.words.join(', '))
        .join(' / ')}`
  }
}
function removeStale(row: SearchFilterRow) {
  emit('update', clearRow(props.filter, row))
}
function clearAll() {
  emit('update', clearPanelRows(props.filter))
}
</script>

<template>
  <div :class="$style.panel">
    <label v-if="rows.includes('scope')" :class="$style.row">
      <span :class="$style.label">{{ i18n.ts._searchFilterPanel.scope }}</span>
      <select :class="$style.input" :value="scopeValue" @change="onScopeChange">
        <option value="">{{ i18n.ts._searchFilterPanel.allAccounts }}</option>
        <option v-for="host in scopeOptions?.servers ?? []" :key="`s:${host}`" :value="`server:${host}`">
          {{ i18n.tsx._searchFilterPanel.serverOption({ host }) }}
        </option>
        <option v-for="acc in scopeOptions?.accounts ?? []" :key="`a:${acc.id}`" :value="`account:${acc.id}`">
          {{ acc.label }}
        </option>
      </select>
    </label>

    <div v-if="rows.includes('host')" :class="$style.row">
      <span :class="$style.label">{{ i18n.ts._searchFilterPanel.scope }}</span>
      <select :class="$style.input" :value="hostKindDraft" @change="onHostKindChange">
        <option v-if="hostOptions?.includes('all')" value="all">{{ crossAccount ? i18n.ts._searchFilterPanel.hostAllAcross : i18n.ts._searchFilterPanel.hostAll }}</option>
        <option v-if="hostOptions?.includes('local')" value="local">{{ crossAccount ? i18n.ts._searchFilterPanel.hostLocalAcross : i18n.ts._searchFilterPanel.hostLocal }}</option>
        <option v-if="hostOptions?.includes('host')" value="host">{{ i18n.ts._searchFilterPanel.hostSpecify }}</option>
      </select>
      <input
        v-if="hostKindDraft === 'host'"
        v-model="hostDraft"
        :class="$style.input"
        type="text"
        :placeholder="i18n.ts._searchFilterPanel.hostPlaceholder"
        @blur="commitHost"
        @keydown.enter.prevent="commitHost"
      />
    </div>

    <div v-if="rows.includes('author')" :class="$style.row">
      <span :class="$style.label">{{ i18n.ts._searchFilterPanel.author }}</span>
      <input
        v-model="authorDraft"
        :class="$style.input"
        type="text"
        :placeholder="i18n.ts._searchFilterPanel.authorPlaceholder"
        @blur="commitAuthor"
        @keydown.enter.prevent="commitAuthor"
      />
      <span v-if="authorHint" :class="[$style.hint, { [$style.hintWarn]: authorState === 'unresolved' }]">
        {{ authorHint }}
      </span>
    </div>

    <div v-if="rows.includes('period')" :class="$style.row">
      <span :class="$style.label">{{ i18n.ts._searchFilterPanel.period }}</span>
      <input
        v-model="sinceDraft"
        type="date"
        :class="$style.input"
        :title="i18n.ts._searchFilterPanel.since"
        @change="commitPeriod(false)"
        @blur="commitPeriod(true)"
        @keydown.enter.prevent="commitPeriod(true)"
      />
      <i :class="$style.dateSeparator" class="ti ti-minus" />
      <input
        v-model="untilDraft"
        type="date"
        :class="$style.input"
        :title="i18n.ts._searchFilterPanel.until"
        @change="commitPeriod(false)"
        @blur="commitPeriod(true)"
        @keydown.enter.prevent="commitPeriod(true)"
      />
    </div>

    <label v-if="rows.includes('attachments')" :class="$style.row">
      <span :class="$style.label">{{ i18n.ts._searchFilterPanel.attachments }}</span>
      <select :class="$style.input" :value="hasFilesValue" @change="onHasFilesChange">
        <option value="">{{ i18n.ts._searchFilterPanel.attachmentsAny }}</option>
        <option value="true">{{ i18n.ts._searchFilterPanel.attachmentsYes }}</option>
        <option value="false">{{ i18n.ts._searchFilterPanel.attachmentsNo }}</option>
      </select>
    </label>

    <div v-if="rows.includes('conditions')" :class="[$style.row, $style.rowTop]">
      <span :class="$style.label">{{ i18n.ts._conditionBuilder.title }}</span>
      <ConditionBuilder
        :model-value="filter.conditions ?? NO_CONDITIONS"
        :paused="filter.conditionsPaused"
        @update:model-value="onConditionsUpdate"
      />
    </div>

    <div v-for="row in stale" :key="row" :class="[$style.row, $style.stale]">
      <span :class="$style.staleText">{{ staleLabel(row) }} — {{ i18n.ts._searchFilterPanel.staleHint }}</span>
      <button class="_button" :class="$style.removeBtn" @click="removeStale(row)">
        {{ i18n.ts._searchFilterPanel.remove }}
      </button>
    </div>

    <button
      v-if="active"
      class="_button"
      :class="$style.clearBtn"
      @click="clearAll"
    >
      <i class="ti ti-x" />
      {{ i18n.ts._searchFilterPanel.clearFilters }}
    </button>
  </div>
</template>

<style lang="scss" module>
/* ノートカラムのフィルターメニューと同じポップアップの中に並ぶ行 (#1180)。
   見出し・幅・余白はポップアップ側 (TimelineFilterPopup) が持つ */
.panel {
  display: flex;
  flex-direction: column;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 14px;
}

.rowTop {
  align-items: flex-start;

  > .label {
    padding-top: 6px;
  }
}

.label {
  flex: 0 0 3.5em;
  font-size: var(--nd-font-body);
}

.input {
  flex: 1;
  min-width: 0;
  background: var(--nd-buttonBg);
  border: none;
  border-radius: var(--nd-radius-sm);
  padding: 4px 6px;
  font-size: var(--nd-font-md);
  color: var(--nd-fg);
  color-scheme: dark;
  outline: none;

  &:focus {
    box-shadow: 0 0 0 2px var(--nd-accent);
  }
}

.dateSeparator {
  font-size: var(--nd-font-2xs);
  opacity: 0.4;
}

.hint {
  flex-basis: 100%;
  padding-left: calc(3.5em + 8px);
  font-size: var(--nd-font-xs);
  opacity: 0.6;
}

.hintWarn {
  color: var(--nd-warn);
  opacity: 1;
}

.stale {
  font-size: var(--nd-font-sm);
  opacity: 0.7;
}

.staleText {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.removeBtn,
.clearBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--nd-radius-sm);
  font-size: var(--nd-font-sm);
  opacity: 0.6;

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }
}

.clearBtn {
  align-self: flex-end;
  margin: 4px 14px 0;
}
</style>

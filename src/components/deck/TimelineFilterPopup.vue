<script setup lang="ts">
import { computed, ref, toRef, useSlots } from 'vue'
import type { TimelineFilter } from '@/adapters/types'
import { useNativePopover } from '@/composables/useNativePopover'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { i18n } from '@/i18n'

const props = defineProps<{
  show: boolean
  filterKeys: (keyof TimelineFilter)[]
  filters: TimelineFilter
  position: { top: number; left: number }
  themeVars?: Record<string, string>
  /**
   * インストール済みの名前付きクエリ (#783 カスタムフィルタトグル)。
   * disabled は本体が無効 (#1043): 適用は残せるが評価されない
   */
  namedQueries?: { id: string; name: string; disabled?: boolean }[]
  /** このカラムに適用中のクエリ id 列 (有効/無効はアイテム側の別軸) */
  appliedQueryIds?: string[]
  /** 入力欄を持つ行 (検索カラムの絞り込み、#1180) が入るときの広い幅 */
  wide?: boolean
}>()

const slots = useSlots()
/** 面ごとの追加の行 (検索カラムの絞り込み)。組込トグルと同じ見出しの下に並ぶ */
const hasExtra = computed(() => Boolean(slots.extra))

const { visible, leaving } = useVaporTransition(toRef(props, 'show'), {
  enterDuration: 180,
  leaveDuration: 200,
})

const emit = defineEmits<{
  close: []
  toggle: [key: keyof TimelineFilter]
  toggleQuery: [id: string]
  /** 無効チップから管理カラムへ (触っても何も起きないスイッチにしない、#1043) */
  openManager: []
}>()

function isQueryApplied(id: string): boolean {
  return props.appliedQueryIds?.includes(id) ?? false
}

const popoverRef = ref<HTMLElement | null>(null)

useNativePopover(popoverRef, visible, {
  onClose: () => emit('close'),
  leaveDuration: 200,
})

const FILTER_LABELS: Record<keyof TimelineFilter, string> = {
  get withRenotes() {
    return i18n.ts._common.renotes
  },
  get withReplies() {
    return i18n.ts._timelineFilterPopup.withReplies
  },
  get withFiles() {
    return i18n.ts._timelineFilterPopup.withFiles
  },
  withBots: 'Bot',
  get withSensitive() {
    return i18n.ts._timelineFilterPopup.withSensitive
  },
}

function isFilterActive(key: keyof TimelineFilter): boolean {
  const v = props.filters[key]
  if (key === 'withFiles') return v === true
  return v === false
}
</script>

<template>
  <div
    v-if="visible"
    ref="popoverRef"
    popover="auto"
    :class="[$style.filterPopup, wide && $style.filterPopupWide, leaving ? $style.filterPopupLeave : $style.filterPopupEnter, '_popup']"
    :style="{ ...themeVars, top: position.top + 'px', left: position.left + 'px', maxHeight: `calc(100vh - ${position.top}px - 8px)` }"
    @click.stop
  >
    <!-- 面ごとの追加の行 (検索カラムの範囲 / 投稿者 / 期間 / 添付 / 条件、#1180)。
         ノートカラムに無い、検索カラムだけの項目なので一番上に置く -->
    <template v-if="hasExtra">
      <div :class="$style.filterPopupHeader">{{ i18n.ts._timelineFilterPopup.search }}</div>
      <slot name="extra" />
    </template>

    <!-- 組込トグルが無いカラム (クエリトグルのみ) では見出しごと隠す (#841) -->
    <div v-if="filterKeys.length > 0" :class="$style.filterPopupHeader">{{ i18n.ts._timelineFilterPopup.filter }}</div>
    <div
      v-for="key in filterKeys"
      :key="key"
      :class="$style.filterItem"
      @click="emit('toggle', key)"
    >
      <span :class="$style.filterLabel">{{ FILTER_LABELS[key] }}</span>
      <button
        class="nd-toggle-switch"
        :class="{ on: key === 'withFiles' ? isFilterActive(key) : !isFilterActive(key) }"
        :aria-checked="key === 'withFiles' ? isFilterActive(key) : !isFilterActive(key)"
        role="switch"
      >
        <span class="nd-toggle-switch-knob" />
      </button>
    </div>

    <!-- 名前付きクエリのカスタムフィルタトグル (#783、AND 合成)。フィルターの次 -->
    <template v-if="namedQueries && namedQueries.length > 0">
      <div :class="$style.filterPopupHeader">{{ i18n.ts._columns.queryManager }}</div>
      <div
        v-for="q in namedQueries"
        :key="q.id"
        :class="$style.filterItem"
        @click="emit('toggleQuery', q.id)"
      >
        <span
          :class="[$style.filterLabel, $style.queryLabel, q.disabled && $style.queryLabelDisabled]"
          :title="q.name"
        >{{ q.name }}</span>
        <button
          v-if="q.disabled"
          class="_button"
          :class="$style.disabledChip"
          :title="i18n.ts._timelineFilterPopup.disabledQueryHint"
          @click.stop="emit('openManager')"
        >{{ i18n.ts._common.disabled }}</button>
        <button
          class="nd-toggle-switch"
          :class="{ on: isQueryApplied(q.id) }"
          :aria-checked="isQueryApplied(q.id)"
          role="switch"
        >
          <span class="nd-toggle-switch-knob" />
        </button>
      </div>
    </template>
  </div>
</template>

<style lang="scss" module>
.filterPopup {
  position: fixed;
  width: 220px;
  padding: 8px 0;
  color: var(--nd-fg);
  font-size: var(--nd-font-body);
  /* 行が多い (検索の行 + クエリの一覧) と画面の下にはみ出して届かないので、
     ボタンの下から画面の端までに収めて中をスクロールさせる (#1178) */
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
}

.filterPopupWide {
  width: 300px;
}

.filterPopupHeader {
  padding: 8px 14px 4px;
  font-size: var(--nd-font-xs);
  font-weight: var(--nd-weight-bold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.5;
}

.filterItem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  cursor: pointer;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.filterLabel {
  font-size: var(--nd-font-body);
}

/* 名前は省略記号で切り詰め、無効チップは常に見せる (幅が狭い、#1043) */
.queryLabel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queryLabelDisabled {
  opacity: 0.5;
}

.disabledChip {
  flex-shrink: 0;
  margin: 0 8px;
  padding: 0 5px;
  font-size: 9px;
  font-weight: var(--nd-weight-bold);
  line-height: 14px;
  height: 14px;
  border-radius: var(--nd-radius-xs);
  background: color-mix(in srgb, var(--nd-fg) 15%, transparent);
  color: var(--nd-fg);
  opacity: 0.75;
}

.filterPopupEnter { animation: filterPopupIn 0.18s var(--nd-ease-pop); }
.filterPopupLeave { animation: filterPopupOut 0.15s var(--nd-ease-pop) forwards; }
@keyframes filterPopupIn { from { opacity: 0; transform: scale(0.95) translateY(-4px); } }
@keyframes filterPopupOut { to { opacity: 0; transform: scale(0.95) translateY(-4px); } }
</style>

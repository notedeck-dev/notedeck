<script setup lang="ts">
import { ref, toRef } from 'vue'
import type { TimelineFilter } from '@/adapters/types'
import { useNativePopover } from '@/composables/useNativePopover'
import { useVaporTransition } from '@/composables/useVaporTransition'

const props = defineProps<{
  show: boolean
  filterKeys: (keyof TimelineFilter)[]
  filters: TimelineFilter
  position: { top: number; left: number }
  themeVars?: Record<string, string>
  /** インストール済みの名前付きクエリ (#783 カスタムフィルタトグル) */
  namedQueries?: { id: string; name: string }[]
  /** このカラムで有効化中のクエリ id 列 */
  enabledQueryIds?: string[]
}>()

const { visible, leaving } = useVaporTransition(toRef(props, 'show'), {
  enterDuration: 180,
  leaveDuration: 200,
})

const emit = defineEmits<{
  close: []
  toggle: [key: keyof TimelineFilter]
  toggleQuery: [id: string]
}>()

function isQueryEnabled(id: string): boolean {
  return props.enabledQueryIds?.includes(id) ?? false
}

const popoverRef = ref<HTMLElement | null>(null)

useNativePopover(popoverRef, visible, {
  onClose: () => emit('close'),
  leaveDuration: 200,
})

const FILTER_LABELS: Record<keyof TimelineFilter, string> = {
  withRenotes: 'リノート',
  withReplies: 'リプライ',
  withFiles: 'ファイル付きのみ',
  withBots: 'Bot',
  withSensitive: 'センシティブ',
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
    :class="[$style.filterPopup, leaving ? $style.filterPopupLeave : $style.filterPopupEnter, '_popup']"
    :style="{ ...themeVars, top: position.top + 'px', left: position.left + 'px' }"
    @click.stop
  >
    <!-- 組込トグルが無いカラム (クエリトグルのみ) では見出しごと隠す (#841) -->
    <div v-if="filterKeys.length > 0" :class="$style.filterPopupHeader">フィルター</div>
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

    <!-- 名前付きクエリのカスタムフィルタトグル (#783、AND 合成) -->
    <template v-if="namedQueries && namedQueries.length > 0">
      <div :class="$style.filterPopupHeader">クエリ</div>
      <div
        v-for="q in namedQueries"
        :key="q.id"
        :class="$style.filterItem"
        @click="emit('toggleQuery', q.id)"
      >
        <span :class="$style.filterLabel">{{ q.name }}</span>
        <button
          class="nd-toggle-switch"
          :class="{ on: isQueryEnabled(q.id) }"
          :aria-checked="isQueryEnabled(q.id)"
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
  color: var(--nd-fg, #fff);
  font-size: 0.9em;
}

.filterPopupHeader {
  padding: 8px 14px 4px;
  font-size: 0.75em;
  font-weight: 700;
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
    background: var(--nd-buttonHoverBg, rgba(255, 255, 255, 0.05));
  }
}

.filterLabel {
  font-size: 0.9em;
}

.filterPopupEnter { animation: filterPopupIn 0.18s var(--nd-ease-pop); }
.filterPopupLeave { animation: filterPopupOut 0.15s var(--nd-ease-pop) forwards; }
@keyframes filterPopupIn { from { opacity: 0; transform: scale(0.95) translateY(-4px); } }
@keyframes filterPopupOut { to { opacity: 0; transform: scale(0.95) translateY(-4px); } }
</style>

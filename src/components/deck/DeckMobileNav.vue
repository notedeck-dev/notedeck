<script setup lang="ts">
import { ref, watch } from 'vue'
import ColumnBadges from '@/components/common/ColumnBadges.vue'
import { useColumnBadge } from '@/composables/useColumnBadge'
import { useColumnTabs } from '@/composables/useColumnTabs'
import { columnTargetId, useSpotlightStore } from '@/composables/useSpotlight'
import type { ColumnType, DeckColumn } from '@/stores/deck'

const props = defineProps<{
  columns: DeckColumn[]
  layout: string[][]
  activeColumnIndex: number
}>()

const emit = defineEmits<{
  'scroll-to-column': [index: number]
  'toggle-add-menu': []
  'toggle-drawer': []
}>()

const rootEl = ref<HTMLElement | null>(null)
const mobileNavRef = ref<HTMLElement | null>(null)

// Misskey本家と同じパターン: ナビの高さをCSS変数として公開
watch(
  rootEl,
  () => {
    if (rootEl.value) {
      const h = rootEl.value.offsetHeight
      document.body.style.setProperty('--nd-mobileNavHeight', `${h}px`)
    } else {
      document.body.style.setProperty('--nd-mobileNavHeight', '0px')
    }
  },
  { immediate: true },
)

const { getBadge } = useColumnBadge()
const spotlightStore = useSpotlightStore()

function isGroupSpotlighted(group: readonly string[]): boolean {
  return group.some((id) => spotlightStore.spotlights.has(columnTargetId(id)))
}

const {
  visibleGroups,
  groupPrimaryId,
  columnType,
  columnIcon,
  columnAccountId,
} = useColumnTabs(
  () => props.columns,
  () => props.layout,
  () => props.activeColumnIndex,
  mobileNavRef,
)
</script>

<template>
  <nav ref="rootEl" :class="$style.root">
    <button
      class="_button"
      :class="$style.menuBtn"
      @click="emit('toggle-drawer')"
    >
      <i class="ti ti-menu-2" />
    </button>
    <div ref="mobileNavRef" :class="$style.tabsScroll">
      <button
        v-for="(group, gi) in visibleGroups"
        :key="groupPrimaryId(group)"
        class="_button"
        :class="[
          $style.tab,
          { [$style.active]: activeColumnIndex === gi },
          isGroupSpotlighted(group) && $style.spotlighted,
        ]"
        @click="
          group.forEach((id) => spotlightStore.clear(columnTargetId(id)));
          emit('scroll-to-column', gi)
        "
      >
        <div :class="$style.iconWrap">
          <i :class="'ti ti-' + columnIcon(groupPrimaryId(group))" />
          <span v-if="group.length > 1" :class="$style.stackBadge">{{ group.length }}</span>
          <span v-if="getBadge(columnType(groupPrimaryId(group)) as ColumnType) > 0" :key="getBadge(columnType(groupPrimaryId(group)) as ColumnType)" :class="$style.badge">{{ getBadge(columnType(groupPrimaryId(group)) as ColumnType) > 99 ? '99+' : getBadge(columnType(groupPrimaryId(group)) as ColumnType) }}</span>
          <ColumnBadges :account-id="columnAccountId(groupPrimaryId(group))" :size="14" />
        </div>
      </button>
    </div>
    <button
      class="_button"
      :class="$style.addBtn"
      title="カラムを追加"
      @click="emit('toggle-add-menu')"
    >
      <i class="ti ti-plus" />
    </button>
  </nav>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.root {
  display: flex;
  align-items: stretch;
  flex: 0 0 auto;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
  background: var(--nd-navBg);
  color: var(--nd-navFg);
  border-top: solid 0.5px var(--nd-divider);
  position: relative;
  z-index: calc(var(--nd-z-navbar) - 1);
}

.menuBtn,
.addBtn {
  flex: 0 0 auto;
  width: 50px;
  padding: 12px 0;
}

.tabsScroll {
  display: flex;
  align-items: stretch;
  justify-content: space-evenly;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.iconWrap { @include nav-icon-wrap; }

.tab {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  min-width: 42px;
  padding: 12px 8px;
  color: var(--nd-fg);
  opacity: 0.45;
  transition: opacity var(--nd-duration-slow), color var(--nd-duration-slow);
  --column-badge-border: var(--nd-navBg);

  :global(.ti) { @include nav-icon; }

  &:active {
    opacity: 0.7;
    transform: scale(0.9);
    transition: opacity var(--nd-duration-fast), color var(--nd-duration-slow), transform var(--nd-duration-fast);
  }
}

.active {
  opacity: 1;
  color: var(--nd-accent);

  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 50%;
    translate: -50% 0;
    width: 24px;
    height: 3px;
    border-radius: 3px 3px 0 0;
    background: var(--nd-accent);
  }
}

.stackBadge { @include nav-stack-badge; }
.badge { @include nav-badge; }

// AI 操作の可視化 (Spotlight): Windows タスクバー風アンダーバー (朱色 + オレンジ枠)。
// 既存 .active が ::after で短い緑バーを描くので、spotlight 中は隠して朱色バー優先。
.spotlighted {
  position: relative;
  isolation: isolate;

  &.active::after {
    display: none;
  }

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(
      180deg,
      rgba(170, 30, 30, 0.55) 0%,
      rgba(200, 55, 45, 0.3) 50%,
      rgba(220, 90, 80, 0.05) 100%
    );
    box-shadow: 0 -1px 8px rgba(170, 30, 30, 0.25);
    pointer-events: none;
    z-index: 0;
    animation: spotlightFill 2.4s ease-out 1 forwards;
  }

  > * {
    position: relative;
    z-index: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    &::before {
      animation: none;
      opacity: 1;
    }
  }
}

@keyframes spotlightFill {
  0%   { opacity: 0; }
  10%  { opacity: 1; }
  85%  { opacity: 1; }
  100% { opacity: 0; }
}

</style>

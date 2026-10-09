<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCommandStore } from '@/commands/registry'
import ColumnBadges from '@/components/common/ColumnBadges.vue'
import NotificationBell from '@/components/common/notifications/NotificationBell.vue'
import { useColumnBadge } from '@/composables/useColumnBadge'
import { useColumnTabs } from '@/composables/useColumnTabs'
import { columnTargetId, useSpotlightStore } from '@/composables/useSpotlight'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { i18n } from '@/i18n'
import type { ColumnType, DeckColumn } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { type ToastItem, useToast } from '@/stores/toast'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{
  columns: DeckColumn[]
  layout: string[][]
  activeColumnIndex: number
}>()

const tabsScrollRef = ref<HTMLElement>()

const emit = defineEmits<{
  'scroll-to-column': [index: number]
}>()

const commandStore = useCommandStore()
const deckStore = useDeckStore()
const { platformName } = useUiStore()

const platformLabel: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS',
}

const profileIndicatorLabel = computed(() => {
  const profile = deckStore.currentProfileName ?? i18n.ts._common.profile
  const os = platformName ? (platformLabel[platformName] ?? platformName) : null
  return os ? `${os}: ${profile}` : profile
})

function onProfileClick() {
  commandStore.openWithInput('~')
}

// ステータス表示の場所として登録する (登録中は軽い通知がカードにならない)
const toastCenter = useToast()
let unregisterStatusHost: (() => void) | null = null
onMounted(() => {
  unregisterStatusHost = toastCenter.registerStatusHost()
})
onBeforeUnmount(() => unregisterStatusHost?.())
// 退場のフェード中も直前の文言を出し続ける
const shownStatus = ref<ToastItem | null>(null)
watch(toastCenter.status, (item) => {
  if (item) shownStatus.value = item
})
const statusT = useVaporTransition(
  computed(() => toastCenter.status.value != null),
  { enterDuration: 200, leaveDuration: 200 },
)

function onSettingsClick() {
  commandStore.openWithInput('*')
}

function onAddColumnClick() {
  commandStore.openWithInput('+')
}

const { getBadge, clearBadge } = useColumnBadge()
const spotlightStore = useSpotlightStore()

/** group のいずれかのカラム ID が spotlight 中なら true */
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
  tabsScrollRef,
)
</script>

<template>
  <div :class="$style.root">
    <div :class="$style.left">
      <button
        class="_button"
        :class="$style.profileIndicator"
        :title="i18n.ts._commands.profileMenu"
        @click="onProfileClick()"
      >
        <i class="ti ti-layout" />
        <span :class="$style.profileName">{{ profileIndicatorLabel }}</span>
      </button>
    </div>

    <div ref="tabsScrollRef" :class="$style.tabsScroll">
      <button
        v-for="(group, gi) in visibleGroups"
        :key="groupPrimaryId(group)"
        class="_button"
        :class="[
          $style.tab,
          { [$style.tabActive]: activeColumnIndex === gi },
          isGroupSpotlighted(group) && $style.spotlighted,
        ]"
        @click="
          group.forEach((id) => spotlightStore.clear(columnTargetId(id)));
          clearBadge(columnType(groupPrimaryId(group)));
          emit('scroll-to-column', gi)
        "
      >
        <div :class="$style.iconWrap">
          <i :class="'ti ti-' + columnIcon(groupPrimaryId(group))" />
          <span v-if="group.length > 1" :class="$style.stackBadge">{{ group.length }}</span>
          <span v-if="getBadge(columnType(groupPrimaryId(group))) > 0" :key="getBadge(columnType(groupPrimaryId(group)))" :class="$style.badge">{{ getBadge(columnType(groupPrimaryId(group))) > 99 ? '99+' : getBadge(columnType(groupPrimaryId(group))) }}</span>
          <ColumnBadges :account-id="columnAccountId(groupPrimaryId(group))" :size="14" />
        </div>
      </button>
      <button
        class="_button"
        :class="$style.tab"
        :title="i18n.ts._commands.addColumn"
        @click="onAddColumnClick()"
      >
        <i class="ti ti-plus" />
      </button>
    </div>

    <div :class="$style.right">
      <!-- 軽い成功・情報 (コピーしました等) はカードを出さずここで短く知らせる -->
      <span
        v-if="statusT.visible.value && shownStatus"
        :class="[$style.status, statusT.leaving.value && $style.statusLeave]"
        role="status"
      >
        <i :class="shownStatus.type === 'success' ? 'ti ti-check' : 'ti ti-info-circle'" />
        <span :class="$style.statusText">{{ shownStatus.text }}</span>
      </span>
      <button
        class="_button"
        :class="[$style.actionBtn, $style.settingsBtn]"
        :title="i18n.ts._deckBottomBar.deckSettings"
        @click="onSettingsClick()"
      >
        <i class="ti ti-settings" />
      </button>
      <NotificationBell />
    </div>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;
@use '@/styles/spotlight' as *;
.root {
  --bar-item-size: 42px;
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
  margin-left: calc(-1 * var(--nd-nav-resize-handle));
  padding-left: var(--nd-nav-resize-handle);
  // 本家のボトムバーもナビバーも境界線を持たない。面は背景色だけで分ける (#1045)
  background: color-mix(in srgb, var(--nd-navBg) 50%, var(--nd-deckBg, #1a1a1a));
}

.left {
  flex: 0 0 auto;
  height: 100%;
}

.right {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  height: 100%;
  padding-right: 4px;
}

.profileIndicator {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 12px;
  color: var(--nd-accent);
  font-size: var(--nd-font-body);
  white-space: nowrap;
  opacity: 0.7;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base),
    color var(--nd-duration-base);

  &:hover {
    opacity: 1;
    color: var(--nd-fg);
    background: var(--nd-buttonHoverBg);
  }

  .ti {
    @include nav-icon;
    flex-shrink: 0;
    color: var(--nd-accent);
  }
}

.profileName {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.tabsScroll {
  display: flex;
  align-items: stretch;
  justify-content: center;
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
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
  min-width: var(--bar-item-size);
  padding: 10px 8px;
  color: var(--nd-fg);
  opacity: 0.4;
  --column-badge-border: var(--nd-navBg);
  transition: opacity var(--nd-duration-base), color var(--nd-duration-base),
    background var(--nd-duration-base);

  :global(.ti) { @include nav-icon; }

  &:hover {
    opacity: 0.8;
    background: var(--nd-buttonHoverBg);
  }
}

.tabActive {
  opacity: 1;
  color: var(--nd-accent);

  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 50%;
    translate: -50% 0;
    width: 20px;
    height: 3px;
    border-radius: var(--nd-radius-xs) var(--nd-radius-xs) 0 0;
    background: var(--nd-accent);
  }
}

.stackBadge { @include nav-stack-badge; }
.badge { @include nav-badge; }

// AI 操作の可視化 (Spotlight): 視覚仕様は @/styles/_spotlight.scss に集約。
// 既存 .tabActive が ::after で短い緑バーを描いているので、spotlight 中は
// それを隠して朱色のハイライトだけ見せる。
.spotlighted {
  @include spotlight-fill;

  &.tabActive::after {
    display: none;
  }
}

.actionBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--bar-item-size);
  height: var(--bar-item-size);
  font-size: 16px;
  color: var(--nd-fg);
  opacity: 0.5;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.settingsBtn {
  position: relative;
}

.status {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 320px;
  padding: 0 10px;
  font-size: var(--nd-font-sm);
  color: var(--nd-fg);
  opacity: 0.75;
  animation: statusIn var(--nd-duration-slow) var(--nd-ease-decel) both;
}

/* 退場: useVaporTransition の leaveDuration (200ms) 以内 */
.statusLeave {
  animation: statusOut var(--nd-duration-base) var(--nd-ease-decel) both;
}

.statusText {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes statusIn {
  from { opacity: 0; translate: 0 4px; }
}

@keyframes statusOut {
  to { opacity: 0; }
}

.updateDot { @include update-dot(6px, 6px); }

</style>

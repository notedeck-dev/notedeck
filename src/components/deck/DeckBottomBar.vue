<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCommandStore } from '@/commands/registry'
import ColumnBadges from '@/components/common/ColumnBadges.vue'
import { useColumnBadge } from '@/composables/useColumnBadge'
import { useColumnTabs } from '@/composables/useColumnTabs'
import { columnTargetId, useSpotlightStore } from '@/composables/useSpotlight'
import type { ColumnType, DeckColumn } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
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
  const profile = deckStore.currentProfileName ?? 'プロファイル'
  const os = platformName ? (platformLabel[platformName] ?? platformName) : null
  return os ? `${os}: ${profile}` : profile
})

function onProfileClick() {
  commandStore.openWithInput('~')
}

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
        title="プロファイル切替"
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
        title="カラムを追加"
        @click="onAddColumnClick()"
      >
        <i class="ti ti-plus" />
      </button>
    </div>

    <div :class="$style.right">
      <button
        class="_button"
        :class="[$style.actionBtn, $style.settingsBtn]"
        title="デッキ設定"
        @click="onSettingsClick()"
      >
        <i class="ti ti-settings" />
      </button>
    </div>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;
.root {
  --bar-item-size: 42px;
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
  margin-left: calc(-1 * (var(--nd-nav-resize-handle) + var(--nd-nav-border)));
  padding-left: calc(var(--nd-nav-resize-handle) + var(--nd-nav-border));
  background: color-mix(in srgb, var(--nd-navBg) 50%, var(--nd-deckBg, #1a1a1a));
  box-shadow: 0 -0.5px 0 0 var(--nd-divider);
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
  font-size: 0.95em;
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
    border-radius: 3px 3px 0 0;
    background: var(--nd-accent);
  }
}

.stackBadge { @include nav-stack-badge; }
.badge { @include nav-badge; }

// AI 操作の可視化 (Spotlight): Windows タスクバーの「新規起動」インジケーター風。
// 朱色 #E34234 背景 + オレンジグラデーション枠線 + 上向き glow。
// Misskey accent (#86b300, 黄緑) との warm/cool 対比で「AI 由来の出来事」を
// 視覚的に分離しつつ、補色ではないので馴染む。
//
// 既存 .tabActive が ::after で短い緑バーを描いているので、spotlight 中は
// それを隠して朱色バー (より長い) だけ見せる。
.spotlighted {
  position: relative;
  isolation: isolate;

  // spotlight 中は既存アクティブバー (緑) と被らないよう隠す
  &.tabActive::after {
    display: none;
  }

  // アイテム全体をクリーム→オレンジ→朱色のグラデで塗りつぶす
  // 3 ストップで明度差を作ることでグラデが視認できる。alpha 0.85 で軽く透過。
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

  // 子要素 (アイコン/バッジ) を色レイヤーより上に持ち上げる
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

.updateDot { @include update-dot(6px, 6px); }

</style>

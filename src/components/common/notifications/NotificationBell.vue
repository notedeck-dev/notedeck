<script setup lang="ts">
// アプリの通知の受信トレイを開くボタン (ボトムバー用)。未読があればバッジで
// 数を出す。スマホサイズのドロワーでは DeckNavbar が同じ操作の項目を持つ
import { i18n } from '@/i18n'
import { useToast } from '@/stores/toast'

const { unreadCount, inboxOpen, setInboxOpen } = useToast()
</script>

<template>
  <button
    class="_button"
    data-notification-bell
    :class="$style.barBtn"
    :title="i18n.ts._notificationCenter.title"
    :aria-expanded="inboxOpen"
    @click="setInboxOpen(!inboxOpen)"
  >
    <span :class="$style.iconWrap">
      <i class="ti ti-inbox" />
      <span
        v-if="unreadCount > 0"
        :key="unreadCount"
        :class="$style.badge"
        :aria-label="i18n.tsx._notificationCenter.unread({ count: unreadCount })"
      >{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
    </span>
  </button>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.iconWrap {
  position: relative;
  display: inline-flex;
}

.badge {
  @include nav-badge;
}

.barBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--bar-item-size, 42px);
  height: var(--bar-item-size, 42px);
  font-size: 16px;
  color: var(--nd-fg);
  opacity: 0.5;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover,
  &[aria-expanded='true'] {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}
</style>

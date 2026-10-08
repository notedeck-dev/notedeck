<script setup lang="ts">
// アプリの通知の受信トレイ (VS Code の通知センター)。ベル (NotificationBell)
// で開く。デスクトップはボトムバーの上に出るパネル、スマホサイズは
// ボトムシート。開閉状態は stores/toast の inboxOpen が持つ
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { useNativePopover } from '@/composables/useNativePopover'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { useToast } from '@/stores/toast'
import { useIsCompactLayout } from '@/stores/ui'
import NotificationInboxList from './NotificationInboxList.vue'

const { inboxOpen, setInboxOpen } = useToast()
const isCompact = useIsCompactLayout()

function close() {
  setInboxOpen(false)
}

const { visible, entering, leaving } = useVaporTransition(inboxOpen, {
  enterDuration: 200,
  leaveDuration: 200,
})

// --- デスクトップ: パネル (popover で top layer に出す) ---
const panelRef = ref<HTMLElement | null>(null)
useNativePopover(
  panelRef,
  computed(() => visible.value && !isCompact.value),
)

// 外側を押したら閉じる。ベル自身は開閉のトグルなので除く
function onPointerDown(e: PointerEvent) {
  const target = e.target as Element | null
  if (!target || panelRef.value?.contains(target)) return
  if (target.closest('[data-notification-bell]')) return
  close()
}
watch(
  () => inboxOpen.value && !isCompact.value,
  (on) => {
    if (on) {
      // 開いたクリック自体を拾わない
      setTimeout(() => document.addEventListener('pointerdown', onPointerDown))
    } else {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  },
)
onScopeDispose(() => document.removeEventListener('pointerdown', onPointerDown))

// --- スマホサイズ: ボトムシート ---
const dialogRef = ref<HTMLDialogElement | null>(null)
useNativeDialog(
  dialogRef,
  computed(() => visible.value && isCompact.value),
  { onCancel: close, leaveDuration: 200 },
)
</script>

<template>
  <template v-if="visible">
    <dialog
      v-if="isCompact"
      ref="dialogRef"
      class="_nativeDialog"
      :class="[$style.mobileBackdrop, leaving ? $style.sheetBackdropLeave : $style.sheetBackdropEnter]"
    >
      <div
        tabindex="-1"
        :class="[$style.sheet, leaving ? $style.sheetContentLeave : $style.sheetContentEnter]"
        @pointerdown.stop
      >
        <NotificationInboxList @close="close" />
      </div>
    </dialog>
    <div
      v-else
      ref="panelRef"
      popover="manual"
      :class="[$style.panel, entering && $style.panelEnter, leaving && $style.panelLeave]"
      @keydown.esc="close"
    >
      <NotificationInboxList @close="close" />
    </div>
  </template>
</template>

<style lang="scss" module>
@use '@/styles/navMenu';

.panel {
  position: fixed;
  inset: auto 12px 54px auto;
  margin: 0;
  width: min(420px, calc(100vw - 24px));
  max-height: min(480px, calc(100vh - 120px));
  display: flex;
  flex-direction: column;
  padding: 0;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-md);
  background: var(--nd-popup);
  color: var(--nd-fg);
  box-shadow: var(--nd-shadow-l);
  overflow: hidden;
}

.panelEnter {
  animation: panelIn var(--nd-duration-slow) var(--nd-ease-decel) both;
}

/* 退場の時間は useVaporTransition の leaveDuration (200ms) 以内 */
.panelLeave {
  animation: panelOut var(--nd-duration-base) var(--nd-ease-decel) both;
}

@keyframes panelIn {
  from { opacity: 0; translate: 0 8px; }
}

@keyframes panelOut {
  to { opacity: 0; translate: 0 8px; }
}

.sheet {
  width: 100%;
  margin: 0;
  border-radius: 16px 16px 0 0;
  background: color-mix(in srgb, var(--nd-navBg) 96%, transparent);
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.3);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: var(--nd-safe-area-bottom, env(safe-area-inset-bottom));

  &:focus,
  &:focus-visible {
    outline: none;
  }
}
</style>

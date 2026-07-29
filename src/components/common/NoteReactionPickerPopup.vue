<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, defineAsyncComponent, ref, useCssModule } from 'vue'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { useNativePopover } from '@/composables/useNativePopover'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { useUiStore } from '@/stores/ui'
import { COLUMN_SELECTOR, extractThemeVars } from '@/utils/themeVars'

const MkReactionPicker = defineAsyncComponent(
  () => import('./MkReactionPicker.vue'),
)

const props = defineProps<{
  serverHost: string
  accountId: string
}>()

const emit = defineEmits<{
  pick: [reaction: string]
  close: []
}>()

const $style = useCssModule()
const { isCompactLayout: isCompact } = storeToRefs(useUiStore())
const show = ref(false)
// 右端揃え。left + translateX(-100%) だと中身 (async component) がロード
// されるまで幅 0 で左端が右端に来てしまい、初回だけ隣のカラムにはみ出して
// から本来の位置に飛ぶ。right 指定なら幅に依存せず最初から確定する。
const pos = ref({ right: 0, y: 0 })
const theme = ref<Record<string, string>>({})
const pickerRef = ref<HTMLElement | null>(null)
const dialogRef = ref<HTMLDialogElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)

const { visible, leaving } = useVaporTransition(show, {
  enterDuration: 200,
  leaveDuration: 200,
})

// Desktop: popover (top layer, outside-click dismiss)
useNativePopover(
  pickerRef,
  computed(() => visible.value && !isCompact.value),
  {
    onClose: () => close(),
    leaveDuration: 200,
    dismissOnOutsideClick: true,
    ignoreOutsideClickFor: triggerRef,
  },
)

// Mobile: dialog (top layer + dark backdrop)
useNativeDialog(
  dialogRef,
  computed(() => visible.value && isCompact.value),
  {
    onCancel: () => close(),
    leaveDuration: 200,
  },
)

const contentClass = computed(() => [
  $style.reactionPickerPopup,
  leaving.value
    ? isCompact.value
      ? $style.sheetContentLeave
      : $style.popupContentLeave
    : isCompact.value
      ? $style.sheetContentEnter
      : $style.popupContentEnter,
])

function open(anchor: MouseEvent | HTMLElement) {
  const btn =
    anchor instanceof HTMLElement
      ? anchor
      : (anchor.currentTarget as HTMLElement)
  triggerRef.value = btn
  const rect = btn.getBoundingClientRect()
  const column = btn.closest(COLUMN_SELECTOR) as HTMLElement | null
  const colRect = column?.getBoundingClientRect()
  const rightEdge = colRect ? colRect.right - 8 : rect.right
  pos.value = {
    right: document.documentElement.clientWidth - rightEdge,
    y: rect.bottom + 4,
  }
  if (column) theme.value = extractThemeVars(column)
  if (show.value) {
    close()
  } else {
    show.value = true
  }
}

function close() {
  show.value = false
  emit('close')
}

defineExpose({ open })
</script>

<template>
  <!-- Desktop: popover -->
  <div
    v-if="visible && !isCompact"
    ref="pickerRef"
    popover="manual"
    :class="contentClass"
    :style="{ ...theme, top: pos.y + 'px', right: pos.right + 'px' }"
  >
    <MkReactionPicker
      :server-host="serverHost"
      :account-id="accountId"
      @pick="(r: string) => { emit('pick', r); close() }"
    />
  </div>

  <!-- Mobile: dialog (bottom sheet with dark backdrop) -->
  <dialog
    v-if="visible && isCompact"
    ref="dialogRef"
    class="_nativeDialog"
    :class="[
      $style.mobileBackdrop,
      leaving ? $style.sheetLeave : $style.sheetEnter,
    ]"
  >
    <div
      autofocus
      tabindex="-1"
      :class="contentClass"
      :style="theme"
    >
      <MkReactionPicker
        :server-host="serverHost"
        :account-id="accountId"
        @pick="(r: string) => { emit('pick', r); close() }"
      />
    </div>
  </dialog>
</template>

<style lang="scss" module>
.reactionPickerPopup {
  position: fixed;
  transform-origin: top right;
  background: color-mix(in srgb, var(--nd-popup, var(--nd-panel)) 96%, transparent);
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  contain: layout paint;

  .mobileBackdrop & {
    position: static;
    width: 100%;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.3);
    padding-bottom: var(--nd-safe-area-bottom, env(safe-area-inset-bottom));
  }
}

:global(dialog._nativeDialog[open]).mobileBackdrop {
  align-items: flex-end;
  justify-content: stretch;
}

/* Desktop popup content — scale + fade */
.popupContentEnter { animation: reactionPickerIn 0.2s var(--nd-ease-spring); }
.popupContentLeave { animation: reactionPickerOut var(--nd-duration-fast) var(--nd-ease-decel) forwards; }
@keyframes reactionPickerIn { from { opacity: 0; transform: scale(0.85); } }
@keyframes reactionPickerOut { to { opacity: 0; transform: scale(0.9); } }

/* Mobile sheet backdrop */
.sheetEnter { animation: sheetBdIn var(--nd-duration-base) var(--nd-ease-decel); }
.sheetLeave { animation: sheetBdOut var(--nd-duration-base) ease-out forwards; }
@keyframes sheetBdIn { from { opacity: 0; } }
@keyframes sheetBdOut { to { opacity: 0; } }

/* Mobile sheet content — slide up from bottom */
.sheetContentEnter { animation: sheetIn 0.25s var(--nd-ease-spring); }
.sheetContentLeave { animation: sheetOut 0.2s var(--nd-ease-decel) forwards; }
@keyframes sheetIn { from { transform: translateY(100%); } }
@keyframes sheetOut { to { transform: translateY(100%); } }

</style>

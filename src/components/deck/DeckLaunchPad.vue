<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, nextTick, ref, useCssModule, watch } from 'vue'
import {
  ACCOUNT_INDEPENDENT_TYPES,
  ALL_COLUMN_TYPES,
  COLUMN_ICONS,
  COLUMN_LABELS,
  COLUMN_REGISTRY,
  CROSS_ACCOUNT_TYPES,
} from '@/columns/registry'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { type ColumnType, isNavDivider, useDeckStore } from '@/stores/deck'
import { useUiStore } from '@/stores/ui'
import { hapticLight } from '@/utils/haptics'

const props = defineProps<{
  anchor?: { x: number; y: number } | null
}>()

const emit = defineEmits<{
  close: []
}>()

const $style = useCssModule()
const deckStore = useDeckStore()
const { isCompactLayout: isCompact } = storeToRefs(useUiStore())

const dialogRef = ref<HTMLDialogElement | null>(null)
const popupRef = ref<HTMLElement | null>(null)
const show = ref(true)

const { visible, leaving } = useVaporTransition(show, {
  enterDuration: 200,
  leaveDuration: 200,
})

useNativeDialog(dialogRef, visible, {
  onCancel: () => close(),
  leaveDuration: 200,
})

const navTypes = computed<Set<string>>(() => {
  const set = new Set<string>()
  for (const item of deckStore.navItems) {
    if (!isNavDivider(item)) set.add(item.type)
  }
  return set
})

const items = computed<ColumnType[]>(() =>
  ALL_COLUMN_TYPES.filter((t) => {
    if (navTypes.value.has(t)) return false
    const spec = COLUMN_REGISTRY[t]
    if (spec?.selectable) return false
    return CROSS_ACCOUNT_TYPES.has(t) || ACCOUNT_INDEPENDENT_TYPES.has(t)
  }),
)

const contentClass = computed(() => {
  if (isCompact.value) {
    return [
      $style.popup,
      leaving.value ? $style.sheetContentLeave : $style.sheetContentEnter,
    ]
  }
  if (props.anchor) {
    return [
      $style.popup,
      $style.anchored,
      leaving.value ? $style.anchoredLeave : $style.anchoredEnter,
    ]
  }
  return [
    $style.popup,
    leaving.value ? $style.popupContentLeave : $style.popupContentEnter,
  ]
})

const popupStyle = computed(() => {
  if (isCompact.value || !props.anchor) return undefined
  return {
    position: 'fixed' as const,
    left: `${props.anchor.x}px`,
    top: `${props.anchor.y}px`,
  }
})

// アンカー指定時：popup の高さを測って画面内に収まるよう top を clamp
watch(
  [visible, () => props.anchor],
  async ([v, anchor]) => {
    if (!v || !anchor || isCompact.value) return
    await nextTick()
    const el = popupRef.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vh = document.documentElement.clientHeight
    const halfH = rect.height / 2
    const clamped = Math.max(8 + halfH, Math.min(anchor.y, vh - 8 - halfH))
    el.style.top = `${clamped}px`
  },
  { immediate: true },
)

function selectItem(type: ColumnType) {
  hapticLight()
  deckStore.toggleSidebarColumn(type, null)
  close()
}

function close() {
  show.value = false
  setTimeout(() => emit('close'), 220)
}
</script>

<template>
  <dialog
    v-if="visible"
    ref="dialogRef"
    class="_nativeDialog"
    :class="[
      $style.overlay,
      isCompact && $style.mobileBackdrop,
      leaving ? $style.sheetLeave : $style.sheetEnter,
    ]"
  >
    <div
      ref="popupRef"
      autofocus
      tabindex="-1"
      class="_popup"
      :class="contentClass"
      :style="popupStyle"
    >
      <div :class="$style.grid">
        <button
          v-for="t in items"
          :key="t"
          class="_button"
          :class="$style.item"
          @click="selectItem(t)"
        >
          <i class="ti" :class="[$style.icon, `ti-${COLUMN_ICONS[t]}`]" />
          <span :class="$style.label">{{ COLUMN_LABELS[t] }}</span>
        </button>
      </div>
    </div>
  </dialog>
</template>

<style lang="scss" module>
.overlay {
  background: transparent;
  border: none;
  padding: 0;
  max-width: 100vw;
  max-height: 100vh;
  width: 100%;
  height: 100%;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

dialog.overlay::backdrop {
  background: rgba(0, 0, 0, 0.08);
}

:global(dialog._nativeDialog[open]).mobileBackdrop {
  align-items: flex-end;
  justify-content: stretch;
}

.popup {
  width: min(360px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  padding: 8px;
  color: var(--nd-fg);
  border-radius: 16px;
  overflow: auto;
  overscroll-behavior: contain;
  box-sizing: border-box;
  outline: none;

  .mobileBackdrop & {
    width: 100%;
    max-height: 75vh;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.3);
    padding-bottom: max(20px, var(--nd-safe-area-bottom, env(safe-area-inset-bottom)));
  }
}

.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2px;
}

.item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  padding: 4px;
  border-radius: 6px;
  color: var(--nd-fg);
  transition: background var(--nd-duration-fast), color var(--nd-duration-fast);

  &:hover {
    background: var(--nd-buttonHoverBg);
    color: var(--nd-fgHighlighted);
  }
}

.icon {
  font-size: 22px;
  height: 22px;
  line-height: 1;
}

.label {
  margin-top: 6px;
  font-size: 0.76em;
  line-height: 1.3em;
  text-align: center;
  word-break: break-word;
}

/* Desktop popup content — scale + fade (no anchor) */
.popupContentEnter { animation: launchPadIn 0.2s var(--nd-ease-spring); }
.popupContentLeave { animation: launchPadOut var(--nd-duration-fast) var(--nd-ease-decel) forwards; }
@keyframes launchPadIn { from { opacity: 0; transform: scale(0.9); } }
@keyframes launchPadOut { to { opacity: 0; transform: scale(0.95); } }

/* Desktop popup content — anchored (origin: navbar 'もっと' button) */
.anchored {
  transform: translateY(-50%);
  transform-origin: left center;
}

.anchoredEnter { animation: anchoredIn 0.2s var(--nd-ease-spring); }
.anchoredLeave { animation: anchoredOut var(--nd-duration-fast) var(--nd-ease-decel) forwards; }
@keyframes anchoredIn {
  from { opacity: 0; transform: translateY(-50%) scale(0.85); }
  to { opacity: 1; transform: translateY(-50%) scale(1); }
}
@keyframes anchoredOut {
  to { opacity: 0; transform: translateY(-50%) scale(0.92); }
}

/* Mobile sheet backdrop fade */
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

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { computed, nextTick, ref, toRef, useTemplateRef, watch } from 'vue'

import { refreshProfileCommands } from '@/commands/definitions'
import { switchProfileWithWindows } from '@/composables/useDeckWindow'
import { useMenuKeyboard } from '@/composables/useMenuKeyboard'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { usePointerReorder } from '@/composables/usePointerReorder'
import { usePortal } from '@/composables/usePortal'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { useConfirm } from '@/stores/confirm'
import { useDeckStore } from '@/stores/deck'
import { useDeckProfileStore } from '@/stores/deckProfile'
import { useIsCompactLayout } from '@/stores/ui'
import { useWindowsStore } from '@/stores/windows'

const props = defineProps<{
  show: boolean
  anchor?: HTMLElement | null
}>()

const emit = defineEmits<{
  close: []
}>()

const deckStore = useDeckStore()
const profileStore = useDeckProfileStore()
const windowsStore = useWindowsStore()
const isCompact = useIsCompactLayout()

const { visible: menuVisible, leaving: menuLeaving } = useVaporTransition(
  toRef(props, 'show'),
  { enterDuration: 180, leaveDuration: 180 },
)

const profiles = computed(() => profileStore.getProfiles())
const menuEl = ref<HTMLElement | null>(null)
const fixedStyle = ref<CSSProperties | undefined>()
const dialogRef = ref<HTMLDialogElement | null>(null)

useNativeDialog(
  dialogRef,
  computed(() => menuVisible.value && isCompact.value),
  {
    onCancel: () => emit('close'),
    leaveDuration: 180,
  },
)

const { activate: activateKeyboard, deactivate: deactivateKeyboard } =
  useMenuKeyboard({
    containerRef: menuEl,
    itemSelector: 'button, [tabindex="0"]',
    onClose: () => emit('close'),
  })

watch(
  () => props.show,
  (val) => {
    if (val) {
      if (props.anchor && !isCompact.value) {
        const rect = props.anchor.getBoundingClientRect()
        fixedStyle.value = {
          position: 'fixed',
          bottom: `${window.innerHeight - rect.top + 4}px`,
          left: `${rect.left}px`,
        }
      } else {
        fixedStyle.value = undefined
      }
      if (!isCompact.value) nextTick(activateKeyboard)
    } else {
      deactivateKeyboard()
    }
  },
  { immediate: true },
)

function createProfile() {
  deckStore.saveAsProfile()
  refreshProfileCommands()
}

let switching = false

async function apply(id: string) {
  if (switching) return
  switching = true
  try {
    await switchProfileWithWindows(id)
  } catch (e) {
    console.warn('[profile] switch failed:', e)
  } finally {
    switching = false
  }
}

const { confirm } = useConfirm()

async function remove(id: string) {
  const ok = await confirm({
    title: 'プロファイルを削除',
    message: 'このプロファイルを削除しますか？',
    okLabel: '削除',
    type: 'danger',
  })
  if (!ok) return
  deckStore.deleteProfile(id)
  refreshProfileCommands()
}

const profileMenuPortalRef = useTemplateRef<HTMLElement>('profileMenuPortalRef')
usePortal(profileMenuPortalRef)

function openEditor(id: string) {
  windowsStore.open('profileEditor', { profileId: id })
  emit('close')
}

const { dragFromIndex, dragOverIndex, startDrag } = usePointerReorder({
  dataAttr: 'profile-idx',
  onReorder(fromIdx, toIdx) {
    profileStore.reorderProfiles(fromIdx, toIdx)
  },
})
</script>

<template>
  <!-- Desktop: portal-rendered popup -->
  <div v-if="!isCompact && (show || menuVisible)" ref="profileMenuPortalRef">
    <div v-if="show" :class="$style.menuBackdrop" @pointerdown="emit('close')" />
    <div v-if="menuVisible" ref="menuEl" :class="[$style.profileMenu, menuLeaving ? $style.menuLeave : $style.menuEnter]" :style="fixedStyle" class="_popupMenu" @pointerdown.stop>
      <div :class="$style.list">
        <div
          v-for="(p, i) in profiles"
          :key="p.id"
          :data-profile-idx="i"
          :class="[$style.item, { [$style.active]: p.id === deckStore.windowProfileId, [$style.dragging]: dragFromIndex === i, [$style.dragOver]: dragOverIndex === i }]"
          tabindex="0"
          @click="apply(p.id)"
          @keydown.enter="apply(p.id)"
        >
          <i class="ti ti-grip-vertical" :class="$style.grip" @pointerdown="startDrag(i, $event)" />
          <span :class="$style.name">{{ p.name }}</span>
          <button
            class="_button"
            :class="$style.action"
            title="エディタで開く"
            @click.stop="openEditor(p.id)"
          >
            <i class="ti ti-pencil" />
          </button>
          <button
            class="_button"
            :class="[$style.action, $style.deleteAction]"
            title="削除"
            @click.stop="remove(p.id)"
          >
            <i class="ti ti-trash" />
          </button>
        </div>
      </div>

      <div v-if="profiles.length === 0" :class="$style.empty">
        保存されたプロファイルはありません
      </div>

      <div :class="$style.divider" />

      <div :class="[$style.item, $style.newItem]" tabindex="0" @click="createProfile" @keydown.enter="createProfile">
        <i class="ti ti-plus" />
        <span>新規プロファイル</span>
      </div>

    </div>
  </div>

  <!-- Mobile: bottom sheet via native <dialog> -->
  <dialog
    v-if="isCompact && menuVisible"
    ref="dialogRef"
    class="_nativeDialog"
    :class="[$style.mobileBackdrop, menuLeaving ? $style.sheetBackdropLeave : $style.sheetBackdropEnter]"
  >
    <div autofocus tabindex="-1" ref="menuEl" :class="[$style.profileMenu, $style.mobile, menuLeaving ? $style.sheetContentLeave : $style.sheetContentEnter]" class="_popupMenu" @pointerdown.stop>
      <div :class="$style.list">
        <div
          v-for="(p, i) in profiles"
          :key="p.id"
          :data-profile-idx="i"
          :class="[$style.item, { [$style.active]: p.id === deckStore.windowProfileId, [$style.dragging]: dragFromIndex === i, [$style.dragOver]: dragOverIndex === i }]"
          tabindex="0"
          @click="apply(p.id)"
          @keydown.enter="apply(p.id)"
        >
          <i class="ti ti-grip-vertical" :class="$style.grip" @pointerdown="startDrag(i, $event)" />
          <span :class="$style.name">{{ p.name }}</span>
          <button
            class="_button"
            :class="$style.action"
            title="エディタで開く"
            @click.stop="openEditor(p.id)"
          >
            <i class="ti ti-pencil" />
          </button>
          <button
            class="_button"
            :class="[$style.action, $style.deleteAction]"
            title="削除"
            @click.stop="remove(p.id)"
          >
            <i class="ti ti-trash" />
          </button>
        </div>
      </div>

      <div v-if="profiles.length === 0" :class="$style.empty">
        保存されたプロファイルはありません
      </div>

      <div :class="$style.divider" />

      <div :class="[$style.item, $style.newItem]" tabindex="0" @click="createProfile" @keydown.enter="createProfile">
        <i class="ti ti-plus" />
        <span>新規プロファイル</span>
      </div>
    </div>
  </dialog>
</template>

<style lang="scss" module>
@use '@/styles/navMenu';

.menuBackdrop {
  position: fixed;
  inset: 0;
  z-index: var(--nd-z-popup) !important;
}

.profileMenu {
  z-index: calc(var(--nd-z-popup) + 1) !important;
  bottom: 100%;
  left: 0;
  margin-bottom: 4px;
  min-width: 180px;
  max-width: 260px;
}

.list {
  padding: 2px 0;
}

.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 0.85em;
  line-height: 20px;
  color: var(--nd-fg);
  position: relative;

  &::before {
    content: '';
    display: block;
    position: absolute;
    inset: 2px 8px;
    border-radius: var(--nd-radius-sm);
    transition: background var(--nd-duration-fast);
  }

  &:hover::before {
    background: var(--nd-accent-hover);
  }
}

.active {
  color: var(--nd-accent);
  font-weight: 600;

  &::before {
    background: var(--nd-accent-subtle);
  }
}

.dragging {
  opacity: 0.3;
}

.dragOver {
  outline: 2px solid var(--nd-accent);
  outline-offset: -2px;
  border-radius: var(--nd-radius-sm);
}

.grip {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--nd-fg);
  opacity: 0.2;
  cursor: grab;
  touch-action: none;
  padding: 8px 4px;
  margin: -8px -4px;
  position: relative;
}

.name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;
}

.action {
  display: none;
  flex-shrink: 0;
  color: var(--nd-fg);
  opacity: 0.4;
  padding: 2px;
  position: relative;
  transition: opacity var(--nd-duration-fast);

  .item:hover & {
    display: flex;
  }

  &:hover {
    opacity: 1;
  }
}

.deleteAction {
  &:hover {
    color: var(--nd-love, #ff6b6b);
  }
}

.divider {
  height: 1px;
  background: var(--nd-divider);
  margin: 4px 12px;
}

.empty {
  padding: 12px 16px;
  font-size: 0.85em;
  color: var(--nd-fg);
  opacity: 0.4;
  text-align: center;
}

.newItem {
  opacity: 0.7;

  &:hover {
    opacity: 1;
  }

  i, span {
    position: relative;
  }
}

/* Mobile overrides — bottom sheet inside <dialog class="_nativeDialog"> */
.mobile {
  &.profileMenu {
    position: static;
    width: 100%;
    max-width: none;
    min-width: 0;
    margin: 0;
    border-radius: 16px 16px 0 0;
    background: color-mix(in srgb, var(--nd-navBg) 96%, transparent);
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.3);
    padding: 4px 0 calc(4px + var(--nd-safe-area-bottom, env(safe-area-inset-bottom)));

    &:focus,
    &:focus-visible {
      outline: none;
    }
  }

  .item {
    padding: 8px 12px;
    min-height: 44px;
    font-size: 0.85em;
    gap: 8px;
  }

  .action {
    display: flex;
    padding: 8px;
  }

  .newItem {
    min-height: 44px;
    gap: 12px;
  }

  .divider {
    margin: 4px 12px;
  }

  .empty {
    padding: 16px;
  }
}

</style>

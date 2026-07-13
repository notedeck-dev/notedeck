<script setup lang="ts">
import { computed, ref, toRef } from 'vue'

import { refreshProfileCommands } from '@/commands/definitions'
import { switchProfileWithWindows } from '@/composables/useDeckWindow'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { useConfirm } from '@/stores/confirm'
import { useDeckStore } from '@/stores/deck'
import { useDeckProfileStore } from '@/stores/deckProfile'
import { useToast } from '@/stores/toast'
import { useWindowsStore } from '@/stores/windows'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const deckStore = useDeckStore()
const profileStore = useDeckProfileStore()
const windowsStore = useWindowsStore()

const { visible: menuVisible, leaving: menuLeaving } = useVaporTransition(
  toRef(props, 'show'),
  { enterDuration: 180, leaveDuration: 180 },
)

const profiles = computed(() => profileStore.getProfiles())
const dialogRef = ref<HTMLDialogElement | null>(null)

useNativeDialog(
  dialogRef,
  computed(() => menuVisible.value),
  {
    onCancel: () => emit('close'),
    leaveDuration: 180,
  },
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
    emit('close')
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
  const undo = deckStore.deleteProfile(id)
  refreshProfileCommands()
  if (undo) {
    useToast().show('プロファイルを削除しました', 'info', {
      action: {
        label: '元に戻す',
        onClick: () => {
          undo()
          refreshProfileCommands()
        },
      },
    })
  }
}

function openEditor(id: string) {
  windowsStore.open('profileEditor', { profileId: id })
  emit('close')
}
</script>

<template>
  <dialog
    v-if="menuVisible"
    ref="dialogRef"
    class="_nativeDialog"
    :class="[$style.mobileBackdrop, menuLeaving ? $style.sheetBackdropLeave : $style.sheetBackdropEnter]"
  >
    <div
      autofocus
      tabindex="-1"
      class="_popupMenu"
      :class="[$style.profileMenu, menuLeaving ? $style.sheetContentLeave : $style.sheetContentEnter]"
      @pointerdown.stop
    >
      <div :class="$style.list">
        <div
          v-for="p in profiles"
          :key="p.id"
          :class="[$style.item, { [$style.active]: p.id === deckStore.windowProfileId }]"
          tabindex="0"
          @click="apply(p.id)"
          @keydown.enter="apply(p.id)"
        >
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

.profileMenu {
  width: 100%;
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

.list {
  padding: 2px 0;
}

.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  min-height: 44px;
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

.name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;
}

.action {
  display: flex;
  flex-shrink: 0;
  color: var(--nd-fg);
  opacity: 0.4;
  padding: 8px;
  position: relative;
  transition: opacity var(--nd-duration-fast);

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
  padding: 16px;
  font-size: 0.85em;
  color: var(--nd-fg);
  opacity: 0.4;
  text-align: center;
}

.newItem {
  opacity: 0.7;
  min-height: 44px;
  gap: 12px;

  &:hover {
    opacity: 1;
  }

  i, span {
    position: relative;
  }
}
</style>

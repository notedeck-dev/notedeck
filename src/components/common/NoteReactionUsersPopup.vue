<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { useHoverPopup } from '@/composables/useHoverPopup'
import { useNativePopover } from '@/composables/useNativePopover'
import { extractColumnThemeVars } from '@/utils/themeVars'

const MkReactionUsersPopup = defineAsyncComponent(
  () => import('./MkReactionUsersPopup.vue'),
)

defineProps<{
  noteId: string
  accountId: string
  serverHost: string
}>()

const emit = defineEmits<{
  openModal: [reaction: string]
}>()

const popup = useHoverPopup({
  hideDelay: 300,
  hideGuardSelector: '.reaction-users-popup',
  // MkReactionUsersPopup の退場アニメ (_popup.scss の hoverLeave) と同じ時間
  leaveDuration: 150,
})

const reaction = ref('')
const reactionUrl = ref<string | null>(null)
const totalCount = ref(0)
const theme = ref<Record<string, string>>({})

function show(e: MouseEvent, r: string, url: string | null, count: number) {
  popup.cancelHide()
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  reaction.value = r
  reactionUrl.value = url
  totalCount.value = count
  theme.value = extractColumnThemeVars(el)
  popup.show({ x: rect.left, y: rect.bottom + 4 })
}

function hide() {
  popup.hide()
}

const popoverRef = ref<HTMLElement | null>(null)
useNativePopover(popoverRef, popup.isVisible, {
  leaveDuration: 0,
})

defineExpose({ show, hide })
</script>

<template>
  <div v-if="popup.isVisible.value" ref="popoverRef" popover="manual" :style="theme">
    <MkReactionUsersPopup
      :note-id="noteId"
      :account-id="accountId"
      :server-host="serverHost"
      :reaction="reaction"
      :reaction-url="reactionUrl"
      :total-count="totalCount"
      :x="popup.position.value.x"
      :y="popup.position.value.y"
      @close="popup.forceClose()"
      @open-modal="(r: string) => { popup.forceClose(); emit('openModal', r) }"
    />
  </div>
</template>

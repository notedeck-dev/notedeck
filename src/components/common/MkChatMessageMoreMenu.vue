<script setup lang="ts">
import { ref } from 'vue'
import type { ChatMessage } from '@/adapters/types'
import PopupMenu from './PopupMenu.vue'

const props = defineProps<{
  message: ChatMessage
  isMine: boolean
}>()

const emit = defineEmits<{
  delete: [messageId: string]
}>()

const popupMenuRef = ref<InstanceType<typeof PopupMenu>>()
const showDeleteConfirm = ref(false)

function open(e: MouseEvent) {
  popupMenuRef.value?.open(e)
}

function close() {
  popupMenuRef.value?.close()
}

function resetSubViews() {
  showDeleteConfirm.value = false
}

async function copyAndClose(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  close()
}

function confirmDelete() {
  emit('delete', props.message.id)
  close()
}

defineExpose({ open })
</script>

<template>
  <PopupMenu ref="popupMenuRef" @close="resetSubViews">
    <!-- Delete confirm -->
    <template v-if="showDeleteConfirm">
      <div class="_popupConfirmText">このメッセージを削除しますか？</div>
      <button class="_popupItem _popupItemDanger" @click="confirmDelete">
        <i class="ti ti-trash" />
        削除
      </button>
      <button class="_popupItem" @click="showDeleteConfirm = false">
        <i class="ti ti-x" />
        キャンセル
      </button>
    </template>

    <!-- Main menu -->
    <template v-else>
      <button v-if="message.text" class="_popupItem" @click="copyAndClose(message.text!)">
        <i class="ti ti-copy" />
        内容をコピー
      </button>
      <template v-if="isMine">
        <div v-if="message.text" class="_popupDivider" />
        <button class="_popupItem _popupItemDanger" @click="showDeleteConfirm = true">
          <i class="ti ti-trash" />
          削除
        </button>
      </template>
    </template>
  </PopupMenu>
</template>

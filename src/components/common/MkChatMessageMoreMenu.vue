<script setup lang="ts">
import { ref } from 'vue'
import type { ChatMessage } from '@/adapters/types'
import { useMultiAccountAdapters } from '@/composables/useMultiAccountAdapters'
import { useToast } from '@/stores/toast'
import { AppError } from '@/utils/errors'
import PopupMenu from './PopupMenu.vue'

const props = defineProps<{
  message: ChatMessage
  isMine: boolean
  accountId?: string
}>()

const emit = defineEmits<{
  delete: [messageId: string]
  react: [messageId: string]
}>()

const toast = useToast()
const { getOrCreate } = useMultiAccountAdapters()

const popupMenuRef = ref<InstanceType<typeof PopupMenu>>()
const showDeleteConfirm = ref(false)
const showReportForm = ref(false)
const reportComment = ref('')

function open(e: MouseEvent) {
  popupMenuRef.value?.open(e)
}

function close() {
  popupMenuRef.value?.close()
}

function resetSubViews() {
  showDeleteConfirm.value = false
  showReportForm.value = false
  reportComment.value = ''
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

function reactAndClose() {
  emit('react', props.message.id)
  close()
}

function confirmDelete() {
  emit('delete', props.message.id)
  close()
}

async function submitReport() {
  if (!reportComment.value.trim() || !props.accountId) return
  try {
    const adapter = await getOrCreate(props.accountId)
    if (!adapter) return
    await adapter.api.reportUser(props.message.fromUserId, reportComment.value)
    toast.show('通報しました')
    close()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[chat:report]', err.code, err.message)
    toast.show(`通報に失敗しました（${err.displayCode}）`, 'error')
  }
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

    <!-- Report form -->
    <template v-else-if="showReportForm">
      <div class="_popupConfirmText">@{{ message.fromUser?.username }} を通報</div>
      <div class="_popupReportInputWrap">
        <textarea
          v-model="reportComment"
          class="_popupReportInput"
          placeholder="通報理由を入力..."
          rows="3"
        />
      </div>
      <button
        class="_popupItem _popupItemDanger"
        :disabled="!reportComment.trim()"
        @click="submitReport"
      >
        <i class="ti ti-alert-triangle" />
        送信
      </button>
      <button class="_popupItem" @click="showReportForm = false">
        <i class="ti ti-x" />
        キャンセル
      </button>
    </template>

    <!-- Main menu -->
    <template v-else>
      <button class="_popupItem" @click.stop="reactAndClose">
        <i class="ti ti-mood-plus" />
        リアクション
      </button>
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
      <template v-else>
        <div class="_popupDivider" />
        <button class="_popupItem _popupItemDanger" @click="showReportForm = true">
          <i class="ti ti-flag" />
          通報
        </button>
      </template>
    </template>
  </PopupMenu>
</template>

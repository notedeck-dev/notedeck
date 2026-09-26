<script setup lang="ts">
import { ref } from 'vue'
import type { ChatMessage } from '@/adapters/types'
import { useMultiAccountAdapters } from '@/composables/useMultiAccountAdapters'
import { i18n } from '@/i18n'
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
    toast.show(i18n.ts._common.reported)
    close()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[chat:report]', err.code, err.message)
    toast.show(
      i18n.tsx._common.reportFailed({ code: err.displayCode }),
      'error',
    )
  }
}

defineExpose({ open })
</script>

<template>
  <PopupMenu ref="popupMenuRef" @close="resetSubViews">
    <!-- Delete confirm -->
    <template v-if="showDeleteConfirm">
      <div class="_popupConfirmText">{{ i18n.ts._mkChatMessageMoreMenu.confirmDelete }}</div>
      <button class="_popupItem _popupItemDanger" @click="confirmDelete">
        <i class="ti ti-trash" />
        {{ i18n.ts._common.delete }}
      </button>
      <button class="_popupItem" @click="showDeleteConfirm = false">
        <i class="ti ti-x" />
        {{ i18n.ts._common.cancel }}
      </button>
    </template>

    <!-- Report form -->
    <template v-else-if="showReportForm">
      <div class="_popupConfirmText">{{ i18n.tsx._common.reportUser({ username: message.fromUser?.username ?? '' }) }}</div>
      <div class="_popupReportInputWrap">
        <textarea
          v-model="reportComment"
          class="_popupReportInput"
          :placeholder="i18n.ts._common.reportReasonPlaceholder"
          rows="3"
        />
      </div>
      <button
        class="_popupItem _popupItemDanger"
        :disabled="!reportComment.trim()"
        @click="submitReport"
      >
        <i class="ti ti-alert-triangle" />
        {{ i18n.ts._common.send }}
      </button>
      <button class="_popupItem" @click="showReportForm = false">
        <i class="ti ti-x" />
        {{ i18n.ts._common.cancel }}
      </button>
    </template>

    <!-- Main menu -->
    <template v-else>
      <!-- 自分のメッセージにはリアクションできない (本家 ChatService.react が
           fromUserId === userId で throw する) ので導線ごと出さない -->
      <button v-if="!isMine" class="_popupItem" @click.stop="reactAndClose">
        <i class="ti ti-mood-plus" />
        {{ i18n.ts._common.react }}
      </button>
      <button v-if="message.text" class="_popupItem" @click="copyAndClose(message.text!)">
        <i class="ti ti-copy" />
        {{ i18n.ts._mkChatMessageMoreMenu.copyContent }}
      </button>
      <template v-if="isMine">
        <div v-if="message.text" class="_popupDivider" />
        <button class="_popupItem _popupItemDanger" @click="showDeleteConfirm = true">
          <i class="ti ti-trash" />
          {{ i18n.ts._common.delete }}
        </button>
      </template>
      <template v-else>
        <div class="_popupDivider" />
        <button class="_popupItem _popupItemDanger" @click="showReportForm = true">
          <i class="ti ti-flag" />
          {{ i18n.ts._common.report }}
        </button>
      </template>
    </template>
  </PopupMenu>
</template>

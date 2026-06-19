<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NormalizedNote } from '@/adapters/types'
import { useAccountMode } from '@/composables/useAccountMode'
import { showLoginPrompt } from '@/composables/useLoginPrompt'
import { useMultiAccountAdapters } from '@/composables/useMultiAccountAdapters'
import { useNavigation } from '@/composables/useNavigation'
import { useAccountsStore } from '@/stores/accounts'
import { useToast } from '@/stores/toast'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import PopupMenu from './PopupMenu.vue'

const props = defineProps<{
  note: NormalizedNote
}>()

const emit = defineEmits<{
  delete: [note: NormalizedNote]
}>()

const { getOrCreate } = useMultiAccountAdapters()
const toast = useToast()
const accountsStore = useAccountsStore()
const { canInteract, isGuest } = useAccountMode(() => props.note._accountId)
const { navigateToNote } = useNavigation()

const popupMenuRef = ref<InstanceType<typeof PopupMenu>>()
const showDeleteConfirm = ref(false)
const showReportForm = ref(false)
const reportComment = ref('')

type MenuView = 'main' | 'deleteConfirm' | 'reportForm'

const currentView = computed<MenuView>(() => {
  if (showDeleteConfirm.value) return 'deleteConfirm'
  if (showReportForm.value) return 'reportForm'
  return 'main'
})

const isMyRenote = computed(() => {
  const account = accountsStore.accountMap.get(props.note._accountId)
  return account?.userId === props.note.user.id
})

const noteWebUrl = computed(() => {
  const n = props.note
  return n.url ?? n.uri ?? `https://${n._serverHost}/notes/${n.id}`
})

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

function backToMain() {
  resetSubViews()
}

function openRenoteDetail() {
  navigateToNote(props.note._accountId, props.note.id)
  close()
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

async function deleteRenote() {
  try {
    unwrap(await commands.apiDeleteNote(props.note._accountId, props.note.id))
    emit('delete', props.note)
    close()
  } catch (e) {
    const err = AppError.from(e)
    toast.show(`削除に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function submitReport() {
  if (!reportComment.value.trim()) return
  try {
    const adapter = await getOrCreate(props.note._accountId)
    if (!adapter) return
    await adapter.api.reportUser(props.note.user.id, reportComment.value)
    toast.show('通報しました')
    close()
  } catch (e) {
    const err = AppError.from(e)
    toast.show(`通報に失敗しました（${err.displayCode}）`, 'error')
  }
}

defineExpose({ open })
</script>

<template>
  <PopupMenu ref="popupMenuRef" @close="resetSubViews">
    <!-- Delete confirm -->
    <template v-if="currentView === 'deleteConfirm'">
      <div class="_popupConfirmText">このリノートを削除しますか？</div>
      <button class="_popupItem _popupItemDanger" @click="deleteRenote">
        <i class="ti ti-trash" />
        削除
      </button>
      <button class="_popupItem" @click="backToMain">
        <i class="ti ti-x" />
        キャンセル
      </button>
    </template>

    <!-- Report form -->
    <template v-else-if="currentView === 'reportForm'">
      <div class="_popupConfirmText">@{{ note.user.username }} を通報</div>
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
      <button class="_popupItem" @click="backToMain">
        <i class="ti ti-x" />
        キャンセル
      </button>
    </template>

    <!-- Main menu -->
    <template v-else>
      <button class="_popupItem" @click="openRenoteDetail">
        <i class="ti ti-info-circle" />
        リノートの詳細
      </button>
      <button class="_popupItem" @click="copyAndClose(noteWebUrl)">
        <i class="ti ti-link" />
        リノートのリンクをコピー
      </button>
      <div class="_popupDivider" />
      <button v-if="isMyRenote" class="_popupItem _popupItemDanger" @click="showDeleteConfirm = true">
        <i class="ti ti-trash" />
        リノート削除
      </button>
      <button v-else-if="!isGuest" class="_popupItem _popupItemDanger" @click="canInteract ? (showReportForm = true) : (showLoginPrompt(), close())">
        <i class="ti ti-alert-triangle" />
        リノートを通報
      </button>
    </template>
  </PopupMenu>
</template>

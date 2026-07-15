<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Clip, NormalizedNote } from '@/adapters/types'
import {
  getPluginHandlers,
  setPluginAccountContext,
} from '@/aiscript/plugin-api'
import { useCommandStore } from '@/commands/registry'
import { useAccountMode } from '@/composables/useAccountMode'
import { showLoginPrompt } from '@/composables/useLoginPrompt'
import { useMultiAccountAdapters } from '@/composables/useMultiAccountAdapters'
import { useConfirm } from '@/stores/confirm'
import { useDeckStore } from '@/stores/deck'
import { usePrompt } from '@/stores/prompt'
import { useToast } from '@/stores/toast'
import { useWindowsStore } from '@/stores/windows'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import PopupMenu from './PopupMenu.vue'

const props = defineProps<{
  note: NormalizedNote
  isOwnNote: boolean
  isFavorited: boolean
  isPinned: boolean
}>()

const emit = defineEmits<{
  delete: [note: NormalizedNote]
  edit: [note: NormalizedNote]
  bookmark: [note: NormalizedNote]
  pin: [note: NormalizedNote]
  deleteAndEdit: [note: NormalizedNote]
}>()

const toast = useToast()
const { confirm } = useConfirm()
const { prompt } = usePrompt()
const { getOrCreate } = useMultiAccountAdapters()
const commandStore = useCommandStore()
const { canInteract, isGuest } = useAccountMode(() => props.note._accountId)

const popupMenuRef = ref<InstanceType<typeof PopupMenu>>()
const showDeleteConfirm = ref(false)
const showDeleteAndEditConfirm = ref(false)
const showReportForm = ref(false)
const reportComment = ref('')
const localIsFavorited = ref(props.isFavorited)
const localIsPinned = ref(props.isPinned)

type MenuView = 'main' | 'deleteConfirm' | 'deleteAndEditConfirm' | 'reportForm'

const currentView = computed<MenuView>(() => {
  if (showDeleteConfirm.value) return 'deleteConfirm'
  if (showDeleteAndEditConfirm.value) return 'deleteAndEditConfirm'
  if (showReportForm.value) return 'reportForm'
  return 'main'
})

watch(
  () => props.isFavorited,
  (v) => {
    localIsFavorited.value = v
  },
)

watch(
  () => props.isPinned,
  (v) => {
    localIsPinned.value = v
  },
)

const noteActions = computed(() =>
  getPluginHandlers('note_action', props.note._accountId),
)

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
  showDeleteAndEditConfirm.value = false
  showReportForm.value = false
  reportComment.value = ''
}

function backToMain() {
  resetSubViews()
}

function openInspector() {
  useWindowsStore().open('note-inspector', {
    accountId: props.note._accountId,
    noteId: props.note.id,
    noteUri: props.note.uri ?? props.note.url ?? undefined,
    serverHost: props.note._serverHost,
  })
  close()
}

const canShare = typeof navigator.share === 'function'

async function shareNote() {
  const url = noteWebUrl.value
  try {
    await navigator.share({ url })
  } catch {
    // User cancelled or share failed — ignore
  }
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

async function addToClip(clipId: string, clipName: string) {
  const adapter = await getOrCreate(props.note._accountId)
  if (!adapter) return
  try {
    await adapter.api.addNoteToClip(clipId, props.note.id)
    useDeckStore().invalidateColumnByKey(`clip:${clipId}`)
    toast.show('クリップに追加しました')
  } catch (e) {
    const err = AppError.from(e)
    if (err.displayCode === 'ALREADY_CLIPPED') {
      const ok = await confirm({
        title: 'クリップ解除',
        message: `このノートは既に「${clipName}」にクリップされています。クリップを解除しますか？`,
        type: 'danger',
        okLabel: '解除',
      })
      if (ok) {
        try {
          await adapter.api.removeNoteFromClip(clipId, props.note.id)
          useDeckStore().invalidateColumnByKey(`clip:${clipId}`)
          toast.show('クリップから解除しました')
        } catch (e2) {
          const err2 = AppError.from(e2)
          console.error('[clip:remove]', err2.code, err2.message)
          toast.show(
            `クリップの解除に失敗しました（${err2.displayCode}）`,
            'error',
          )
        }
      }
    } else {
      console.error('[clip:add]', err.code, err.message)
      toast.show(
        `クリップへの追加に失敗しました（${err.displayCode}）`,
        'error',
      )
    }
  }
}

async function createClipAndAdd() {
  commandStore.close()
  const name = await prompt({
    title: '新しいクリップを作成',
    placeholder: 'クリップ名を入力...',
  })
  if (!name) return
  try {
    const created = unwrap(
      await commands.apiCreateClip(props.note._accountId, { name }),
    )
    await addToClip(created.id, created.name)
  } catch (e) {
    const err = AppError.from(e)
    console.error('[clip:create]', err.code, err.message)
    toast.show(`クリップの作成に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function openClipQuickPick() {
  close()
  try {
    const clipList = unwrap(await commands.apiGetClips(props.note._accountId))
    const items = [
      {
        id: 'create-new-clip',
        label: '新しいクリップを作成',
        icon: 'plus',
        action: () => createClipAndAdd(),
      },
      ...clipList.map((clip) => ({
        id: `clip-${clip.id}`,
        label: clip.name,
        icon: 'paperclip',
        action: () => {
          commandStore.close()
          addToClip(clip.id, clip.name)
        },
      })),
    ]
    commandStore.pushQuickPick({
      title: 'クリップに追加',
      placeholder: 'クリップを選択...',
      items,
    })
    commandStore.open()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[clip:list]', err.code, err.message)
    toast.show(`クリップの取得に失敗しました（${err.displayCode}）`, 'error')
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
    console.error('[user:report]', err.code, err.message)
    toast.show(`通報に失敗しました（${err.displayCode}）`, 'error')
  }
}

defineExpose({ open })
</script>

<template>
  <PopupMenu ref="popupMenuRef" @close="resetSubViews">
    <!-- Delete confirm -->
    <template v-if="currentView === 'deleteConfirm'">
      <div class="_popupConfirmText">このノートを削除しますか？</div>
      <button class="_popupItem _popupItemDanger" @click="emit('delete', note); close()">
        <i class="ti ti-trash" />
        削除
      </button>
      <button class="_popupItem" @click="backToMain">
        <i class="ti ti-x" />
        キャンセル
      </button>
    </template>

    <!-- Delete and edit confirm -->
    <template v-else-if="currentView === 'deleteAndEditConfirm'">
      <div class="_popupConfirmText">このノートを削除して再編集しますか？</div>
      <button class="_popupItem _popupItemDanger" @click="emit('deleteAndEdit', note); close()">
        <i class="ti ti-trash" />
        削除して編集
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
      <button
        v-if="!isGuest"
        :class="['_popupItem', localIsFavorited && '_popupItemActive']"
        @click="canInteract ? (localIsFavorited = !localIsFavorited, emit('bookmark', note), close()) : (showLoginPrompt(), close())"
      >
        <i class="ti ti-star" />
        {{ localIsFavorited ? 'お気に入り解除' : 'お気に入り' }}
      </button>
      <button v-if="!isGuest" class="_popupItem" @click="canInteract ? openClipQuickPick() : (showLoginPrompt(), close())">
        <i class="ti ti-paperclip" />
        クリップに追加
      </button>
      <button class="_popupItem" @click="openInspector">
        <i class="ti ti-code" />
        Raw JSON を表示
      </button>
      <div class="_popupDivider" />
      <button v-if="note.text" class="_popupItem" @click="copyAndClose(note.text!)">
        <i class="ti ti-copy" />
        内容をコピー
      </button>
      <button class="_popupItem" @click="copyAndClose(noteWebUrl)">
        <i class="ti ti-link" />
        リンクをコピー
      </button>
      <button v-if="canShare" class="_popupItem" @click="shareNote">
        <i class="ti ti-share" />
        共有
      </button>
      <template v-if="noteActions.length > 0">
        <div class="_popupDivider" />
        <button
          v-for="action in noteActions"
          :key="action.pluginInstallId + action.title"
          class="_popupItem"
          @click="setPluginAccountContext(action.pluginInstallId, note._accountId); action.handler(note); close()"
        >
          <i class="ti ti-plug" />
          {{ action.title }}
        </button>
      </template>
      <template v-if="isOwnNote">
        <div class="_popupDivider" />
        <button
          :class="['_popupItem', localIsPinned && '_popupItemActive']"
          @click="localIsPinned = !localIsPinned; emit('pin', note); close()"
        >
          <i :class="localIsPinned ? 'ti ti-pinned-off' : 'ti ti-pin'" />
          {{ localIsPinned ? 'ピン留め解除' : 'ピン留め' }}
        </button>
        <button class="_popupItem" @click="emit('edit', note); close()">
          <i class="ti ti-edit" />
          編集
        </button>
        <button class="_popupItem" @click="showDeleteAndEditConfirm = true">
          <i class="ti ti-eraser" />
          削除して編集
        </button>
        <button class="_popupItem _popupItemDanger" @click="showDeleteConfirm = true">
          <i class="ti ti-trash" />
          削除
        </button>
      </template>
      <template v-if="!isOwnNote && !isGuest">
        <div class="_popupDivider" />
        <button class="_popupItem _popupItemDanger" @click="canInteract ? (showReportForm = true) : (showLoginPrompt(), close())">
          <i class="ti ti-alert-triangle" />
          通報
        </button>
      </template>
    </template>
  </PopupMenu>
</template>

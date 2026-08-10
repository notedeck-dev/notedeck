<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Clip, NormalizedNote } from '@/adapters/types'
import {
  getPluginHandlers,
  withPluginAccountContext,
} from '@/aiscript/plugin-api'
import { useCommandStore } from '@/commands/registry'
import { useAccountMode } from '@/composables/useAccountMode'
import { showLoginPrompt } from '@/composables/useLoginPrompt'
import { useMultiAccountAdapters } from '@/composables/useMultiAccountAdapters'
import {
  getAccountAvatarUrl,
  getAccountLabel,
  useAccountsStore,
} from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import { useDeckStore } from '@/stores/deck'
import { usePrompt } from '@/stores/prompt'
import { useToast } from '@/stores/toast'
import { useIsCompactLayout } from '@/stores/ui'
import { useWindowsStore } from '@/stores/windows'
import { clipCacheKey } from '@/utils/columnCacheKey'
import { AppError } from '@/utils/errors'
import { proxyThumbUrl } from '@/utils/mediaProxy'
import { getNoteShareUrl } from '@/utils/noteUrl'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { isWindowExposed } from '@/windows/exposure'
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
  reactAs: [accountId: string]
  renoteAs: [accountId: string]
  quoteAs: [accountId: string]
}>()

const toast = useToast()
const { confirm } = useConfirm()
const { prompt } = usePrompt()
const { getOrCreate } = useMultiAccountAdapters()
const commandStore = useCommandStore()
const isCompact = useIsCompactLayout()
const { canInteract, isGuest } = useAccountMode(() => props.note._accountId)

const popupMenuRef = ref<InstanceType<typeof PopupMenu>>()
const showDeleteConfirm = ref(false)
const showDeleteAndEditConfirm = ref(false)
const showReportForm = ref(false)
// compact ではコマンドパレットが無いので、シート内で 2 段選択する (#627)
const showActAs = ref(false)
const actAsAccountId = ref<string | null>(null)
const reportComment = ref('')
const localIsFavorited = ref(props.isFavorited)
const localIsPinned = ref(props.isPinned)

type MenuView =
  | 'main'
  | 'deleteConfirm'
  | 'deleteAndEditConfirm'
  | 'reportForm'
  | 'actAsAccounts'
  | 'actAsOperations'

const currentView = computed<MenuView>(() => {
  if (showDeleteConfirm.value) return 'deleteConfirm'
  if (showDeleteAndEditConfirm.value) return 'deleteAndEditConfirm'
  if (showReportForm.value) return 'reportForm'
  if (showActAs.value)
    return actAsAccountId.value ? 'actAsOperations' : 'actAsAccounts'
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

const noteWebUrl = computed(() => getNoteShareUrl(props.note))

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
  showActAs.value = false
  actAsAccountId.value = null
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
    useDeckStore().invalidateColumnByKey(clipCacheKey(clipId))
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
          useDeckStore().invalidateColumnByKey(clipCacheKey(clipId))
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

// 別のアカウントで… (#627)。ノートを表示しているアカウント以外の
// ログイン済みアカウントが候補。0 件ならメニュー項目自体を出さない。
// フロー: アカウント選択 → 操作選択 (リアクション / リノート / 引用) の
// 2 段 quickPick (children で階層化)。
const actAsCandidates = computed(() =>
  useAccountsStore().accounts.filter(
    (a) => a.hasToken && a.id !== props.note._accountId,
  ),
)

const actAsAccountLabel = computed(() => {
  const acc = actAsCandidates.value.find((a) => a.id === actAsAccountId.value)
  return acc ? getAccountLabel(acc) : ''
})

function actAsOperations(accountId: string) {
  return [
    {
      id: `${accountId}-react`,
      label: 'リアクション',
      icon: 'mood-plus',
      action: () => {
        commandStore.close()
        emit('reactAs', accountId)
      },
    },
    {
      id: `${accountId}-renote`,
      label: 'リノート',
      icon: 'repeat',
      action: () => {
        commandStore.close()
        emit('renoteAs', accountId)
      },
    },
    {
      id: `${accountId}-quote`,
      label: '引用',
      icon: 'quote',
      action: () => {
        commandStore.close()
        emit('quoteAs', accountId)
      },
    },
  ]
}

function openActAs() {
  // compact はコマンドパレットが無い (TitleBar ごと非表示) ので
  // ボトムシートの中で同じ 2 段選択を再現する
  if (isCompact.value) {
    showActAs.value = true
    return
  }
  close()
  commandStore.pushQuickPick({
    title: '別のアカウントで…',
    placeholder: 'アカウントを選択…',
    items: actAsCandidates.value.map((acc) => ({
      id: acc.id,
      label: getAccountLabel(acc),
      icon: 'user',
      avatarUrl: proxyThumbUrl(getAccountAvatarUrl(acc), 18),
      children: () => actAsOperations(acc.id),
    })),
  })
  commandStore.open()
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



    <!-- 別のアカウントで… (compact のみ): アカウント選択 -->
    <template v-else-if="currentView === 'actAsAccounts'">
      <div class="_popupConfirmText">別のアカウントで…</div>
      <button
        v-for="acc in actAsCandidates"
        :key="acc.id"
        class="_popupItem"
        @click="actAsAccountId = acc.id"
      >
        <img :src="proxyThumbUrl(getAccountAvatarUrl(acc), 18)" :class="$style.actAsAvatar" alt="" />
        {{ getAccountLabel(acc) }}
      </button>
      <button class="_popupItem" @click="backToMain">
        <i class="ti ti-arrow-left" />
        戻る
      </button>
    </template>

    <!-- 別のアカウントで… (compact のみ): 操作選択 -->
    <template v-else-if="currentView === 'actAsOperations'">
      <div class="_popupConfirmText">{{ actAsAccountLabel }}</div>
      <button class="_popupItem" @click="emit('reactAs', actAsAccountId!); close()">
        <i class="ti ti-mood-plus" />
        リアクション
      </button>
      <button class="_popupItem" @click="emit('renoteAs', actAsAccountId!); close()">
        <i class="ti ti-repeat" />
        リノート
      </button>
      <button class="_popupItem" @click="emit('quoteAs', actAsAccountId!); close()">
        <i class="ti ti-quote" />
        引用
      </button>
      <button class="_popupItem" @click="actAsAccountId = null">
        <i class="ti ti-arrow-left" />
        戻る
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
      <button v-if="actAsCandidates.length > 0" class="_popupItem" @click="openActAs">
        <i class="ti ti-users" />
        別のアカウントで…
      </button>
      <button v-if="isWindowExposed('note-inspector')" class="_popupItem" @click="openInspector">
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
          @click="withPluginAccountContext(action.pluginInstallId, note._accountId, () => action.handler(note)); close()"
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
        <!--
          「編集」は出さない (#954)。本家 Misskey にノートを更新する API は無く、
          NoteDeck が呼んでいるのはフォークが独自に生やしたエンドポイントのため、
          本家サーバーでは押すと必ず失敗する。対応可否の判定方法とフォークの実地
          確認が済むまでは項目自体を出さない。下の「削除して編集」は全サーバーで
          機能するので、投稿を直す手段は残る。emit('edit') の配線は判定を入れて
          復活させるときのために残してある。
        -->
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

<style lang="scss" module>
// 「別のアカウントで…」のアカウント行アバター (._popupItem .ti と同じ幅に揃える)
.actAsAvatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
}
</style>

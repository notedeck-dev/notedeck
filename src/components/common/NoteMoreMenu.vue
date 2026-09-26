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
import { i18n } from '@/i18n'
import type { NoteGroup } from '@/services/noteGroup'
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
import AccountPickerSheet from './AccountPickerSheet.vue'
import PopupMenu from './PopupMenu.vue'

const props = defineProps<{
  note: NormalizedNote
  isOwnNote: boolean
  isFavorited: boolean
  isPinned: boolean
  /** 束ねた行 (#1058)。各アカウントの variant があれば ap/show なしで操作できる */
  group?: NoteGroup
}>()

const emit = defineEmits<{
  delete: [note: NormalizedNote]
  edit: [note: NormalizedNote]
  bookmark: [note: NormalizedNote]
  pin: [note: NormalizedNote]
  deleteAndEdit: [note: NormalizedNote]
  reactAs: [accountId: string]
  /** そのアカウントの variant が反応済みのとき、その反応を取り消す (#1058 §5.6) */
  unreactAs: [accountId: string]
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
// compact ではコマンドパレットが無いので、アカウント選択シートで 2 段選択する
// (#627 / #1018 — 選ばせ方はナビバーのアカウント一覧に揃える)
const showActAs = ref(false)
const actAsAccountId = ref<string | null>(null)
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
  reportComment.value = ''
}

/** アカウント選択シートを閉じる (メニュー本体は既に閉じている) */
function closeActAs() {
  showActAs.value = false
  actAsAccountId.value = null
}

function actAs(op: 'reactAs' | 'unreactAs' | 'renoteAs' | 'quoteAs') {
  const accountId = actAsAccountId.value
  closeActAs()
  if (!accountId) return
  if (op === 'reactAs') emit('reactAs', accountId)
  else if (op === 'unreactAs') emit('unreactAs', accountId)
  else if (op === 'renoteAs') emit('renoteAs', accountId)
  else emit('quoteAs', accountId)
}

/** 束ねた行で、そのアカウントの variant (#1058)。無ければ ap/show で解決する */
function variantFor(accountId: string): NormalizedNote | undefined {
  return props.group?.variants.find((v) => v._accountId === accountId)
}

/** その variant が反応済みなら、描画される側 (Renote なら renote 元) の myReaction */
function variantReaction(accountId: string): string | null {
  const v = variantFor(accountId)
  if (!v) return null
  const eff = v.renote && v.text == null ? v.renote : v
  return eff.myReaction ?? null
}

/** 本文が非公開の variant を持つアカウントでは操作させない (「選べないものは選べない」) */
function variantHidden(accountId: string): boolean {
  return variantFor(accountId)?.contentHidden === true
}

function backToMain() {
  resetSubViews()
}

function openInspector() {
  useWindowsStore().open('note-inspector', {
    accountId: props.note._accountId,
    noteId: props.note.id,
    noteUri: props.note._identity,
    serverHost: props.note._serverHost,
    // 束ねた行なら各ビューを切り替えて見られる (開発者モード、#1058 §7)
    variants: props.group?.variants.map((v) => ({
      accountId: v._accountId,
      noteId: v.id,
      serverHost: v._serverHost,
      identity: v._identity,
    })),
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
  if (variantHidden(accountId)) {
    return [
      {
        id: `${accountId}-hidden`,
        label: 'このアカウントでは本文が非公開のため操作できません',
        icon: 'lock',
        action: () => commandStore.close(),
      },
    ]
  }
  const mine = variantReaction(accountId)
  return [
    mine
      ? {
          id: `${accountId}-unreact`,
          label: `リアクションを取り消す (${mine})`,
          icon: 'mood-minus',
          action: () => {
            commandStore.close()
            emit('unreactAs', accountId)
          },
        }
      : {
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
  // compact はコマンドパレットが無い (TitleBar ごと非表示) ので、共通の
  // アカウント選択シートで同じ 2 段選択を再現する。メニュー自身もシートなので、
  // 閉じ切ってから開く (dialog が重ならないように)
  if (isCompact.value) {
    close()
    setTimeout(() => {
      showActAs.value = true
    }, 200)
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
      <div class="_popupConfirmText">{{ i18n.ts._noteMoreMenu.confirmDelete }}</div>
      <button class="_popupItem _popupItemDanger" @click="emit('delete', note); close()">
        <i class="ti ti-trash" />
        {{ i18n.ts._common.delete }}
      </button>
      <button class="_popupItem" @click="backToMain">
        <i class="ti ti-x" />
        {{ i18n.ts._common.cancel }}
      </button>
    </template>

    <!-- Delete and edit confirm -->
    <template v-else-if="currentView === 'deleteAndEditConfirm'">
      <div class="_popupConfirmText">{{ i18n.ts._noteMoreMenu.confirmDeleteAndEdit }}</div>
      <button class="_popupItem _popupItemDanger" @click="emit('deleteAndEdit', note); close()">
        <i class="ti ti-trash" />
        {{ i18n.ts._noteMoreMenu.deleteAndEdit }}
      </button>
      <button class="_popupItem" @click="backToMain">
        <i class="ti ti-x" />
        {{ i18n.ts._common.cancel }}
      </button>
    </template>



    <!-- Report form -->
    <template v-else-if="currentView === 'reportForm'">
      <div class="_popupConfirmText">{{ i18n.tsx._noteMoreMenu.reportUser({ username: note.user.username }) }}</div>
      <div class="_popupReportInputWrap">
        <textarea
          v-model="reportComment"
          class="_popupReportInput"
          :placeholder="i18n.ts._noteMoreMenu.reportReasonPlaceholder"
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
      <button class="_popupItem" @click="backToMain">
        <i class="ti ti-x" />
        {{ i18n.ts._common.cancel }}
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
        {{ localIsFavorited ? i18n.ts._noteMoreMenu.unfavorite : i18n.ts._noteMoreMenu.favorite }}
      </button>
      <button v-if="!isGuest" class="_popupItem" @click="canInteract ? openClipQuickPick() : (showLoginPrompt(), close())">
        <i class="ti ti-paperclip" />
        {{ i18n.ts._noteMoreMenu.addToClip }}
      </button>
      <button v-if="actAsCandidates.length > 0" class="_popupItem" @click="openActAs">
        <i class="ti ti-users" />
        {{ i18n.ts._noteMoreMenu.actAs }}
      </button>
      <button v-if="isWindowExposed('note-inspector')" class="_popupItem" @click="openInspector">
        <i class="ti ti-code" />
        {{ i18n.ts._noteMoreMenu.showRawJson }}
      </button>
      <div class="_popupDivider" />
      <button v-if="note.text" class="_popupItem" @click="copyAndClose(note.text!)">
        <i class="ti ti-copy" />
        {{ i18n.ts._noteMoreMenu.copyContent }}
      </button>
      <button class="_popupItem" @click="copyAndClose(noteWebUrl)">
        <i class="ti ti-link" />
        {{ i18n.ts._noteMoreMenu.copyLink }}
      </button>
      <button v-if="canShare" class="_popupItem" @click="shareNote">
        <i class="ti ti-share" />
        {{ i18n.ts._noteMoreMenu.share }}
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
          {{ localIsPinned ? i18n.ts._noteMoreMenu.unpin : i18n.ts._noteMoreMenu.pin }}
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
          {{ i18n.ts._noteMoreMenu.deleteAndEdit }}
        </button>
        <button class="_popupItem _popupItemDanger" @click="showDeleteConfirm = true">
          <i class="ti ti-trash" />
          {{ i18n.ts._common.delete }}
        </button>
      </template>
      <template v-if="!isOwnNote && !isGuest">
        <div class="_popupDivider" />
        <button class="_popupItem _popupItemDanger" @click="canInteract ? (showReportForm = true) : (showLoginPrompt(), close())">
          <i class="ti ti-alert-triangle" />
          {{ i18n.ts._noteMoreMenu.report }}
        </button>
      </template>
    </template>
  </PopupMenu>

  <!-- 別のアカウントで… (compact のみ): アカウント選択 → 操作選択の 2 段 -->
  <AccountPickerSheet
    :show="showActAs"
    :accounts="actAsCandidates"
    :title="actAsAccountId ? actAsAccountLabel : i18n.ts._noteMoreMenu.actAs"
    :description="actAsAccountId ? undefined : i18n.ts._noteMoreMenu.actAsDescription"
    :stage="actAsAccountId ? 'detail' : 'accounts'"
    has-next
    @select="actAsAccountId = $event"
    @close="closeActAs"
  >
    <template #detail>
      <!-- 非公開 variant は desktop の actAsOperations と同じく全操作を出さない -->
      <div v-if="actAsAccountId && variantHidden(actAsAccountId)" class="_popupItem" aria-disabled="true" style="opacity: 0.6; cursor: default">
        <i class="ti ti-lock" />
        {{ i18n.ts._noteMoreMenu.contentHiddenForAccount }}
      </div>
      <template v-else>
        <button v-if="actAsAccountId && variantReaction(actAsAccountId)" class="_popupItem" @click="actAs('unreactAs')">
          <i class="ti ti-mood-minus" />
          {{ i18n.tsx._noteMoreMenu.unreactWith({ reaction: variantReaction(actAsAccountId) ?? '' }) }}
        </button>
        <button v-else class="_popupItem" @click="actAs('reactAs')">
          <i class="ti ti-mood-plus" />
          {{ i18n.ts._noteMoreMenu.react }}
        </button>
        <button class="_popupItem" @click="actAs('renoteAs')">
          <i class="ti ti-repeat" />
          {{ i18n.ts._noteMoreMenu.renote }}
        </button>
        <button class="_popupItem" @click="actAs('quoteAs')">
          <i class="ti ti-quote" />
          {{ i18n.ts._noteMoreMenu.quote }}
        </button>
      </template>
      <button class="_popupItem" @click="actAsAccountId = null">
        <i class="ti ti-arrow-left" />
        {{ i18n.ts._common.back }}
      </button>
    </template>
  </AccountPickerSheet>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  Antenna,
  NormalizedUserDetail,
  ServerAdapter,
  UserList,
  UserRelation,
} from '@/adapters/types'
import {
  getPluginHandlers,
  setPluginAccountContext,
} from '@/aiscript/plugin-api'
import PopupMenu from '@/components/common/PopupMenu.vue'
import { useDeckStore } from '@/stores/deck'
import { useMutesStore } from '@/stores/mutes'
import { useToast } from '@/stores/toast'
import { generateUserEmbedCode } from '@/utils/embedCode'
import { AppError } from '@/utils/errors'

const props = defineProps<{
  adapter: ServerAdapter | null
  accountId: string
  user: NormalizedUserDetail | null
  accountHost?: string
  hasToken: boolean
  isOwnProfile: boolean
}>()

const emit = defineEmits<{
  /** ユーザー指定ノートの作成 — 投稿フォームは親が持つ */
  compose: [acct: string]
}>()

const deckStore = useDeckStore()
const mutesStore = useMutesStore()
const toast = useToast()

const userRelation = ref<UserRelation | null>(null)

// user 読み込み後に relation (mute/block/follow) を取得する。認証必須 —
// 自分自身は対象外。
watch(
  () => props.user,
  (u) => {
    if (u && props.hasToken && !props.isOwnProfile) {
      void refreshUserRelation()
    }
  },
  { immediate: true },
)

async function refreshUserRelation() {
  if (!props.adapter || !props.user) return
  try {
    const [relation] = await props.adapter.api.getUserRelations([props.user.id])
    userRelation.value = relation ?? null
  } catch (e) {
    console.error('[user:relation]', AppError.from(e).message)
  }
}

// Menu view state
const userMenuRef = ref<InstanceType<typeof PopupMenu>>()
const showMuteConfirm = ref(false)
const showBlockConfirm = ref(false)
const showInvalidateFollowerConfirm = ref(false)
const showReportForm = ref(false)
const showListPicker = ref(false)
const showAntennaPicker = ref(false)
const reportComment = ref('')
const userLists = ref<UserList[]>([])
const userAntennas = ref<Antenna[]>([])
const antennaBusy = ref(false)

type UserMenuView =
  | 'main'
  | 'muteConfirm'
  | 'blockConfirm'
  | 'invalidateFollowerConfirm'
  | 'reportForm'
  | 'listPicker'
  | 'antennaPicker'
const userMenuView = computed<UserMenuView>(() => {
  if (showMuteConfirm.value) return 'muteConfirm'
  if (showBlockConfirm.value) return 'blockConfirm'
  if (showInvalidateFollowerConfirm.value) return 'invalidateFollowerConfirm'
  if (showReportForm.value) return 'reportForm'
  if (showListPicker.value) return 'listPicker'
  if (showAntennaPicker.value) return 'antennaPicker'
  return 'main'
})

function open(event: MouseEvent) {
  userMenuRef.value?.open(event)
}

defineExpose({ open })

// プラグインの user_action (#731) — note_action (NoteMoreMenu) と同じ発火パターン
const userActions = computed(() =>
  getPluginHandlers('user_action', props.accountId),
)

function closeUserMenu() {
  userMenuRef.value?.close()
}

function userMenuBack() {
  showMuteConfirm.value = false
  showBlockConfirm.value = false
  showInvalidateFollowerConfirm.value = false
  showReportForm.value = false
  showListPicker.value = false
  showAntennaPicker.value = false
  reportComment.value = ''
}

async function handleMuteUser() {
  if (!props.adapter || !props.user) return
  try {
    await props.adapter.api.muteUser(props.user.id)
    // 過去ノートをリロード無しで即時非表示にする（#574）。表示述語が reactive に再評価。
    mutesStore.muteUser(props.accountId, props.user.id)
    toast.show('ミュートしました')
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:mute]', err.code, err.message)
    toast.show(`ミュートに失敗しました（${err.displayCode}）`, 'error')
  }
}

async function handleUnmuteUser() {
  if (!props.adapter || !props.user) return
  try {
    await props.adapter.api.unmuteUser(props.user.id)
    // ミュート中に隠れていた過去ノートを即時復活させる（#574）。
    mutesStore.unmuteUser(props.accountId, props.user.id)
    toast.show('ミュートを解除しました')
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:unmute]', err.code, err.message)
    toast.show(`ミュート解除に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function handleBlockUser() {
  if (!props.adapter || !props.user) return
  try {
    await props.adapter.api.blockUser(props.user.id)
    toast.show('ブロックしました')
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:block]', err.code, err.message)
    toast.show(`ブロックに失敗しました（${err.displayCode}）`, 'error')
  }
}

async function handleUnblockUser() {
  if (!props.adapter || !props.user) return
  try {
    await props.adapter.api.unblockUser(props.user.id)
    toast.show('ブロックを解除しました')
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:unblock]', err.code, err.message)
    toast.show(`ブロック解除に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function handleRenoteMuteUser() {
  if (!props.adapter || !props.user) return
  try {
    await props.adapter.api.renoteMuteUser(props.user.id)
    toast.show('リノートをミュートしました')
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:renote-mute]', err.code, err.message)
    toast.show(`リノートミュートに失敗しました（${err.displayCode}）`, 'error')
  }
}

async function handleUnrenoteMuteUser() {
  if (!props.adapter || !props.user) return
  try {
    await props.adapter.api.unrenoteMuteUser(props.user.id)
    toast.show('リノートのミュートを解除しました')
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:renote-unmute]', err.code, err.message)
    toast.show(
      `リノートミュート解除に失敗しました（${err.displayCode}）`,
      'error',
    )
  }
}

async function handleInvalidateFollower() {
  if (!props.adapter || !props.user) return
  try {
    await props.adapter.api.invalidateFollower(props.user.id)
    toast.show('フォロワーを解除しました')
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:invalidate-follower]', err.code, err.message)
    toast.show(`フォロワー解除に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function handleReportUser() {
  if (!props.adapter || !props.user || !reportComment.value.trim()) return
  try {
    await props.adapter.api.reportUser(props.user.id, reportComment.value)
    toast.show('通報しました')
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:report]', err.code, err.message)
    toast.show(`通報に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function copyText(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.show(successMessage)
  } catch (e) {
    console.error('[user:copy]', e)
    toast.show('コピーに失敗しました', 'error')
  } finally {
    closeUserMenu()
  }
}

function handleCopyUsername() {
  if (!props.user) return
  const host = props.user.host ?? props.accountHost
  if (!host) return
  copyText(`@${props.user.username}@${host}`, 'ユーザー名をコピーしました')
}

function handleCopyProfileUrl() {
  if (!props.user || !props.accountHost) return
  const canonical = props.user.host
    ? `@${props.user.username}@${props.user.host}`
    : `@${props.user.username}`
  copyText(
    `https://${props.accountHost}/${canonical}`,
    'プロフィール URL をコピーしました',
  )
}

function handleCopyRss() {
  if (!props.user) return
  const host = props.user.host ?? props.accountHost
  if (!host) return
  copyText(
    `${host}/@${props.user.username}.atom`,
    'RSS の URL をコピーしました',
  )
}

function handleCopyEmbedCode() {
  if (!props.user || !props.accountHost) return
  // リモートユーザーはホストサーバーで埋め込みを取得できないので除外 (Misskey 本家踏襲)
  if (props.user.host) return
  const code = generateUserEmbedCode(props.accountHost, props.user.id)
  copyText(code, '埋め込みコードをコピーしました')
}

async function openListPicker() {
  if (!props.adapter) return
  try {
    userLists.value = await props.adapter.api.getUserLists()
    showListPicker.value = true
  } catch (e) {
    const err = AppError.from(e)
    console.error('[list:fetch]', err.code, err.message)
    toast.show(`リストの取得に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function addToList(listId: string) {
  if (!props.adapter || !props.user) return
  try {
    await props.adapter.api.addUserToList(listId, props.user.id)
    toast.show('リストに追加しました')
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[list:add]', err.code, err.message)
    toast.show(`リストへの追加に失敗しました（${err.displayCode}）`, 'error')
  }
}

// リモートユーザーは `@user@host`、ローカルユーザーは `@user`。
// メンション投稿・アンテナの users 配列いずれもこの形式を受け付ける。
const userAcct = computed(() => {
  const u = props.user
  if (!u) return null
  return u.host ? `@${u.username}@${u.host}` : `@${u.username}`
})

function composeNoteToUser() {
  const acct = userAcct.value
  if (!acct) return
  closeUserMenu()
  emit('compose', acct)
}

function searchUserNotes() {
  if (!props.user) return
  deckStore.addColumn({
    type: 'search',
    accountId: props.accountId,
    userId: props.user.id,
    name: `${userAcct.value ?? props.user.username} の検索`,
    width: 360,
  })
  closeUserMenu()
}

function openDirectMessage() {
  if (!props.user) return
  deckStore.openChatWith({
    accountId: props.accountId,
    userId: props.user.id,
    name: props.user.name || props.user.username,
    avatarUrl: props.user.avatarUrl ?? null,
    serverHost: props.accountHost ?? null,
  })
  closeUserMenu()
}

async function toggleWithReplies() {
  if (!props.adapter || !props.user) return
  const next = !props.user.withReplies
  try {
    await props.adapter.api.updateFollowing(props.user.id, {
      withReplies: next,
    })
    props.user.withReplies = next
    toast.show(next ? 'TLに返信を含めます' : 'TLに返信を含めません')
  } catch (e) {
    const err = AppError.from(e)
    console.error('[following:withReplies]', err.code, err.message)
    toast.show(`設定の更新に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function toggleNotify() {
  if (!props.adapter || !props.user) return
  const next = props.user.notify === 'normal' ? 'none' : 'normal'
  try {
    await props.adapter.api.updateFollowing(props.user.id, { notify: next })
    props.user.notify = next
    toast.show(next === 'normal' ? '投稿を通知します' : '投稿を通知しません')
  } catch (e) {
    const err = AppError.from(e)
    console.error('[following:notify]', err.code, err.message)
    toast.show(`設定の更新に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function openAntennaPicker() {
  if (!props.adapter) return
  try {
    const all = await props.adapter.api.getAntennas()
    // ユーザーソースのアンテナのみ追加対象 (keyword 系には個別ユーザーを足せない)。
    userAntennas.value = all.filter((a) => a.src === 'users')
    showAntennaPicker.value = true
  } catch (e) {
    const err = AppError.from(e)
    console.error('[antenna:fetch]', err.code, err.message)
    toast.show(`アンテナの取得に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function addToAntenna(antenna: Antenna) {
  if (!props.adapter || antennaBusy.value) return
  const acct = userAcct.value
  if (!acct) return
  antennaBusy.value = true
  try {
    // 最新の設定を取得してから users を append (他フィールドを保持して往復する)。
    const current = await props.adapter.api.getAntenna(antenna.id)
    const existing = current.users ?? []
    if (existing.some((u) => u.toLowerCase() === acct.toLowerCase())) {
      toast.show('すでに追加されています')
      closeUserMenu()
      return
    }
    await props.adapter.api.updateAntenna({
      ...current,
      users: [...existing, acct],
    })
    toast.show(`${antenna.name} に追加しました`)
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[antenna:add]', err.code, err.message)
    toast.show(`アンテナへの追加に失敗しました（${err.displayCode}）`, 'error')
  } finally {
    antennaBusy.value = false
  }
}
</script>

<template>
  <PopupMenu ref="userMenuRef" @close="userMenuBack">
    <!-- Main -->
    <template v-if="userMenuView === 'main'">
      <button class="_popupItem" @click="composeNoteToUser">
        <i class="ti ti-pencil" />
        ユーザー指定ノートを作成
      </button>
      <button class="_popupItem" @click="searchUserNotes">
        <i class="ti ti-search" />
        ユーザーのノートを検索
      </button>
      <button class="_popupItem" @click="openDirectMessage">
        <i class="ti ti-message" />
        ダイレクトメッセージ
      </button>
      <div class="_popupDivider" />
      <button class="_popupItem" @click="handleCopyUsername">
        <i class="ti ti-at" />
        ユーザー名をコピー
      </button>
      <button class="_popupItem" @click="handleCopyProfileUrl">
        <i class="ti ti-share" />
        プロフィール URL をコピー
      </button>
      <button class="_popupItem" @click="handleCopyRss">
        <i class="ti ti-rss" />
        RSS をコピー
      </button>
      <button
        v-if="!user?.host"
        class="_popupItem"
        @click="handleCopyEmbedCode"
      >
        <i class="ti ti-code" />
        埋め込み
      </button>
      <div class="_popupDivider" />
      <button class="_popupItem" @click="openListPicker">
        <i class="ti ti-list" />
        リストに追加
      </button>
      <button class="_popupItem" @click="openAntennaPicker">
        <i class="ti ti-antenna" />
        アンテナに追加
      </button>
      <template v-if="user?.isFollowing">
        <div class="_popupDivider" />
        <button class="_popupItem" @click="toggleWithReplies">
          <i
            :class="
              user?.withReplies ? 'ti ti-checkbox' : 'ti ti-square'
            "
          />
          TLに他の人への返信を含める
        </button>
        <button class="_popupItem" @click="toggleNotify">
          <i
            :class="
              user?.notify === 'normal' ? 'ti ti-bell-ringing' : 'ti ti-bell'
            "
          />
          投稿を通知
        </button>
      </template>
      <template v-if="user && userActions.length > 0">
        <div class="_popupDivider" />
        <button
          v-for="action in userActions"
          :key="action.pluginInstallId + action.title"
          class="_popupItem"
          @click="setPluginAccountContext(action.pluginInstallId, accountId); action.handler(user); closeUserMenu()"
        >
          <i class="ti ti-plug" />
          {{ action.title }}
        </button>
      </template>
      <div class="_popupDivider" />
      <button
        class="_popupItem"
        @click="
          userRelation?.isMuted ? handleUnmuteUser() : (showMuteConfirm = true)
        "
      >
        <i :class="userRelation?.isMuted ? 'ti ti-eye' : 'ti ti-eye-off'" />
        {{ userRelation?.isMuted ? 'ミュート解除' : 'ミュート' }}
      </button>
      <button
        class="_popupItem"
        @click="
          userRelation?.isRenoteMuted
            ? handleUnrenoteMuteUser()
            : handleRenoteMuteUser()
        "
      >
        <i
          :class="
            userRelation?.isRenoteMuted ? 'ti ti-repeat' : 'ti ti-repeat-off'
          "
        />
        {{ userRelation?.isRenoteMuted ? 'リノートミュート解除' : 'リノートをミュート' }}
      </button>
      <button
        class="_popupItem _popupItemDanger"
        @click="
          userRelation?.isBlocking
            ? handleUnblockUser()
            : (showBlockConfirm = true)
        "
      >
        <i class="ti ti-ban" />
        {{ userRelation?.isBlocking ? 'ブロック解除' : 'ブロック' }}
      </button>
      <button
        v-if="userRelation?.isFollowed"
        class="_popupItem _popupItemDanger"
        @click="showInvalidateFollowerConfirm = true"
      >
        <i class="ti ti-link-off" />
        フォロワーを解除
      </button>
      <div class="_popupDivider" />
      <button class="_popupItem _popupItemDanger" @click="showReportForm = true">
        <i class="ti ti-alert-triangle" />
        通報
      </button>
    </template>
    <!-- Mute confirm -->
    <template v-else-if="userMenuView === 'muteConfirm'">
      <div class="_popupConfirmText">@{{ user?.username }} をミュートしますか？</div>
      <button class="_popupItem _popupItemDanger" @click="handleMuteUser">
        <i class="ti ti-eye-off" />
        ミュート
      </button>
      <button class="_popupItem" @click="userMenuBack">
        <i class="ti ti-x" />
        キャンセル
      </button>
    </template>
    <!-- Block confirm -->
    <template v-else-if="userMenuView === 'blockConfirm'">
      <div class="_popupConfirmText">@{{ user?.username }} をブロックしますか？</div>
      <button class="_popupItem _popupItemDanger" @click="handleBlockUser">
        <i class="ti ti-ban" />
        ブロック
      </button>
      <button class="_popupItem" @click="userMenuBack">
        <i class="ti ti-x" />
        キャンセル
      </button>
    </template>
    <!-- Invalidate follower confirm -->
    <template v-else-if="userMenuView === 'invalidateFollowerConfirm'">
      <div class="_popupConfirmText">
        @{{ user?.username }} のフォロワーを解除しますか？
      </div>
      <button
        class="_popupItem _popupItemDanger"
        @click="handleInvalidateFollower"
      >
        <i class="ti ti-link-off" />
        解除
      </button>
      <button class="_popupItem" @click="userMenuBack">
        <i class="ti ti-x" />
        キャンセル
      </button>
    </template>
    <!-- Report form -->
    <template v-else-if="userMenuView === 'reportForm'">
      <div class="_popupConfirmText">@{{ user?.username }} を通報</div>
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
        @click="handleReportUser"
      >
        <i class="ti ti-alert-triangle" />
        送信
      </button>
      <button class="_popupItem" @click="userMenuBack">
        <i class="ti ti-x" />
        キャンセル
      </button>
    </template>
    <!-- List picker -->
    <template v-else-if="userMenuView === 'listPicker'">
      <button class="_popupItem" @click="userMenuBack">
        <i class="ti ti-arrow-left" />
        戻る
      </button>
      <div class="_popupDivider" />
      <template v-if="userLists.length > 0">
        <button
          v-for="list in userLists"
          :key="list.id"
          class="_popupItem"
          @click="addToList(list.id)"
        >
          <i class="ti ti-list" />
          {{ list.name }}
        </button>
      </template>
      <div v-else class="_popupConfirmText">リストがありません</div>
    </template>
    <!-- Antenna picker -->
    <template v-else-if="userMenuView === 'antennaPicker'">
      <button class="_popupItem" @click="userMenuBack">
        <i class="ti ti-arrow-left" />
        戻る
      </button>
      <div class="_popupDivider" />
      <template v-if="userAntennas.length > 0">
        <button
          v-for="antenna in userAntennas"
          :key="antenna.id"
          class="_popupItem"
          :disabled="antennaBusy"
          @click="addToAntenna(antenna)"
        >
          <i class="ti ti-antenna" />
          {{ antenna.name }}
        </button>
      </template>
      <div v-else class="_popupConfirmText">
        ユーザーソースのアンテナがありません
      </div>
    </template>
  </PopupMenu>
</template>

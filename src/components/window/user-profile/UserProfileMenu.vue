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
  withPluginAccountContext,
} from '@/aiscript/plugin-api'
import PopupMenu from '@/components/common/PopupMenu.vue'
import { i18n } from '@/i18n'
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
    toast.show(i18n.ts._userProfileMenu.muted)
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:mute]', err.code, err.message)
    toast.show(
      i18n.tsx._userProfileMenu.muteFailed({ code: err.displayCode }),
      'error',
    )
  }
}

async function handleUnmuteUser() {
  if (!props.adapter || !props.user) return
  try {
    await props.adapter.api.unmuteUser(props.user.id)
    // ミュート中に隠れていた過去ノートを即時復活させる（#574）。
    mutesStore.unmuteUser(props.accountId, props.user.id)
    toast.show(i18n.ts._userProfileMenu.unmuted)
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:unmute]', err.code, err.message)
    toast.show(
      i18n.tsx._userProfileMenu.unmuteFailed({ code: err.displayCode }),
      'error',
    )
  }
}

async function handleBlockUser() {
  if (!props.adapter || !props.user) return
  try {
    await props.adapter.api.blockUser(props.user.id)
    toast.show(i18n.ts._userProfileMenu.blocked)
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:block]', err.code, err.message)
    toast.show(
      i18n.tsx._userProfileMenu.blockFailed({ code: err.displayCode }),
      'error',
    )
  }
}

async function handleUnblockUser() {
  if (!props.adapter || !props.user) return
  try {
    await props.adapter.api.unblockUser(props.user.id)
    toast.show(i18n.ts._userProfileMenu.unblocked)
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:unblock]', err.code, err.message)
    toast.show(
      i18n.tsx._userProfileMenu.unblockFailed({ code: err.displayCode }),
      'error',
    )
  }
}

async function handleRenoteMuteUser() {
  if (!props.adapter || !props.user) return
  try {
    await props.adapter.api.renoteMuteUser(props.user.id)
    toast.show(i18n.ts._userProfileMenu.renotesMuted)
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:renote-mute]', err.code, err.message)
    toast.show(
      i18n.tsx._userProfileMenu.renoteMuteFailed({ code: err.displayCode }),
      'error',
    )
  }
}

async function handleUnrenoteMuteUser() {
  if (!props.adapter || !props.user) return
  try {
    await props.adapter.api.unrenoteMuteUser(props.user.id)
    toast.show(i18n.ts._userProfileMenu.renotesUnmuted)
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:renote-unmute]', err.code, err.message)
    toast.show(
      i18n.tsx._userProfileMenu.renoteUnmuteFailed({ code: err.displayCode }),
      'error',
    )
  }
}

async function handleInvalidateFollower() {
  if (!props.adapter || !props.user) return
  try {
    await props.adapter.api.invalidateFollower(props.user.id)
    toast.show(i18n.ts._userProfileMenu.followerInvalidated)
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:invalidate-follower]', err.code, err.message)
    toast.show(
      i18n.tsx._userProfileMenu.invalidateFollowerFailed({
        code: err.displayCode,
      }),
      'error',
    )
  }
}

async function handleReportUser() {
  if (!props.adapter || !props.user || !reportComment.value.trim()) return
  try {
    await props.adapter.api.reportUser(props.user.id, reportComment.value)
    toast.show(i18n.ts._userProfileMenu.reported)
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:report]', err.code, err.message)
    toast.show(
      i18n.tsx._userProfileMenu.reportFailed({ code: err.displayCode }),
      'error',
    )
  }
}

async function copyText(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.show(successMessage)
  } catch (e) {
    console.error('[user:copy]', e)
    toast.show(i18n.ts._userProfileMenu.copyFailed, 'error')
  } finally {
    closeUserMenu()
  }
}

function handleCopyUsername() {
  if (!props.user) return
  const host = props.user.host ?? props.accountHost
  if (!host) return
  copyText(
    `@${props.user.username}@${host}`,
    i18n.ts._userProfileMenu.usernameCopied,
  )
}

function handleCopyProfileUrl() {
  if (!props.user || !props.accountHost) return
  const canonical = props.user.host
    ? `@${props.user.username}@${props.user.host}`
    : `@${props.user.username}`
  copyText(
    `https://${props.accountHost}/${canonical}`,
    i18n.ts._userProfileMenu.profileUrlCopied,
  )
}

function handleCopyRss() {
  if (!props.user) return
  const host = props.user.host ?? props.accountHost
  if (!host) return
  copyText(
    `${host}/@${props.user.username}.atom`,
    i18n.ts._userProfileMenu.rssUrlCopied,
  )
}

function handleCopyEmbedCode() {
  if (!props.user || !props.accountHost) return
  // リモートユーザーはホストサーバーで埋め込みを取得できないので除外 (Misskey 本家踏襲)
  if (props.user.host) return
  const code = generateUserEmbedCode(props.accountHost, props.user.id)
  copyText(code, i18n.ts._userProfileMenu.embedCodeCopied)
}

async function openListPicker() {
  if (!props.adapter) return
  try {
    userLists.value = await props.adapter.api.getUserLists()
    showListPicker.value = true
  } catch (e) {
    const err = AppError.from(e)
    console.error('[list:fetch]', err.code, err.message)
    toast.show(
      i18n.tsx._userProfileMenu.fetchListsFailed({ code: err.displayCode }),
      'error',
    )
  }
}

async function addToList(listId: string) {
  if (!props.adapter || !props.user) return
  try {
    await props.adapter.api.addUserToList(listId, props.user.id)
    toast.show(i18n.ts._userProfileMenu.addedToList)
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[list:add]', err.code, err.message)
    toast.show(
      i18n.tsx._userProfileMenu.addToListFailed({ code: err.displayCode }),
      'error',
    )
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
    toast.show(
      next
        ? i18n.ts._userProfileMenu.withRepliesOn
        : i18n.ts._userProfileMenu.withRepliesOff,
    )
  } catch (e) {
    const err = AppError.from(e)
    console.error('[following:withReplies]', err.code, err.message)
    toast.show(
      i18n.tsx._userProfileMenu.updateSettingsFailed({ code: err.displayCode }),
      'error',
    )
  }
}

async function toggleNotify() {
  if (!props.adapter || !props.user) return
  const next = props.user.notify === 'normal' ? 'none' : 'normal'
  try {
    await props.adapter.api.updateFollowing(props.user.id, { notify: next })
    props.user.notify = next
    toast.show(
      next === 'normal'
        ? i18n.ts._userProfileMenu.notifyOn
        : i18n.ts._userProfileMenu.notifyOff,
    )
  } catch (e) {
    const err = AppError.from(e)
    console.error('[following:notify]', err.code, err.message)
    toast.show(
      i18n.tsx._userProfileMenu.updateSettingsFailed({ code: err.displayCode }),
      'error',
    )
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
    toast.show(
      i18n.tsx._userProfileMenu.fetchAntennasFailed({ code: err.displayCode }),
      'error',
    )
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
      toast.show(i18n.ts._userProfileMenu.alreadyAdded)
      closeUserMenu()
      return
    }
    await props.adapter.api.updateAntenna({
      ...current,
      users: [...existing, acct],
    })
    toast.show(i18n.tsx._userProfileMenu.addedToAntenna({ name: antenna.name }))
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[antenna:add]', err.code, err.message)
    toast.show(
      i18n.tsx._userProfileMenu.addToAntennaFailed({ code: err.displayCode }),
      'error',
    )
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
        {{ i18n.ts._userProfileMenu.composeToUser }}
      </button>
      <button class="_popupItem" @click="searchUserNotes">
        <i class="ti ti-search" />
        {{ i18n.ts._userProfileMenu.searchUserNotes }}
      </button>
      <button class="_popupItem" @click="openDirectMessage">
        <i class="ti ti-message" />
        {{ i18n.ts._userProfileMenu.directMessage }}
      </button>
      <div class="_popupDivider" />
      <button class="_popupItem" @click="handleCopyUsername">
        <i class="ti ti-at" />
        {{ i18n.ts._userProfileMenu.copyUsername }}
      </button>
      <button class="_popupItem" @click="handleCopyProfileUrl">
        <i class="ti ti-share" />
        {{ i18n.ts._userProfileMenu.copyProfileUrl }}
      </button>
      <button class="_popupItem" @click="handleCopyRss">
        <i class="ti ti-rss" />
        {{ i18n.ts._userProfileMenu.copyRss }}
      </button>
      <button
        v-if="!user?.host"
        class="_popupItem"
        @click="handleCopyEmbedCode"
      >
        <i class="ti ti-code" />
        {{ i18n.ts._userProfileMenu.embed }}
      </button>
      <div class="_popupDivider" />
      <button class="_popupItem" @click="openListPicker">
        <i class="ti ti-list" />
        {{ i18n.ts._userProfileMenu.addToList }}
      </button>
      <button class="_popupItem" @click="openAntennaPicker">
        <i class="ti ti-antenna" />
        {{ i18n.ts._userProfileMenu.addToAntenna }}
      </button>
      <template v-if="user?.isFollowing">
        <div class="_popupDivider" />
        <button class="_popupItem" @click="toggleWithReplies">
          <i
            :class="
              user?.withReplies ? 'ti ti-checkbox' : 'ti ti-square'
            "
          />
          {{ i18n.ts._userProfileMenu.withReplies }}
        </button>
        <button class="_popupItem" @click="toggleNotify">
          <i
            :class="
              user?.notify === 'normal' ? 'ti ti-bell-ringing' : 'ti ti-bell'
            "
          />
          {{ i18n.ts._userProfileMenu.notifyPosts }}
        </button>
      </template>
      <template v-if="user && userActions.length > 0">
        <div class="_popupDivider" />
        <button
          v-for="action in userActions"
          :key="action.pluginInstallId + action.title"
          class="_popupItem"
          @click="withPluginAccountContext(action.pluginInstallId, accountId, () => action.handler(user)); closeUserMenu()"
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
        {{ userRelation?.isMuted ? i18n.ts._userProfileMenu.unmute : i18n.ts._userProfileMenu.mute }}
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
        {{ userRelation?.isRenoteMuted ? i18n.ts._userProfileMenu.unmuteRenotes : i18n.ts._userProfileMenu.muteRenotes }}
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
        {{ userRelation?.isBlocking ? i18n.ts._userProfileMenu.unblock : i18n.ts._userProfileMenu.block }}
      </button>
      <button
        v-if="userRelation?.isFollowed"
        class="_popupItem _popupItemDanger"
        @click="showInvalidateFollowerConfirm = true"
      >
        <i class="ti ti-link-off" />
        {{ i18n.ts._userProfileMenu.invalidateFollower }}
      </button>
      <div class="_popupDivider" />
      <button class="_popupItem _popupItemDanger" @click="showReportForm = true">
        <i class="ti ti-alert-triangle" />
        {{ i18n.ts._userProfileMenu.report }}
      </button>
    </template>
    <!-- Mute confirm -->
    <template v-else-if="userMenuView === 'muteConfirm'">
      <div class="_popupConfirmText">{{ i18n.tsx._userProfileMenu.muteConfirm({ username: user?.username ?? '' }) }}</div>
      <button class="_popupItem _popupItemDanger" @click="handleMuteUser">
        <i class="ti ti-eye-off" />
        {{ i18n.ts._userProfileMenu.mute }}
      </button>
      <button class="_popupItem" @click="userMenuBack">
        <i class="ti ti-x" />
        {{ i18n.ts._common.cancel }}
      </button>
    </template>
    <!-- Block confirm -->
    <template v-else-if="userMenuView === 'blockConfirm'">
      <div class="_popupConfirmText">{{ i18n.tsx._userProfileMenu.blockConfirm({ username: user?.username ?? '' }) }}</div>
      <button class="_popupItem _popupItemDanger" @click="handleBlockUser">
        <i class="ti ti-ban" />
        {{ i18n.ts._userProfileMenu.block }}
      </button>
      <button class="_popupItem" @click="userMenuBack">
        <i class="ti ti-x" />
        {{ i18n.ts._common.cancel }}
      </button>
    </template>
    <!-- Invalidate follower confirm -->
    <template v-else-if="userMenuView === 'invalidateFollowerConfirm'">
      <div class="_popupConfirmText">
        {{ i18n.tsx._userProfileMenu.invalidateFollowerConfirm({ username: user?.username ?? '' }) }}
      </div>
      <button
        class="_popupItem _popupItemDanger"
        @click="handleInvalidateFollower"
      >
        <i class="ti ti-link-off" />
        {{ i18n.ts._userProfileMenu.invalidate }}
      </button>
      <button class="_popupItem" @click="userMenuBack">
        <i class="ti ti-x" />
        {{ i18n.ts._common.cancel }}
      </button>
    </template>
    <!-- Report form -->
    <template v-else-if="userMenuView === 'reportForm'">
      <div class="_popupConfirmText">{{ i18n.tsx._userProfileMenu.reportTitle({ username: user?.username ?? '' }) }}</div>
      <div class="_popupReportInputWrap">
        <textarea
          v-model="reportComment"
          class="_popupReportInput"
          :placeholder="i18n.ts._userProfileMenu.reportPlaceholder"
          rows="3"
        />
      </div>
      <button
        class="_popupItem _popupItemDanger"
        :disabled="!reportComment.trim()"
        @click="handleReportUser"
      >
        <i class="ti ti-alert-triangle" />
        {{ i18n.ts._common.send }}
      </button>
      <button class="_popupItem" @click="userMenuBack">
        <i class="ti ti-x" />
        {{ i18n.ts._common.cancel }}
      </button>
    </template>
    <!-- List picker -->
    <template v-else-if="userMenuView === 'listPicker'">
      <button class="_popupItem" @click="userMenuBack">
        <i class="ti ti-arrow-left" />
        {{ i18n.ts._common.back }}
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
      <div v-else class="_popupConfirmText">{{ i18n.ts._userProfileMenu.noLists }}</div>
    </template>
    <!-- Antenna picker -->
    <template v-else-if="userMenuView === 'antennaPicker'">
      <button class="_popupItem" @click="userMenuBack">
        <i class="ti ti-arrow-left" />
        {{ i18n.ts._common.back }}
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
        {{ i18n.ts._userProfileMenu.noUserAntennas }}
      </div>
    </template>
  </PopupMenu>
</template>

<script setup lang="ts">
import { defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import type { NoteReaction } from '@/adapters/types'
import { useEmojiMute } from '@/composables/useEmojiMute'
import { useNativePopover } from '@/composables/useNativePopover'
import { useNavigation } from '@/composables/useNavigation'
import { useAccountsStore } from '@/stores/accounts'
import { normalizeEmojiMuteKey } from '@/utils/emojiMute'
import { proxyUrl } from '@/utils/imageProxy'
import { extractColumnThemeVars } from '@/utils/themeVars'
import MkAvatar from './MkAvatar.vue'
import MkEmoji from './MkEmoji.vue'
import MkMfm from './MkMfm.vue'

const MkUserPopup = defineAsyncComponent(() => import('./MkUserPopup.vue'))

const PREVIEW_LIMIT = 10

const props = defineProps<{
  noteId: string
  accountId: string
  serverHost: string
  reaction: string
  reactionUrl: string | null
  totalCount: number
  x: number
  y: number
}>()

const emit = defineEmits<{
  close: []
  openModal: [reaction: string]
}>()

const { navigateToUser } = useNavigation()
const { isEmojiMuted, toggleEmojiMuteWithConfirm } = useEmojiMute()
const accountsStore = useAccountsStore()

// プレビュー内の軽量アクション (#612)。hover popup と右クリックメニューが
// 重なるため、メニューは廃止してここに統合した
const copiedCode = ref(false)
function copyReactionCode() {
  navigator.clipboard.writeText(normalizeEmojiMuteKey(props.reaction))
  copiedCode.value = true
  setTimeout(() => {
    copiedCode.value = false
  }, 1500)
}

function toggleMute() {
  emit('close')
  toggleEmojiMuteWithConfirm(props.reaction, props.reactionUrl)
}

const reactions = ref<NoteReaction[]>([])
const isLoading = ref(true)

// User hover popup
const showUserPopup = ref(false)
const userPopupUserId = ref('')
const userPopupPos = ref({ x: 0, y: 0 })
const userPopupTheme = ref<Record<string, string>>({})
let hoverTimer: ReturnType<typeof setTimeout> | null = null

async function fetchReactions() {
  isLoading.value = true
  reactions.value = []
  try {
    const account = accountsStore.accounts.find((a) => a.id === props.accountId)
    if (!account) return
    const { adapter } = await initAdapterFor(account.host, account.id, {
      pinnedReactions: false,
      hasToken: account.hasToken,
    })
    reactions.value = await adapter.api.getNoteReactions(
      props.noteId,
      props.reaction,
      PREVIEW_LIMIT,
    )
  } catch {
    // Non-critical tooltip
  } finally {
    isLoading.value = false
  }
}

watch(() => props.reaction, fetchReactions, { immediate: true })

function handleMouseLeave() {
  if (showUserPopup.value) return
  emit('close')
}

function onUserClick(userId: string) {
  emit('close')
  navigateToUser(props.accountId, userId)
}

function onUserMouseEnter(e: MouseEvent, userId: string) {
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }

  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  userPopupPos.value = { x: rect.right + 8, y: rect.top }
  userPopupUserId.value = userId

  userPopupTheme.value = extractColumnThemeVars(el)

  if (showUserPopup.value) return

  hoverTimer = setTimeout(() => {
    showUserPopup.value = true
  }, 400)
}

function onUserMouseLeave() {
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
}

function closeUserPopup() {
  showUserPopup.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
const userPopupPopoverRef = ref<HTMLElement | null>(null)
useNativePopover(userPopupPopoverRef, showUserPopup, {
  leaveDuration: 0,
})

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  if (hoverTimer) clearTimeout(hoverTimer)
})
</script>

<template>
  <div
    :class="$style.root"
    class="_popup reaction-users-popup"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @mouseleave="handleMouseLeave"
  >
    <template v-if="!isLoading || reactions.length > 0">
      <!-- Left: reaction icon -->
      <div :class="$style.reaction">
        <span
          v-if="isEmojiMuted(reaction)"
          class="_emojiMuted"
          :class="$style.reactionIcon"
          role="img"
          :aria-label="reaction"
          :title="`${reaction} (ミュート中)`"
        />
        <img
          v-else-if="reactionUrl"
          :src="proxyUrl(reactionUrl)"
          :alt="reaction"
          :class="$style.reactionIcon"
          decoding="async"
          loading="lazy"
        />
        <MkEmoji v-else :emoji="reaction" :class="$style.reactionIcon" />
        <div :class="$style.reactionActions">
          <button
            class="_button"
            :class="$style.actionBtn"
            :data-tooltip="copiedCode ? 'コピーしました' : 'コードをコピー'"
            @click.stop="copyReactionCode"
          >
            <i :class="copiedCode ? 'ti ti-check' : 'ti ti-copy'" />
          </button>
          <button
            class="_button"
            :class="$style.actionBtn"
            :data-tooltip="isEmojiMuted(reaction) ? 'ミュートを解除' : 'この絵文字をミュート'"
            @click.stop="toggleMute"
          >
            <i :class="isEmojiMuted(reaction) ? 'ti ti-mood-smile' : 'ti ti-mood-off'" />
          </button>
        </div>
      </div>

      <!-- Right: user list (original style) -->
      <div :class="$style.users">
        <button
          v-for="r in reactions"
          :key="r.id"
          :class="$style.userRow"
          @click.stop="onUserClick(r.user.id)"
          @mouseenter="onUserMouseEnter($event, r.user.id)"
          @mouseleave="onUserMouseLeave"
        >
          <MkAvatar
            :avatar-url="r.user.avatarUrl"
            :size="24"
            :is-cat="r.user.isCat"
            :alt="r.user.username"
            :class="$style.avatar"
          />
          <div :class="$style.userInfo">
            <span :class="$style.userName">
              <MkMfm v-if="r.user.name" :text="r.user.name" :emojis="r.user.emojis" :server-host="serverHost" plain />
              <template v-else>{{ r.user.username }}</template>
            </span>
            <span :class="$style.userHandle">@{{ r.user.username }}</span>
          </div>
        </button>
        <button
          v-if="totalCount > PREVIEW_LIMIT"
          :class="$style.more"
          @click.stop="emit('openModal', reaction)"
        >
          +{{ totalCount - reactions.length }}
        </button>
      </div>
    </template>
  </div>

  <div v-if="showUserPopup" ref="userPopupPopoverRef" popover="manual" :style="userPopupTheme">
    <MkUserPopup
      :key="userPopupUserId"
      :user-id="userPopupUserId"
      :account-id="accountId"
      :x="userPopupPos.x"
      :y="userPopupPos.y"
      @close="closeUserPopup"
    />
  </div>
</template>

<style lang="scss" module>
.root {
  position: fixed;
  z-index: calc(var(--nd-z-popup) + 1);
  display: flex;
  align-items: stretch;
  max-width: 340px;
  padding: 8px 0 8px 12px;
  pointer-events: auto;
  animation: reactionPopupIn 0.2s var(--nd-ease-spring);

  /* Bridge to catch the mouse in the gap between badge and tooltip */
  &::before {
    content: '';
    position: absolute;
    top: -8px;
    left: 0;
    right: 0;
    height: 8px;
  }
}

.reaction {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding-right: 10px;
  margin-right: 2px;
  border-right: 1px solid var(--nd-divider);
  flex-shrink: 0;
}

.reactionActions {
  display: flex;
  gap: 2px;
}

.actionBtn {
  position: relative;
  padding: 3px 6px;
  border-radius: 6px;
  font-size: 0.9em;
  opacity: 0.55;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }

  /* ネイティブ title は popover の top-layer に潜るため、popup 内で描く */
  &::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    padding: 3px 8px;
    border-radius: 6px;
    background: var(--nd-bg);
    box-shadow: var(--nd-shadow-m);
    color: var(--nd-fg);
    font-size: 0.75rem;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--nd-duration-base);
  }

  &:hover::after {
    opacity: 1;
  }
}

.reactionIcon {
  height: 32px;
  width: auto;
  max-width: 120px;
  object-fit: contain;
}

.users {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-height: 96px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.userRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  width: 100%;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.avatar {
  flex-shrink: 0;
}

.userInfo {
  min-width: 0;
  overflow: hidden;
}

.userName {
  font-size: 0.85em;
  font-weight: bold;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}

.userHandle {
  font-size: 0.75em;
  opacity: 0.6;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.more {
  padding: 4px 12px;
  border: none;
  background: none;
  color: var(--nd-accent);
  font-size: 0.85em;
  font-weight: bold;
  cursor: pointer;
  text-align: left;
  flex-shrink: 0;
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 0.7;
  }
}

@keyframes reactionPopupIn {
  from { opacity: 0; transform: scale(0.88) translateY(6px); }
}

</style>

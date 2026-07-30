<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { ref, watch } from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import type { NoteReaction } from '@/adapters/types'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import { useEmojiMute } from '@/composables/useEmojiMute'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { useNavigation } from '@/composables/useNavigation'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { useAccountsStore } from '@/stores/accounts'
import { useUiStore } from '@/stores/ui'
import { proxyUrl } from '@/utils/imageProxy'
import MkEmoji from './MkEmoji.vue'
import MkMfm from './MkMfm.vue'

const props = defineProps<{
  noteId: string
  accountId: string
  serverHost: string
  reactions: { reaction: string; count: number }[]
  reactionUrls: Record<string, string | null>
}>()

const { isCompactLayout: isCompact } = storeToRefs(useUiStore())
const { navigateToUser } = useNavigation()
const { isEmojiMuted } = useEmojiMute()
const accountsStore = useAccountsStore()

const show = ref(false)
const selectedReaction = ref('')
const users = ref<NoteReaction[]>([])
const isLoading = ref(false)
const hasMore = ref(false)
const scrollRef = ref<HTMLElement | null>(null)
const dialogRef = ref<HTMLDialogElement | null>(null)

const LIMIT = 20

const { visible, leaving } = useVaporTransition(show, {
  enterDuration: 200,
  leaveDuration: 200,
})

useNativeDialog(dialogRef, visible, {
  onCancel: () => close(),
  leaveDuration: 200,
})

watch(selectedReaction, () => {
  users.value = []
  hasMore.value = false
  fetchReactions()
})

async function fetchReactions(untilId?: string) {
  if (isLoading.value) return
  isLoading.value = true
  try {
    const account = accountsStore.accounts.find((a) => a.id === props.accountId)
    if (!account) return
    const { adapter } = await initAdapterFor(account.host, account.id, {
      pinnedReactions: false,
      hasToken: account.hasToken,
    })
    const result = await adapter.api.getNoteReactions(
      props.noteId,
      selectedReaction.value,
      LIMIT,
      untilId,
    )
    if (untilId) {
      users.value = [...users.value, ...result]
    } else {
      users.value = result
    }
    hasMore.value = result.length === LIMIT
  } catch {
    // Non-critical modal
  } finally {
    isLoading.value = false
  }
}

function onScroll() {
  if (!scrollRef.value || !hasMore.value || isLoading.value) return
  const el = scrollRef.value
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
    const lastId = users.value[users.value.length - 1]?.id
    if (lastId) fetchReactions(lastId)
  }
}

function open(initialReaction?: string) {
  selectedReaction.value = initialReaction ?? props.reactions[0]?.reaction ?? ''
  show.value = true
}

function close() {
  show.value = false
}

function onUserClick(userId: string) {
  close()
  navigateToUser(props.accountId, userId)
}

defineExpose({ open })
</script>

<template>
  <dialog
    v-if="visible"
    ref="dialogRef"
    class="_nativeDialog"
    :class="[
      $style.backdrop,
      isCompact && $style.mobile,
      leaving ? (isCompact ? $style.sheetLeave : $style.popupLeave) : (isCompact ? $style.sheetEnter : $style.popupEnter),
    ]"
  >
      <div
        :class="[
          $style.modal,
          leaving ? (isCompact ? $style.sheetContentLeave : $style.popupContentLeave) : (isCompact ? $style.sheetContentEnter : $style.popupContentEnter),
        ]"
      >
        <!-- Reaction tabs -->
        <div :class="$style.tabs">
          <button
            v-for="r in reactions"
            :key="r.reaction"
            :class="[$style.tab, { [$style.tabActive]: selectedReaction === r.reaction }]"
            @click="selectedReaction = r.reaction"
          >
            <span v-if="isEmojiMuted(r.reaction)" class="_emojiMuted" :class="$style.tabEmoji" role="img" :aria-label="r.reaction" :title="`${r.reaction} (ミュート中)`" />
            <img v-else-if="reactionUrls[r.reaction]" :src="proxyUrl(reactionUrls[r.reaction]!)" :alt="r.reaction" :class="$style.tabEmoji" decoding="async" loading="lazy" />
            <MkEmoji v-else :emoji="r.reaction" :class="$style.tabEmoji" />
            <span :class="$style.tabCount">{{ r.count }}</span>
          </button>
        </div>

        <!-- User list -->
        <div ref="scrollRef" :class="$style.userList" @scroll.passive="onScroll">
          <div v-if="isLoading && users.length === 0" :class="$style.loading"><LoadingSpinner /></div>
          <template v-else>
            <div v-if="users.length === 0" :class="$style.loading">リアクションなし</div>
            <button
              v-for="u in users"
              :key="u.id"
              :class="$style.userRow"
              @click="onUserClick(u.user.id)"
            >
              <img
                v-if="u.user.avatarUrl"
                :src="u.user.avatarUrl"
                :class="$style.avatar"
                width="32"
                height="32"
                loading="lazy"
                decoding="async"
              />
              <div v-else :class="[$style.avatar, $style.avatarPlaceholder]" />
              <div :class="$style.userInfo">
                <span :class="$style.userName">
                  <MkMfm v-if="u.user.name" :text="u.user.name" :emojis="u.user.emojis" :server-host="serverHost" plain />
                  <template v-else>{{ u.user.username }}</template>
                </span>
                <span :class="$style.userHandle">@{{ u.user.username }}</span>
              </div>
            </button>
            <div v-if="isLoading && users.length > 0" :class="$style.loading"><LoadingSpinner /></div>
          </template>
        </div>
      </div>
  </dialog>
</template>

<style lang="scss" module>
.backdrop {
  &.mobile {
    align-items: flex-end;
    justify-content: stretch;
  }
}

.modal {
  width: 360px;
  max-height: 480px;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--nd-popup, var(--nd-panel)) 96%, transparent);
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  contain: paint;

  .mobile & {
    width: 100%;
    max-height: 70vh;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.3);
    padding-bottom: var(--nd-safe-area-bottom, env(safe-area-inset-bottom));
  }
}

.tabs {
  display: flex;
  overflow-x: auto;
  padding: 8px 8px 0;
  gap: 4px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--nd-divider);
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  flex-shrink: 0;
  border-radius: 8px 8px 0 0;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.tabActive {
  border-bottom-color: var(--nd-accent);
}

.tabEmoji {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.tabCount {
  font-size: 0.8em;
  opacity: 0.7;
}

.userList {
  overflow-y: auto;
  flex: 1;
  padding: 4px 0;
}

.loading {
  padding: 16px;
  text-align: center;
  font-size: 0.85em;
  color: var(--nd-fg);
  opacity: 0.5;
}

.userRow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
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
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.avatarPlaceholder {
  background: var(--nd-buttonBg);
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

/* Desktop popup */
.popupEnter { animation: modalBdIn var(--nd-duration-base) var(--nd-ease-decel); }
.popupLeave { animation: modalBdOut var(--nd-duration-base) ease-out forwards; }
@keyframes modalBdIn { from { opacity: 0; } }
@keyframes modalBdOut { to { opacity: 0; } }

.popupContentEnter { animation: modalIn 0.2s var(--nd-ease-spring); }
.popupContentLeave { animation: modalOut var(--nd-duration-base) var(--nd-ease-decel) forwards; }
@keyframes modalIn { from { opacity: 0; transform: scale(0.88) translateY(6px); } }
@keyframes modalOut { to { opacity: 0; transform: scale(0.93); } }

/* Mobile sheet — iOS-style spring slide */
.sheetEnter { animation: sheetBdIn var(--nd-duration-slow) var(--nd-ease-decel); }
.sheetLeave { animation: sheetBdOut var(--nd-duration-base) ease-out forwards; }
@keyframes sheetBdIn { from { opacity: 0; } }
@keyframes sheetBdOut { to { opacity: 0; } }

.sheetContentEnter { animation: sheetIn 0.25s var(--nd-ease-spring); }
.sheetContentLeave { animation: sheetOut 0.2s var(--nd-ease-decel) forwards; }
@keyframes sheetIn { from { transform: translateY(100%); } }
@keyframes sheetOut { to { transform: translateY(100%); } }
</style>

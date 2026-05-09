<script setup lang="ts">
import { computed, defineAsyncComponent, ref, useTemplateRef } from 'vue'
import type { ChatMessage, NormalizedUser } from '@/adapters/types'
import MkAvatar from '@/components/common/MkAvatar.vue'
import MkChatMessageMoreMenu from '@/components/common/MkChatMessageMoreMenu.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import { useEmojiResolver } from '@/composables/useEmojiResolver'
import { useHoverPopup } from '@/composables/useHoverPopup'
import { provideNoteAccountId } from '@/composables/useNoteContext'
import { usePortal } from '@/composables/usePortal'
import { proxyThumbUrl, proxyUrl } from '@/utils/imageProxy'
import { commands, unwrap } from '@/utils/tauriInvoke'

const MkUserPopup = defineAsyncComponent(() => import('./MkUserPopup.vue'))

const props = defineProps<{
  message: ChatMessage
  myUserId?: string
  accountId?: string
  serverHost?: string
  otherAvatarUrl?: string
}>()

if (props.accountId) provideNoteAccountId(props.accountId)

const emit = defineEmits<{
  react: [messageId: string, reaction: string]
  unreact: [messageId: string, reaction: string]
  delete: [messageId: string]
}>()

const moreMenuRef = ref<InstanceType<typeof MkChatMessageMoreMenu> | null>(null)

const { reactionUrl } = useEmojiResolver()

const AVATAR_ERROR = '/avatar-error.svg'

const isMine = computed(
  () => props.myUserId && props.message.fromUserId === props.myUserId,
)

const displayUser = computed(() => {
  const u = props.message.fromUser
  if (!u) return null
  return {
    name: u.name || u.username,
    hasName: !!u.name,
    avatarUrl: u.avatarUrl ?? null,
    avatarDecorations: u.avatarDecorations ?? [],
    username: u.username,
    host: u.host ?? null,
    isCat: u.isCat,
    emojis: u.emojis ?? {},
  }
})

const timeStr = computed(() => {
  const d = new Date(props.message.createdAt)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
})

const lightboxUrl = ref<string | null>(null)

function openLightbox(url: string) {
  lightboxUrl.value = url
}

function closeLightbox() {
  lightboxUrl.value = null
}

// Group reactions: { reaction, count, users[], avatarUrls[], reacted (by me) }
const groupedReactions = computed(() => {
  const reactions = props.message.reactions
  if (!reactions || reactions.length === 0) return []

  const map = new Map<
    string,
    {
      reaction: string
      count: number
      users: string[]
      avatarUrls: string[]
      reacted: boolean
    }
  >()
  for (const r of reactions) {
    let userName = ''
    let avatarUrl: string | undefined
    let isMe = false

    if (r.user) {
      userName = r.user.name || r.user.username
      avatarUrl = r.user.avatarUrl
      isMe = r.user.id === props.myUserId
    } else if (props.otherAvatarUrl) {
      // 1-on-1: no user in reaction = the other participant reacted
      avatarUrl = props.otherAvatarUrl
    }

    const existing = map.get(r.reaction)
    if (existing) {
      existing.count++
      if (userName) existing.users.push(userName)
      if (avatarUrl) existing.avatarUrls.push(avatarUrl)
      if (isMe) existing.reacted = true
    } else {
      map.set(r.reaction, {
        reaction: r.reaction,
        count: 1,
        users: userName ? [userName] : [],
        avatarUrls: avatarUrl ? [avatarUrl] : [],
        reacted: isMe,
      })
    }
  }
  return Array.from(map.values())
})

function getReactionImageUrl(reaction: string): string | null {
  if (!props.serverHost) return null
  return reactionUrl(reaction, {}, {}, props.serverHost)
}

function onReactionAvatarError(e: Event) {
  const img = e.target as HTMLImageElement
  if (!img.src.endsWith(AVATAR_ERROR)) {
    img.src = AVATAR_ERROR
  }
}

function handleReactionClick(reaction: string, reacted: boolean) {
  if (reacted) {
    emit('unreact', props.message.id, reaction)
  } else {
    emit('react', props.message.id, reaction)
  }
}

// User hover popup for mentions
const mentionPopup = useHoverPopup()
const mentionUserId = ref('')
let mentionHovering = false

async function onMentionHover(
  e: MouseEvent,
  username: string,
  host: string | null,
) {
  if (!props.accountId) return
  mentionHovering = true
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  try {
    const user = unwrap(
      await commands.apiLookupUser(props.accountId, username, host ?? null),
    )
    if (!mentionHovering) return
    mentionUserId.value = user.id
    mentionPopup.show({ x: rect.right + 8, y: rect.top })
  } catch {
    // lookup failed — don't show popup
  }
}

function onMentionLeave() {
  mentionHovering = false
  mentionPopup.hide()
}

function closeMentionPopup() {
  mentionPopup.forceClose()
}

const mentionPortalRef = useTemplateRef<HTMLElement>('mentionPortalRef')
usePortal(mentionPortalRef)

const lightboxPortalRef = useTemplateRef<HTMLElement>('lightboxPortalRef')
usePortal(lightboxPortalRef)
</script>

<template>
  <div :class="[$style.chatMsg, { [$style.mine]: isMine }]">
    <MkAvatar
      v-if="!isMine && displayUser"
      :class="$style.chatAvatar"
      :avatar-url="displayUser.avatarUrl"
      :decorations="displayUser.avatarDecorations"
      :size="32"
      :is-cat="displayUser.isCat"
    />
    <div :class="$style.chatBubbleWrapper">
      <div
        :class="$style.chatBubble"
        @contextmenu.prevent.stop="moreMenuRef?.open($event)"
      >
        <div v-if="!isMine && displayUser" :class="$style.chatSender">
          <MkMfm
            v-if="displayUser.hasName"
            :text="displayUser.name"
            :emojis="displayUser.emojis"
            :server-host="serverHost"
            plain
          />
          <template v-else>{{ displayUser.username }}</template>
        </div>
        <div v-if="message.text" :class="$style.chatText">
          <MkMfm :text="message.text" :server-host="serverHost" @mention-hover="onMentionHover" @mention-leave="onMentionLeave" />
        </div>
        <div v-if="message.file" :class="$style.chatFile">
          <img
            v-if="message.file.type.startsWith('image/')"
            :src="message.file.thumbnailUrl || message.file.url"
            :class="$style.chatImage"
            loading="lazy"
            @click="openLightbox(message.file!.url)"
          />
          <a v-else :href="message.file.url" target="_blank" rel="noopener">
            {{ message.file.name }}
          </a>
        </div>
        <div :class="$style.chatTime">{{ timeStr }}</div>
      </div>

      <!-- Reactions -->
      <div v-if="groupedReactions.length > 0" :class="$style.chatReactions">
        <button
          v-for="r in groupedReactions"
          :key="r.reaction"
          :class="[$style.chatReactionPill, { [$style.reacted]: r.reacted }]"
          :title="r.users.join(', ')"
          @click="handleReactionClick(r.reaction, r.reacted)"
        >
          <span v-if="r.avatarUrls.length > 0" :class="$style.reactionAvatars">
            <span
              v-for="(url, i) in r.avatarUrls.slice(0, 3)"
              :key="i"
              :class="$style.reactionAvatarWrap"
              :style="{ marginLeft: i > 0 ? '-6px' : '0' }"
            >
              <img
                :src="proxyThumbUrl(url, 18)"
                :class="$style.reactionAvatar"
                decoding="async"
                loading="lazy"
                @error="onReactionAvatarError"
              />
            </span>
          </span>
          <img
            v-if="getReactionImageUrl(r.reaction)"
            :src="proxyUrl(getReactionImageUrl(r.reaction)!)"
            :alt="r.reaction"
            :class="$style.reactionEmojiImg"
            decoding="async"
            loading="lazy"
          />
          <span v-else :class="$style.reactionEmojiText">{{ r.reaction }}</span>
          <span v-if="r.count > 1" :class="$style.reactionCount">{{ r.count }}</span>
        </button>
      </div>

      <!-- Add reaction button -->
      <button
        :class="$style.chatAddReaction"
        title="リアクション"
        @click.stop="emit('react', message.id, '')"
      >
        <i class="ti ti-mood-plus" />
      </button>
    </div>
  </div>

  <MkChatMessageMoreMenu
    ref="moreMenuRef"
    :message="message"
    :is-mine="!!isMine"
    @delete="emit('delete', $event)"
  />

  <div v-if="mentionPopup.isVisible.value && mentionUserId" ref="mentionPortalRef">
    <MkUserPopup
      :user-id="mentionUserId"
      :account-id="accountId!"
      :x="mentionPopup.position.value.x"
      :y="mentionPopup.position.value.y"
      @close="closeMentionPopup"
    />
  </div>

  <div v-if="lightboxUrl" ref="lightboxPortalRef" :class="$style.lightboxOverlay" @click="closeLightbox">
    <button :class="$style.lightboxClose" @click="closeLightbox">
      <svg viewBox="0 0 24 24" width="24" height="24">
        <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </button>
    <img
      :src="lightboxUrl"
      :class="$style.lightboxImage"
      @click.stop
    />
  </div>
</template>

<style lang="scss" module>
.chatMsg {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 12px;

  &.mine {
    flex-direction: row-reverse;

    .chatBubble {
      background: var(--nd-accentedBg, rgba(134, 179, 0, 0.15));
      border-bottom-right-radius: 4px;
    }

    .chatReactions {
      justify-content: flex-end;
    }

    .chatAddReaction {
      left: -28px;
    }
  }

  &:not(.mine) {
    .chatBubble {
      border-bottom-left-radius: 4px;
    }

    .chatAddReaction {
      right: -28px;
    }
  }
}

.chatAvatar {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  margin-top: 4px;
}

.chatBubbleWrapper {
  max-width: 75%;
  position: relative;

  &:hover .chatAddReaction {
    opacity: 1;
  }
}

.chatBubble {
  padding: 8px 12px;
  border-radius: 14px;
  background: var(--nd-panelHighlight, rgba(255, 255, 255, 0.05));
  font-size: 0.95em;
  line-height: 1.5;
  word-break: break-word;
}

.chatSender {
  font-size: 0.8em;
  font-weight: 600;
  opacity: 0.7;
  margin-bottom: 2px;
}

.chatText {
  white-space: pre-wrap;
}

.chatFile {
  margin-top: 4px;
}

.chatImage {
  max-width: 100%;
  max-height: 200px;
  border-radius: var(--nd-radius-md);
  object-fit: contain;
  cursor: pointer;
}

.chatTime {
  font-size: 0.7em;
  opacity: 0.5;
  text-align: right;
  margin-top: 2px;
}

/* Reactions */
.chatReactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.chatReactionPill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 10px;
  border: 1px solid var(--nd-divider, rgba(255, 255, 255, 0.1));
  background: var(--nd-panelHighlight, rgba(255, 255, 255, 0.05));
  color: var(--nd-fg);
  font-size: 0.8em;
  cursor: pointer;
  line-height: 1.4;

  &:hover {
    background: var(--nd-buttonHoverBg, rgba(255, 255, 255, 0.1));
  }

  &.reacted {
    border-color: var(--nd-accent);
    background: var(--nd-accentedBg, rgba(134, 179, 0, 0.15));
  }
}

.reactionAvatars {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.reactionAvatarWrap {
  display: inline-block;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--nd-buttonBg);
  overflow: hidden;
  border: 1.5px solid var(--nd-panel, #1a1a1a);
}

.reactionAvatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.reactionEmojiImg {
  width: 18px;
  height: 18px;
  object-fit: contain;
  flex-shrink: 0;
}

.reactionEmojiText {
  font-size: 1.1em;
}

.reactionCount {
  font-size: 0.85em;
  opacity: 0.7;
}

/* Add reaction button */
.chatAddReaction {
  position: absolute;
  top: 2px;
  border: none;
  background: var(--nd-panelHighlight, rgba(255, 255, 255, 0.08));
  color: var(--nd-fg);
  opacity: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.85em;
  transition: opacity var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg, rgba(255, 255, 255, 0.15));
  }
}

/* Lightbox */
.lightboxOverlay {
  position: fixed;
  inset: 0;
  z-index: var(--nd-z-popup);
  background: var(--nd-overlayLightbox);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.lightboxClose {
  position: absolute;
  top: 16px;
  right: 16px;
  background: var(--nd-modalBg);
  border: none;
  color: white;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 1;

  &:hover {
    background: rgba(255, 255, 255, 0.3);
  }
}

.lightboxImage {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  cursor: default;
}
</style>

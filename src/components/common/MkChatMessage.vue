<script setup lang="ts">
import { computed, defineAsyncComponent, ref, useTemplateRef } from 'vue'
import type { ChatMessage, NormalizedUser } from '@/adapters/types'
import MkAvatar from '@/components/common/MkAvatar.vue'
import MkChatMessageMoreMenu from '@/components/common/MkChatMessageMoreMenu.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import { useEmojiResolver } from '@/composables/useEmojiResolver'
import { USER_POPUP_HOVER, useHoverPopup } from '@/composables/useHoverPopup'
import { useNavigation } from '@/composables/useNavigation'
import { provideNoteAccountId } from '@/composables/useNoteContext'
import { usePortal } from '@/composables/usePortal'
import { i18n } from '@/i18n'
import { proxyEmojiUrl, proxyThumbUrl } from '@/utils/mediaProxy'
import { commands, unwrap } from '@/utils/tauriInvoke'

const MkUserPopup = defineAsyncComponent(() => import('./MkUserPopup.vue'))

const props = defineProps<{
  message: ChatMessage
  myUserId?: string
  accountId?: string
  serverHost?: string
  myAvatarUrl?: string
  otherAvatarUrl?: string
  /** ルームでは送り主が複数いるので、相手側の吹き出しの上に名前を出す */
  showSenderName?: boolean
}>()

if (props.accountId) provideNoteAccountId(props.accountId)

const emit = defineEmits<{
  react: [messageId: string, reaction: string]
  unreact: [messageId: string, reaction: string]
  delete: [messageId: string]
}>()

const moreMenuRef = ref<InstanceType<typeof MkChatMessageMoreMenu> | null>(null)

const { reactionUrl } = useEmojiResolver()
const { navigateToUser } = useNavigation()

function onAvatarClick(e: MouseEvent) {
  e.stopPropagation()
  if (!props.accountId) return
  navigateToUser(props.accountId, props.message.fromUserId)
}

const AVATAR_ERROR = '/avatar-error.svg'

const isMine = computed(
  () => props.myUserId && props.message.fromUserId === props.myUserId,
)

const displayUser = computed(() => {
  const u = props.message.fromUser
  if (!u) return null
  return {
    avatarUrl: u.avatarUrl ?? null,
    avatarDecorations: u.avatarDecorations ?? [],
    isCat: u.isCat,
  }
})

const senderName = computed(() => {
  if (!props.showSenderName || isMine.value) return null
  const u = props.message.fromUser
  if (!u) return null
  return { text: u.name || u.username, hasName: !!u.name, emojis: u.emojis }
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
    } else {
      // 1on1 (packMessageLiteFor1on1) はリアクションから reactor を削除する。
      // Misskey 本家 (room.vue normalizeMessage) と同じく、メッセージ送信者から
      // 逆算する: 自分のメッセージへのリアクション = 相手、相手のメッセージ = 自分。
      // (自分のメッセージに自分でリアクションした場合は相手扱いになる本家と同じ制約)
      if (isMine.value) {
        avatarUrl = props.otherAvatarUrl
      } else {
        avatarUrl = props.myAvatarUrl
        isMe = true
      }
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
  // 自分のメッセージに付いたリアクションは必ず他人のもの。本家 ChatService.react
  // が fromUserId === userId で throw するため、押しても付け外しはできない。
  if (isMine.value) return
  if (reacted) {
    emit('unreact', props.message.id, reaction)
  } else {
    emit('react', props.message.id, reaction)
  }
}

// User hover popup for mentions
const mentionPopup = useHoverPopup(USER_POPUP_HOVER)
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
      v-if="displayUser"
      :class="$style.chatAvatar"
      :avatar-url="displayUser.avatarUrl"
      :decorations="displayUser.avatarDecorations"
      :size="50"
      :is-cat="displayUser.isCat"
      @click="onAvatarClick"
    />
    <div :class="$style.chatBubbleWrapper">
      <div v-if="senderName" :class="$style.chatSender">
        <MkMfm
          v-if="senderName.hasName"
          :text="senderName.text"
          :emojis="senderName.emojis"
          :server-host="serverHost"
          plain
        />
        <template v-else>{{ senderName.text }}</template>
      </div>
      <div
        :class="$style.chatBubble"
        @contextmenu.prevent.stop="moreMenuRef?.open($event)"
      >
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
      </div>
      <div :class="$style.chatMeta">
        <button
          :class="$style.chatMoreBtn"
          :title="i18n.ts._common.menu"
          @click.stop="moreMenuRef?.open($event)"
        >
          <i class="ti ti-dots" />
        </button>
        <span :class="$style.chatTime">{{ timeStr }}</span>
      </div>

      <!-- Reactions -->
      <div v-if="groupedReactions.length > 0" :class="$style.chatReactions">
        <button
          v-for="r in groupedReactions"
          :key="r.reaction"
          :class="[$style.chatReactionPill, { [$style.reacted]: r.reacted }]"
          :title="r.users.join(', ')"
          :disabled="!!isMine"
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
                :src="proxyThumbUrl(url, 24)"
                :class="$style.reactionAvatar"
                decoding="async"
                loading="lazy"
                @error="onReactionAvatarError"
              />
            </span>
          </span>
          <img
            v-if="getReactionImageUrl(r.reaction)"
            :src="proxyEmojiUrl(getReactionImageUrl(r.reaction)!)"
            :alt="r.reaction"
            :class="$style.reactionEmojiImg"
            decoding="async"
            loading="lazy"
          />
          <span v-else :class="$style.reactionEmojiText">{{ r.reaction }}</span>
          <span v-if="r.count > 1" :class="$style.reactionCount">{{ r.count }}</span>
        </button>
      </div>
    </div>
  </div>

  <MkChatMessageMoreMenu
    ref="moreMenuRef"
    :message="message"
    :is-mine="!!isMine"
    :account-id="accountId"
    @react="emit('react', $event, '')"
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
    <button :aria-label="i18n.ts._common.close" :class="$style.lightboxClose" @click="closeLightbox">
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
@use '@/styles/buttons' as *;
// 寸法は本家 (pages/chat/XMessage.vue) に揃える。カラムが 450px 以下なら
// 小さい段 (本文 0.9em・アバター 42px・自分のアバターは隠す)、それより広ければ
// 本文 14px 相当・アバター 50px の大きい段 (#1207)。DeckColumn が
// container-type: inline-size を持つので、カラムの幅で切り替わる
.chatMsg {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 0 12px;

  &.mine {
    flex-direction: row-reverse;

    .chatBubble {
      background: var(--nd-accentedBg);
      border-bottom-right-radius: 4px;
    }

    .chatReactions {
      justify-content: flex-end;
    }
  }

  &:not(.mine) {
    .chatBubble {
      border-bottom-left-radius: 4px;
    }
  }
}

// MkAvatar 側の幅指定 (--avatar-size) より強くするため 2 クラスで当てる
.chatMsg .chatAvatar {
  width: 50px;
  height: 50px;
  flex-shrink: 0;
  cursor: pointer;
}

.chatBubbleWrapper {
  // 最大幅は決め打ちの割合ではなく、反対側に少し余白を残すだけにする。
  // 狭いカラムで自分のアバターを隠した分も吹き出しに回る
  min-width: 0;
  max-width: calc(100% - 32px);
  position: relative;
}

.chatSender {
  margin: 0 4px 2px;
  font-size: var(--nd-font-sm);
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chatBubble {
  padding: 10px 14px;
  border-radius: 14px;
  background: var(--nd-panelHighlight);
  font-size: 1em;
  line-height: 1.5;
  word-break: break-word;
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

.chatMeta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  padding: 0 2px;
}

.mine .chatMeta {
  flex-direction: row-reverse;
}

.chatTime {
  font-size: var(--nd-font-xs);
  opacity: 0.6;
}

.chatMoreBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: var(--nd-panelHighlight);
  color: var(--nd-fg);
  opacity: 0.5;
  cursor: pointer;
  font-size: var(--nd-font-sm);
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

/* Reactions */
.chatReactions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.chatReactionPill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--nd-radius-full);
  border: 1px solid var(--nd-divider);
  background: var(--nd-panelHighlight);
  color: var(--nd-fg);
  font-size: var(--nd-font-md);
  cursor: pointer;
  line-height: 1.4;

  &:not(:disabled):hover {
    background: var(--nd-buttonHoverBg);
  }

  /* 自分のメッセージのリアクションは付け外しできないので押せる見た目にしない */
  &:disabled {
    cursor: default;
  }

  &.reacted {
    border-color: var(--nd-accent);
    background: var(--nd-accentedBg);
  }
}

.reactionAvatars {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.reactionAvatarWrap {
  display: inline-block;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--nd-buttonBg);
  overflow: hidden;
  border: 1.5px solid var(--nd-panel);
}

.reactionAvatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.reactionEmojiImg {
  width: 24px;
  height: 24px;
  object-fit: contain;
  flex-shrink: 0;
}

.reactionEmojiText {
  font-size: 20px;
  line-height: 1;
}

.reactionCount {
  font-size: 1em;
  opacity: 0.7;
}

@container (max-width: 450px) {
  .chatMsg.mine .chatAvatar {
    display: none;
  }

  .chatMsg .chatAvatar {
    width: 42px;
    height: 42px;
  }

  .chatBubble {
    padding: 8px 12px;
    font-size: var(--nd-font-body);
  }

  .reactionAvatarWrap {
    width: 20px;
    height: 20px;
  }

  .reactionEmojiImg {
    width: 22px;
    height: 22px;
  }
}

/* Add reaction button */
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
  @include nd-interactive;
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

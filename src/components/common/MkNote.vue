<script setup lang="ts">
import { useIntersectionObserver } from '@vueuse/core'
import { computed, defineAsyncComponent, ref, useTemplateRef, watch } from 'vue'
import type {
  NormalizedNote,
  NormalizedUser,
  NoteVisibility,
} from '@/adapters/types'
import { applyNoteViewInterruptors } from '@/aiscript/plugin-api'
import { useAccountMode } from '@/composables/useAccountMode'
import { useEmojiResolver } from '@/composables/useEmojiResolver'
import { useHoverPopup } from '@/composables/useHoverPopup'
import { showLoginPrompt } from '@/composables/useLoginPrompt'
import { useLongPress } from '@/composables/useLongPress'
import { useNavigation } from '@/composables/useNavigation'
import { provideNoteAccountId } from '@/composables/useNoteContext'
import { useNoteVisibility } from '@/composables/useNoteVisibility'
import { usePortal } from '@/composables/usePortal'
import { useRippleEffect } from '@/composables/useRippleEffect'
import { noteTargetId, useSpotlightStore } from '@/composables/useSpotlight'
import {
  useVaporTransition,
  useVaporTransitionGroup,
} from '@/composables/useVaporTransition'
import { useAccountsStore } from '@/stores/accounts'
import { CUSTOM_TL_ICONS } from '@/utils/customTimelines'
import { extractUrlFromMfm } from '@/utils/extractUrlFromMfm'
import { formatTime } from '@/utils/formatTime'
import { proxyThumbUrl, proxyUrl } from '@/utils/imageProxy'
import { parseMfm } from '@/utils/mfm'
import { spawnReactionEffect } from '@/utils/reactionEffect'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { extractColumnThemeVars } from '@/utils/themeVars'
import MkAvatar from './MkAvatar.vue'
import MkEmoji from './MkEmoji.vue'
import MkMediaGrid from './MkMediaGrid.vue'
import MkMfm from './MkMfm.vue'
import MkPoll from './MkPoll.vue'
import NoteMoreMenu from './NoteMoreMenu.vue'
import NoteReactionPickerPopup from './NoteReactionPickerPopup.vue'
import NoteReactionUsersPopup from './NoteReactionUsersPopup.vue'

const MkUserPopup = defineAsyncComponent(() => import('./MkUserPopup.vue'))
const MkUrlPreview = defineAsyncComponent(() => import('./MkUrlPreview.vue'))
const NoteReactionUsersModal = defineAsyncComponent(
  () => import('./NoteReactionUsersModal.vue'),
)

const props = defineProps<{
  note: NormalizedNote
  detailed?: boolean
  focused?: boolean
  pinnedNoteIds?: string[]
  embedded?: boolean
  /** Hint from virtual scroller: this note is near the viewport, use eager image loading */
  nearViewport?: boolean
  /** チャンネルカラム内など、チャンネル情報を重複表示したくない時に true */
  hideChannelBadge?: boolean
  /**
   * article 全体クリックでの navigateToDetail を抑制する。メモプレビュー等
   * で合成 ID (`memo:<accountId>:<key>`) を渡すケースで、navigate すると
   * 404 になるため使用。親側が wrapper の click handler でメモエディタ
   * 等への遷移を行う想定 (= 親 wrapper は capture phase で click を奪わず
   * bubble に任せる + 内部 button の `.stop` 修飾子に依存する)。
   */
  disableArticleClick?: boolean
}>()

/** Pure renote → show inner note, otherwise show note itself */
const effectiveNote = computed(() => {
  const base =
    props.note.renote && props.note.text === null
      ? props.note.renote
      : props.note
  return applyNoteViewInterruptors(base, props.note._accountId)
})
const allEmojis = computed(() => ({
  ...effectiveNote.value.emojis,
  ...effectiveNote.value.user.emojis,
}))
const isPureRenote = computed(
  () => props.note.renote && props.note.text === null,
)

/** 本文から抽出した URL（renote の url/uri と一致するものは除外） */
const extractedUrls = computed<string[]>(() => {
  const text = effectiveNote.value.text
  if (!text) return []
  const tokens = parseMfm(text)
  const renote = effectiveNote.value.renote
  return extractUrlFromMfm(tokens).filter(
    (u) => u !== renote?.url && u !== renote?.uri,
  )
})

provideNoteAccountId(props.note._accountId)

// AI Spotlight: capability dispatcher が note:<id> を highlight している間だけ
// 朱色 glow を出す。複数カラムで同じ note が表示されていれば全箇所で光る。
const spotlightStore = useSpotlightStore()
const isSpotlighted = computed(() =>
  spotlightStore.spotlights.has(noteTargetId(props.note.id)),
)
function clearSpotlight(): void {
  spotlightStore.clear(noteTargetId(props.note.id))
}

const { canInteract, isGuest } = useAccountMode(() => props.note._accountId)
const { spawn: spawnRipple } = useRippleEffect()

const moreMenuRef = ref<InstanceType<typeof NoteMoreMenu> | null>(null)
const reactionPickerRef = ref<InstanceType<
  typeof NoteReactionPickerPopup
> | null>(null)
const reactionUsersRef = ref<InstanceType<
  typeof NoteReactionUsersPopup
> | null>(null)
const reactionModalRef = ref<InstanceType<
  typeof NoteReactionUsersModal
> | null>(null)

const { longPressed, handlers: lpHandlers } = useLongPress((e) => {
  const btn = (e.target as HTMLElement).closest('button') as HTMLElement | null
  const reaction = btn?.dataset.reaction
  if (reaction) reactionModalRef.value?.open(reaction)
})
const reactionsAreaRef = ref<HTMLElement | null>(null)
const reactionsVisible = ref(false)

const { stop: stopReactionsObserver } = useIntersectionObserver(
  reactionsAreaRef,
  ([entry]) => {
    if (entry?.isIntersecting) {
      reactionsVisible.value = true
      stopReactionsObserver()
    }
  },
  { rootMargin: '150px' },
)

const emit = defineEmits<{
  react: [reaction: string, note: NormalizedNote]
  reply: [note: NormalizedNote]
  renote: [note: NormalizedNote]
  quote: [note: NormalizedNote]
  delete: [note: NormalizedNote]
  edit: [note: NormalizedNote]
  bookmark: [note: NormalizedNote]
  pin: [note: NormalizedNote]
  deleteAndEdit: [note: NormalizedNote]
  vote: [choice: number, note: NormalizedNote]
}>()

const {
  navigateToNote: navToNote,
  navigateToUser: navToUser,
  navigateToChannel: navToChannel,
} = useNavigation()

function hashChannelColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  const hue = ((h % 360) + 360) % 360
  return `hsl(${hue}, 65%, 55%)`
}

const channelInfo = computed(() => {
  const ch = effectiveNote.value.channel
  const id = ch?.id ?? effectiveNote.value.channelId
  if (!id) return null
  return {
    id,
    name: ch?.name ?? null,
    color: ch?.color || hashChannelColor(id),
  }
})

const showChannelInfo = computed(
  () => !!channelInfo.value && !props.hideChannelBadge && !props.embedded,
)

function openChannelColumn(e: MouseEvent) {
  e.stopPropagation()
  const info = channelInfo.value
  if (!info) return
  navToChannel(props.note._accountId, info.id, info.name ?? undefined)
}
const accountsStore = useAccountsStore()
const myAccount = computed(() =>
  accountsStore.accountMap.get(props.note._accountId),
)
const { resolveEmoji: resolveEmojiRaw, reactionUrl: reactionUrlRaw } =
  useEmojiResolver()
const instanceIconUrl = computed(() => {
  const inst = effectiveNote.value.user.instance
  if (!inst) return null
  return inst.faviconUrl || inst.iconUrl || null
})

const instanceTickerStyle = computed(() => {
  const color = effectiveNote.value.user.instance?.themeColor || '#777'
  return {
    background: `linear-gradient(90deg, ${color}, transparent)`,
  }
})

const renoteMenuPos = ref<{ x: number; y: number } | null>(null)
const renoteMenuShow = computed(() => renoteMenuPos.value !== null)
const { visible: renoteMenuVisible, leaving: renoteMenuLeaving } =
  useVaporTransition(renoteMenuShow, { enterDuration: 200, leaveDuration: 200 })
const renoteMenuTheme = ref<Record<string, string>>({})
const myRenoteId = ref<string | null>(null)
const isRenoted = ref(false)

function openRenoteMenu(e: MouseEvent) {
  if (renoteMenuPos.value) {
    renoteMenuPos.value = null
    return
  }
  const el = e.currentTarget as HTMLElement
  renoteMenuTheme.value = extractColumnThemeVars(el)
  const rect = el.getBoundingClientRect()
  let x = rect.left
  let y = rect.bottom + 4
  const menuWidth = 200
  const menuHeight = 80
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  if (x + menuWidth > vw) x = vw - menuWidth - 8
  if (y + menuHeight > vh) y = Math.max(8, rect.top - menuHeight - 4)
  x = Math.max(8, x)
  y = Math.max(8, y)
  renoteMenuPos.value = { x, y }

  // Check if already renoted
  myRenoteId.value = null
  commands
    .apiGetNoteRenotes(props.note._accountId, effectiveNote.value.id, 30)
    .then((r) => unwrap(r))
    .then((renotes) => {
      const account = accountsStore.accountMap.get(props.note._accountId)
      const mine = renotes.find((r) => r.user.id === account?.userId)
      myRenoteId.value = mine?.id ?? null
      isRenoted.value = !!mine
    })
    .catch((e) => {
      if (import.meta.env.DEV) console.debug('[renote-check] failed:', e)
    })
}

function closeRenoteMenu() {
  renoteMenuPos.value = null
}

async function handleUnrenote() {
  if (!myRenoteId.value) return
  const renoteId = myRenoteId.value
  closeRenoteMenu()
  effectiveNote.value.renoteCount = Math.max(
    0,
    (effectiveNote.value.renoteCount ?? 1) - 1,
  )
  isRenoted.value = false
  myRenoteId.value = null
  try {
    unwrap(await commands.apiDeleteNote(props.note._accountId, renoteId))
  } catch {
    effectiveNote.value.renoteCount = (effectiveNote.value.renoteCount ?? 0) + 1
    isRenoted.value = true
  }
}
const cwExpanded = ref(false)
const longTextExpanded = ref(false)

// ワードミュート soft（#610）: mutedWords にマッチしたら本文を折りたたみ、展開可能にする
const visibility = useNoteVisibility()
const wordMuteRevealed = ref(false)
const softMuteCollapsed = computed(
  () =>
    visibility.isSoftWordMuted(effectiveNote.value) && !wordMuteRevealed.value,
)

const LONG_TEXT_THRESHOLD = 500
const LONG_TEXT_LINES = 8
const isLongText = computed(() => {
  const text = effectiveNote.value.text
  if (!text || effectiveNote.value.cw !== null) return false
  if (text.length > LONG_TEXT_THRESHOLD) return true
  const lines = text.split('\n').length
  return lines > LONG_TEXT_LINES
})

const isOwnNote = computed(() => {
  const account = accountsStore.accountMap.get(props.note._accountId)
  return account?.userId === effectiveNote.value.user.id
})

// リノート可否（Misskey WebUI と同じ判定）
// public/home は誰でも可、followers は自分のノートのみ、specified は不可
const canRenote = computed(() => {
  const v = effectiveNote.value.visibility
  return (
    v === 'public' || v === 'home' || (v === 'followers' && isOwnNote.value)
  )
})

// User hover popup
const userPopup = useHoverPopup()
const popupTheme = ref<Record<string, string>>({})

function onAvatarMouseEnter(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  popupTheme.value = extractColumnThemeVars(el)
  userPopup.show({ x: rect.right + 8, y: rect.top })
}

function onAvatarMouseLeave() {
  userPopup.hide()
}

function closeUserPopup() {
  userPopup.forceClose()
}

const VISIBILITY_ICONS: Record<NoteVisibility, string> = {
  public:
    'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  followers:
    'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
  specified:
    'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z',
}

const DEFAULT_MODE_ICON = 'M12 2a10 10 0 100 20 10 10 0 000-20z'

const activeModeFlags = computed(() => {
  const flags = effectiveNote.value.modeFlags
  if (!flags) return []
  return Object.entries(flags)
    .filter(([, v]) => v)
    .map(([key]) => {
      const match = key.match(/^isNoteIn(.+)Mode$/)
      const label = match?.[1] ?? key
      return {
        key,
        label,
        icon: CUSTOM_TL_ICONS[label.toLowerCase()] ?? DEFAULT_MODE_ICON,
      }
    })
})

function navigateToDetail() {
  if (props.disableArticleClick) return
  if (!props.detailed) {
    navToNote(props.note._accountId, props.note.id)
  }
}

function navigateToUser(userId: string, e: Event) {
  e.stopPropagation()
  navToUser(props.note._accountId, userId)
}

const reactionsData = computed(() => {
  const n = effectiveNote.value
  const reactions = n.reactions
  const keys = Object.keys(reactions)
  if (keys.length === 0)
    return {
      sorted: [] as { reaction: string; count: number }[],
      urls: {} as Record<string, string | null>,
    }
  keys.sort()
  const sorted: { reaction: string; count: number }[] = new Array(keys.length)
  const urls: Record<string, string | null> = {}
  for (let i = 0; i < keys.length; i++) {
    const reaction = keys[i] as string
    sorted[i] = { reaction, count: reactions[reaction] as number }
    urls[reaction] = reactionUrlRaw(
      reaction,
      n.emojis,
      n.reactionEmojis,
      n._serverHost,
    )
  }
  return { sorted, urls }
})

const sortedReactions = computed(() => reactionsData.value.sorted)
const reactionUrls = computed(() => reactionsData.value.urls)

const reactionsWithId = computed(() =>
  sortedReactions.value.map((r) => ({ ...r, id: r.reaction })),
)
const {
  rendered: renderedReactions,
  enteringIds: reactionEnteringIds,
  leavingIds: reactionLeavingIds,
} = useVaporTransitionGroup(reactionsWithId, {
  enterDuration: 200,
  leaveDuration: 200,
})

// Spawn floating effect when reaction count increases (Misskey-compatible)
let prevReactionCounts = new Map<string, number>(
  Object.entries(effectiveNote.value.reactions),
)
watch(
  () => effectiveNote.value.reactions,
  (reactions) => {
    for (const [reaction, count] of Object.entries(reactions)) {
      const prev = prevReactionCounts.get(reaction) ?? 0
      if (count > prev) {
        const btn = reactionsAreaRef.value?.querySelector<HTMLElement>(
          `[data-reaction="${CSS.escape(reaction)}"]`,
        )
        if (btn) spawnReactionEffect(btn)
      }
    }
    prevReactionCounts = new Map(Object.entries(reactions))
  },
  { deep: true },
)

async function handleMentionClick(username: string, host: string | null) {
  try {
    const user = unwrap(
      await commands.apiLookupUser(
        props.note._accountId,
        username,
        host ?? null,
      ),
    )
    navToUser(props.note._accountId, user.id)
  } catch (e) {
    console.warn('[MkNote] failed to lookup user:', username, host, e)
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
  mentionHovering = true
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  popupTheme.value = extractColumnThemeVars(el)
  try {
    const user = unwrap(
      await commands.apiLookupUser(
        props.note._accountId,
        username,
        host ?? null,
      ),
    )
    if (!mentionHovering) return
    mentionUserId.value = user.id
    mentionPopup.show({ x: rect.right + 8, y: rect.top })
  } catch {
    // lookup failed
  }
}

function onMentionLeave() {
  mentionHovering = false
  mentionPopup.hide()
}

function closeMentionPopup() {
  mentionPopup.forceClose()
}

const renotePortalRef = useTemplateRef<HTMLElement>('renotePortalRef')
usePortal(renotePortalRef)

const userPopupPortalRef = useTemplateRef<HTMLElement>('userPopupPortalRef')
usePortal(userPopupPortalRef)

const mentionPopupPortalRef = useTemplateRef<HTMLElement>(
  'mentionPopupPortalRef',
)
usePortal(mentionPopupPortalRef)

function handleReactionClick(e: MouseEvent, reaction: string) {
  if (longPressed.value) return
  if (!canInteract.value) {
    showLoginPrompt()
    return
  }
  const btn = e.currentTarget as HTMLElement
  const isRemoving = effectiveNote.value.myReaction === reaction
  if (!isRemoving) {
    const rect = btn.getBoundingClientRect()
    spawnRipple(rect.left + rect.width / 2, rect.top + rect.height / 2)
    spawnReactionEffect(btn)
  }
  emit('react', reaction, effectiveNote.value)
}

function handlePickerReaction(reaction: string) {
  emit('react', reaction, effectiveNote.value)
  // Wait for optimistic update (RAF) + Vue render to complete,
  // then spawn floating effect on the newly created button.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const btn = reactionsAreaRef.value?.querySelector<HTMLElement>(
        `[data-reaction="${CSS.escape(reaction)}"]`,
      )
      if (btn) spawnReactionEffect(btn)
    })
  })
}
</script>

<template>
  <div
    class="note-root"
    :class="[
      $style.noteRoot,
      {
        [$style.detailed]: detailed,
        [$style.focused]: focused,
        [$style.hasChannel]: showChannelInfo,
        [$style.spotlighted]: isSpotlighted,
      },
    ]"
    :style="channelInfo && showChannelInfo ? { '--nd-channel-color': channelInfo.color } : undefined"
    tabindex="0"
    @mousedown="clearSpotlight"
    @contextmenu.prevent.stop="moreMenuRef?.open($event)"
  >
    <!-- Pinned indicator -->
    <div v-if="pinnedNoteIds?.includes(note.id)" :class="$style.pinnedInfo">
      <i class="ti ti-pin" :class="$style.pinnedIcon" />
      <span :class="$style.pinnedLabel">ピン留めされたノート</span>
    </div>

    <!-- Renote info bar -->
    <div v-if="isPureRenote" :class="$style.renoteInfo">
      <i class="ti ti-repeat" :class="$style.renoteIcon" />
      <img
        v-if="note.user.avatarUrl"
        :key="note.user.avatarUrl"
        :src="proxyThumbUrl(note.user.avatarUrl, 56)"
        :class="$style.renoteAvatar"
        width="28"
        height="28"
        decoding="async"
      />
      <span :class="$style.renoteUser">
        <MkMfm
          v-if="note.user.name"
          :text="note.user.name"
          :emojis="{ ...note.emojis, ...note.user.emojis }"
          :server-host="note._serverHost"
          plain
        />
        <template v-else>{{ note.user.username }}</template>
      </span>
      <span :class="$style.renoteLabel">リノート</span>
      <span :class="$style.renoteTime">{{ formatTime(note.createdAt) }}</span>
    </div>

    <!-- Reply-to preview (Misskey style) -->
    <div
      v-if="effectiveNote.reply && !embedded"
      :class="$style.replyTo"
      @click.stop="navToNote(note._accountId, effectiveNote.reply!.id)"
    >
      <img
        v-if="effectiveNote.reply!.user.avatarUrl"
        :src="proxyUrl(effectiveNote.reply!.user.avatarUrl)"
        :class="$style.replyToAvatar"
        width="20"
        height="20"
        decoding="async"
      />
      <span :class="$style.replyToName">
        <MkMfm
          v-if="effectiveNote.reply!.user.name"
          :text="effectiveNote.reply!.user.name"
          :emojis="{ ...effectiveNote.reply!.emojis, ...effectiveNote.reply!.user.emojis }"
          :server-host="effectiveNote._serverHost"
          plain
        />
        <template v-else>{{ effectiveNote.reply!.user.username }}</template>
      </span>
      <span :class="$style.replyToText">
        <MkMfm
          :text="effectiveNote.reply!.cw ?? effectiveNote.reply!.text?.slice(0, 100) ?? ''"
          :emojis="{ ...effectiveNote.reply!.emojis, ...effectiveNote.reply!.reactionEmojis }"
          :server-host="effectiveNote._serverHost"
        />
      </span>
    </div>

    <article :class="$style.article" @click="navigateToDetail">
      <MkAvatar
        :avatar-url="effectiveNote.user.avatarUrl"
        :decorations="effectiveNote.user.avatarDecorations"
        :size="58"
        :alt="effectiveNote.user.username ?? undefined"
        :is-cat="effectiveNote.user.isCat"
        :class="$style.avatar"
        @click="navigateToUser(effectiveNote.user.id, $event)"
        @mouseenter="onAvatarMouseEnter"
        @mouseleave="onAvatarMouseLeave"
      />

      <div :class="$style.main">
        <!-- Header -->
        <header :class="$style.header">
          <i v-if="effectiveNote.replyId" class="ti ti-arrow-back-up" :class="$style.replyIcon" />
          <span :class="$style.name">
            <MkMfm
              v-if="effectiveNote.user.name"
              :text="effectiveNote.user.name"
              :emojis="allEmojis"
              :server-host="effectiveNote._serverHost"
              plain
              @mention-click="handleMentionClick"
              @mention-hover="onMentionHover"
              @mention-leave="onMentionLeave"
            />
            <template v-else>{{ effectiveNote.user.username }}</template>
          </span>
          <span :class="$style.username">@{{ effectiveNote.user.username }}{{ effectiveNote.user.host ? `@${effectiveNote.user.host}` : '' }}</span>
          <span v-if="effectiveNote.user.isBot" :class="$style.isBot">Bot</span>
          <span :class="$style.info">
            <span :class="$style.time">{{ formatTime(effectiveNote.createdAt) }}</span>
            <span
              v-if="effectiveNote.updatedAt"
              :class="$style.edited"
              :title="formatTime(effectiveNote.updatedAt)"
            >(edited)</span>
            <svg
              v-for="mode in activeModeFlags"
              :key="mode.key"
              :class="$style.visibilityIcon"
              viewBox="0 0 24 24"
              width="14"
              height="14"
              :title="mode.label + 'モード'"
            >
              <path :d="mode.icon" fill="currentColor" />
            </svg>
            <i
              v-if="effectiveNote.localOnly"
              class="ti ti-rocket-off"
              :class="$style.visibilityIcon"
              title="ローカルのみ"
            />
            <svg
              v-if="effectiveNote.visibility !== 'public'"
              :class="$style.visibilityIcon"
              viewBox="0 0 24 24"
              width="14"
              height="14"
            >
              <path :d="VISIBILITY_ICONS[effectiveNote.visibility] || VISIBILITY_ICONS.public" fill="currentColor" />
            </svg>
          </span>
        </header>

        <!-- Server badge (remote users) -->
        <div
          v-if="effectiveNote.user.instance"
          :class="$style.instanceTicker"
          :style="instanceTickerStyle"
        >
          <img
            v-if="instanceIconUrl"
            :src="proxyThumbUrl(instanceIconUrl, 28)"
            :class="$style.instanceIcon"
            width="14"
            height="14"
            loading="lazy"
            decoding="async"
          />
          <span :class="$style.instanceName">{{ effectiveNote.user.instance.name || effectiveNote.user.host }}</span>
        </div>

        <!-- Word mute (soft, #610) -->
        <div v-if="softMuteCollapsed" :class="$style.cw">
          <p :class="$style.cwText">{{ effectiveNote.user.name || effectiveNote.user.username }}が何かを言いました</p>
          <button :class="$style.cwToggle" class="_button" @click.stop="wordMuteRevealed = true">
            もっと見る
          </button>
        </div>

        <!-- CW -->
        <div v-if="effectiveNote.cw !== null && !softMuteCollapsed" :class="$style.cw">
          <p :class="$style.cwText">
            <MkMfm
              v-if="effectiveNote.cw"
              :text="effectiveNote.cw"
              :emojis="effectiveNote.emojis"
              :server-host="effectiveNote._serverHost"
              :my-username="myAccount?.username"
              :my-host="myAccount?.host"
              @mention-click="handleMentionClick"
              @mention-hover="onMentionHover"
              @mention-leave="onMentionLeave"
            />
          </p>
          <button :class="$style.cwToggle" class="_button" @click.stop="cwExpanded = !cwExpanded">
            {{ cwExpanded ? '隠す' : 'もっと見る' }}
            <span v-if="!cwExpanded && effectiveNote.text" :class="$style.cwChars">({{ effectiveNote.text.length }}文字)</span>
          </button>
        </div>

        <!-- Body -->
        <div v-show="(effectiveNote.cw === null || cwExpanded) && !softMuteCollapsed" :class="$style.body">
          <div v-if="effectiveNote.text" :class="[$style.textContainer, { [$style.collapsed]: isLongText && !longTextExpanded }]">
            <p :class="$style.text">
              <MkMfm
                :text="effectiveNote.text"
                :emojis="effectiveNote.emojis"
                :reaction-emojis="effectiveNote.reactionEmojis"
                :server-host="effectiveNote._serverHost"
                :my-username="myAccount?.username"
                :my-host="myAccount?.host"
                @mention-click="handleMentionClick"
                @mention-hover="onMentionHover"
                @mention-leave="onMentionLeave"
              />
            </p>
            <div v-if="isLongText && !longTextExpanded" :class="$style.longTextFade" />
          </div>
          <button v-if="isLongText" :class="$style.cwToggle" class="_button" @click.stop="longTextExpanded = !longTextExpanded">
            {{ longTextExpanded ? '隠す' : 'もっと見る' }}
            <span v-if="!longTextExpanded && effectiveNote.text" :class="$style.cwChars">({{ effectiveNote.text.length }}文字)</span>
          </button>

          <MkMediaGrid
            v-if="effectiveNote.files.length > 0"
            :files="effectiveNote.files"
            :eager="props.nearViewport"
          />

          <MkPoll
            v-if="effectiveNote.poll"
            :poll="effectiveNote.poll"
            @vote="(choice) => emit('vote', choice, effectiveNote)"
          />

          <!-- OGP URL previews aggregated at note bottom (Misskey parity) -->
          <div v-if="extractedUrls.length > 0" :class="$style.urlPreviewsContainer">
            <MkUrlPreview v-for="url in extractedUrls" :key="url" :url="url" />
          </div>

          <!-- Quote renote (when note has text + renote) -->
          <div v-if="note.renote && note.text !== null" :class="$style.quote" @click.stop>
            <MkNote v-if="!embedded" :note="note.renote" embedded />
            <a
              v-else
              :class="$style.quoteLink"
              @click.prevent="navToNote(note._accountId, note.renote!.id)"
            >
              RN: ...
            </a>
          </div>
        </div>

        <!-- Reactions -->
        <div v-if="sortedReactions.length > 0 && !embedded && !softMuteCollapsed" ref="reactionsAreaRef" :class="$style.reactionsArea">
          <div
            v-if="reactionsVisible"
            :class="$style.reactions"
          >
            <button
              v-for="r in renderedReactions"
              :key="r.reaction"
              v-memo="[r.reaction, r.count, effectiveNote.myReaction === r.reaction, reactionUrls[r.reaction], reactionEnteringIds.has(r.id), reactionLeavingIds.has(r.id)]"
              :class="[
                $style.reaction,
                { [$style.reacted]: effectiveNote.myReaction === r.reaction },
                reactionEnteringIds.has(r.id) && $style.reactionEnter,
                reactionLeavingIds.has(r.id) && $style.reactionLeave,
              ]"
              :data-reaction="r.reaction"
              :disabled="isGuest"
              @click.stop="handleReactionClick($event, r.reaction)"
              @pointerdown="lpHandlers.onPointerdown"
              @pointermove="lpHandlers.onPointermove"
              @pointerup="lpHandlers.onPointerup"
              @pointercancel="lpHandlers.onPointercancel"
              @mouseenter="reactionUsersRef?.show($event, r.reaction, reactionUrls[r.reaction] ?? null, effectiveNote.reactions[r.reaction] ?? 0)"
              @mouseleave="reactionUsersRef?.hide()"
            >
              <img v-if="reactionUrls[r.reaction]" :src="proxyUrl(reactionUrls[r.reaction]!)" :alt="r.reaction" :class="$style.customEmoji" decoding="async" loading="lazy" @error="(e: Event) => { const img = e.target as HTMLImageElement; if (!img.src.endsWith('/emoji-unknown.svg')) img.src = '/emoji-unknown.svg' }" />
              <img v-else-if="r.reaction.startsWith(':')" src="/emoji-unknown.svg" :alt="r.reaction" :title="r.reaction" :class="$style.customEmoji" />
              <MkEmoji v-else :emoji="r.reaction" :class="$style.reactionEmoji" />
              <span :class="$style.count">{{ r.count }}</span>
            </button>
          </div>
        </div>

        <!-- Channel badge -->
        <button
          v-if="showChannelInfo && channelInfo"
          :class="$style.channelBadge"
          type="button"
          :title="channelInfo.name ?? channelInfo.id"
          @click.stop="openChannelColumn"
        >
          <i class="ti ti-device-tv" :class="$style.channelBadgeIcon" />
          <span :class="$style.channelBadgeName">
            {{ channelInfo.name ?? 'チャンネル' }}
          </span>
        </button>

        <!-- Footer -->
        <footer v-if="!embedded" :class="$style.footer">
          <button :class="[$style.footerButton, $style.replyButton, { [$style.footerDisabled]: isGuest }]" :disabled="isGuest" @click.stop="canInteract ? emit('reply', effectiveNote) : showLoginPrompt()">
            <i class="ti ti-arrow-back-up" />
            <span v-if="effectiveNote.repliesCount > 0" :class="$style.buttonCount">
              {{ effectiveNote.repliesCount }}
            </span>
          </button>
          <button v-if="canRenote" :class="[$style.footerButton, $style.renoteButton, { [$style.renoted]: isRenoted, [$style.footerDisabled]: isGuest }]" :disabled="isGuest" @click.stop="canInteract ? openRenoteMenu($event) : showLoginPrompt()">
            <i class="ti ti-repeat" />
            <span v-if="effectiveNote.renoteCount > 0" :class="$style.buttonCount">
              {{ effectiveNote.renoteCount }}
            </span>
          </button>
          <button v-else :class="[$style.footerButton, $style.renoteButton, $style.footerDisabled]" disabled>
            <i class="ti ti-ban" />
          </button>
          <button
            :class="[$style.footerButton, $style.reactionButton, { [$style.footerDisabled]: isGuest }]"
            :disabled="isGuest"
            @click.stop="canInteract ? reactionPickerRef?.open($event) : showLoginPrompt()"
          >
            <i class="ti ti-plus" />
          </button>
          <button
            :class="[$style.footerButton, $style.moreButton]"
            @click.stop="moreMenuRef?.open($event)"
          >
            <i class="ti ti-dots" />
          </button>
        </footer>

      </div>
    </article>
  </div>

  <!-- Renote popup menu -->
    <div
      v-if="renoteMenuVisible"
      ref="renotePortalRef"
      :class="[$style.renoteBackdrop, renoteMenuLeaving ? $style.renotePopupLeave : $style.renotePopupEnter]"
      @click="closeRenoteMenu"
    >
      <div
        :class="[$style.renotePopup, renoteMenuLeaving ? $style.renotePopupContentLeave : $style.renotePopupContentEnter]"
        class="_popup"
        :style="renoteMenuPos ? { ...renoteMenuTheme, top: renoteMenuPos.y + 'px', left: renoteMenuPos.x + 'px' } : renoteMenuTheme"
        @click.stop
      >
        <button v-if="myRenoteId" :class="[$style.renotePopupItem, $style.renotePopupItemActive]" @click="handleUnrenote()">
          <i class="ti ti-trash" />
          リノート解除
        </button>
        <button v-else :class="$style.renotePopupItem" @click="emit('renote', effectiveNote); closeRenoteMenu(); isRenoted = true">
          <i class="ti ti-repeat" />
          リノート
        </button>
        <button :class="$style.renotePopupItem" @click="emit('quote', effectiveNote); closeRenoteMenu()">
          <i class="ti ti-quote" />
          引用
        </button>
      </div>
    </div>

  <div v-if="userPopup.isVisible.value" ref="userPopupPortalRef">
    <MkUserPopup
      :user-id="effectiveNote.user.id"
      :account-id="note._accountId"
      :x="userPopup.position.value.x"
      :y="userPopup.position.value.y"
      :theme-vars="popupTheme"
      @close="closeUserPopup"
    />
  </div>

  <div v-if="mentionPopup.isVisible.value && mentionUserId" ref="mentionPopupPortalRef">
    <MkUserPopup
      :user-id="mentionUserId"
      :account-id="note._accountId"
      :x="mentionPopup.position.value.x"
      :y="mentionPopup.position.value.y"
      :theme-vars="popupTheme"
      @close="closeMentionPopup"
    />
  </div>

  <NoteReactionUsersPopup
    ref="reactionUsersRef"
    :note-id="effectiveNote.id"
    :account-id="note._accountId"
    :server-host="effectiveNote._serverHost"
    @open-modal="(r: string) => reactionModalRef?.open(r)"
  />

  <NoteReactionUsersModal
    ref="reactionModalRef"
    :note-id="effectiveNote.id"
    :account-id="note._accountId"
    :server-host="effectiveNote._serverHost"
    :reactions="sortedReactions"
    :reaction-urls="reactionUrls"
  />

  <NoteMoreMenu
    ref="moreMenuRef"
    :note="effectiveNote"
    :is-own-note="isOwnNote"
    :is-favorited="effectiveNote.isFavorited ?? false"
    :is-pinned="props.pinnedNoteIds?.includes(effectiveNote.id) ?? false"
    @delete="emit('delete', $event)"
    @edit="emit('edit', $event)"
    @bookmark="emit('bookmark', $event)"
    @pin="emit('pin', $event)"
    @delete-and-edit="emit('deleteAndEdit', $event)"
  />

  <NoteReactionPickerPopup
    ref="reactionPickerRef"
    :server-host="effectiveNote._serverHost"
    :account-id="note._accountId"
    @pick="handlePickerReaction"
  />
</template>

<style lang="scss" module>
.noteRoot {
  position: relative;
  font-size: 1.05em;
  contain: content;
  container-type: inline-size;

  &:not(.detailed) {
    cursor: pointer;

    > .article {
      transition: background var(--nd-duration-slow) ease;
    }

    &:hover > .article {
      background: var(--nd-panelHighlight);
    }
  }

  &.focused {
    box-shadow: inset 3px 0 0 var(--nd-accent);

    > .article {
      background: var(--nd-panelHighlight);
    }
  }

  &.hasChannel {
    box-shadow: inset 4px 0 0 var(--nd-channel-color);
  }

  &.hasChannel.focused {
    box-shadow:
      inset 4px 0 0 var(--nd-channel-color),
      inset 7px 0 0 var(--nd-accent);
  }
}

.channelBadge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  margin-top: 6px;
  padding: 2px 10px 2px 8px;
  background: transparent;
  border: 1px solid var(--nd-divider);
  border-radius: 999px;
  color: var(--nd-fg);
  opacity: 0.75;
  font: inherit;
  font-size: 0.78em;
  line-height: 1.4;
  cursor: pointer;
  transition:
    background var(--nd-duration-base) ease,
    opacity var(--nd-duration-base) ease;

  &:hover {
    background: var(--nd-panelHighlight);
    opacity: 1;
  }
}

.channelBadgeIcon {
  flex-shrink: 0;
  font-size: 0.95em;
}

.channelBadgeName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Pinned indicator */
.pinnedInfo {
  display: flex;
  padding: 12px 32px 0 32px;
  align-items: center;
  gap: 6px;
  font-size: 0.85em;
  color: var(--nd-accent);
}

.pinnedIcon {
  flex-shrink: 0;
  opacity: 0.8;
}

.pinnedLabel {
  opacity: 0.8;
  font-weight: bold;
}

/* Reply-to preview */
.replyTo {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 32px 0 32px;
  cursor: pointer;
  overflow: hidden;
  opacity: 0.7;
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 1;
  }
}

.replyToAvatar {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
}

.replyToName {
  flex-shrink: 0;
  font-size: 0.8em;
  font-weight: bold;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  :deep(.custom-emoji) {
    height: 1em;
    width: auto;
  }
}

.replyToText {
  flex: 1;
  font-size: 0.8em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.7;
}

/* Reply icon in header */
.replyIcon {
  color: var(--nd-accent);
  margin-right: 0.5em;
  flex-shrink: 0;
}

/* Renote info bar */
.renoteInfo {
  display: flex;
  padding: 16px 32px 8px 32px;
  line-height: 28px;
  align-items: center;
  gap: 8px;
  font-size: 0.85em;
  color: var(--nd-renote);
}

.renoteIcon {
  flex-shrink: 0;
  opacity: 0.8;
}

.renoteAvatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
}

.renoteUser {
  font-weight: bold;

  :deep(.custom-emoji) {
    height: 1.2em;
    width: auto;
  }
}

.renoteLabel {
  opacity: 0.7;
}

.renoteTime {
  margin-left: auto;
  opacity: 0.6;
}

/* Main article layout */
.article {
  display: flex;
  padding: 28px 32px;
}

.avatar {
  margin: 0 14px 0 0;
  cursor: pointer;
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 0.8;
  }
}

.main {
  flex: 1;
  min-width: 0;
}

/* Header */
.header {
  display: flex;
  align-items: baseline;
  white-space: nowrap;
  margin-bottom: 4px;
}

.name {
  flex-shrink: 1;
  font-size: 1em;
  font-weight: bold;
  margin: 0 0.5em 0 0;
  text-overflow: ellipsis;
  overflow: hidden;
  color: var(--nd-fgHighlighted);

  :deep(.mfm) {
    white-space: nowrap;
  }

  :deep(.custom-emoji) {
    height: 1.2em;
    width: auto;
  }
}

.username {
  flex-shrink: 9999999;
  margin: 0 0.5em 0 0;
  text-overflow: ellipsis;
  overflow: hidden;
  opacity: 0.7;
}

.isBot {
  flex-shrink: 0;
  align-self: center;
  margin: 0 0.5em 0 0;
  padding: 1px 6px;
  font-size: 80%;
  border: solid 0.5px var(--nd-divider);
  border-radius: 3px;
}

/* Server badge (instance ticker) */
.instanceTicker {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 2px;
  padding: 1px 8px;
  border-radius: 3px;
  font-size: 0.75em;
  line-height: 1.4;
  overflow: hidden;
}

.instanceIcon {
  flex-shrink: 0;
  border-radius: 2px;
  object-fit: contain;
  user-select: none;
  -webkit-user-select: none;
}

.instanceName {
  color: #fff;
  font-weight: bold;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  max-width: 200px;
  text-shadow:
    0 0 2px rgba(0, 0, 0, 0.8),
    0 0 4px rgba(0, 0, 0, 0.5);
}

.info {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-left: auto;
  font-size: 0.9em;
}

.edited {
  opacity: 0.5;
  font-size: 0.85em;
}

.time {
  opacity: 0.7;
}

.visibilityIcon {
  opacity: 0.5;
  font-size: 14px;
}

/* CW */
.cw {
  margin-bottom: 4px;
}

.cwText {
  font-weight: bold;
  margin: 0;
}

.cwToggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  margin-top: 4px;
  padding: 4px 12px;
  min-height: 36px;
  border: none;
  border-radius: var(--nd-radius-full);
  background: var(--nd-accentedBg);
  color: var(--nd-accent);
  font-size: 0.8em;
  font-weight: normal;
  cursor: pointer;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.cwChars {
  opacity: 0.7;
  font-weight: normal;
}

/* Body */
.body {
  overflow-wrap: break-word;
}

.textContainer {
  position: relative;

  &.collapsed {
    max-height: 9em;
    overflow: hidden;
  }
}

.longTextFade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 64px;
  background: linear-gradient(to bottom, transparent, var(--nd-panel));
  pointer-events: none;
}

.text {
  margin: 0;
}

/* OGP URL previews aggregated at note bottom */
.urlPreviewsContainer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

/* Quote renote */
.quote {
  padding: 8px 0;

  > :global(.note-root) {
    padding: 16px;
    border: dashed 1px var(--nd-renote);
    border-radius: var(--nd-radius-md);
  }
}

.quoteLink {
  display: block;
  padding: 4px 8px;
  color: var(--fg-light);
  font-size: 0.9em;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

/* Reactions */
.reactions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
}

.reaction {
  display: inline-flex;
  height: 42px;
  padding: 0 6px;
  font-size: 1.5em;
  border-radius: var(--nd-radius-sm);
  align-items: center;
  justify-content: center;
  background: var(--nd-buttonBg);
  border: none;
  cursor: pointer;
  color: var(--nd-fg);
  transition: background var(--nd-duration-fast);

  &:hover {
    background: rgba(0, 0, 0, 0.1);
  }

  &:active {
    animation: reaction-bounce 0.35s var(--nd-ease-spring-bouncy);
  }

  &.reacted,
  &.reacted:hover {
    background: var(--nd-accentedBg);
    color: var(--nd-accent);
    box-shadow: 0 0 0 1px var(--nd-accent) inset;
  }

  /* Misskey: drop-shadow on custom emoji when reacted */
  &.reacted .customEmoji {
    filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.5));
  }

  .customEmoji {
    height: 1.25em;
    min-width: 1.25em;
    max-width: 70px;
    object-fit: contain;
  }

  .count {
    font-size: 0.7em;
    line-height: 42px;
    margin: 0 0 0 4px;
  }

  &.reacted .count {
    color: var(--nd-accent);
    animation: nd-count-bump 0.3s var(--nd-ease-spring-bouncy);
  }
}

@keyframes reaction-bounce {
  0%   { transform: scale(1); }
  15%  { transform: scale(0.95); }
  35%  { transform: scale(1.08); }
  60%  { transform: scale(0.98); }
  100% { transform: scale(1); }
}

.customEmoji {
  height: 2em;
  min-width: 2em;
  width: auto;
  vertical-align: middle;
  object-fit: contain;
}

.reactionEmojiFallback {
  font-size: 0.85em;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 5em;
  white-space: nowrap;
}

.reactionEmoji :deep(.twemoji) {
  height: 1.25em;
}

.count {
  font-size: 0.7em;
  line-height: 42px;
  margin: 0 0 0 4px;
}

/* Footer */
.footer {
  display: flex;
  align-items: center;
  margin-top: 4px;
  margin-bottom: -14px;
}

.footerButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px;
  min-height: 42px;
  min-width: 44px;
  margin-right: 28px;
  border: none;
  border-radius: var(--nd-radius-sm);
  background: none;
  cursor: pointer;
  color: color-mix(in srgb, var(--nd-panel) 30%, var(--nd-fg) 70%);
  font-size: 1em;
  transition: background var(--nd-duration-fast), color var(--nd-duration-fast), transform var(--nd-duration-fast) var(--nd-ease-spring);

  &:active {
    transform: scale(var(--nd-active-scale-sm));
    transition: transform 0.06s ease-out;
  }

  &:hover {
    color: var(--nd-fgHighlighted);
    background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
  }
}

.footerDisabled {
  opacity: 0.3;
  pointer-events: none;
}

.replyButton:hover {
  color: var(--nd-replyHover);
}

.renoteButton:hover,
.renoteButton.renoted {
  color: var(--nd-renote);
}

.reactionButton:hover {
  color: var(--nd-reactionHover);
}

.reactionButton:active {
  animation: reaction-bounce 0.35s var(--nd-ease-spring-bouncy);
}

.moreButton:hover {
  color: var(--nd-fgHighlighted);
}

.buttonCount {
  font-size: 0.85em;
}

/* Renote popup menu */
.renoteBackdrop {
  position: fixed;
  inset: 0;
  z-index: var(--nd-z-popup);
  background: transparent;
}

.renotePopup {
  position: fixed;
  min-width: 180px;
  max-width: 250px;
  padding: 6px 0;
  z-index: calc(var(--nd-z-popup) + 1);
}

.renotePopupItem {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 22px;
  border: none;
  border-radius: 0;
  background: none;
  cursor: pointer;
  color: var(--nd-fg);
  font-size: 0.85em;
  text-align: left;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
    color: var(--nd-renote);
  }

  :global(.ti) {
    opacity: 0.8;
    flex-shrink: 0;
    width: 1em;
    text-align: center;
  }
}

.renotePopupItemActive {
  color: var(--nd-renote);
}

/* Renote popup animations */
.renotePopupEnter { animation: renotePopupBdIn var(--nd-duration-base) var(--nd-ease-decel); }
.renotePopupLeave { animation: renotePopupBdOut var(--nd-duration-fast) ease-in forwards; }
@keyframes renotePopupBdIn { from { opacity: 0; } }
@keyframes renotePopupBdOut { to { opacity: 0; } }

.renotePopupContentEnter { animation: renotePopupIn 0.2s var(--nd-ease-spring); }
.renotePopupContentLeave { animation: renotePopupOut var(--nd-duration-fast) var(--nd-ease-decel) forwards; }
@keyframes renotePopupIn { from { opacity: 0; transform: scale(0.85) translateY(4px); } }
@keyframes renotePopupOut { to { opacity: 0; transform: scale(0.92); } }

/* Divider between notes */
.noteRoot + .noteRoot {
  border-top: 0.5px solid var(--nd-divider);
}

/* AI Spotlight: note 本体を朱色 glow で囲む (内容を阻害しないよう枠 only) */
.spotlighted {
  &::after {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: inherit;
    pointer-events: none;
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--nd-warn) 70%, transparent),
      0 0 24px 8px color-mix(in srgb, var(--nd-warn) 40%, transparent);
    animation: spotlightNoteAppear 2.4s ease-out 1 forwards;
    z-index: 2;
  }

  @media (prefers-reduced-motion: reduce) {
    &::after {
      animation: none;
      opacity: 1;
    }
  }
}

@keyframes spotlightNoteAppear {
  0%   { opacity: 0; }
  10%  { opacity: 1; }
  85%  { opacity: 1; }
  100% { opacity: 0; }
}

/* Container query responsive breakpoints */
@container (max-width: 580px) {
  .noteRoot { font-size: 0.95em; }
  .article { padding: 24px 26px; }
  .renoteInfo { padding: 12px 26px 6px 26px; }
  .pinnedInfo { padding: 10px 26px 0 26px; }
  .replyTo { padding: 10px 26px 0 26px; }
}

@container (max-width: 500px) {
  .noteRoot { font-size: 0.9em; }
  .article { padding: 20px 22px; }
  .renoteInfo { padding: 8px 22px 4px 22px; }
  .pinnedInfo { padding: 8px 22px 0 22px; }
  .replyTo { padding: 8px 22px 0 22px; }
  .footer { margin-bottom: -8px; }
  .instanceName { max-width: 120px; }
}

@container (max-width: 480px) {
  .article { padding: 14px 16px; }
  .renoteInfo { padding: 8px 16px 4px 16px; }
  .pinnedInfo { padding: 8px 16px 0 16px; }
  .replyTo { padding: 8px 16px 0 16px; }
}

@container (max-width: 450px) {
  .avatar { margin: 0 10px 0 0; }
}

@container (max-width: 400px) {
  .footerButton { margin-right: 18px; }
}

@container (max-width: 350px) {
  .footerButton { margin-right: 12px; }

}

@container (max-width: 300px) {
  .footerButton { margin-right: 8px; }
  .reaction { height: 32px; font-size: 1em; border-radius: 4px; }
  .reaction .count { font-size: 0.9em; line-height: 32px; }
}

.reactionEnter {
  animation: reaction-enter 0.2s cubic-bezier(0, .5, .5, 1) both;
}

.reactionLeave {
  animation: reaction-leave 0.2s cubic-bezier(0, .5, .5, 1) both;
  position: absolute;
}

@keyframes reaction-enter {
  from {
    opacity: 0;
    transform: scale(0.7);
  }
}

@keyframes reaction-leave {
  to {
    opacity: 0;
    transform: scale(0.7);
  }
}

</style>

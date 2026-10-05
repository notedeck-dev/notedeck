<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import type { AvatarDecoration } from '@/adapters/types'
import MkAvatar from '@/components/common/MkAvatar.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import MkUserPopup from '@/components/common/MkUserPopup.vue'
import { USER_POPUP_HOVER, useHoverPopup } from '@/composables/useHoverPopup'
import { useNavigation } from '@/composables/useNavigation'
import { usePortal } from '@/composables/usePortal'
import { i18n } from '@/i18n'
import { useServersStore } from '@/stores/servers'
import { proxyThumbUrl } from '@/utils/mediaProxy'

type UserForListItem = {
  id: string
  username: string
  host: string | null
  name: string | null
  avatarUrl: string | null
  isCat?: boolean
  avatarDecorations?: AvatarDecoration[]
  emojis?: Record<string, string>
}

/** relation バッジ表示 (#752)。UserRelation のサブセット */
type RelationForListItem = {
  isFollowing?: boolean
  isFollowed?: boolean
  isBlocking?: boolean
  isMuted?: boolean
}

const props = withDefaults(
  defineProps<{
    user: UserForListItem
    /** hover popup / navigation に必須。無指定なら両方とも no-op。 */
    accountId?: string
    avatarSize?: number
    /** MkMfm の絵文字解決ホスト。未指定時は絵文字を URL で解決できない。 */
    serverHost?: string | null
    description?: string | null
    descLines?: number
    clickToNavigate?: boolean
    hoverPopup?: boolean
    /** フォロー中/ブロック中/ミュート中/フォローされています のバッジ表示 (#752) */
    relation?: RelationForListItem | null
    /**
     * アバターの右上に出すサーバーアイコンの host (全アカウント面で「どのアカウント
     * 経由の行か」を示す。右上のバッジはサーバーのアイコンだけに使う)
     */
    serverBadgeHost?: string | null
  }>(),
  {
    accountId: undefined,
    avatarSize: 42,
    serverHost: undefined,
    description: null,
    descLines: 2,
    clickToNavigate: true,
    hoverPopup: true,
    relation: null,
    serverBadgeHost: null,
  },
)

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

const { navigateToUser } = useNavigation()
const popup = useHoverPopup(USER_POPUP_HOVER)

const popupPortalRef = useTemplateRef<HTMLElement>('popupPortalRef')
usePortal(popupPortalRef)

const popupEnabled = computed(() => props.hoverPopup && !!props.accountId)

const serversStore = useServersStore()
const badgeSize = computed(() =>
  Math.max(10, Math.round(props.avatarSize * 0.4)),
)
/** サーバー登録済みならそのアイコン、無ければ favicon (AccountAvatar と同じ規則) */
const serverBadgeUrl = computed(() => {
  const host = props.serverBadgeHost
  if (!host) return ''
  const iconUrl = serversStore.servers.get(host)?.iconUrl
  return proxyThumbUrl(
    iconUrl || `https://${host}/favicon.ico`,
    badgeSize.value * 2,
  )
})

const descStyle = computed(() => ({
  '--mk-uli-desc-lines': String(props.descLines),
}))

function handleActivate(event: MouseEvent | KeyboardEvent) {
  emit('click', event as MouseEvent)
  if (event.defaultPrevented) return
  // #actions 内のインタラクティブ要素からの bubble は navigate しない保険
  const target = event.target as HTMLElement | null
  if (target?.closest('[data-mk-uli-action]')) return
  if (props.clickToNavigate && props.accountId) {
    navigateToUser(props.accountId, props.user.id)
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  handleActivate(event)
}

function onMouseEnter(event: MouseEvent) {
  if (!popupEnabled.value) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  popup.show({ x: rect.right + 8, y: rect.top })
}

function onMouseLeave() {
  if (!popupEnabled.value) return
  popup.hide()
}

function closePopup() {
  popup.forceClose()
}
</script>

<template>
  <div
    :class="$style.item"
    role="button"
    tabindex="0"
    @click="handleActivate"
    @keydown="onKeydown"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <span :class="$style.avatarWrap">
      <MkAvatar
        :avatar-url="user.avatarUrl"
        :decorations="user.avatarDecorations"
        :size="avatarSize"
        :is-cat="user.isCat"
        :alt="user.username"
        :class="$style.avatar"
      />
      <img
        v-if="serverBadgeUrl"
        :src="serverBadgeUrl"
        :class="$style.serverBadge"
        :style="{ width: `${badgeSize}px`, height: `${badgeSize}px` }"
        @error="($event.target as HTMLImageElement).src = '/server-icon-error.svg'"
      />
    </span>
    <div :class="$style.body">
      <slot>
        <div :class="$style.nameRow">
          <span :class="$style.name">
            <MkMfm
              v-if="user.name"
              :text="user.name"
              :emojis="user.emojis"
              :server-host="serverHost ?? undefined"
              plain
            />
            <template v-else>{{ user.username }}</template>
          </span>
          <slot name="badges" />
          <span v-if="relation?.isFollowing" :class="$style.relationBadge">{{ i18n.ts._mkUserListItem.following }}</span>
          <span
            v-if="relation?.isBlocking"
            :class="[$style.relationBadge, $style.relationDanger]"
          >{{ i18n.ts._mkUserListItem.blocking }}</span>
          <span v-if="relation?.isMuted" :class="$style.relationBadge">{{ i18n.ts._mkUserListItem.muted }}</span>
          <span :class="$style.acct">@{{ user.username }}<template v-if="user.host">@{{ user.host }}</template></span>
        </div>
        <div v-if="relation?.isFollowed" :class="$style.relationBadgeRow">
          <span :class="$style.relationBadge">{{ i18n.ts._common.followsYou }}</span>
        </div>
        <slot name="meta">
          <div v-if="description" :class="$style.desc" :style="descStyle">
            {{ description }}
          </div>
        </slot>
      </slot>
    </div>
    <slot name="actions" />
  </div>

  <div
    v-if="popupEnabled && popup.isVisible.value && accountId"
    ref="popupPortalRef"
  >
    <MkUserPopup
      :user-id="user.id"
      :account-id="accountId"
      :x="popup.position.value.x"
      :y="popup.position.value.y"
      @close="closePopup"
    />
  </div>
</template>

<style lang="scss" module>
/* self-chain で WebView2 の _button 特異度衝突に備える（将来 _button を併用する
   呼び出し元が出ても崩れないように）。 */
.item.item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  text-align: left;
  border-bottom: 1px solid var(--nd-divider);
  background: none;
  color: inherit;
  cursor: pointer;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  &:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--nd-focus);
  }
}

.avatarWrap {
  position: relative;
  flex-shrink: 0;
  display: inline-block;
}

.avatar {
  flex-shrink: 0;
}

.serverBadge {
  position: absolute;
  top: -2px;
  right: -2px;
  border-radius: 50%;
  object-fit: contain;
  background: var(--nd-panel);
  box-shadow: 0 0 0 2px var(--nd-panel);
  user-select: none;
  -webkit-user-select: none;
}

.body {
  flex: 1;
  min-width: 0;
}

.nameRow {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 6px;
  row-gap: 2px;
  min-width: 0;
}

.name {
  font-size: 0.9em;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
}

.acct {
  font-size: 0.8em;
  opacity: 0.6;
}

.desc {
  margin-top: 4px;
  font-size: 0.8em;
  opacity: 0.7;
  display: -webkit-box;
  -webkit-line-clamp: var(--mk-uli-desc-lines, 2);
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.relationBadgeRow {
  margin-top: 2px;
}

.relationBadge {
  display: inline-block;
  font-size: 0.65em;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  opacity: 0.7;
}

.relationDanger {
  background: color-mix(in srgb, var(--nd-error) 15%, var(--nd-buttonBg));
  color: var(--nd-error);
  opacity: 1;
}
</style>

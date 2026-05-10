<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NoteVisibility } from '@/adapters/types'
import type { StoredMemo } from '@/composables/useMemos'
import { useNavigation } from '@/composables/useNavigation'
import { type Account, getAccountAvatarUrl } from '@/stores/accounts'
import { useEmojisStore } from '@/stores/emojis'
import { useWindowsStore } from '@/stores/windows'
import { formatTime } from '@/utils/formatTime'
import MkAvatar from './MkAvatar.vue'
import MkMfm from './MkMfm.vue'

/**
 * メモアイテム表示用コンポーネント (#493 / #500 後の独立化)。
 *
 * MkNote (Misskey 投稿用) は memo にとって過剰なレイヤを大量に持っている
 * (reply chain / reactions / footer / OGP / channel badge / quote nest 等)。
 * 加えて memo は実際のノートではないので合成 ID で navigateToDetail する
 * と users/show が `INVALID_PARAM` で落ちるなどの破綻を起こす。
 *
 * MemoCard は MkNote の見た目を踏襲した薄い表示用 component。
 * - avatar クリックで persona は skill-edit window、通常は user page
 * - 合成 ID で API を叩こうとしない (= navigate しない)
 * - reply / reaction / quote nest 等は持たない
 *
 * 本文 render は当面 MkMfm (Misskey 構文) のまま。markdown 構文 (`# 見出し`
 * 等) のレンダリングは後続 PR で markdown-it を導入予定。
 */

const props = defineProps<{
  account: Account
  memo: StoredMemo
  /**
   * Cross-account ビューで `@user@host` 表示にしたい場合 true。
   * persona memo (memo.author 埋め込みあり) では無視 (常に `@yui` 表示)。
   */
  showAccountHost?: boolean
}>()

const emojisStore = useEmojisStore()
const windowsStore = useWindowsStore()
const { navigateToUser } = useNavigation()

const author = computed(() => props.memo.data.author ?? null)

const isPersona = computed(() => author.value?.id.startsWith('skill:') ?? false)

const displayName = computed(
  () =>
    author.value?.displayName ??
    props.account.displayName ??
    props.account.username,
)

const avatarUrl = computed(
  () => author.value?.avatarUrl ?? getAccountAvatarUrl(props.account),
)

const handle = computed(() => {
  if (author.value) {
    // persona は host を持たない (= ローカル概念)。`@yui` のみ表示。
    return `@${author.value.id.replace(/^skill:/, '')}`
  }
  if (props.showAccountHost) {
    return `@${props.account.username}@${props.account.host}`
  }
  return `@${props.account.username}`
})

const text = computed(() => props.memo.data.text)

const cw = computed(() => {
  const d = props.memo.data
  return d.showCw && d.cw ? d.cw : null
})

const visibility = computed(() => props.memo.data.visibility as NoteVisibility)
const localOnly = computed(() => props.memo.data.localOnly)

const updatedAtRelative = computed(() => formatTime(props.memo.updatedAt))
const updatedAtAbsolute = computed(() =>
  new Date(props.memo.updatedAt).toLocaleString(),
)

const emojiDict = computed(
  () => emojisStore.cache.get(props.account.host) ?? {},
)

// CW / 長文折り畳み (MkNote と同じ閾値)
const cwExpanded = ref(false)
const longTextExpanded = ref(false)
const LONG_TEXT_THRESHOLD = 500
const LONG_TEXT_LINES = 8
const isLongText = computed(() => {
  const t = text.value
  if (!t || cw.value !== null) return false
  if (t.length > LONG_TEXT_THRESHOLD) return true
  return t.split('\n').length > LONG_TEXT_LINES
})

function onAvatarClick(e: MouseEvent) {
  e.stopPropagation()
  if (isPersona.value && author.value) {
    const skillId = author.value.id.replace(/^skill:/, '')
    windowsStore.open('skill-edit', { skillId })
    return
  }
  // 通常 memo: 保存先 account の user page (= memo の保存空間オーナー)
  navigateToUser(props.account.id, props.account.userId)
}

const VISIBILITY_LABELS: Record<NoteVisibility, string> = {
  public: '公開',
  home: 'ホーム',
  followers: 'フォロワー限定',
  specified: 'ダイレクト',
}

// MkNote と同じ SVG path で表示 (見た目を完全に揃えるため)
const VISIBILITY_ICONS: Record<NoteVisibility, string> = {
  public:
    'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  followers:
    'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
  specified:
    'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z',
}
</script>

<template>
  <article :class="$style.card">
    <!-- persona memo: SVG mask + currentColor でテーマアクセント色化
         (DeckAiColumn の personaIndicator と同じパターン)。
         通常 memo: 普通の MkAvatar (img) 表示。 -->
    <button
      v-if="isPersona && avatarUrl"
      type="button"
      :class="$style.personaAvatar"
      :title="displayName"
      @click.stop="onAvatarClick"
    >
      <span
        :class="$style.personaAvatarInner"
        :style="{ '--icon-url': `url('${avatarUrl}')` }"
        aria-hidden="true"
      />
    </button>
    <MkAvatar
      v-else
      :avatar-url="avatarUrl"
      :size="58"
      :alt="displayName"
      :class="$style.avatar"
      @click.stop="onAvatarClick"
    />

    <div :class="$style.main">
      <header :class="$style.header">
        <span :class="$style.name">
          <MkMfm
            v-if="!isPersona"
            :text="displayName"
            :emojis="emojiDict"
            :server-host="account.host"
            plain
          />
          <template v-else>{{ displayName }}</template>
        </span>
        <span :class="$style.handle">{{ handle }}</span>
        <span :class="$style.info">
          <span :class="$style.time" :title="updatedAtAbsolute">{{ updatedAtRelative }}</span>
          <i
            v-if="localOnly"
            class="ti ti-rocket-off"
            :class="$style.visibilityIcon"
            title="ローカルのみ"
          />
          <svg
            v-if="visibility !== 'public'"
            :class="$style.visibilityIcon"
            viewBox="0 0 24 24"
            width="14"
            height="14"
          >
            <title>{{ VISIBILITY_LABELS[visibility] }}</title>
            <path :d="VISIBILITY_ICONS[visibility]" fill="currentColor" />
          </svg>
        </span>
      </header>

      <!-- CW -->
      <div v-if="cw !== null" :class="$style.cw">
        <p :class="$style.cwText">
          <MkMfm
            :text="cw"
            :emojis="emojiDict"
            :server-host="account.host"
          />
        </p>
        <button
          :class="$style.toggle"
          class="_button"
          @click.stop="cwExpanded = !cwExpanded"
        >
          {{ cwExpanded ? '隠す' : 'もっと見る' }}
          <span v-if="!cwExpanded && text" :class="$style.toggleChars">({{ text.length }}文字)</span>
        </button>
      </div>

      <!-- Body -->
      <div v-show="cw === null || cwExpanded" :class="$style.body">
        <div
          v-if="text"
          :class="[$style.textContainer, { [$style.collapsed]: isLongText && !longTextExpanded }]"
        >
          <p :class="$style.text">
            <MkMfm
              :text="text"
              :emojis="emojiDict"
              :reaction-emojis="emojiDict"
              :server-host="account.host"
              markdown
            />
          </p>
          <div v-if="isLongText && !longTextExpanded" :class="$style.fade" />
        </div>
        <button
          v-if="isLongText"
          :class="$style.toggle"
          class="_button"
          @click.stop="longTextExpanded = !longTextExpanded"
        >
          {{ longTextExpanded ? '隠す' : 'もっと見る' }}
          <span v-if="!longTextExpanded && text" :class="$style.toggleChars">({{ text.length }}文字)</span>
        </button>
      </div>
    </div>
  </article>
</template>

<style lang="scss" module>
// MkNote の article スタイルと 1:1 で揃える (size / padding / margin / 余白等)。
// container query でカラム幅に応じて padding / font-size を縮小するのも MkNote と同じ。
.card {
  display: flex;
  padding: 28px 32px;
  font-size: 1.05em;
  contain: content;
  container-type: inline-size;
}

@container (max-width: 580px) {
  .card { font-size: 0.95em; padding: 24px 26px; }
}
@container (max-width: 500px) {
  .card { font-size: 0.9em; padding: 20px 22px; }
}

.avatar {
  margin: 0 14px 0 0;
  cursor: pointer;
  transition: opacity var(--nd-duration-base);
  flex-shrink: 0;

  &:hover {
    opacity: 0.8;
  }
}

/* persona memo の avatar: SVG mask + currentColor でテーマアクセント色化、
   hover で背景反転 (= DeckAiColumn の personaIndicator と同じパターン)。 */
.personaAvatar {
  width: 58px;
  height: 58px;
  margin: 0 14px 0 0;
  padding: 0;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--nd-accent);
  cursor: pointer;
  transition:
    background var(--nd-duration-base),
    color var(--nd-duration-base);

  &:hover {
    background: var(--nd-accent);
    color: var(--nd-bg);
  }
}

.personaAvatarInner {
  width: 100%;
  height: 100%;
  background-color: currentColor;
  -webkit-mask: var(--icon-url) center / contain no-repeat;
  mask: var(--icon-url) center / contain no-repeat;
}

.main {
  flex: 1;
  min-width: 0;
}

.header {
  display: flex;
  align-items: baseline;
  white-space: nowrap;
  margin-bottom: 4px;
  gap: 0;
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

.handle {
  flex-shrink: 9999999;
  margin: 0 0.5em 0 0;
  text-overflow: ellipsis;
  overflow: hidden;
  opacity: 0.7;
}

.info {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-left: auto;
  font-size: 0.9em;
}

.time {
  opacity: 0.7;
}

.visibilityIcon {
  opacity: 0.5;
  font-size: 14px;
}

/* CW (MkNote と 1:1) */
.cw {
  margin-bottom: 4px;
}

.cwText {
  font-weight: bold;
  margin: 0;
}

/* もっと見る / 隠す ボタン (MkNote.cwToggle と 1:1) */
.toggle {
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

.toggleChars {
  opacity: 0.7;
  font-weight: normal;
}

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

.fade {
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
</style>

<script setup lang="ts">
import { computed } from 'vue'
import MkEmoji from '@/components/common/MkEmoji.vue'
import AiSwitchRow from '@/components/window/ai-settings/AiSwitchRow.vue'
import { useEmojiMute } from '@/composables/useEmojiMute'
import { useAccountsStore } from '@/stores/accounts'
import { useEmojisStore } from '@/stores/emojis'
import { useSettingsStore } from '@/stores/settings'
import { proxyUrl } from '@/utils/mediaProxy'

/**
 * アピアランス設定内のリアクション表示制御セクション。
 * - 絵文字の種類ミュート (#612): 一覧・解除
 * - ミュートユーザーのリアクション抹消 (#575): トグル
 */
const { mutedEmojis, getMutedEmojiUrl, toggleEmojiMuteWithConfirm } =
  useEmojiMute()
const emojisStore = useEmojisStore()
const accountsStore = useAccountsStore()
const settingsStore = useSettingsStore()

const hideMutedUserReactions = computed(
  () => settingsStore.get('mute.hideMutedUserReactions') === true,
)
function toggleHideMutedUserReactions() {
  settingsStore.set(
    'mute.hideMutedUserReactions',
    !hideMutedUserReactions.value,
  )
}

function isCustomKey(key: string): boolean {
  return key.startsWith(':')
}

/**
 * 一覧では実体を見せる (本家の ignoreMuted 相当)。ミュート時にスナップ
 * ショットした URL を最優先し、無ければ各アカウントの絵文字キャッシュから
 * 解決を試みる。どちらも無い場合のみ unknown 表示に落ちる。
 */
function resolveCustomUrl(key: string): string | null {
  const snapshot = getMutedEmojiUrl(key)
  if (snapshot) return snapshot
  const shortcode = key.slice(1, -1)
  for (const account of accountsStore.accounts) {
    const url = emojisStore.resolve(account.host, shortcode)
    if (url) return url
  }
  return null
}
</script>

<template>
  <div :class="$style.root">
    <AiSwitchRow
      label="ミュート・凍結ユーザーのリアクションを隠す"
      sub-label="リアクション集計から抹消する。リアクションが非常に多いノートは対象外"
      icon="ti-eye-off"
      :on="hideMutedUserReactions"
      @toggle="toggleHideMutedUserReactions"
    />

    <details :class="$style.mutedEmojis">
      <summary :class="$style.mutedEmojisLabel">
        <i class="ti ti-chevron-right" :class="$style.chevron" />
        ミュート中の絵文字
        <span :class="$style.countBadge">{{ mutedEmojis.length }}</span>
      </summary>
      <p v-if="mutedEmojis.length === 0" :class="$style.empty">
        なし — リアクションや絵文字カラムの右クリックから追加できます
      </p>
      <div v-else :class="$style.list">
        <button
          v-for="key in mutedEmojis"
          :key="key"
          class="_button"
          :class="$style.item"
          :title="`${key} — クリックで解除`"
          @click="toggleEmojiMuteWithConfirm(key)"
        >
          <img
            v-if="isCustomKey(key) && resolveCustomUrl(key)"
            :src="proxyUrl(resolveCustomUrl(key)!)"
            :alt="key"
            :class="$style.itemEmoji"
            decoding="async"
            loading="lazy"
          />
          <img
            v-else-if="isCustomKey(key)"
            src="/emoji-unknown.svg"
            :alt="key"
            :class="$style.itemEmoji"
          />
          <MkEmoji v-else :emoji="key" ignore-muted :class="$style.itemEmoji" />
          <span :class="$style.itemKey">{{ key }}</span>
          <i class="ti ti-x" :class="$style.itemRemove" />
        </button>
      </div>
    </details>
  </div>
</template>

<style lang="scss" module>
.root {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mutedEmojis {
  display: flex;
  flex-direction: column;
  gap: 4px;

  &[open] .chevron {
    transform: rotate(90deg);
  }
}

.mutedEmojisLabel {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8em;
  font-weight: bold;
  opacity: 0.7;
  padding: 4px 2px 0;
  cursor: pointer;
  user-select: none;
  list-style: none;

  &::-webkit-details-marker {
    display: none;
  }
}

.chevron {
  transition: transform var(--nd-duration-base);
}

.countBadge {
  font-weight: normal;
  opacity: 0.7;
}

.empty {
  margin: 0;
  padding: 2px;
  font-size: 0.8em;
  opacity: 0.5;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  text-align: left;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.itemEmoji {
  width: 22px;
  height: 22px;
  object-fit: contain;
  flex-shrink: 0;
}

.itemKey {
  flex: 1;
  min-width: 0;
  font-size: 0.8em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.itemRemove {
  flex-shrink: 0;
  opacity: 0.5;
}
</style>

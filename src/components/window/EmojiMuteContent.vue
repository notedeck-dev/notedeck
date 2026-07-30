<script setup lang="ts">
import MkEmoji from '@/components/common/MkEmoji.vue'
import { useEmojiMute } from '@/composables/useEmojiMute'
import { useAccountsStore } from '@/stores/accounts'
import { useEmojisStore } from '@/stores/emojis'
import { proxyUrl } from '@/utils/imageProxy'

const { mutedEmojis, getMutedEmojiUrl, toggleEmojiMuteWithConfirm } =
  useEmojiMute()
const emojisStore = useEmojisStore()
const accountsStore = useAccountsStore()

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
  <!--
    リアクション表示制御の設定面。現状は絵文字の種類ミュート (#612) のみ。
    将来 #575 (ミュートユーザーのリアクションを集計ごと抹消) のトグルを
    別セクションとしてここに追加する予定。
  -->
  <div :class="$style.root">
    <section>
      <h3 :class="$style.sectionTitle">ミュートする絵文字</h3>
      <p :class="$style.hint">
        ミュートした絵文字は本文とリアクションでプレースホルダー表示になり、ピッカーと補完の候補からも外れます。リアクションや絵文字カラムの右クリックメニューから追加できます。
      </p>

      <div v-if="mutedEmojis.length === 0" :class="$style.empty">
        ミュート中の絵文字はありません
      </div>

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
    </section>
  </div>
</template>

<style lang="scss" module>
.root {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px;
}

.root section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sectionTitle {
  margin: 0;
  font-size: 0.9em;
  font-weight: bold;
}

.hint {
  margin: 0;
  font-size: 0.85em;
  opacity: 0.7;
  line-height: 1.6;
}

.empty {
  padding: 24px 0;
  text-align: center;
  font-size: 0.9em;
  opacity: 0.5;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  text-align: left;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.itemEmoji {
  width: 24px;
  height: 24px;
  object-fit: contain;
  flex-shrink: 0;
}

.itemKey {
  flex: 1;
  min-width: 0;
  font-size: 0.85em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.itemRemove {
  flex-shrink: 0;
  opacity: 0.5;
}
</style>

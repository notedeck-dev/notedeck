<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import type { ServerEmoji } from '@/adapters/types'
import { emojiCharByCategory, unicodeEmojiCategories } from '@/data/emojilist'
import { useEmojisStore } from '@/stores/emojis'
import { usePinnedReactionsStore } from '@/stores/pinnedReactions'
import { useRecentEmojisStore } from '@/stores/recentEmojis'
import { useIsCompactLayout } from '@/stores/ui'
import { hapticLight } from '@/utils/haptics'
import { proxyUrl } from '@/utils/imageProxy'
import { isImeComposing } from '@/utils/ime'
import { char2twemojiUrl } from '@/utils/twemoji'
import MkReactionPickerSection from './MkReactionPickerSection.vue'

const props = defineProps<{
  serverHost: string
  accountId: string
  fullWidth?: boolean
}>()

const emit = defineEmits<{
  pick: [reaction: string]
}>()

const isCompact = useIsCompactLayout()
const emojisStore = useEmojisStore()
const pinnedReactionsStore = usePinnedReactionsStore()
const recentEmojisStore = useRecentEmojisStore()

const pinnedEmojis = computed(() => pinnedReactionsStore.get(props.accountId))
const searchQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

// Custom emojis organized by category
const customEmojis = computed(() => emojisStore.getEmojiList(props.serverHost))

const customEmojisByCategory = computed(() => {
  const groups = new Map<string, ServerEmoji[]>()
  for (const emoji of customEmojis.value) {
    const cat = emoji.category || 'その他'
    const list = groups.get(cat)
    if (list) list.push(emoji)
    else groups.set(cat, [emoji])
  }
  return groups
})

// Search results
const searchResults = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return null

  const customResults: ServerEmoji[] = []
  const unicodeResults: string[] = []

  // Custom emoji search (multi-stage: exact → startsWith → includes)
  const seen = new Set<string>()
  const allCustom = customEmojis.value

  // Exact match
  for (const e of allCustom) {
    if (e.name === q) {
      seen.add(e.name)
      customResults.push(e)
    }
  }
  // startsWith
  if (customResults.length < 100) {
    for (const e of allCustom) {
      if (seen.has(e.name)) continue
      if (e.name.startsWith(q) || e.aliases.some((a) => a.startsWith(q))) {
        seen.add(e.name)
        customResults.push(e)
        if (customResults.length >= 100) break
      }
    }
  }
  // includes
  if (customResults.length < 100) {
    for (const e of allCustom) {
      if (seen.has(e.name)) continue
      if (e.name.includes(q) || e.aliases.some((a) => a.includes(q))) {
        seen.add(e.name)
        customResults.push(e)
        if (customResults.length >= 100) break
      }
    }
  }

  // Unicode emoji: 名前データがないため文字一致のみ
  for (const [, emojis] of emojiCharByCategory) {
    for (const char of emojis) {
      if (char.includes(q)) {
        unicodeResults.push(char)
        if (unicodeResults.length >= 100) break
      }
    }
    if (unicodeResults.length >= 100) break
  }

  return { custom: customResults, unicode: unicodeResults }
})

// Recently used emojis (per server)
const recentEmojis = computed(() => recentEmojisStore.get(props.serverHost))

function resolveEmojiUrl(reaction: string): string | null {
  if (reaction.startsWith(':') && reaction.endsWith(':')) {
    const shortcode = reaction.slice(1, -1)
    return emojisStore.resolve(props.serverHost, shortcode)
  }
  return null
}

function isCustomEmoji(reaction: string): boolean {
  return reaction.startsWith(':') && reaction.endsWith(':')
}

function twemojiSrc(char: string): string {
  return proxyUrl(char2twemojiUrl(char)) ?? char2twemojiUrl(char)
}

function pickEmoji(emoji: string) {
  hapticLight()
  recentEmojisStore.add(props.serverHost, emoji, pinnedEmojis.value)
  emit('pick', emoji)
}

function pickCustom(name: string) {
  hapticLight()
  const key = `:${name}:`
  recentEmojisStore.add(props.serverHost, key, pinnedEmojis.value)
  emit('pick', key)
}

function pickPinnedOrRecent(reaction: string) {
  hapticLight()
  recentEmojisStore.add(props.serverHost, reaction, pinnedEmojis.value)
  emit('pick', reaction)
}

const pickerScrollRef = ref<HTMLElement | null>(null)

function getEmojiButtons(): HTMLButtonElement[] {
  if (!pickerScrollRef.value) return []
  return Array.from(
    pickerScrollRef.value.querySelectorAll<HTMLButtonElement>('button'),
  )
}

function onSearchKeydown(e: KeyboardEvent) {
  if (isImeComposing(e)) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const buttons = getEmojiButtons()
    buttons[0]?.focus()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const buttons = getEmojiButtons()
    buttons[0]?.click()
  }
}

function onScrollKeydown(e: KeyboardEvent) {
  const buttons = getEmojiButtons()
  const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (idx < 0) return

  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault()
    const next = buttons[idx + 1]
    if (next) next.focus()
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (idx === 0) {
      searchInput.value?.focus()
    } else {
      buttons[idx - 1]?.focus()
    }
  } else if (e.key === 'Escape') {
    e.preventDefault()
    searchInput.value?.focus()
  }
}

onMounted(() => {
  // モバイルでは自動フォーカスしない（仮想キーボードでピッカーが押し出される）
  if (!isCompact.value) {
    nextTick(() => searchInput.value?.focus())
  }
})
</script>

<template>
  <div :class="[$style.reactionPickerPanel, { [$style.mobile]: isCompact, [$style.fullWidth]: props.fullWidth }]" @click.stop>
    <!-- Search (top when has query, bottom otherwise via CSS order) -->
    <div :class="[$style.pickerSearch, searchQuery.length > 0 && $style.hasQuery]">
      <input
        ref="searchInput"
        v-model="searchQuery"
        :class="$style.pickerSearchInput"
        type="text"
        placeholder="絵文字を検索..."
        @click.stop
        @keydown="onSearchKeydown"
      />
    </div>

    <!-- Scrollable area -->
    <div ref="pickerScrollRef" :class="$style.pickerScroll" @keydown="onScrollKeydown">
      <!-- Search results -->
      <template v-if="searchResults">
        <div v-if="searchResults.custom.length === 0 && searchResults.unicode.length === 0" :class="$style.pickerEmpty">
          絵文字が見つかりません
        </div>
        <template v-else>
          <div v-if="searchResults.custom.length > 0" :class="$style.pickerGrid">
            <button
              v-for="emoji in searchResults.custom"
              :key="emoji.name"
              :class="$style.pickerEmojiBtn"
              :title="`:${emoji.name}:`"
              @click="pickCustom(emoji.name)"
            >
              <img :src="emoji.url" :alt="emoji.name" :class="$style.pickerCustomImg" loading="lazy" />
            </button>
          </div>
          <div v-if="searchResults.unicode.length > 0" :class="$style.pickerGrid">
            <button
              v-for="emoji in searchResults.unicode"
              :key="emoji"
              :class="$style.pickerEmojiBtn"
              @click="pickEmoji(emoji)"
            >
              <img :src="twemojiSrc(emoji)" :alt="emoji" :class="$style.pickerTwemoji" decoding="async" loading="lazy" />
            </button>
          </div>
        </template>
      </template>

      <!-- Normal view (no search) -->
      <template v-else>
        <!-- Pinned reactions -->
        <div v-if="pinnedEmojis.length > 0" :class="$style.pickerPinned">
          <div :class="$style.pickerGrid">
            <button
              v-for="reaction in pinnedEmojis"
              :key="reaction"
              :class="$style.pickerEmojiBtn"
              :title="reaction"
              @click="pickPinnedOrRecent(reaction)"
            >
              <img
                v-if="isCustomEmoji(reaction)"
                :src="resolveEmojiUrl(reaction) ?? ''"
                :alt="reaction"
                :class="$style.pickerCustomImg"
                loading="lazy"
              />
              <img
                v-else
                :src="twemojiSrc(reaction)"
                :alt="reaction"
                :class="$style.pickerTwemoji"
                decoding="async"
                loading="lazy"
              />
            </button>
          </div>
        </div>

        <!-- Recently used -->
        <MkReactionPickerSection
          v-if="recentEmojis.length > 0"
          label="最近使った絵文字"
          :count="recentEmojis.length"
        >
          <div :class="$style.pickerGrid">
            <button
              v-for="reaction in recentEmojis"
              :key="reaction"
              :class="$style.pickerEmojiBtn"
              :title="reaction"
              @click="pickPinnedOrRecent(reaction)"
            >
              <img
                v-if="isCustomEmoji(reaction)"
                :src="resolveEmojiUrl(reaction) ?? ''"
                :alt="reaction"
                :class="$style.pickerCustomImg"
                loading="lazy"
              />
              <img
                v-else
                :src="twemojiSrc(reaction)"
                :alt="reaction"
                :class="$style.pickerTwemoji"
                decoding="async"
                loading="lazy"
              />
            </button>
          </div>
        </MkReactionPickerSection>

        <!-- Custom emojis by category -->
        <template v-if="customEmojisByCategory.size > 0">
          <MkReactionPickerSection
            v-for="[category, emojis] in customEmojisByCategory"
            :key="category"
            :label="category"
            :count="emojis.length"
            :initial-open="false"
          >
            <div :class="$style.pickerGrid">
              <button
                v-for="emoji in emojis"
                :key="emoji.name"
                :class="$style.pickerEmojiBtn"
                :title="`:${emoji.name}:`"
                @click="pickCustom(emoji.name)"
              >
                <img :src="emoji.url" :alt="emoji.name" :class="$style.pickerCustomImg" loading="lazy" />
              </button>
            </div>
          </MkReactionPickerSection>
        </template>

        <!-- Unicode emojis by category -->
        <MkReactionPickerSection
          v-for="category in unicodeEmojiCategories"
          :key="category"
          :label="category"
          :count="emojiCharByCategory.get(category)?.length"
          :initial-open="false"
        >
          <div :class="$style.pickerGrid">
            <button
              v-for="emoji in emojiCharByCategory.get(category)"
              :key="emoji"
              :class="$style.pickerEmojiBtn"
              @click="pickEmoji(emoji)"
            >
              <img :src="twemojiSrc(emoji)" :alt="emoji" :class="$style.pickerTwemoji" decoding="async" loading="lazy" />
            </button>
          </div>
        </MkReactionPickerSection>
      </template>
    </div>
  </div>
</template>

<style lang="scss" module>
.reactionPickerPanel {
  display: flex;
  flex-direction: column;
  width: 320px;
  max-width: calc(100vw - 32px);
  max-height: 360px;
  overflow: hidden;

  &.fullWidth {
    width: 100%;
    max-width: 100%;
    max-height: 100%;
    flex: 1;
    min-height: 0;
  }
}

.pickerSearch {
  padding: 8px;
  flex-shrink: 0;
  order: 1;
  border-top: 1px solid var(--nd-divider);

  &.hasQuery {
    order: -1;
    border-top: none;
    border-bottom: 1px solid var(--nd-divider);
  }
}

.pickerSearchInput {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-panel);
  color: var(--nd-fg);
  font-size: 0.85em;
  outline: none;
  box-sizing: border-box;

  &:focus {
    border-color: var(--nd-accent);
  }
}

.pickerScroll {
  flex: 1;
  /* flex 子の min-height:auto がコンテンツ高で膨らみスクロール不能になるのを防ぐ (#715) */
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  contain: paint;
  scrollbar-width: none;
}

.pickerPinned {
  padding-bottom: 4px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--nd-divider);
}

.pickerGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 44px);
  gap: 2px;
}

.pickerEmojiBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: var(--nd-radius-sm);
  background: none;
  cursor: pointer;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  &:active {
    background: var(--nd-accent);
  }
}

.pickerTwemoji {
  width: 26px;
  height: 26px;
  object-fit: contain;
}

.pickerCustomImg {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.pickerEmpty {
  padding: 2rem;
  text-align: center;
  color: var(--nd-fg);
  opacity: 0.4;
  font-size: 0.85em;
}

.mobile {
  width: 100%;
  max-width: 100%;
  max-height: 50vh;

  .pickerSearchInput {
    padding: 10px 12px;
    font-size: 1em;
  }
}
</style>

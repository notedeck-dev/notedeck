<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import type { ServerEmoji } from '@/adapters/types'
import { useEmojiMute } from '@/composables/useEmojiMute'
import {
  emojiCharByCategory,
  emojilist,
  type UnicodeEmojiCategory,
  unicodeEmojiCategories,
} from '@/data/emojilist'
import { loadUnicodeEmojiIndexes } from '@/data/unicodeEmojiIndexes'
import { i18n } from '@/i18n'
import {
  searchUnicodeEmojis,
  type UnicodeEmojiIndex,
} from '@/services/emojiSearch'
import {
  applySkinTone,
  normalizeSkinTone,
  SKIN_TONES,
  type SkinTone,
} from '@/services/emojiSkinTone'
import { char2twemojiUrl } from '@/services/twemoji'
import { useEmojisStore } from '@/stores/emojis'
import { usePinnedReactionsStore } from '@/stores/pinnedReactions'
import { useRecentEmojisStore } from '@/stores/recentEmojis'
import { useSettingsStore } from '@/stores/settings'
import { useIsCompactLayout } from '@/stores/ui'
import { hapticLight } from '@/utils/haptics'
import { isImeComposing } from '@/utils/ime'
import { proxyEmojiUrl } from '@/utils/mediaProxy'
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
const settingsStore = useSettingsStore()

// ミュート絵文字はピッカー候補から除外する (#612)
const { isEmojiMuted } = useEmojiMute()

const pinnedEmojis = computed(() =>
  pinnedReactionsStore.get(props.accountId).filter((r) => !isEmojiMuted(r)),
)
const searchQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

// Custom emojis organized by category
const customEmojis = computed(() =>
  emojisStore
    .getEmojiList(props.serverHost)
    .filter((e) => !isEmojiMuted(e.name)),
)

// スキントーン (#1193)。選んだトーンは settings.json5 に残し、Unicode 絵文字の
// 一覧と検索結果に付けて出す。ピン留め・最近使ったものは保存された文字のまま
const skinTone = computed(() =>
  normalizeSkinTone(settingsStore.get('emoji.skinTone')),
)
const showSkinTones = ref(false)
const SKIN_TONE_SAMPLE = '\u270B'
const skinToneOptions = computed(() =>
  [null, ...SKIN_TONES].map((tone) => ({
    tone,
    char: applySkinTone(SKIN_TONE_SAMPLE, tone),
    label: skinToneLabel(tone),
  })),
)

function skinToneLabel(tone: SkinTone | null): string {
  switch (tone) {
    case 1:
      return i18n.ts._mkReactionPicker._skinTones.light
    case 2:
      return i18n.ts._mkReactionPicker._skinTones.mediumLight
    case 3:
      return i18n.ts._mkReactionPicker._skinTones.medium
    case 4:
      return i18n.ts._mkReactionPicker._skinTones.mediumDark
    case 5:
      return i18n.ts._mkReactionPicker._skinTones.dark
    default:
      return i18n.ts._mkReactionPicker._skinTones.none
  }
}

function selectSkinTone(tone: SkinTone | null) {
  settingsStore.set('emoji.skinTone', tone)
  showSkinTones.value = false
}

/** トーンを付け、トーン前後どちらかがミュートされていれば外す */
function toUnicodeCandidates(chars: readonly string[]): string[] {
  const out: string[] = []
  for (const c of chars) {
    const toned = applySkinTone(c, skinTone.value)
    if (isEmojiMuted(c) || isEmojiMuted(toned)) continue
    out.push(toned)
  }
  return out
}

const unicodeEmojisByCategory = computed(() => {
  const map = new Map<UnicodeEmojiCategory, string[]>()
  for (const [cat, chars] of emojiCharByCategory) {
    map.set(cat, toUnicodeCandidates(chars))
  }
  return map
})

// Unicode 絵文字のキーワード辞書は表示言語のものを初めて検索したときに読む。
// 読み終わるまでは英名だけで引く
const unicodeIndexes = shallowRef<readonly UnicodeEmojiIndex[]>([])
watch(
  () => searchQuery.value.trim() !== '' && i18n.lang,
  (lang) => {
    if (!lang) return
    loadUnicodeEmojiIndexes(lang).then(
      (indexes) => {
        if (i18n.lang === lang) unicodeIndexes.value = indexes
      },
      (e) => console.warn('[emoji-picker] failed to load emoji keywords:', e),
    )
  },
)

const customEmojisByCategory = computed(() => {
  const groups = new Map<string, ServerEmoji[]>()
  for (const emoji of customEmojis.value) {
    const cat = emoji.category || i18n.ts._mkReactionPicker.uncategorized
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

  const unicodeResults = toUnicodeCandidates(
    searchUnicodeEmojis(q, emojilist, unicodeIndexes.value).map((e) => e.char),
  )

  return { custom: customResults, unicode: unicodeResults }
})

// Recently used emojis (per server)
const recentEmojis = computed(() =>
  recentEmojisStore.get(props.serverHost).filter((r) => !isEmojiMuted(r)),
)

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
  // 同梱アセットのローカルパスなのでプロキシ不要
  return char2twemojiUrl(char)
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

// --- カテゴリジャンプ (#1193) ---
// 最近使った絵文字の下のセクションは閉じて始まる。ジャンプ先は開いてから飛ぶ
const openSections = ref<Record<string, boolean>>({})

function sectionOpen(key: string): boolean {
  return openSections.value[key] ?? false
}

function setSectionOpen(key: string, open: boolean) {
  openSections.value = { ...openSections.value, [key]: open }
}

const UNICODE_CATEGORIES: Record<
  UnicodeEmojiCategory,
  { icon: string; label: () => string }
> = {
  face: {
    icon: 'ti-mood-smile',
    label: () => i18n.ts._mkReactionPicker._categories.face,
  },
  people: {
    icon: 'ti-hand-stop',
    label: () => i18n.ts._mkReactionPicker._categories.people,
  },
  animals_and_nature: {
    icon: 'ti-paw',
    label: () => i18n.ts._mkReactionPicker._categories.animals_and_nature,
  },
  food_and_drink: {
    icon: 'ti-cup',
    label: () => i18n.ts._mkReactionPicker._categories.food_and_drink,
  },
  activity: {
    icon: 'ti-ball-football',
    label: () => i18n.ts._mkReactionPicker._categories.activity,
  },
  travel_and_places: {
    icon: 'ti-plane',
    label: () => i18n.ts._mkReactionPicker._categories.travel_and_places,
  },
  objects: {
    icon: 'ti-bulb',
    label: () => i18n.ts._mkReactionPicker._categories.objects,
  },
  symbols: {
    icon: 'ti-heart',
    label: () => i18n.ts._mkReactionPicker._categories.symbols,
  },
  flags: {
    icon: 'ti-flag',
    label: () => i18n.ts._mkReactionPicker._categories.flags,
  },
}

interface NavItem {
  /** スクロール位置からアクティブを決めるときの所属 (セクションの data-nav) */
  key: string
  icon: string
  label: string
  /** 飛ぶ先のセクション。null は先頭 (ピン留め・最近使った絵文字) */
  section: string | null
}

const navItems = computed<NavItem[]>(() => {
  const items: NavItem[] = []
  if (pinnedEmojis.value.length > 0 || recentEmojis.value.length > 0) {
    items.push({
      key: 'recent',
      icon: 'ti-clock',
      label: i18n.ts._mkReactionPicker.recent,
      section: null,
    })
  }
  const firstCustom = customEmojisByCategory.value.keys().next()
  if (!firstCustom.done) {
    items.push({
      key: 'custom',
      icon: 'ti-icons',
      label: i18n.ts._mkReactionPicker.custom,
      section: `custom:${firstCustom.value}`,
    })
  }
  for (const category of unicodeEmojiCategories) {
    items.push({
      key: category,
      icon: UNICODE_CATEGORIES[category].icon,
      label: UNICODE_CATEGORIES[category].label(),
      section: `unicode:${category}`,
    })
  }
  return items
})

const activeNav = ref<string | null>(null)

/** スクロール位置の上端にかかっているセクションの所属をアクティブにする */
function updateActiveNav() {
  const scroller = pickerScrollRef.value
  if (!scroller) return
  const top = scroller.getBoundingClientRect().top
  let current = navItems.value[0]?.key ?? null
  for (const el of scroller.querySelectorAll<HTMLElement>('[data-nav]')) {
    // 見出しが上端から少し下までに来ていれば、そのセクションに入ったとみなす
    if (el.getBoundingClientRect().top - top > 16) break
    current = el.dataset.nav ?? current
  }
  activeNav.value = current
}

let navFrame = 0
// ジャンプ直後のスクロールは位置から決め直さない。末尾のカテゴリは上端まで
// 届かないため、決め直すと押したのと違うカテゴリが光る
let skipNextScroll = false
function onPickerScroll() {
  if (skipNextScroll) {
    skipNextScroll = false
    return
  }
  if (navFrame) return
  navFrame = requestAnimationFrame(() => {
    navFrame = 0
    updateActiveNav()
  })
}

async function jumpTo(item: NavItem) {
  const scroller = pickerScrollRef.value
  if (!scroller) return
  if (item.section === null) {
    scroller.scrollTop = 0
  } else {
    setSectionOpen(item.section, true)
    await nextTick()
    const el = scroller.querySelector<HTMLElement>(
      `[data-section="${CSS.escape(item.section)}"]`,
    )
    if (!el) return
    const delta =
      el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    if (Math.abs(delta) >= 1) {
      skipNextScroll = true
      scroller.scrollTop += delta
    }
  }
  activeNav.value = item.key
}

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

onUnmounted(() => cancelAnimationFrame(navFrame))

onMounted(() => {
  updateActiveNav()
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
        :placeholder="i18n.ts._mkReactionPicker.searchPlaceholder"
        @click.stop
        @keydown="onSearchKeydown"
      />
    </div>

    <!-- Category jump + skin tone (#1193)。検索中は結果だけを出すので隠す -->
    <div v-if="!searchResults" :class="$style.pickerNav">
      <div v-if="showSkinTones" :class="$style.pickerNavItems" role="radiogroup" :aria-label="i18n.ts._mkReactionPicker.skinTone">
        <button
          v-for="opt in skinToneOptions"
          :key="opt.tone ?? 0"
          class="_button"
          :class="[$style.pickerNavBtn, opt.tone === skinTone && $style.active]"
          role="radio"
          :aria-checked="opt.tone === skinTone"
          :title="opt.label"
          :aria-label="opt.label"
          @click="selectSkinTone(opt.tone)"
        >
          <img :src="twemojiSrc(opt.char)" alt="" :class="$style.pickerNavTwemoji" decoding="async" />
        </button>
      </div>
      <div v-else :class="$style.pickerNavItems" role="toolbar" :aria-label="i18n.ts._mkReactionPicker.categories">
        <button
          v-for="item in navItems"
          :key="item.key"
          class="_button"
          :class="[$style.pickerNavBtn, activeNav === item.key && $style.active]"
          :title="item.label"
          :aria-label="item.label"
          :aria-current="activeNav === item.key || undefined"
          @click="jumpTo(item)"
        >
          <i class="ti" :class="item.icon" />
        </button>
      </div>
      <button
        class="_button"
        :class="[$style.pickerNavBtn, $style.pickerSkinToneBtn, showSkinTones && $style.active]"
        :title="i18n.ts._mkReactionPicker.skinTone"
        :aria-label="i18n.ts._mkReactionPicker.skinTone"
        :aria-expanded="showSkinTones"
        @click="showSkinTones = !showSkinTones"
      >
        <img :src="twemojiSrc(applySkinTone(SKIN_TONE_SAMPLE, skinTone))" alt="" :class="$style.pickerNavTwemoji" decoding="async" />
      </button>
    </div>

    <!-- Scrollable area -->
    <div ref="pickerScrollRef" :class="$style.pickerScroll" @keydown="onScrollKeydown" @scroll.passive="onPickerScroll">
      <!-- Search results -->
      <template v-if="searchResults">
        <div v-if="searchResults.custom.length === 0 && searchResults.unicode.length === 0" :class="$style.pickerEmpty">
          {{ i18n.ts._mkReactionPicker.notFound }}
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
              <img :src="proxyEmojiUrl(emoji.url)" :alt="emoji.name" :class="$style.pickerCustomImg" decoding="async" loading="lazy" />
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
                :src="proxyEmojiUrl(resolveEmojiUrl(reaction)) ?? ''"
                :alt="reaction"
                :class="$style.pickerCustomImg"
                decoding="async"
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
          :label="i18n.ts._mkReactionPicker.recent"
          :count="recentEmojis.length"
          data-nav="recent"
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
                :src="proxyEmojiUrl(resolveEmojiUrl(reaction)) ?? ''"
                :alt="reaction"
                :class="$style.pickerCustomImg"
                decoding="async"
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
            :open="sectionOpen(`custom:${category}`)"
            :data-section="`custom:${category}`"
            data-nav="custom"
            @update:open="setSectionOpen(`custom:${category}`, $event)"
          >
            <div :class="$style.pickerGrid">
              <button
                v-for="emoji in emojis"
                :key="emoji.name"
                :class="$style.pickerEmojiBtn"
                :title="`:${emoji.name}:`"
                @click="pickCustom(emoji.name)"
              >
                <img :src="proxyEmojiUrl(emoji.url)" :alt="emoji.name" :class="$style.pickerCustomImg" decoding="async" loading="lazy" />
              </button>
            </div>
          </MkReactionPickerSection>
        </template>

        <!-- Unicode emojis by category -->
        <MkReactionPickerSection
          v-for="category in unicodeEmojiCategories"
          :key="category"
          :label="UNICODE_CATEGORIES[category].label()"
          :count="unicodeEmojisByCategory.get(category)?.length"
          :open="sectionOpen(`unicode:${category}`)"
          :data-section="`unicode:${category}`"
          :data-nav="category"
          @update:open="setSectionOpen(`unicode:${category}`, $event)"
        >
          <div :class="$style.pickerGrid">
            <button
              v-for="emoji in unicodeEmojisByCategory.get(category)"
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
  font-size: var(--nd-font-md);
  outline: none;
  box-sizing: border-box;

  &:focus {
    border-color: var(--nd-accent);
  }
}

.pickerNav {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  order: 0;
  padding: 4px 8px 0;
  border-bottom: 1px solid var(--nd-divider);
}

.pickerNavItems {
  display: flex;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.pickerNavBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 30px;
  color: var(--nd-fg);
  opacity: 0.5;
  font-size: var(--nd-font-md);
  border-bottom: 2px solid transparent;
  transition:
    opacity var(--nd-duration-base),
    color var(--nd-duration-base);

  &:hover {
    opacity: 0.8;
  }

  &.active {
    opacity: 1;
    color: var(--nd-accent);
    border-bottom-color: var(--nd-accent);
  }
}

.pickerSkinToneBtn {
  margin-left: 4px;
}

.pickerNavTwemoji {
  width: 18px;
  height: 18px;
  object-fit: contain;
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
  font-size: var(--nd-font-md);
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

<script setup lang="ts">
import { computed } from 'vue'
import { ACHIEVEMENT_LABELS } from '@/utils/achievementLabels'
import {
  ACHIEVEMENT_TYPES,
  type Achievement,
  type AchievementBadge,
} from '@/utils/achievements'

/**
 * 種別・バッジ・ラベルは差し替えられる。既定は Misskey サーバーの実績だが、
 * NoteDeck 独自実績 (#1029) も同じ見た目で出すため (グリッドを 2 つ作らない)。
 */
const props = defineProps<{
  achievements: Achievement[]
  /** 表示する種別と並び。未指定ならサーバー実績の全種別 */
  types?: readonly string[]
  /** 種別 → バッジ。未指定ならサーバー実績のバッジ */
  badges?: Record<string, AchievementBadge>
  /** 種別 → 表示名。未指定ならサーバー実績のラベル */
  labels?: Record<string, string>
  /**
   * 開放待ちの種別 (#1036)。まだ達成できない状態なので未達成とは区別し、
   * 鍵として見せて開放を促す。押すと unlock を emit する
   */
  pending?: readonly string[]
  /** 開放待ちカードの説明。押したときに何が起きるかを書く */
  pendingHint?: string
}>()

const emit = defineEmits<{
  unlock: []
}>()

const pendingSet = computed(() => new Set(props.pending ?? []))

type BadgeInfo = AchievementBadge

const BADGES: Record<string, BadgeInfo> = {
  notes1: {
    emoji: '\u{1F4DD}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
  },
  notes10: { emoji: '\u{1F4D1}', frame: 'bronze', bg: null },
  notes100: {
    emoji: '\u{1F4D2}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
  },
  notes500: { emoji: '\u{1F4DA}', frame: 'bronze', bg: null },
  notes1000: {
    emoji: '\u{1F5C3}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
  },
  notes5000: {
    emoji: '\u{1F304}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
  },
  notes10000: {
    emoji: '\u{1F3D9}',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
  },
  notes20000: {
    emoji: '\u{1F307}',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
  },
  notes30000: {
    emoji: '\u{1F306}',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
  },
  notes40000: {
    emoji: '\u{1F303}',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(197 69 192), rgb(2 112 155))',
  },
  notes50000: {
    emoji: '\u{1FA90}',
    frame: 'gold',
    bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
  },
  notes60000: {
    emoji: '\u2604\uFE0F',
    frame: 'gold',
    bg: 'linear-gradient(0deg, rgb(197 69 192), rgb(2 112 155))',
  },
  notes70000: {
    emoji: '\u{1F30C}',
    frame: 'gold',
    bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
  },
  notes80000: {
    emoji: '\u{1F30C}',
    frame: 'gold',
    bg: 'linear-gradient(0deg, rgb(197 69 192), rgb(2 112 155))',
  },
  notes90000: {
    emoji: '\u{1F30C}',
    frame: 'gold',
    bg: 'linear-gradient(0deg, rgb(255 232 119), rgb(255 140 41))',
  },
  notes100000: {
    emoji: '\u267E\uFE0F',
    frame: 'platinum',
    bg: 'linear-gradient(0deg, rgb(255 232 119), rgb(255 140 41))',
  },
  login3: { emoji: '\u{1F331}', frame: 'bronze', bg: null },
  login7: {
    emoji: '\u{1F331}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
  },
  login15: {
    emoji: '\u{1F331}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
  },
  login30: { emoji: '\u{1FAB4}', frame: 'bronze', bg: null },
  login60: {
    emoji: '\u{1FAB4}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
  },
  login100: {
    emoji: '\u{1FAB4}',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
  },
  login200: { emoji: '\u{1F333}', frame: 'silver', bg: null },
  login300: {
    emoji: '\u{1F333}',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
  },
  login400: {
    emoji: '\u{1F333}',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
  },
  login500: { emoji: '\u{1F304}', frame: 'silver', bg: null },
  login600: {
    emoji: '\u{1F304}',
    frame: 'gold',
    bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
  },
  login700: {
    emoji: '\u{1F304}',
    frame: 'gold',
    bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
  },
  login800: { emoji: '\u{1F307}', frame: 'gold', bg: null },
  login900: {
    emoji: '\u{1F307}',
    frame: 'gold',
    bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
  },
  login1000: {
    emoji: '\u{1F307}',
    frame: 'platinum',
    bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
  },
  passedSinceAccountCreated1: {
    emoji: '1\uFE0F\u20E3',
    frame: 'bronze',
    bg: null,
  },
  passedSinceAccountCreated2: {
    emoji: '2\uFE0F\u20E3',
    frame: 'silver',
    bg: null,
  },
  passedSinceAccountCreated3: {
    emoji: '3\uFE0F\u20E3',
    frame: 'gold',
    bg: null,
  },
  loggedInOnBirthday: {
    emoji: '\u{1F382}',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(255 77 77), rgb(247 155 214))',
  },
  loggedInOnNewYearsDay: {
    emoji: '\u{1F38D}',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(255 144 144), rgb(255 232 168))',
  },
  noteClipped1: { emoji: '\u{1F587}\uFE0F', frame: 'bronze', bg: null },
  noteFavorited1: { emoji: '\u{1F31F}', frame: 'bronze', bg: null },
  myNoteFavorited1: { emoji: '\u{1F320}', frame: 'silver', bg: null },
  profileFilled: {
    emoji: '\u{1F44C}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(187 183 59), rgb(255 143 77))',
  },
  markedAsCat: {
    emoji: '\u{1F408}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(187 183 59), rgb(255 143 77))',
  },
  following1: {
    emoji: '\u2618\uFE0F',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
  },
  following10: {
    emoji: '\u{1F6B8}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
  },
  following50: {
    emoji: '\u{1F91D}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
  },
  following100: {
    emoji: '\u{1F4AF}',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(255 53 184), rgb(255 206 69))',
  },
  following300: {
    emoji: '\u{1F970}',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
  },
  followers1: {
    emoji: '\u2618\uFE0F',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
  },
  followers10: {
    emoji: '\u{1F44B}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
  },
  followers50: {
    emoji: '\u{1F411}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
  },
  followers100: {
    emoji: '\u{1F60E}',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
  },
  followers300: {
    emoji: '\u{1F3C6}',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
  },
  followers500: {
    emoji: '\u{1F4E1}',
    frame: 'gold',
    bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
  },
  followers1000: {
    emoji: '\u{1F451}',
    frame: 'platinum',
    bg: 'linear-gradient(0deg, rgb(255 232 119), rgb(255 140 41))',
  },
  collectAchievements30: {
    emoji: '\u{1F3C5}',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(255 77 77), rgb(247 155 214))',
  },
  viewAchievements3min: {
    emoji: '\u{1F3C5}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
  },
  iLoveMisskey: {
    emoji: '\u2764\uFE0F',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(255 77 77), rgb(247 155 214))',
  },
  foundTreasure: {
    emoji: '\u{1F3C6}',
    frame: 'gold',
    bg: 'linear-gradient(0deg, rgb(197 69 192), rgb(2 112 155))',
  },
  client30min: {
    emoji: '\u{1F552}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
  },
  client60min: {
    emoji: '\u{1F552}',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
  },
  noteDeletedWithin1min: {
    emoji: '\u{1F5D1}\uFE0F',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
  },
  postedAtLateNight: {
    emoji: '\u{1F319}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(197 69 192), rgb(2 112 155))',
  },
  postedAt0min0sec: {
    emoji: '\u{1F55B}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(58 231 198), rgb(37 194 255))',
  },
  selfQuote: { emoji: '\u{1F4DD}', frame: 'bronze', bg: null },
  htl20npm: {
    emoji: '\u{1F30A}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
  },
  viewInstanceChart: {
    emoji: '\u{1F4CA}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(58 231 198), rgb(37 194 255))',
  },
  outputHelloWorldOnScratchpad: {
    emoji: '\u{1F530}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(58 231 198), rgb(37 194 255))',
  },
  open3windows: {
    emoji: '\u{1F5A5}\uFE0F',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
  },
  driveFolderCircularReference: {
    emoji: '\u{1F4C2}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
  },
  reactWithoutRead: {
    emoji: '\u2753',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
  },
  clickedClickHere: {
    emoji: '\u2757',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
  },
  justPlainLucky: {
    emoji: '\u{1F340}',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(187 183 59), rgb(255 143 77))',
  },
  setNameToSyuilo: {
    emoji: '\u{1F36E}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(187 183 59), rgb(255 143 77))',
  },
  cookieClicked: {
    emoji: '\u{1F36A}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(187 183 59), rgb(255 143 77))',
  },
  brainDiver: {
    emoji: '\u{1F9E0}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
  },
  smashTestNotificationButton: {
    emoji: '\u{1F514}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(187 183 59), rgb(255 143 77))',
  },
  tutorialCompleted: {
    emoji: '\u{1F393}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
  },
  bubbleGameExplodingHead: {
    emoji: '\u{1F92F}',
    frame: 'bronze',
    bg: 'linear-gradient(0deg, rgb(255 77 77), rgb(247 155 214))',
  },
  bubbleGameDoubleExplodingHead: {
    emoji: '\u{1F92F}',
    frame: 'silver',
    bg: 'linear-gradient(0deg, rgb(255 77 77), rgb(247 155 214))',
  },
}

const FRAME_COLORS = {
  bronze: {
    outer: 'linear-gradient(0deg, #703827, #d37566)',
    inner: 'linear-gradient(0deg, #d37566, #703827)',
  },
  silver: {
    outer: 'linear-gradient(0deg, #7c7c7c, #e1e1e1)',
    inner: 'linear-gradient(0deg, #e1e1e1, #7c7c7c)',
  },
  gold: {
    outer:
      'linear-gradient(0deg, rgba(255,182,85,1) 0%, rgba(233,133,0,1) 49%, rgba(255,243,93,1) 51%, rgba(255,187,25,1) 100%)',
    inner: 'linear-gradient(0deg, #ffee20, #eb7018)',
  },
  platinum: {
    outer:
      'linear-gradient(0deg, rgba(154,154,154,1) 0%, rgba(226,226,226,1) 49%, rgba(255,255,255,1) 51%, rgba(195,195,195,1) 100%)',
    inner: 'linear-gradient(0deg, #e1e1e1, #7c7c7c)',
  },
}

const sortedAchievements = computed(() => {
  const unlocked: Array<{ name: string; unlockedAt: number | null }> = []
  const locked: Array<{ name: string; unlockedAt: number | null }> = []
  for (const name of props.types ?? ACHIEVEMENT_TYPES) {
    const a = props.achievements.find((x) => x.name === name)
    if (a) {
      unlocked.push(a)
    } else {
      locked.push({ name, unlockedAt: null })
    }
  }
  return [...unlocked, ...locked]
})

function getBadge(name: string): BadgeInfo {
  const table = props.badges ?? BADGES
  return table[name] ?? { emoji: '\u{1F3C5}', frame: 'bronze', bg: null }
}

function getLabel(name: string): string {
  const table = props.labels ?? ACHIEVEMENT_LABELS
  return table[name] ?? name
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}
</script>

<template>
  <div :class="$style.achievementsGrid">
    <component
      :is="pendingSet.has(item.name) ? 'button' : 'div'"
      v-for="item in sortedAchievements"
      :key="item.name"
      :class="[
        $style.achievementCard,
        { [$style.locked]: !item.unlockedAt, [$style.pending]: pendingSet.has(item.name) },
      ]"
      :title="pendingSet.has(item.name) ? pendingHint : undefined"
      @click="pendingSet.has(item.name) && emit('unlock')"
    >
      <div :class="$style.achievementBadge">
        <div
          :class="[$style.badgeFrame, $style['frame-' + getBadge(item.name).frame]]"
          :style="{ background: FRAME_COLORS[getBadge(item.name).frame].outer }"
        >
          <div
            :class="$style.badgeInner"
            :style="{
              background: (item.unlockedAt ? getBadge(item.name).bg : null) ?? FRAME_COLORS[getBadge(item.name).frame].inner,
            }"
          >
            <span v-if="item.unlockedAt" :class="$style.badgeEmoji">{{ getBadge(item.name).emoji }}</span>
            <i
              v-else-if="pendingSet.has(item.name)"
              :class="['ti ti-lock', $style.badgeEmoji, $style.lockedEmoji]"
            />
            <span v-else :class="[$style.badgeEmoji, $style.lockedEmoji]">?</span>
          </div>
        </div>
      </div>
      <div :class="$style.achievementInfo">
        <div :class="$style.achievementName">{{ item.unlockedAt ? getLabel(item.name) : '???' }}</div>
        <div v-if="item.unlockedAt" :class="$style.achievementDate">{{ formatDate(item.unlockedAt) }}</div>
        <div v-else-if="pendingSet.has(item.name)" :class="$style.achievementDate">開放する</div>
      </div>
    </component>
  </div>
</template>

<style lang="scss" module>
.achievementsGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 2px;
  padding: 4px;
}

.achievementCard {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 8px;
  border-radius: var(--nd-radius-md);
  transition: background var(--nd-duration-base);
  contain: layout style;
  content-visibility: auto;
  contain-intrinsic-size: auto 110px;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  &.locked {
    opacity: 0.35;
  }

  /* 開放待ちは押せる。未達成 (0.35) より濃くして、諦めの対象でないと分かる形にする */
  &.pending {
    opacity: 0.6;
    cursor: pointer;
    border: none;
    background: none;
    font: inherit;
    color: inherit;

    &:hover {
      opacity: 1;
      background: var(--nd-buttonHoverBg);
    }
  }
}

.achievementBadge {
  flex-shrink: 0;
}

@keyframes shine {
  0% { translate: -30px; }
  100% { translate: -130px; }
}

.badgeFrame {
  position: relative;
  width: 52px;
  height: 52px;
  padding: 5px;
  border-radius: 50%;
  box-sizing: border-box;
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.27));
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.53) inset;
  overflow: clip;

  &.frame-gold,
  &.frame-platinum {
    &::before {
      content: "";
      display: block;
      position: absolute;
      top: 26px;
      width: 200px;
      height: 6px;
      rotate: -45deg;
      translate: -30px;
      animation: shine 2s infinite;
    }
  }

  &.frame-gold::before {
    background: rgba(255, 255, 255, 0.53);
  }

  &.frame-platinum::before {
    background: rgba(255, 255, 255, 0.93);
  }
}

.badgeInner {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.53) inset;
  display: flex;
  align-items: center;
  justify-content: center;
}

.badgeEmoji {
  font-size: 22px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.67));
  line-height: 1;
}

.lockedEmoji {
  font-size: 16px;
  font-weight: bold;
  color: rgba(255, 255, 255, 0.5);
  filter: none;
}

.achievementInfo {
  text-align: center;
  min-width: 0;
  width: 100%;
}

.achievementName {
  font-size: 0.7em;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.achievementDate {
  font-size: 0.6em;
  opacity: 0.5;
  margin-top: 2px;
}
</style>

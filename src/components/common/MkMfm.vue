<script setup lang="ts">
import { openUrl } from '@tauri-apps/plugin-opener'
import { computed, useCssModule } from 'vue'
import { useEmojiResolver } from '@/composables/useEmojiResolver'
import { useNavigation } from '@/composables/useNavigation'
import { highlightCode, highlighterLoaded } from '@/utils/highlight'
import { proxyUrl } from '@/utils/imageProxy'
import { type MfmToken, parseMfm } from '@/utils/mfm'
import { isMemoUrl, isSafeUrl } from '@/utils/url'
import MkEmoji from './MkEmoji.vue'

const props = defineProps<{
  text?: string
  tokens?: MfmToken[]
  emojis?: Record<string, string>
  reactionEmojis?: Record<string, string>
  serverHost?: string
  plain?: boolean
  myUsername?: string
  myHost?: string
  /**
   * Markdown 拡張 (heading / list) を有効化する。memo 表示等で使用 (opt-in)。
   * ノート本文には影響しないので Misskey 互換性は保たれる。
   */
  markdown?: boolean
}>()

const emit = defineEmits<{
  mentionClick: [username: string, host: string | null]
  mentionHover: [e: MouseEvent, username: string, host: string | null]
  mentionLeave: []
  /** `memo:<id>` link のクリック (#494)。親が memo inspector window 等で受ける */
  memoLinkClick: [memoId: string]
}>()

const { resolveEmoji: resolveEmojiRaw } = useEmojiResolver()
const { navigateToHashtag } = useNavigation()
const style = useCssModule()

function isMentionMe(username: string, host: string | null): boolean {
  if (!props.myUsername) return false
  if (username.toLowerCase() !== props.myUsername.toLowerCase()) return false
  // Local mention matches if myHost is the same server or host is null
  if (!host) return !props.myHost || props.myHost === props.serverHost
  return (
    host.toLowerCase() ===
    (props.myHost ?? props.serverHost ?? '').toLowerCase()
  )
}

const resolvedTokens = computed(() => {
  if (props.tokens) return props.tokens
  return parseMfm(props.text ?? '', { markdown: props.markdown })
})

const emojiUrls = computed(() => {
  const urls: Record<string, string | null> = {}
  const emojis = props.emojis ?? {}
  const reactionEmojis = props.reactionEmojis ?? {}
  const host = props.serverHost ?? ''
  for (const token of resolvedTokens.value) {
    if (token.type === 'customEmoji' && !(token.shortcode in urls)) {
      urls[token.shortcode] = resolveEmojiRaw(
        token.shortcode,
        emojis,
        reactionEmojis,
        host,
      )
    }
  }
  return urls
})

function handleLinkClick(e: MouseEvent, url: string) {
  e.preventDefault()
  // `memo:<id>` は app 内 navigation 専用、親に委譲して inspector を開く (#494)
  const memo = isMemoUrl(url)
  if (memo) {
    emit('memoLinkClick', memo.id)
    return
  }
  if (isSafeUrl(url)) openUrl(url)
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// KaTeX + DOMPurify are loaded on demand — most notes don't contain math
let katexModule: typeof import('katex') | null = null
let domPurifyModule: typeof import('dompurify') | null = null
let mathLoadPromise: Promise<void> | null = null

function ensureMathLoaded(): Promise<void> {
  if (katexModule && domPurifyModule) return Promise.resolve()
  if (!mathLoadPromise) {
    mathLoadPromise = Promise.all([import('katex'), import('dompurify')]).then(
      ([k, d]) => {
        katexModule = k
        domPurifyModule = d
      },
    )
  }
  return mathLoadPromise
}

const KATEX_ALLOWED_TAGS = [
  'span',
  'div',
  'math',
  'semantics',
  'mrow',
  'mi',
  'mo',
  'mn',
  'msup',
  'msub',
  'mfrac',
  'munder',
  'mover',
  'munderover',
  'msqrt',
  'mroot',
  'mtable',
  'mtr',
  'mtd',
  'mtext',
  'mspace',
  'annotation',
  'svg',
  'line',
  'path',
  'rect',
  'g',
]
const KATEX_ALLOWED_ATTR = [
  'class',
  'style',
  'mathvariant',
  'encoding',
  'xmlns',
  'width',
  'height',
  'viewBox',
  'preserveAspectRatio',
  'd',
  'x1',
  'x2',
  'y1',
  'y2',
  'fill',
  'stroke',
  'stroke-width',
]

function renderKatex(formula: string, displayMode: boolean): string {
  if (!katexModule || !domPurifyModule) {
    // Trigger load (will re-render on next update)
    ensureMathLoaded()
    return escapeHtml(formula)
  }
  try {
    const html = katexModule.default.renderToString(formula, {
      displayMode,
      throwOnError: false,
      trust: false,
      strict: 'error',
    })
    return domPurifyModule.default.sanitize(html, {
      ALLOWED_TAGS: KATEX_ALLOWED_TAGS,
      ALLOWED_ATTR: KATEX_ALLOWED_ATTR,
    })
  } catch {
    return escapeHtml(formula)
  }
}

const hexColorRe = /^[0-9a-fA-F]{3,8}$/
const cssTimeRe = /^\d+(\.\d+)?(s|ms)$/
const cssNumRe = /^-?\d+(\.\d+)?$/
const borderStyles = new Set([
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
  'none',
  'hidden',
])

const fnClassMap: Record<string, string> = {
  'mfm-spin': style.mfmSpin,
  'mfm-spin-left': style.mfmSpinLeft,
  'mfm-spin-alternate': style.mfmSpinAlternate,
  'mfm-spinX': style.mfmSpinX,
  'mfm-spinX-left': style.mfmSpinXLeft,
  'mfm-spinX-alternate': style.mfmSpinXAlternate,
  'mfm-spinY': style.mfmSpinY,
  'mfm-spinY-left': style.mfmSpinYLeft,
  'mfm-spinY-alternate': style.mfmSpinYAlternate,
  'mfm-shake': style.mfmShake,
  'mfm-bounce': style.mfmBounce,
  'mfm-jelly': style.mfmJelly,
  'mfm-tada': style.mfmTada,
  'mfm-jump': style.mfmJump,
  'mfm-twitch': style.mfmTwitch,
  'mfm-rainbow': style.mfmRainbow,
  'mfm-sparkle': style.mfmSparkle,
  'mfm-blur': style.mfmBlur,
}

function fnClass(token: MfmToken & { type: 'fn' }): string | undefined {
  let key: string | undefined
  switch (token.name) {
    case 'spin': {
      const axis = token.args.x ? 'X' : token.args.y ? 'Y' : ''
      const dir = token.args.left
        ? '-left'
        : token.args.alternate
          ? '-alternate'
          : ''
      key = `mfm-spin${axis}${dir}`
      break
    }
    case 'shake':
      key = 'mfm-shake'
      break
    case 'bounce':
      key = 'mfm-bounce'
      break
    case 'jelly':
      key = 'mfm-jelly'
      break
    case 'tada':
      key = 'mfm-tada'
      break
    case 'jump':
      key = 'mfm-jump'
      break
    case 'twitch':
      key = 'mfm-twitch'
      break
    case 'rainbow':
      key = 'mfm-rainbow'
      break
    case 'sparkle':
      key = 'mfm-sparkle'
      break
    case 'blur':
      key = 'mfm-blur'
      break
    default:
      return undefined
  }
  return fnClassMap[key] ?? undefined
}

function fnStyle(
  token: MfmToken & { type: 'fn' },
): Record<string, string> | undefined {
  const s: Record<string, string> = {}
  const { name, args } = token

  if (typeof args.speed === 'string' && cssTimeRe.test(args.speed)) {
    s.animationDuration = args.speed
  }

  switch (name) {
    case 'flip':
      if (args.h && args.v) s.transform = 'scale(-1,-1)'
      else if (args.v) s.transform = 'scaleY(-1)'
      else s.transform = 'scaleX(-1)'
      s.display = 'inline-block'
      break
    case 'rotate': {
      const deg =
        typeof args.deg === 'string' && cssNumRe.test(args.deg)
          ? args.deg
          : '90'
      s.transform = `rotate(${deg}deg)`
      s.display = 'inline-block'
      break
    }
    case 'scale': {
      const sx =
        typeof args.x === 'string' && cssNumRe.test(args.x) ? args.x : '1'
      const sy =
        typeof args.y === 'string' && cssNumRe.test(args.y) ? args.y : '1'
      s.transform = `scale(${sx},${sy})`
      s.display = 'inline-block'
      break
    }
    case 'position': {
      const px =
        typeof args.x === 'string' && cssNumRe.test(args.x) ? args.x : '0'
      const py =
        typeof args.y === 'string' && cssNumRe.test(args.y) ? args.y : '0'
      s.transform = `translate(${px}em,${py}em)`
      s.display = 'inline-block'
      break
    }
    case 'fg':
      if (typeof args.color === 'string' && hexColorRe.test(args.color)) {
        s.color = `#${args.color}`
      }
      break
    case 'bg':
      if (typeof args.color === 'string' && hexColorRe.test(args.color)) {
        s.backgroundColor = `#${args.color}`
      }
      break
    case 'x2':
    case 'x3':
    case 'x4':
      // font-size is handled by CSS classes (mfmX2/X3/X4) with nesting limits
      break
    case 'font':
      if (args.serif) s.fontFamily = 'serif'
      else if (args.monospace) s.fontFamily = 'monospace'
      else if (args.cursive) s.fontFamily = 'cursive'
      else if (args.fantasy) s.fontFamily = 'fantasy'
      break
    case 'border': {
      const w =
        typeof args.width === 'string' && cssNumRe.test(args.width)
          ? args.width
          : '1'
      const st =
        typeof args.style === 'string' && borderStyles.has(args.style)
          ? args.style
          : 'solid'
      const c =
        typeof args.color === 'string' && hexColorRe.test(args.color)
          ? `#${args.color}`
          : 'var(--nd-fg)'
      const r =
        typeof args.radius === 'string' && cssNumRe.test(args.radius)
          ? args.radius
          : '0'
      s.border = `${w}px ${st} ${c}`
      s.borderRadius = `${r}px`
      if (!args.noclip) s.overflow = 'clip'
      s.display = 'inline-block'
      break
    }
  }

  return Object.keys(s).length > 0 ? s : undefined
}

const knownFns = new Set([
  'spin',
  'shake',
  'bounce',
  'jelly',
  'tada',
  'jump',
  'twitch',
  'rainbow',
  'sparkle',
  'blur',
  'flip',
  'rotate',
  'scale',
  'position',
  'fg',
  'bg',
  'x2',
  'x3',
  'x4',
  'font',
  'border',
])

function isFnKnown(token: MfmToken & { type: 'fn' }): boolean {
  return knownFns.has(token.name)
}

function fnZoomClass(token: MfmToken & { type: 'fn' }): string | undefined {
  if (token.name === 'x2' || token.name === 'x3' || token.name === 'x4') {
    return style[`mfm${token.name.toUpperCase()}`]
  }
  return undefined
}

function rubyParts(token: MfmToken & { type: 'fn' }): [string, string] | null {
  if (token.children.length !== 1 || token.children[0]?.type !== 'text')
    return null
  const text = token.children[0].value
  const spaceIdx = text.lastIndexOf(' ')
  if (spaceIdx <= 0) return null
  return [text.slice(0, spaceIdx), text.slice(spaceIdx + 1)]
}

function unixtimeISO(token: MfmToken & { type: 'fn' }): string {
  const ts = unixtimeValue(token)
  return ts ? new Date(ts * 1000).toISOString() : ''
}

function unixtimeDisplay(token: MfmToken & { type: 'fn' }): string {
  const ts = unixtimeValue(token)
  if (!ts) return '?'
  try {
    return new Date(ts * 1000).toLocaleString()
  } catch {
    return '?'
  }
}

function unixtimeValue(token: MfmToken & { type: 'fn' }): number | null {
  if (token.children.length !== 1 || token.children[0]?.type !== 'text')
    return null
  const n = Number(token.children[0].value)
  return Number.isFinite(n) ? n : null
}
</script>

<template>
  <span class="mfm" :class="$style.mfm"><template v-for="(token, i) in resolvedTokens" :key="i"><!--
    --><!-- URL --><a v-if="token.type === 'url'" :href="isSafeUrl(token.value) ? token.value : '#'" :class="$style.mfmUrl" target="_blank" rel="noopener noreferrer" @click.stop="handleLinkClick($event, token.value)">{{ token.value }}</a><!--
    --><!-- Link --><a v-else-if="token.type === 'link'" :href="isSafeUrl(token.url) ? token.url : '#'" :class="$style.mfmUrl" target="_blank" rel="noopener noreferrer" @click.stop="handleLinkClick($event, token.url)"><MkMfm :tokens="token.label" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" /></a><!--
    --><!-- Mention --><span v-else-if="token.type === 'mention'" :class="isMentionMe(token.username, token.host) ? $style.mfmMentionMe : $style.mfmMention" @click.stop="emit('mentionClick', token.username, token.host)" @mouseenter="emit('mentionHover', $event, token.username, token.host)" @mouseleave="emit('mentionLeave')">{{ token.acct }}</span><!--
    --><!-- Hashtag --><span v-else-if="token.type === 'hashtag'" :class="$style.mfmHashtag" @click.stop="navigateToHashtag(token.value)">#{{ token.value }}</span><!--
    --><!-- Bold --><b v-else-if="token.type === 'bold'"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" /></b><!--
    --><!-- Italic --><i v-else-if="token.type === 'italic'"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" /></i><!--
    --><!-- Strike --><s v-else-if="token.type === 'strike'"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" /></s><!--
    --><!-- Code Block --><div v-else-if="token.type === 'codeBlock'" :key="`cb-${i}-${highlighterLoaded}`" :class="$style.mfmCodeBlock" v-html="highlightCode(token.value, token.lang)"></div><!--
    --><!-- Inline Code --><code v-else-if="token.type === 'inlineCode'" :class="$style.mfmCode">{{ token.value }}</code><!--
    --><!-- Custom Emoji (resolved) --><img v-else-if="token.type === 'customEmoji' && emojiUrls[token.shortcode]" :src="proxyUrl(emojiUrls[token.shortcode]!)" :alt="`:${token.shortcode}:`" class="custom-emoji" :class="plain ? $style.customEmojiPlain : $style.customEmoji" decoding="async" loading="lazy" @error="(e: Event) => { const img = e.target as HTMLImageElement; if (!img.src.endsWith('/emoji-unknown.svg')) img.src = '/emoji-unknown.svg' }" /><!--
    --><!-- Custom Emoji (unresolved — show fallback icon) --><img v-else-if="token.type === 'customEmoji'" src="/emoji-unknown.svg" :alt="`:${token.shortcode}:`" :title="`:${token.shortcode}:`" class="custom-emoji" :class="plain ? $style.customEmojiPlain : $style.customEmoji" /><!--
    --><!-- Unicode Emoji --><MkEmoji v-else-if="token.type === 'unicodeEmoji'" :emoji="token.value" class="twemoji" :class="$style.twemoji" /><!--
    --><!-- MFM Function: ruby --><ruby v-else-if="token.type === 'fn' && token.name === 'ruby' && rubyParts(token)">{{ rubyParts(token)![0] }}<rp>(</rp><rt>{{ rubyParts(token)![1] }}</rt><rp>)</rp></ruby><!--
    --><!-- MFM Function: unixtime --><time v-else-if="token.type === 'fn' && token.name === 'unixtime'" :datetime="unixtimeISO(token)">{{ unixtimeDisplay(token) }}</time><!--
    --><!-- MFM Function: known --><span v-else-if="token.type === 'fn' && isFnKnown(token)" :class="[fnClass(token), fnZoomClass(token)]" :style="fnStyle(token)"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" /></span><!--
    --><!-- MFM Function: unknown → show children --><span v-else-if="token.type === 'fn'"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" /></span><!--
    --><!-- Small --><small v-else-if="token.type === 'small'" :class="$style.mfmSmall"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" /></small><!--
    --><!-- Center --><span v-else-if="token.type === 'center'" :class="$style.mfmCenter"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" /></span><!--
    --><!-- Plain --><span v-else-if="token.type === 'plain'">{{ token.value }}</span><!--
    --><!-- Quote --><blockquote v-else-if="token.type === 'quote'" :class="$style.mfmQuote"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" /></blockquote><!--
    --><!-- Search --><div v-else-if="token.type === 'search'" :class="$style.mfmSearch"><input :class="$style.mfmSearchInput" type="text" :value="token.query" readonly /><button :class="$style.mfmSearchButton" @click.stop="openUrl(`https://www.google.com/search?q=${encodeURIComponent(token.query)}`)">検索</button></div><!--
    --><!-- Math Inline --><span v-else-if="token.type === 'mathInline'" :class="$style.mfmMath" v-html="renderKatex(token.value, false)"></span><!--
    --><!-- Math Block --><div v-else-if="token.type === 'mathBlock'" :class="$style.mfmMathBlock" v-html="renderKatex(token.value, true)"></div><!--
    --><!-- Heading (Markdown 拡張) --><h1 v-else-if="token.type === 'heading' && token.level === 1" :class="[$style.mfmHeading, $style.mfmHeading1]"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" /></h1><!--
    --><h2 v-else-if="token.type === 'heading' && token.level === 2" :class="[$style.mfmHeading, $style.mfmHeading2]"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" /></h2><!--
    --><h3 v-else-if="token.type === 'heading' && token.level === 3" :class="[$style.mfmHeading, $style.mfmHeading3]"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" /></h3><!--
    --><h4 v-else-if="token.type === 'heading' && token.level === 4" :class="[$style.mfmHeading, $style.mfmHeading4]"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" /></h4><!--
    --><h5 v-else-if="token.type === 'heading' && token.level === 5" :class="[$style.mfmHeading, $style.mfmHeading5]"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" /></h5><!--
    --><h6 v-else-if="token.type === 'heading'" :class="[$style.mfmHeading, $style.mfmHeading6]"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" /></h6><!--
    --><!-- List (Markdown 拡張、ordered) --><ol v-else-if="token.type === 'list' && token.ordered" :class="$style.mfmList"><li v-for="(item, j) in token.items" :key="j"><MkMfm :tokens="item" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" /></li></ol><!--
    --><!-- List (Markdown 拡張、unordered) --><ul v-else-if="token.type === 'list'" :class="$style.mfmList"><li v-for="(item, j) in token.items" :key="j"><MkMfm :tokens="item" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" /></li></ul><!--
    --><!-- Text --><template v-else-if="token.type === 'text'">{{ token.value }}</template><!--
  --></template></span>
</template>

<style lang="scss" module>
.mfm {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

.mfmUrl {
  color: var(--nd-link);
  text-decoration: none;
  word-break: break-all;

  &:hover {
    text-decoration: underline;
  }
}

.mfmMention {
  color: var(--nd-mention);
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

.mfmMentionMe {
  color: var(--nd-mentionMe);
  cursor: pointer;
  font-weight: 600;

  &:hover {
    text-decoration: underline;
  }
}

.mfmHashtag {
  color: var(--nd-hashtag, var(--nd-accent));
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

.mfmCode {
  font-family: 'Fira Code', 'Cascadia Code', monospace;
  font-size: 0.9em;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--nd-inlineCodeBg, rgba(0, 0, 0, 0.15));
  color: var(--nd-inlineCodeFg, var(--nd-fg));
}

.mfmCodeBlock {
  margin: 8px 0;
  max-width: 100%;
  overflow: hidden;

  :deep(pre) {
    font-family: 'Fira Code', 'Cascadia Code', monospace;
    font-size: 0.85em;
    padding: 12px 16px;
    border-radius: var(--nd-radius-md);
    overflow-x: auto;
    white-space: pre;
    word-break: normal;
    margin: 0;
  }

  :deep(pre code) {
    font-family: inherit;
  }
}

.customEmoji {
  height: 2em;
  min-width: 2em;
  width: auto;
  vertical-align: middle;
  object-fit: contain;
}

.customEmojiPlain {
  height: 1.25em;
  vertical-align: -0.25em;
  object-fit: contain;
}

.twemoji {
  height: 1.25em;
  vertical-align: -0.25em;
  object-fit: contain;
}

/* Small */
.mfmSmall {
  font-size: 0.8em;
  opacity: 0.7;
}

/* Center */
.mfmCenter {
  display: block;
  text-align: center;
}

/* Quote */
.mfmQuote {
  display: block;
  margin: 8px 0;
  padding: 4px 0 4px 16px;
  border-left: 3px solid var(--nd-divider, rgba(128, 128, 128, 0.3));
  color: var(--nd-fg-muted, var(--nd-fg));
  opacity: 0.85;
}

/* Markdown 拡張: heading (memo 用 opt-in) */
.mfmHeading {
  display: block;
  margin: 0.6em 0 0.3em;
  font-weight: bold;
  line-height: 1.25;
  color: var(--nd-fgHighlighted, var(--nd-fg));
}
.mfmHeading1 { font-size: 1.6em; }
.mfmHeading2 { font-size: 1.4em; }
.mfmHeading3 { font-size: 1.2em; }
.mfmHeading4 { font-size: 1.05em; }
.mfmHeading5 { font-size: 0.95em; opacity: 0.9; }
.mfmHeading6 { font-size: 0.85em; opacity: 0.8; }

/* Markdown 拡張: list */
.mfmList {
  display: block;
  margin: 4px 0;
  padding-left: 1.5em;
}

/* Search */
.mfmSearch {
  display: flex;
  margin: 8px 0;
  gap: 4px;
}

.mfmSearchInput {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--nd-divider, rgba(128, 128, 128, 0.3));
  border-radius: var(--nd-radius-sm, 4px);
  background: var(--nd-bg-secondary, rgba(0, 0, 0, 0.05));
  color: var(--nd-fg);
  font-size: 0.9em;
}

.mfmSearchButton {
  padding: 6px 16px;
  border: none;
  border-radius: var(--nd-radius-sm, 4px);
  background: var(--nd-accent);
  color: #fff;
  cursor: pointer;
  font-size: 0.9em;
  white-space: nowrap;

  &:hover {
    opacity: 0.85;
  }
}

/* Math */
.mfmMath {
  display: inline;
}

.mfmMathBlock {
  display: block;
  overflow-wrap: anywhere;
  background: var(--nd-bg-secondary, rgba(0, 0, 0, 0.05));
  padding: 0 1em;
  margin: 0.5em 0;
  overflow: auto;
  border-radius: 8px;

  :deep(.katex-display) {
    margin: auto;
    width: fit-content;
    overflow: clip;
  }
}

/* Zoom (x2/x3/x4) — Misskey-compatible nesting limit */
.mfmX2 { --mfm-zoom-size: 200%; }
.mfmX3 { --mfm-zoom-size: 400%; }
.mfmX4 { --mfm-zoom-size: 600%; }

.mfmX2, .mfmX3, .mfmX4 {
  font-size: var(--mfm-zoom-size);

  .mfmX2, .mfmX3, .mfmX4 {
    /* only half effective */
    font-size: calc(var(--mfm-zoom-size) / 2 + 50%);

    .mfmX2, .mfmX3, .mfmX4 {
      /* disabled */
      font-size: 100%;
    }
  }
}

/* Blur — static filter (initial paint only) + opacity reveal (compositor-only) */
.mfmBlur {
  filter: blur(6px);
  transition: opacity var(--nd-duration-slower);

  &:hover,
  &:focus {
    filter: none;
  }
}

/* Spin */
@keyframes mfm-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes mfm-spinX {
  from { transform: perspective(128px) rotateX(0deg); }
  to { transform: perspective(128px) rotateX(360deg); }
}
@keyframes mfm-spinY {
  from { transform: perspective(128px) rotateY(0deg); }
  to { transform: perspective(128px) rotateY(360deg); }
}
.mfmSpin { display: inline-block; animation: mfm-spin 1.5s linear infinite; }
.mfmSpinLeft { display: inline-block; animation: mfm-spin 1.5s linear infinite reverse; }
.mfmSpinAlternate { display: inline-block; animation: mfm-spin 1.5s linear infinite alternate; }
.mfmSpinX { display: inline-block; animation: mfm-spinX 1.5s linear infinite; }
.mfmSpinXLeft { display: inline-block; animation: mfm-spinX 1.5s linear infinite reverse; }
.mfmSpinXAlternate { display: inline-block; animation: mfm-spinX 1.5s linear infinite alternate; }
.mfmSpinY { display: inline-block; animation: mfm-spinY 1.5s linear infinite; }
.mfmSpinYLeft { display: inline-block; animation: mfm-spinY 1.5s linear infinite reverse; }
.mfmSpinYAlternate { display: inline-block; animation: mfm-spinY 1.5s linear infinite alternate; }

/* Shake — 8 keyframes (imperceptible difference at 0.5s, 60% less interpolation) */
@keyframes mfm-shake {
  0%   { transform: translate(-3px, -1px) rotate(-8deg); }
  14%  { transform: translate(1px, -3px) rotate(6deg); }
  28%  { transform: translate(-2px, 1px) rotate(-3deg); }
  42%  { transform: translate(2px, -2px) rotate(10deg); }
  57%  { transform: translate(-1px, 2px) rotate(-9deg); }
  71%  { transform: translate(1px, -3px) rotate(8deg); }
  85%  { transform: translate(-2px, 0) rotate(-3deg); }
  100% { transform: translate(2px, 1px) rotate(2deg); }
}
.mfmShake { display: inline-block; animation: mfm-shake 0.5s ease infinite; }

/* Bounce */
@keyframes mfm-bounce {
  0% { transform: translateY(0) scale(1, 1); }
  25% { transform: translateY(-16px) scale(1, 1); }
  50% { transform: translateY(0) scale(1, 1); }
  75% { transform: translateY(0) scale(1.5, 0.75); }
  100% { transform: translateY(0) scale(1, 1); }
}
.mfmBounce { display: inline-block; animation: mfm-bounce 0.75s linear infinite; transform-origin: center bottom; }

/* Jelly — unified scale() */
@keyframes mfm-jelly {
  0% { transform: scale(1, 1); }
  33% { transform: scale(1.2, 0.8); }
  66% { transform: scale(0.8, 1.2); }
  100% { transform: scale(1, 1); }
}
.mfmJelly { display: inline-block; animation: mfm-jelly 1s ease infinite; }

/* Tada */
@keyframes mfm-tada {
  from { transform: rotate(0deg) scale(1); }
  10% { transform: rotate(-5deg) scale(0.9); }
  20% { transform: rotate(-5deg) scale(0.9); }
  30% { transform: rotate(5deg) scale(1.3); }
  40% { transform: rotate(-3deg) scale(1.3); }
  50% { transform: rotate(3deg) scale(1.3); }
  60% { transform: rotate(-3deg) scale(1.3); }
  70% { transform: rotate(3deg) scale(1.3); }
  80% { transform: rotate(-3deg) scale(1.3); }
  90% { transform: rotate(3deg) scale(1.3); }
  to { transform: rotate(0deg) scale(1); }
}
.mfmTada { display: inline-block; animation: mfm-tada 1s linear infinite; }

/* Jump */
@keyframes mfm-jump {
  0% { transform: translateY(0); }
  25% { transform: translateY(-16px); }
  50% { transform: translateY(0); }
  75% { transform: translateY(-8px); }
  100% { transform: translateY(0); }
}
.mfmJump { display: inline-block; animation: mfm-jump 0.75s linear infinite; }

/* Twitch — 6 keyframes (imperceptible at 0.5s, 70% less interpolation) */
@keyframes mfm-twitch {
  0%   { transform: translate(7px, -2px); }
  20%  { transform: translate(-8px, 6px); }
  40%  { transform: translate(-8px, -3px); }
  60%  { transform: translate(3px, -8px); }
  80%  { transform: translate(-3px, 7px); }
  100% { transform: translate(7px, -2px); }
}
.mfmTwitch { display: inline-block; animation: mfm-twitch 0.5s ease infinite; }

/* Rainbow */
@keyframes mfm-rainbow {
  0% { color: #ff0000; }
  16.6% { color: #ff8000; }
  33.3% { color: #ffff00; }
  50% { color: #00ff00; }
  66.6% { color: #0000ff; }
  83.3% { color: #ff00ff; }
  100% { color: #ff0000; }
}
.mfmRainbow { animation: mfm-rainbow 1s linear infinite; }

/* Sparkle */
@keyframes mfm-sparkle {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.mfmSparkle { animation: mfm-sparkle 1.5s ease-in-out infinite; }
</style>

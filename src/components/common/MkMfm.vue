<script setup lang="ts">
import type { MfmFn, MfmPlain } from 'mfm-js'
import { computed, shallowRef, useCssModule } from 'vue'
import { useEmojiMute } from '@/composables/useEmojiMute'
import { useEmojiResolver } from '@/composables/useEmojiResolver'
import { useMinuteClock } from '@/composables/useMinuteClock'
import { useNavigation } from '@/composables/useNavigation'
import { i18n } from '@/i18n'
import { nyaizeTokens } from '@/services/nyaize'
import { isMemoUrl, isSafeUrl } from '@/services/safeUrl'
import { useSettingsStore } from '@/stores/settings'
import { onCustomEmojiImgError } from '@/utils/emojiImgError'
import { formatAbsoluteTime, formatTime } from '@/utils/formatTime'
import { proxyEmojiUrl } from '@/utils/mediaProxy'
import { type MfmNode, parseMfm } from '@/utils/mfm'
import { openSafeUrl } from '@/utils/url'
import MkCodeBlock from './MkCodeBlock.vue'
import MkEmoji from './MkEmoji.vue'
import MkSparkle from './MkSparkle.vue'

const props = defineProps<{
  text?: string
  tokens?: MfmNode[]
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
  /**
   * cat ユーザーの本文を text ノード単位で にゃ化する (#763)。
   * 再帰呼び出しには変換済み children が渡るので prop の伝播は不要。
   */
  nyaize?: boolean
  /**
   * 1 行に収める (本家の nowrap)。改行とブロック要素 (中央寄せ・引用・コード・
   * 検索・数式) を行内に畳み、fn の装飾 (拡大 / 位置 / アニメ…) は外して中身の
   * 文字と絵文字だけ出す (MFM アートは 1 行では崩れるだけなので)。あふれは省略記号。
   * 通知の要約 1 行で使う (#1210 / #1279)。入れ子の MkMfm には渡さず、根で fn を
   * 畳み、残りは根のクラスから CSS で効かせる
   */
  nowrap?: boolean
  /**
   * 親からの拡大率 (本家 genEl の scale)。$[x2] や $[scale] の中で増え、
   * 2.5 倍以上ならカスタム絵文字を縮小版でなく原寸で出す
   */
  scale?: number
}>()

const emit = defineEmits<{
  mentionClick: [username: string, host: string | null]
  mentionHover: [e: MouseEvent, username: string, host: string | null]
  mentionLeave: []
  /** `memo:<id>` link のクリック (#494)。親が memo inspector window 等で受ける */
  memoLinkClick: [memoId: string]
  /** `$[clickable.ev=<name> ...]` のクリック (本家の clickEv。Play が受ける想定) */
  clickEv: [ev: string]
}>()

const { resolveEmoji: resolveEmojiRaw } = useEmojiResolver()
const { isEmojiMuted } = useEmojiMute()
const { navigateToHashtag } = useNavigation()
const style = useCssModule()
const settingsStore = useSettingsStore()
const clock = useMinuteClock()

// 本家の advancedMfm / animatedMfm。アニメーションは高度な MFM の中にある
const advancedMfm = computed(() => settingsStore.get('mfm.advanced') !== false)
const animatedMfm = computed(
  () => advancedMfm.value && settingsStore.get('mfm.animated') !== false,
)

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
  // plain は本家と同じく parseSimple (絵文字と text だけ)
  const parsed =
    props.tokens ??
    parseMfm(props.text ?? '', {
      markdown: props.markdown,
      simple: props.plain,
    })
  const tokens = props.nowrap ? flattenFnNodes(parsed) : parsed
  return props.nyaize ? nyaizeTokens(tokens) : tokens
})

/** 1 行要約でも行内の文字として成立する fn。それ以外の fn は装飾を外して中身だけ出す */
const NOWRAP_KEPT_FNS = new Set(['ruby', 'unixtime'])

/**
 * nowrap では fn の装飾 (拡大 / 位置 / 回転 / 反転 / 枠 / アニメ…) を外して子だけを
 * 残す。MFM アートを 1 行に畳むと位置指定や拡大が噛み合わず崩れるだけで、本家の
 * 通知 (plain) のように構文を生で見せるのも読みにくい。文字と絵文字だけ残せば
 * 「何を書いたノートか」は 1 行で分かる
 */
function flattenFnNodes(nodes: MfmNode[]): MfmNode[] {
  const out: MfmNode[] = []
  for (const node of nodes) {
    if (node.type === 'fn' && !NOWRAP_KEPT_FNS.has(node.props.name)) {
      out.push(...flattenFnNodes(node.children))
    } else if ('children' in node && Array.isArray(node.children)) {
      out.push({ ...node, children: flattenFnNodes(node.children) } as MfmNode)
    } else {
      out.push(node)
    }
  }
  return out
}

const currentScale = computed(() => props.scale ?? 1)
/** 2.5 倍以上に拡大された絵文字は 128px の縮小版だと粗いので原寸を使う (本家と同じ) */
const emojiOriginalSize = computed(() => currentScale.value >= 2.5)

const emojiUrls = computed(() => {
  const urls: Record<string, string | null> = {}
  const emojis = props.emojis ?? {}
  const reactionEmojis = props.reactionEmojis ?? {}
  const host = props.serverHost ?? ''
  for (const token of resolvedTokens.value) {
    if (token.type === 'emojiCode' && !(token.props.name in urls)) {
      urls[token.props.name] = resolveEmojiRaw(
        token.props.name,
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
  openSafeUrl(url)
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// KaTeX + DOMPurify are loaded on demand — most notes don't contain math
let katexModule: typeof import('katex') | null = null
let domPurifyModule: typeof import('dompurify') | null = null
let mathLoadPromise: Promise<void> | null = null
/** 読み込み完了で数式ノードを再レンダリングさせるための reactive flag (shiki と同じ方式) */
const mathLoaded = shallowRef(false)

function ensureMathLoaded(): Promise<void> {
  if (katexModule && domPurifyModule) return Promise.resolve()
  if (!mathLoadPromise) {
    mathLoadPromise = Promise.all([import('katex'), import('dompurify')]).then(
      ([k, d]) => {
        katexModule = k
        domPurifyModule = d
        mathLoaded.value = true
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
  // mathLoaded を render 中に読むことで、読み込み完了時の再レンダリングを購読する
  if (!mathLoaded.value || !katexModule || !domPurifyModule) {
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
// 本家 (mfm-renderer の validTime) と同じく負の値も通す。負の duration は CSS として
// 無効で捨てられ、負の delay は位相をずらす正当な書き方 (MFM アートで使う)
const cssTimeRe = /^-?\d+(\.\d+)?(s|ms)$/
const cssNumRe = /^-?\d+(\.\d+)?$/

// 本家 (mfm-renderer) と同じ値域: scale は上側だけ 5 倍で止め (負の値は本家と同じく
// 反転としてそのまま通す)、position には上限を置かない。MFM アートは
// `$[position.x=-1000 $[spin $[position.x=1000 …]]]` のように大きな値で軌道を作るので、
// ここで丸めると本家と違う絵になる (#1083)。はみ出しは描く面の側で切る (本家も同じ)。
// ノート / メモカードは contain: content、それ以外 (プロフィール / チャット / ページ /
// お知らせ / AiScript の UI) は本文の枠の overflow: clip。MFM を全文で描く面を
// 足すときは同じく切る。切らないとスクロール領域が横に広がる
const MFM_SCALE_LIMIT = 5

function validColor(value: string | true | undefined): string | null {
  return typeof value === 'string' && hexColorRe.test(value) ? value : null
}

/** 子に渡す拡大率 (本家 genEl と同じ: x2〜x4 と $[scale] で増える) */
function childScale(token: MfmFn): number {
  if (!advancedMfm.value) return currentScale.value
  const { name, args } = token.props
  switch (name) {
    case 'x2':
      return currentScale.value * 2
    case 'x3':
      return currentScale.value * 3
    case 'x4':
      return currentScale.value * 4
    case 'scale':
      return currentScale.value * Math.max(scaleArg(args.x), scaleArg(args.y))
    default:
      return currentScale.value
  }
}

function numArg(value: string | true | undefined, fallback: number): number {
  if (typeof value !== 'string' || !cssNumRe.test(value)) return fallback
  return Number(value)
}

/** 本家と同じく上側だけ MFM_SCALE_LIMIT で止める (負は反転として通す) */
function scaleArg(value: string | true | undefined): number {
  return Math.min(numArg(value, 1), MFM_SCALE_LIMIT)
}
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
  'mfm-blur': style.mfmBlur,
}

function fnClass(token: MfmFn): string | undefined {
  if (token.props.name === 'blur') return style.mfmBlur
  if (!animatedMfm.value) {
    // 本家と同じく rainbow は静的なグラデーション、tada は 150% の文字だけ残す
    if (token.props.name === 'rainbow') return style.mfmRainbowStatic
    if (token.props.name === 'tada') return style.mfmTadaStatic
    return undefined
  }
  let key: string | undefined
  switch (token.props.name) {
    case 'spin': {
      const { args } = token.props
      const axis = args.x ? 'X' : args.y ? 'Y' : ''
      const dir = args.left ? '-left' : args.alternate ? '-alternate' : ''
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
    default:
      return undefined
  }
  return fnClassMap[key] ?? undefined
}

function fnStyle(token: MfmFn): Record<string, string> | undefined {
  const s: Record<string, string> = {}
  const { name, args } = token.props

  if (typeof args.speed === 'string' && cssTimeRe.test(args.speed)) {
    s.animationDuration = args.speed
  }
  // 本家と同じ `delay` (#1083)。複数要素の位相をずらす MFM アートはこれが無いと
  // 全部同時に動く
  if (typeof args.delay === 'string' && cssTimeRe.test(args.delay)) {
    s.animationDelay = args.delay
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
      s.transformOrigin = 'center center'
      s.display = 'inline-block'
      break
    }
    case 'scale': {
      if (!advancedMfm.value) break
      s.transform = `scale(${scaleArg(args.x)},${scaleArg(args.y)})`
      s.display = 'inline-block'
      break
    }
    case 'position': {
      if (!advancedMfm.value) break
      s.transform = `translate(${numArg(args.x, 0)}em,${numArg(args.y, 0)}em)`
      s.display = 'inline-block'
      break
    }
    // 色が無効なときの赤は本家と同じ既定値
    // 本家は style を持つ fn をすべて inline-block で描く (fg / bg / font も同じ)
    case 'fg':
      s.color = `#${validColor(args.color) ?? 'f00'}`
      s.overflowWrap = 'anywhere'
      s.display = 'inline-block'
      break
    case 'bg':
      s.backgroundColor = `#${validColor(args.color) ?? 'f00'}`
      s.overflowWrap = 'anywhere'
      s.display = 'inline-block'
      break
    case 'x2':
    case 'x3':
    case 'x4':
      // font-size is handled by CSS classes (mfmX2/X3/X4) with nesting limits
      break
    case 'font':
      if (args.serif) s.fontFamily = 'serif'
      else if (args.monospace) s.fontFamily = 'var(--nd-font-mono)'
      else if (args.cursive) s.fontFamily = 'cursive'
      else if (args.fantasy) s.fontFamily = 'fantasy'
      else if (args.emoji) s.fontFamily = 'emoji'
      else if (args.math) s.fontFamily = 'math'
      if (s.fontFamily) s.display = 'inline-block'
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
          : 'var(--nd-accent)'
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

function isFnKnown(token: MfmFn): boolean {
  return knownFns.has(token.props.name)
}

function fnZoomClass(token: MfmFn): string | undefined {
  if (!advancedMfm.value) return undefined
  const { name } = token.props
  if (name === 'x2' || name === 'x3' || name === 'x4') {
    return style[`mfm${name.toUpperCase()}`]
  }
  return undefined
}

function plainText(token: MfmPlain): string {
  return token.children.map((c) => c.props.text).join('')
}

/**
 * 本家と同じ分け方: 子が text 1 つなら最初のスペースで本文と読みに分け、
 * 複数なら最後の text を読みにして残りを本文として描画する
 */
function rubyParts(token: MfmFn): { base: MfmNode[]; rt: string } {
  const { children } = token
  const only = children.length === 1 ? children[0] : undefined
  if (only?.type === 'text') {
    const [base = '', rt = ''] = only.props.text.split(' ')
    return { base: [{ type: 'text', props: { text: base } }], rt }
  }
  const last = children.at(-1)
  return {
    base: children.slice(0, -1),
    rt: last?.type === 'text' ? last.props.text.trim() : '',
  }
}

function clickableEv(token: MfmFn): string {
  const { ev } = token.props.args
  return typeof ev === 'string' ? ev : ''
}

function unixtimeISO(token: MfmFn): string {
  const ts = unixtimeValue(token)
  return ts === null ? '' : new Date(ts * 1000).toISOString()
}

/** 本家 MkTime の detail と同じ「絶対時刻 (相対時刻)」 */
function unixtimeDisplay(token: MfmFn): string {
  const ts = unixtimeValue(token)
  if (ts === null) return '?'
  const ms = ts * 1000
  return `${formatAbsoluteTime(ms)} (${formatTime(ms, clock.value)})`
}

function unixtimeValue(token: MfmFn): number | null {
  if (token.children.length !== 1 || token.children[0]?.type !== 'text')
    return null
  const n = Number(token.children[0].props.text)
  // Date で表せる範囲 (±8.64e15 ms) を超えると toISOString が RangeError を投げ、
  // カラムごと落ちる。投稿 1 つで起こせるので値の側で止める
  return Number.isFinite(n) && Math.abs(n * 1000) <= 8.64e15 ? n : null
}
</script>

<template>
  <span class="mfm" :class="[$style.mfm, nowrap && $style.mfmNowrap]"><template v-for="(token, i) in resolvedTokens" :key="i"><!--
    --><!-- URL --><a v-if="token.type === 'url'" :href="isSafeUrl(token.props.url) ? token.props.url : '#'" :class="$style.mfmUrl" target="_blank" rel="noopener noreferrer" @click.stop="handleLinkClick($event, token.props.url)">{{ token.props.url }}</a><!--
    --><!-- Link --><a v-else-if="token.type === 'link'" :href="isSafeUrl(token.props.url) ? token.props.url : '#'" :title="token.props.url" :class="$style.mfmUrl" target="_blank" rel="noopener noreferrer" @click.stop="handleLinkClick($event, token.props.url)"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /></a><!--
    --><!-- Mention --><span v-else-if="token.type === 'mention'" :class="isMentionMe(token.props.username, token.props.host) ? $style.mfmMentionMe : $style.mfmMention" @click.stop="emit('mentionClick', token.props.username, token.props.host)" @mouseenter="emit('mentionHover', $event, token.props.username, token.props.host)" @mouseleave="emit('mentionLeave')">{{ token.props.acct }}</span><!--
    --><!-- Hashtag --><span v-else-if="token.type === 'hashtag'" :class="$style.mfmHashtag" @click.stop="navigateToHashtag(token.props.hashtag)">#{{ token.props.hashtag }}</span><!--
    --><!-- Bold --><b v-else-if="token.type === 'bold'"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /></b><!--
    --><!-- Italic --><i v-else-if="token.type === 'italic'" :class="$style.mfmItalic"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /></i><!--
    --><!-- Strike --><s v-else-if="token.type === 'strike'"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /></s><!--
    --><!-- Code Block --><MkCodeBlock v-else-if="token.type === 'blockCode'" :code="token.props.code" :lang="token.props.lang" /><!--
    --><!-- Inline Code --><code v-else-if="token.type === 'inlineCode'" :class="$style.mfmCode">{{ token.props.code }}</code><!--
    --><!-- Custom Emoji (muted #612) --><span v-else-if="token.type === 'emojiCode' && isEmojiMuted(token.props.name)" class="custom-emoji _emojiMuted" :class="plain ? $style.customEmojiPlain : $style.customEmoji" role="img" :aria-label="`:${token.props.name}:`" :title="i18n.tsx._common.mutedEmoji({ emoji: `:${token.props.name}:` })"></span><!--
    --><!-- Custom Emoji (resolved) --><img v-else-if="token.type === 'emojiCode' && emojiUrls[token.props.name]" :src="proxyEmojiUrl(emojiUrls[token.props.name]!, emojiOriginalSize)" :alt="`:${token.props.name}:`" class="custom-emoji" :class="plain ? $style.customEmojiPlain : $style.customEmoji" decoding="async" loading="lazy" @error="onCustomEmojiImgError" /><!--
    --><!-- Custom Emoji (unresolved — show fallback icon) --><img v-else-if="token.type === 'emojiCode'" src="/emoji-unknown.svg" :alt="`:${token.props.name}:`" :title="`:${token.props.name}:`" class="custom-emoji" :class="plain ? $style.customEmojiPlain : $style.customEmoji" /><!--
    --><!-- Unicode Emoji --><MkEmoji v-else-if="token.type === 'unicodeEmoji'" :emoji="token.props.emoji" class="twemoji" :class="$style.twemoji" /><!--
    --><!-- MFM Function: ruby --><ruby v-else-if="token.type === 'fn' && token.props.name === 'ruby'"><MkMfm :tokens="rubyParts(token).base" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /><rp>(</rp><rt>{{ rubyParts(token).rt }}</rt><rp>)</rp></ruby><!--
    --><!-- MFM Function: unixtime --><time v-else-if="token.type === 'fn' && token.props.name === 'unixtime'" :datetime="unixtimeISO(token)" :class="$style.mfmUnixtime"><i class="ti ti-clock" :class="$style.mfmUnixtimeIcon"></i>{{ unixtimeDisplay(token) }}</time><!--
    --><!-- MFM Function: clickable (本家の clickEv) --><span v-else-if="token.type === 'fn' && token.props.name === 'clickable'" :class="$style.mfmClickable" @click.stop.prevent="emit('clickEv', clickableEv(token))"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /></span><!--
    --><!-- MFM Function: sparkle (粒子) --><MkSparkle v-else-if="token.type === 'fn' && token.props.name === 'sparkle' && animatedMfm"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /></MkSparkle><!--
    --><!-- MFM Function: known --><span v-else-if="token.type === 'fn' && isFnKnown(token)" :class="[fnClass(token), fnZoomClass(token)]" :style="fnStyle(token)"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="childScale(token)" /></span><!--
    --><!-- MFM Function: unknown → 本家と同じく原文のまま --><span v-else-if="token.type === 'fn'">$[{{ token.props.name }} <MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" />]</span><!--
    --><!-- Small --><small v-else-if="token.type === 'small'" :class="$style.mfmSmall"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /></small><!--
    --><!-- Center --><span v-else-if="token.type === 'center'" :class="$style.mfmCenter"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /></span><!--
    --><!-- Plain --><span v-else-if="token.type === 'plain'">{{ plainText(token) }}</span><!--
    --><!-- Quote --><blockquote v-else-if="token.type === 'quote'" :class="$style.mfmQuote"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /></blockquote><!--
    --><!-- Search --><div v-else-if="token.type === 'search'" :class="$style.mfmSearch"><input :class="$style.mfmSearchInput" type="text" :value="token.props.query" readonly /><button :class="$style.mfmSearchButton" @click.stop="openSafeUrl(`https://www.google.com/search?q=${encodeURIComponent(token.props.query)}`)">{{ i18n.ts._mkMfm.search }}</button></div><!--
    --><!-- Math Inline --><span v-else-if="token.type === 'mathInline'" :class="$style.mfmMath" v-html="renderKatex(token.props.formula, false)"></span><!--
    --><!-- Math Block --><div v-else-if="token.type === 'mathBlock'" :class="$style.mfmMathBlock" v-html="renderKatex(token.props.formula, true)"></div><!--
    --><!-- Heading (Markdown 拡張) --><h1 v-else-if="token.type === 'heading' && token.props.level === 1" :class="[$style.mfmHeading, $style.mfmHeading1]"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /></h1><!--
    --><h2 v-else-if="token.type === 'heading' && token.props.level === 2" :class="[$style.mfmHeading, $style.mfmHeading2]"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /></h2><!--
    --><h3 v-else-if="token.type === 'heading' && token.props.level === 3" :class="[$style.mfmHeading, $style.mfmHeading3]"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /></h3><!--
    --><h4 v-else-if="token.type === 'heading' && token.props.level === 4" :class="[$style.mfmHeading, $style.mfmHeading4]"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /></h4><!--
    --><h5 v-else-if="token.type === 'heading' && token.props.level === 5" :class="[$style.mfmHeading, $style.mfmHeading5]"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /></h5><!--
    --><h6 v-else-if="token.type === 'heading'" :class="[$style.mfmHeading, $style.mfmHeading6]"><MkMfm :tokens="token.children" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /></h6><!--
    --><!-- List (Markdown 拡張、ordered) --><ol v-else-if="token.type === 'list' && token.props.ordered" :class="$style.mfmList"><li v-for="(item, j) in token.props.items" :key="j"><MkMfm :tokens="item" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /></li></ol><!--
    --><!-- List (Markdown 拡張、unordered) --><ul v-else-if="token.type === 'list'" :class="$style.mfmList"><li v-for="(item, j) in token.props.items" :key="j"><MkMfm :tokens="item" :emojis="emojis" :reaction-emojis="reactionEmojis" :server-host="serverHost" :my-username="myUsername" :my-host="myHost" @mention-click="(u, h) => emit('mentionClick', u, h)" @mention-hover="(e, u, h) => emit('mentionHover', e, u, h)" @mention-leave="emit('mentionLeave')" @memo-link-click="(id) => emit('memoLinkClick', id)" @click-ev="(ev) => emit('clickEv', ev)" :scale="currentScale" /></li></ul><!--
    --><!-- Text --><template v-else-if="token.type === 'text'">{{ token.props.text }}</template><!--
  --></template></span>
</template>

<style lang="scss" module>
.mfm {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

/* 1 行に収める (nowrap prop、#1279)。入れ子の MkMfm も同じモジュールのクラスを
   持つので、根から子孫ごと畳める */
.mfmNowrap {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* $[x3] などで行が伸びないよう 1 行の高さで切る (line-height と同じ) */
  max-height: 1.5em;

  .mfm {
    white-space: inherit;
  }

  :is(div, blockquote, pre, h1, h2, h3, h4, h5, h6, ol, ul, li),
  .mfmCenter,
  .mfmQuote,
  .mfmSearch,
  .mfmMathBlock {
    display: inline;
    margin: 0;
    padding: 0;
    border: none;
  }

  /* カスタム絵文字は文字の高さにそろえる (本家の plain と同じ大きさ) */
  .customEmoji {
    height: 1.25em;
    min-width: 1.25em;
    vertical-align: -0.25em;
  }
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
  font-weight: var(--nd-weight-bold);

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
  font-family: var(--nd-font-mono);
  font-size: var(--nd-font-body);
  padding: 2px 6px;
  border-radius: var(--nd-radius-xs);
  background: var(--nd-inlineCodeBg, rgba(0, 0, 0, 0.15));
  color: var(--nd-inlineCodeFg, var(--nd-fg));
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
  /* ロード前の intrinsic 0 幅 → 実幅への拡大で行が再ラップするのを軽減
     (.customEmoji の min-width: 2em と同趣旨。正方形ぶんは先に予約する) */
  min-width: 1.25em;
  vertical-align: -0.25em;
  object-fit: contain;
}

.twemoji {
  height: 1.25em;
  /* width 属性 (20px) を上書きし、幅を高さ=font-size に追従させる。
     これがないと MFM の $[x2]/$[x3]/$[x4] で絵文字が拡大されない。 */
  width: auto;
  vertical-align: -0.25em;
  object-fit: contain;
}

/* Small */
.mfmItalic {
  font-style: oblique;
}

.mfmSmall {
  font-size: var(--nd-font-sm);
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
  border-left: 3px solid var(--nd-divider);
  color: var(--nd-fg-muted, var(--nd-fg));
  opacity: 0.85;
}

/* Markdown 拡張: heading (memo 用 opt-in) */
.mfmHeading {
  display: block;
  margin: 0.6em 0 0.3em;
  font-weight: var(--nd-weight-bold);
  line-height: 1.25;
  color: var(--nd-fgHighlighted, var(--nd-fg));
}
.mfmHeading1 { font-size: 1.6em; }
.mfmHeading2 { font-size: var(--nd-font-2xl); }
.mfmHeading3 { font-size: var(--nd-font-xl); }
.mfmHeading4 { font-size: var(--nd-font-lg); }
.mfmHeading5 { font-size: var(--nd-font-body); opacity: 0.9; }
.mfmHeading6 { font-size: var(--nd-font-md); opacity: 0.8; }

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
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg-secondary, rgba(0, 0, 0, 0.05));
  color: var(--nd-fg);
  font-size: var(--nd-font-body);
}

.mfmSearchButton {
  padding: 6px 16px;
  border: none;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-accent);
  color: #fff;
  cursor: pointer;
  font-size: var(--nd-font-body);
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
  border-radius: var(--nd-radius-md);

  :global(.katex-display) {
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

/* keyframes の名前はクラス名と camelCase で衝突させない。CSS Modules は @keyframes も
   export するので、`@keyframes mfm-spin` と `.mfmSpin` が同じキー `mfmSpin` になり、
   クラスの方が keyframes 名で上書きされて (= クラスが当たらず) アニメーションが
   丸ごと死んでいた (#1083)。tests/lint/cssModuleKeyframes.test.ts が検査する。
   値は本家 packages/frontend/src/style.scss の同名 keyframes に揃える */

/* Spin */
@keyframes kf-mfm-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
@keyframes kf-mfm-spinX {
  0% { transform: perspective(128px) rotateX(0deg); }
  100% { transform: perspective(128px) rotateX(360deg); }
}
@keyframes kf-mfm-spinY {
  0% { transform: perspective(128px) rotateY(0deg); }
  100% { transform: perspective(128px) rotateY(360deg); }
}
.mfmSpin { display: inline-block; animation: kf-mfm-spin 1.5s linear infinite; }
.mfmSpinLeft { display: inline-block; animation: kf-mfm-spin 1.5s linear infinite reverse; }
.mfmSpinAlternate { display: inline-block; animation: kf-mfm-spin 1.5s linear infinite alternate; }
.mfmSpinX { display: inline-block; animation: kf-mfm-spinX 1.5s linear infinite; }
.mfmSpinXLeft { display: inline-block; animation: kf-mfm-spinX 1.5s linear infinite reverse; }
.mfmSpinXAlternate { display: inline-block; animation: kf-mfm-spinX 1.5s linear infinite alternate; }
.mfmSpinY { display: inline-block; animation: kf-mfm-spinY 1.5s linear infinite; }
.mfmSpinYLeft { display: inline-block; animation: kf-mfm-spinY 1.5s linear infinite reverse; }
.mfmSpinYAlternate { display: inline-block; animation: kf-mfm-spinY 1.5s linear infinite alternate; }

/* Shake (本家 mfm-shake) */
@keyframes kf-mfm-shake {
  0% { transform: translate(-3px, -1px) rotate(-8deg); }
  5% { transform: translate(0px, -1px) rotate(-10deg); }
  10% { transform: translate(1px, -3px) rotate(0deg); }
  15% { transform: translate(1px, 1px) rotate(11deg); }
  20% { transform: translate(-2px, 1px) rotate(1deg); }
  25% { transform: translate(-1px, -2px) rotate(-2deg); }
  30% { transform: translate(-1px, 2px) rotate(-3deg); }
  35% { transform: translate(2px, 1px) rotate(6deg); }
  40% { transform: translate(-2px, -3px) rotate(-9deg); }
  45% { transform: translate(0px, -1px) rotate(-12deg); }
  50% { transform: translate(1px, 2px) rotate(10deg); }
  55% { transform: translate(0px, -3px) rotate(8deg); }
  60% { transform: translate(1px, -1px) rotate(8deg); }
  65% { transform: translate(0px, -1px) rotate(-7deg); }
  70% { transform: translate(-1px, -3px) rotate(6deg); }
  75% { transform: translate(0px, -2px) rotate(4deg); }
  80% { transform: translate(-2px, -1px) rotate(3deg); }
  85% { transform: translate(1px, -3px) rotate(-10deg); }
  90% { transform: translate(1px, 0px) rotate(3deg); }
  95% { transform: translate(-2px, 0px) rotate(-3deg); }
  100% { transform: translate(2px, 1px) rotate(2deg); }
}
.mfmShake { display: inline-block; animation: kf-mfm-shake 0.5s ease infinite; }

/* Bounce (本家 mfm-bounce) */
@keyframes kf-mfm-bounce {
  0% { transform: translateY(0) scale(1, 1); }
  25% { transform: translateY(-16px) scale(1, 1); }
  50% { transform: translateY(0) scale(1, 1); }
  75% { transform: translateY(0) scale(1.5, 0.75); }
  100% { transform: translateY(0) scale(1, 1); }
}
.mfmBounce { display: inline-block; animation: kf-mfm-bounce 0.75s linear infinite; transform-origin: center bottom; }

/* Jelly (本家 mfm-rubberBand) */
@keyframes kf-mfm-jelly {
  from { transform: scale3d(1, 1, 1); }
  30% { transform: scale3d(1.25, 0.75, 1); }
  40% { transform: scale3d(0.75, 1.25, 1); }
  50% { transform: scale3d(1.15, 0.85, 1); }
  65% { transform: scale3d(0.95, 1.05, 1); }
  75% { transform: scale3d(1.05, 0.95, 1); }
  to { transform: scale3d(1, 1, 1); }
}
.mfmJelly { display: inline-block; animation: kf-mfm-jelly 1s linear infinite both; }

/* Tada (本家 global-tada) */
@keyframes kf-mfm-tada {
  from { transform: scale3d(1, 1, 1); }
  10%, 20% { transform: scale3d(0.91, 0.91, 0.91) rotate3d(0, 0, 1, -2deg); }
  30%, 70% { transform: scale3d(1.09, 1.09, 1.09) rotate3d(0, 0, 1, 2deg); }
  50%, 90% { transform: scale3d(1.09, 1.09, 1.09) rotate3d(0, 0, 1, -2deg); }
  to { transform: scale3d(1, 1, 1); }
}
.mfmTada { display: inline-block; font-size: 150%; animation: kf-mfm-tada 1s linear infinite both; }
/* アニメーションを切っても文字の大きさは本家と同じく 150% のまま */
.mfmTadaStatic { font-size: 150%; }

/* Jump (本家 mfm-jump) */
@keyframes kf-mfm-jump {
  0% { transform: translateY(0); }
  25% { transform: translateY(-16px); }
  50% { transform: translateY(0); }
  75% { transform: translateY(-8px); }
  100% { transform: translateY(0); }
}
.mfmJump { display: inline-block; animation: kf-mfm-jump 0.75s linear infinite; }

/* Twitch (本家 mfm-twitch) */
@keyframes kf-mfm-twitch {
  0% { transform: translate(7px, -2px); }
  5% { transform: translate(-3px, 1px); }
  10% { transform: translate(-7px, -1px); }
  15% { transform: translate(0px, -1px); }
  20% { transform: translate(-8px, 6px); }
  25% { transform: translate(-4px, -3px); }
  30% { transform: translate(-4px, -6px); }
  35% { transform: translate(-8px, -8px); }
  40% { transform: translate(4px, 6px); }
  45% { transform: translate(-3px, 1px); }
  50% { transform: translate(2px, -10px); }
  55% { transform: translate(-7px, 0px); }
  60% { transform: translate(-2px, 4px); }
  65% { transform: translate(3px, -8px); }
  70% { transform: translate(6px, 7px); }
  75% { transform: translate(-7px, -2px); }
  80% { transform: translate(-7px, -8px); }
  85% { transform: translate(9px, 3px); }
  90% { transform: translate(-3px, -2px); }
  95% { transform: translate(-10px, 2px); }
  100% { transform: translate(-2px, -6px); }
}
.mfmTwitch { display: inline-block; animation: kf-mfm-twitch 0.5s ease infinite; }

/* Rainbow — 本家と同じく filter: hue-rotate で回す。color のアニメは毎フレーム
   テキストの再ペイントになるが、filter は合成で済む。hue-rotate は無彩色を
   動かさないので、起点の色を赤に固定してから回す (中の絵文字も色が回るのは本家と同じ)。
   純色の赤から回すと緑〜青緑が暗く沈むので、少し明るい赤 + saturate で持ち上げる */
@keyframes kf-mfm-rainbow {
  from { filter: hue-rotate(0deg) saturate(150%); }
  to { filter: hue-rotate(360deg) saturate(150%); }
}
.mfmRainbow { color: #ff4d4d; animation: kf-mfm-rainbow 1s linear infinite; }

/* アニメーションを切ったときの rainbow (本家 _mfm_rainbow_fallback_) */
.mfmRainbowStatic {
  background-image: linear-gradient(to right, rgb(255, 0, 0) 0%, rgb(255, 165, 0) 17%, rgb(255, 255, 0) 33%, rgb(0, 255, 0) 50%, rgb(0, 255, 255) 67%, rgb(0, 0, 255) 83%, rgb(255, 0, 255) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.mfmClickable {
  user-select: none;
}

/* unixtime は本家と同じ丸いピル */
.mfmUnixtime {
  display: inline-block;
  font-size: 90%;
  border: solid 1px var(--nd-divider);
  border-radius: var(--nd-radius-full);
  padding: 4px 10px 4px 6px;
  font-variant-numeric: tabular-nums;
}
.mfmUnixtimeIcon {
  margin-right: 0.25em;
}

/* 画面外の行では止める。親 (MkNote の .offscreen) が継承する CSS 変数で指示する。
   animation の shorthand は play-state を running に戻すので、各定義の後に置く */
.mfmSpin, .mfmSpinLeft, .mfmSpinAlternate,
.mfmSpinX, .mfmSpinXLeft, .mfmSpinXAlternate,
.mfmSpinY, .mfmSpinYLeft, .mfmSpinYAlternate,
.mfmShake, .mfmBounce, .mfmJelly, .mfmTada, .mfmJump, .mfmTwitch,
.mfmRainbow {
  animation-play-state: var(--nd-mfm-play-state, running);
}
</style>

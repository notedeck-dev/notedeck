<script setup lang="ts">
// 統一ツールチップ (#704 C)。native title 依存 (約 240 箇所) を個別改修せずに
// 置き換えるため、document へのイベント委譲で `title` 属性を拾って表示する。
// 初回ホバー時に title を data-nd-tip へ退避して OS 標準ツールチップを抑止する
// (Vue の :title バインドは値が変わった再レンダで復活するが、次のホバーで再退避される)。
import { onMounted, onUnmounted, ref } from 'vue'

const visible = ref(false)
const text = ref('')
const x = ref(0)
const y = ref(0)
const below = ref(false)

// タッチ環境はホバーが無いので何もしない (native title も出ないため現状維持)
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches
const SHOW_DELAY = 350

let showTimer: ReturnType<typeof setTimeout> | null = null
let currentEl: HTMLElement | null = null

function findTipEl(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  return target.closest<HTMLElement>('[title], [data-nd-tip]')
}

function hide() {
  if (showTimer) {
    clearTimeout(showTimer)
    showTimer = null
  }
  visible.value = false
  currentEl = null
}

function positionFor(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  x.value = Math.min(Math.max(8, r.left + r.width / 2), window.innerWidth - 8)
  if (r.top < 44) {
    below.value = true
    y.value = r.bottom + 6
  } else {
    below.value = false
    y.value = r.top - 6
  }
}

/** native tooltip 抑止: title → data-nd-tip 退避。退避後の本文を返す */
function stashTip(el: HTMLElement): string | undefined {
  const title = el.getAttribute('title')
  if (title !== null) {
    el.setAttribute('data-nd-tip', title)
    el.removeAttribute('title')
  }
  return el.getAttribute('data-nd-tip')?.trim() || undefined
}

function onMouseOver(e: MouseEvent) {
  const el = findTipEl(e.target)
  if (!el) return
  if (el === currentEl) return
  hide()
  currentEl = el

  const tip = stashTip(el)
  if (!tip) {
    currentEl = null
    return
  }
  showTimer = setTimeout(() => {
    if (!currentEl?.isConnected) return
    positionFor(currentEl)
    text.value = tip
    visible.value = true
  }, SHOW_DELAY)
}

function onMouseOut(e: MouseEvent) {
  if (!currentEl) return
  const related = e.relatedTarget
  if (related instanceof Node && currentEl.contains(related)) return
  const from = e.target
  if (from instanceof Node && currentEl.contains(from)) hide()
}

/**
 * キーボードでフォーカスが載ったときも同じ tooltip を出す。
 * これが無いと `title` 依存の説明 (アプリ全体で 300 箇所超) が
 * キーボード利用者にだけ届かない。
 *
 * 遅延はホバーと分ける: ホバーは「たまたま通過した」可能性があるので待つが、
 * フォーカスは明示的な到達なので 0ms で出す。
 */
function onFocusIn(e: FocusEvent) {
  const target = e.target
  // ポインタ由来のフォーカスはホバー側が担当するので :focus-visible に限る
  if (!(target instanceof HTMLElement) || !target.matches(':focus-visible'))
    return
  const el = findTipEl(target)
  if (!el) return
  hide()
  const tip = stashTip(el)
  if (!tip) return
  currentEl = el
  positionFor(el)
  text.value = tip
  visible.value = true
}

function onFocusOut() {
  if (visible.value || showTimer) hide()
}

// クリック (状態が変わる) / スクロール / キー操作では即座に消す
function onDocEvent() {
  if (visible.value || showTimer) hide()
}

onMounted(() => {
  // フォーカス経路はポインタの有無と無関係なので touch 環境でも張る
  document.addEventListener('focusin', onFocusIn, { passive: true })
  document.addEventListener('focusout', onFocusOut, { passive: true })
  if (IS_TOUCH) return
  document.addEventListener('mouseover', onMouseOver, { passive: true })
  document.addEventListener('mouseout', onMouseOut, { passive: true })
  document.addEventListener('click', onDocEvent, true)
  document.addEventListener('scroll', onDocEvent, {
    capture: true,
    passive: true,
  })
  document.addEventListener('keydown', onDocEvent, true)
})

onUnmounted(() => {
  document.removeEventListener('focusin', onFocusIn)
  document.removeEventListener('focusout', onFocusOut)
  if (IS_TOUCH) return
  document.removeEventListener('mouseover', onMouseOver)
  document.removeEventListener('mouseout', onMouseOut)
  document.removeEventListener('click', onDocEvent, true)
  document.removeEventListener('scroll', onDocEvent, true)
  document.removeEventListener('keydown', onDocEvent, true)
})
</script>

<template>
  <div
    v-if="visible"
    :class="[$style.tooltip, below && $style.below]"
    :style="{ left: `${x}px`, top: `${y}px` }"
    role="tooltip"
  >
    {{ text }}
  </div>
</template>

<style lang="scss" module>
.tooltip {
  position: fixed;
  z-index: var(--nd-z-toast);
  translate: -50% -100%;
  max-width: 280px;
  padding: 4px 8px;
  border-radius: var(--nd-radius-sm);
  background: color-mix(in srgb, var(--nd-panel) 96%, #fff);
  color: var(--nd-fg);
  box-shadow: 0 2px 8px var(--nd-shadow);
  border: 1px solid var(--nd-divider);
  font-size: 0.75em;
  line-height: 1.4;
  white-space: pre-line;
  overflow-wrap: break-word;
  pointer-events: none;
  animation: tooltip-in var(--nd-duration-base) var(--nd-ease-slide) both;
}

.below {
  translate: -50% 0;
}

@keyframes tooltip-in {
  from {
    opacity: 0;
  }
}
</style>

<script setup lang="ts">
/**
 * デッキの上に浮かぶペット (#1080)。
 *
 * AI 活動の集約状態 (useAiActivity) をそのまま表示する。コマ送りは
 * petdex desktop と同じ固定表 (services/petSprite)。ドラッグで位置を変えられ、
 * 動かした向きで running-left / right になる。省電力 (#931) とウィンドウ非表示
 * の間は 1 コマ目で止める。
 *
 * コンパクト (スマホ幅) では下端の基準をモバイルナビの上端に置く
 * (`--nd-mobileNavHeight`、DeckMobileNav が body に公開)。位置未設定なら
 * FAB (右下) の上に載せる。
 *
 * 当たり判定は矩形ではなく、状態ごとの不透明領域 (Rust が作るマスク) を
 * clip-path にして切り抜く。透過部のクリック・タップ・スクロールは下の
 * デッキに届く。マスクが無い / path() 非対応なら矩形のまま。
 */
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import {
  clampPetScale,
  PET_COLUMNS,
  PET_FRAME_HEIGHT,
  PET_FRAME_WIDTH,
  type PetState,
  petFrames,
  petHitClipPath,
  petStateRow,
} from '@/services/petSprite'
import { useAiActivity } from '@/stores/aiActivity'
import { usePetStore } from '@/stores/pet'
import { useSettingsStore } from '@/stores/settings'
import { useSystemStateStore } from '@/stores/systemState'
import { useIsCompactLayout } from '@/stores/ui'

const DEFAULT_MARGIN = 16
/** コンパクト時の既定の下端。DeckLayout の FAB (56px, ナビ上 12px) を避ける */
const COMPACT_DEFAULT_BOTTOM = 12 + 56 + 12
const DRAG_THRESHOLD = 4

const pet = usePetStore()
const settings = useSettingsStore()
const systemState = useSystemStateStore()
const isCompact = useIsCompactLayout()
const { petState, pulse } = useAiActivity()

const visible = computed(() => pet.spriteUrl !== null && pet.info !== null)

// ── 大きさ (アピアランス設定のスライダー) ──
const scale = computed(() => clampPetScale(settings.get('pet.scale')))
const cellW = computed(() => Math.round(PET_FRAME_WIDTH * scale.value))
const cellH = computed(() => Math.round(PET_FRAME_HEIGHT * scale.value))

// ── 位置 ──
// bottom はモバイルナビの上端からの距離 (デスクトップではナビ高 0 = 画面下端)
const defaultBottom = () =>
  isCompact.value ? COMPACT_DEFAULT_BOTTOM : DEFAULT_MARGIN
const right = ref(settings.get('pet.right') ?? DEFAULT_MARGIN)
const bottom = ref(settings.get('pet.bottom') ?? defaultBottom())
// コードタブ・外部エディタ・別ウィンドウからの変更も位置に反映する
watch(
  () => [settings.get('pet.right'), settings.get('pet.bottom')] as const,
  ([nextRight, nextBottom]) => {
    right.value = nextRight ?? DEFAULT_MARGIN
    bottom.value = nextBottom ?? defaultBottom()
    clamp()
  },
)

function mobileNavHeight(): number {
  return (
    Number.parseFloat(
      document.body.style.getPropertyValue('--nd-mobileNavHeight'),
    ) || 0
  )
}

function clamp(): void {
  right.value = Math.min(
    Math.max(0, right.value),
    Math.max(0, window.innerWidth - cellW.value),
  )
  bottom.value = Math.min(
    Math.max(0, bottom.value),
    Math.max(0, window.innerHeight - mobileNavHeight() - cellH.value),
  )
}
clamp()
watch(scale, clamp)
// ナビの高さは DeckMobileNav のマウント後に決まるので 1 tick 待つ。
// 初回からコンパクトな場合も同じで、初期化時の clamp はナビ高 0 で走っている
watch(
  isCompact,
  () => {
    if (settings.get('pet.bottom') === undefined) bottom.value = defaultBottom()
    void nextTick(clamp)
  },
  { immediate: true },
)
window.addEventListener('resize', clamp)
onScopeDispose(() => window.removeEventListener('resize', clamp))

// ── ドラッグ ──
const dragging = ref(false)
const dragDir = ref<'running-left' | 'running-right'>('running-right')
let dragStart: { x: number; y: number; right: number; bottom: number } | null =
  null
let moved = false

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  dragStart = {
    x: e.clientX,
    y: e.clientY,
    right: right.value,
    bottom: bottom.value,
  }
  moved = false
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!dragStart) return
  const dx = e.clientX - dragStart.x
  const dy = e.clientY - dragStart.y
  if (
    !moved &&
    Math.abs(dx) < DRAG_THRESHOLD &&
    Math.abs(dy) < DRAG_THRESHOLD
  ) {
    return
  }
  moved = true
  dragging.value = true
  if (dx !== 0) dragDir.value = dx < 0 ? 'running-left' : 'running-right'
  right.value = dragStart.right - dx
  bottom.value = dragStart.bottom - dy
  clamp()
}

function onPointerUp() {
  if (!dragStart) return
  dragStart = null
  if (moved) {
    dragging.value = false
    settings.set('pet.right', right.value)
    settings.set('pet.bottom', bottom.value)
  } else {
    // 触ると手を振る
    pulse('waving')
  }
}

// ── コマ送り ──
const displayState = computed<PetState>(() =>
  dragging.value ? dragDir.value : petState.value,
)
const frozen = computed(
  () => systemState.adaptation.staticEmoji || hidden.value,
)
const hidden = ref(document.visibilityState === 'hidden')
function onVisibility() {
  hidden.value = document.visibilityState === 'hidden'
}
document.addEventListener('visibilitychange', onVisibility)
onScopeDispose(() =>
  document.removeEventListener('visibilitychange', onVisibility),
)

const frameIndex = ref(0)
let frameTimer: ReturnType<typeof setTimeout> | null = null

function stopFrames() {
  if (frameTimer) clearTimeout(frameTimer)
  frameTimer = null
}

function scheduleFrame(state: PetState) {
  const frames = petFrames(state)
  const frame = frames[frameIndex.value % frames.length]
  if (!frame) return
  frameTimer = setTimeout(() => {
    frameIndex.value = (frameIndex.value + 1) % frames.length
    scheduleFrame(state)
  }, frame.durationMs)
}

watch(
  [displayState, frozen, visible],
  ([state, isFrozen, isVisible]) => {
    stopFrames()
    frameIndex.value = 0
    if (!isVisible || isFrozen) return
    scheduleFrame(state)
  },
  { immediate: true },
)
onScopeDispose(stopFrames)

// ── 当たり判定 ──
const clipSupported =
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('clip-path', 'path("M0 0h1v1z")')
const clipPath = computed(() => {
  if (!clipSupported || !pet.hitMask) return undefined
  return (
    petHitClipPath(
      pet.hitMask,
      petStateRow(displayState.value),
      cellW.value,
      cellH.value,
    ) ?? undefined
  )
})

const spriteStyle = computed(() => {
  const info = pet.info
  if (!info || !pet.spriteUrl) return undefined
  const frames = petFrames(displayState.value)
  const col = frames[frameIndex.value % frames.length]?.col ?? 0
  const row = petStateRow(displayState.value)
  return {
    right: `${right.value}px`,
    '--pet-bottom': `${bottom.value}px`,
    '--pet-clip': clipPath.value,
    width: `${cellW.value}px`,
    height: `${cellH.value}px`,
    backgroundImage: `url("${pet.spriteUrl}")`,
    backgroundSize: `${PET_COLUMNS * cellW.value}px ${info.rows * cellH.value}px`,
    backgroundPosition: `${-col * cellW.value}px ${-row * cellH.value}px`,
  }
})
</script>

<template>
  <div
    v-if="visible"
    :class="[$style.pet, dragging && $style.dragging]"
    :style="spriteStyle"
    :title="pet.info?.displayName"
    role="img"
    :aria-label="pet.info?.displayName"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  />
</template>

<style module lang="scss">
.pet {
  position: fixed;
  // 下端はモバイルナビの上端基準 (デスクトップではナビ高 0)
  bottom: calc(var(--pet-bottom, 16px) + var(--nd-mobileNavHeight, 0px));
  // 当たり判定 = 不透明領域 (透明側に膨らませたブロック)。描画も切るので
  // box-shadow / outline のような要素外周の装飾はここでは使えない
  clip-path: var(--pet-clip, none);
  z-index: var(--nd-z-popup);
  background-repeat: no-repeat;
  image-rendering: auto;
  cursor: grab;
  user-select: none;
  touch-action: none;
  // 位置は translate ではなく right/bottom で持つ (ドラッグ中も同じ座標系)
}

.dragging {
  cursor: grabbing;
}
</style>

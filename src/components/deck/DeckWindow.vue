<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useSpotlightStore, windowTargetId } from '@/composables/useSpotlight'
import { provideWindowEditAction } from '@/composables/useWindowEditAction'
import { provideWindowExternalFile } from '@/composables/useWindowExternalFile'
import { provideWindowExternalLink } from '@/composables/useWindowExternalLink'
import { useIsCompactLayout } from '@/stores/ui'
import {
  type DeckWindow,
  useWindowsStore,
  WINDOW_MIN_SIZE,
  WINDOW_SIZES,
} from '@/stores/windows'
import { isTauri, openSettingsFileInEditor } from '@/utils/settingsFs'
import { openSafeUrl } from '@/utils/url'
import { WINDOW_LABELS } from './windowLabels'

const props = defineProps<{
  window: DeckWindow
  themeVars?: Record<string, string>
  /** 閉じアニメーション中 (DeckWindowLayer の leave 遅延で DOM がまだ残っている間) */
  closing?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const windowsStore = useWindowsStore()
const spotlightStore = useSpotlightStore()

const isSpotlighted = computed(() =>
  spotlightStore.spotlights.has(windowTargetId(props.window.id)),
)
const isCompact = useIsCompactLayout()
const baseSize = computed(() => WINDOW_SIZES[props.window.type])

// ヘッダー右側「外部エディタで開く」ボタン — 中身のコンポーネントが登録する
const externalFile = provideWindowExternalFile()
async function openExternalFile() {
  const t = externalFile.value
  if (!t || t.disabled) return
  try {
    await openSettingsFileInEditor(t.name, t.subdir)
  } catch (e) {
    console.warn('[DeckWindow] openExternalFile failed:', e)
  }
}

// ヘッダー右側「外部ブラウザで開く」ボタン
const externalLink = provideWindowExternalLink()
async function openExternalLink() {
  const t = externalLink.value
  if (!t || t.disabled) return
  try {
    await openSafeUrl(t.url)
  } catch (e) {
    console.warn('[DeckWindow] openExternalLink failed:', e)
  }
}

// ヘッダー右側「編集」ボタン — 中身のコンポーネントが登録する
const editAction = provideWindowEditAction()
function runEditAction() {
  const t = editAction.value
  if (!t || t.disabled) return
  try {
    t.onClick()
  } catch (e) {
    console.warn('[DeckWindow] editAction failed:', e)
  }
}

const windowTitle = computed(() => {
  const base = WINDOW_LABELS[props.window.type] ?? ''
  if (props.window.type === 'follow-list' && props.window.props.username) {
    return `@${props.window.props.username} のフォロー / フォロワー`
  }
  return base
})

const icons: Record<string, string> = {
  'note-detail': 'ti ti-note',
  'note-inspector': 'ti ti-code',
  'notification-inspector': 'ti ti-code',
  'user-profile': 'ti ti-user',
  'federation-instance': 'ti ti-planet',
  'follow-list': 'ti ti-users',
  login: 'ti ti-login-2',
  search: 'ti ti-search',
  notifications: 'ti ti-bell',
  plugins: 'ti ti-plug',
  keybinds: 'ti ti-keyboard',
  cssEditor: 'ti ti-code',
  themeEditor: 'ti ti-palette',
  profileEditor: 'ti ti-layout-columns',
  ai: 'ti ti-brain',
  aiSettings: 'ti ti-robot',
  permissions: 'ti ti-shield-lock',
  chat: 'ti ti-messages',
  about: 'ti ti-info-circle',
  navEditor: 'ti ti-layout-sidebar-left-collapse',
  performanceEditor: 'ti ti-gauge',
  appearanceEditor: 'ti ti-brush',
  backup: 'ti ti-package-export',
  cacheEditor: 'ti ti-eraser',
  tasksEditor: 'ti ti-player-play',
  snippetsEditor: 'ti ti-code-plus',
  memoEditor: 'ti ti-notes',
  'page-detail': 'ti ti-note',
  'play-detail': 'ti ti-player-play',
  'gallery-detail': 'ti ti-icons',
  'list-detail': 'ti ti-list',
  'clip-detail': 'ti ti-paperclip',
  'drive-file-detail': 'ti ti-file',
  'page-edit': 'ti ti-pencil',
  'play-edit': 'ti ti-pencil',
  'widget-edit': 'ti ti-layout-dashboard',
  'skill-edit': 'ti ti-sparkles',
  connections: 'ti ti-plug-connected',
  connectionEdit: 'ti ti-plug-connected',
  tutorial: 'ti ti-presentation-analytics',
}

const isMinimized = computed(() => props.window.minimized)
const isMaximized = computed(() => props.window.maximized)

// --- Drag (move) ---
const isDragging = ref(false)
const dragX = ref(0)
const dragY = ref(0)
let dragStartX = 0
let dragStartY = 0
let dragStartWinX = 0
let dragStartWinY = 0

// --- Resize (8-direction) ---
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const isResizing = ref(false)
const resizeX = ref(0)
const resizeY = ref(0)
const resizeW = ref(0)
const resizeH = ref(0)
let resizeDir: ResizeDir = 'se'
let rsStartX = 0
let rsStartY = 0
let rsStartWinX = 0
let rsStartWinY = 0
let rsStartWinW = 0
let rsStartWinH = 0

const winWidth = computed(() => {
  if (isResizing.value) return resizeW.value
  return props.window.width ?? baseSize.value.width
})
const winHeight = computed(() => {
  if (isResizing.value) return resizeH.value
  return props.window.height ?? baseSize.value.maxHeight
})
// ユーザーが一度でもリサイズしたら height を固定する。それまでは max-height で内容に追従。
const isUserSized = computed(
  () => isResizing.value || props.window.height !== undefined,
)
const winX = computed(() => {
  if (isDragging.value) return dragX.value
  if (isResizing.value) return resizeX.value
  return props.window.x
})
const winY = computed(() => {
  if (isDragging.value) return dragY.value
  if (isResizing.value) return resizeY.value
  return props.window.y
})

// テンプレートの inline :style 内で computed が auto-unwrap されないケースを避けるため、
// スタイルオブジェクトを明示的に computed として切り出す。
const windowStyle = computed<Record<string, string | number>>(() => {
  if (isMaximized.value) {
    return { ...(props.themeVars ?? {}), zIndex: props.window.zIndex }
  }
  const style: Record<string, string | number> = {
    ...(props.themeVars ?? {}),
    '--nd-win-y': `${winY.value}px`,
    '--nd-win-w': `${winWidth.value}px`,
    '--nd-win-h': `${winHeight.value}px`,
    zIndex: props.window.zIndex,
  }
  // 右上アンカー窓は viewport 右端からの相対配置にする。open() 時点の innerWidth
  // に依存しないため、初回起動の早期表示でも確実に右上へ出る。ドラッグ/リサイズ
  // すると anchor が外れ (updatePosition)、通常の x 配置へ切り替わる。
  if (
    props.window.anchor === 'top-right' &&
    !isDragging.value &&
    !isResizing.value
  ) {
    style['--nd-win-x'] = '0px'
    style.left = 'auto'
    style.right = '32px'
    return style
  }
  style['--nd-win-x'] = `${winX.value}px`
  return style
})

// 右上アンカー窓は描画上 viewport 右端基準で配置される (x は未確定)。掴んだ
// 瞬間に左へジャンプしないよう、現在の見た目上の x を clientWidth から算出する。
function resolveStartX(): number {
  if (props.window.anchor === 'top-right') {
    return Math.max(
      50,
      document.documentElement.clientWidth - winWidth.value - 32,
    )
  }
  return props.window.x
}

function onHeaderPointerDown(e: PointerEvent) {
  if ((e.target as HTMLElement).closest('button')) return
  e.preventDefault()
  // isDragging を立てる前に start 値と dragX/dragY を初期化する。
  // winX/winY computed は isDragging が true のとき dragX/dragY を返すため、
  // 順序を逆にすると一瞬 ref の初期値 (0) が使われて左上にジャンプして見える。
  const startX = resolveStartX()
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragStartWinX = startX
  dragStartWinY = props.window.y
  dragX.value = startX
  dragY.value = props.window.y
  isDragging.value = true
  document.body.style.userSelect = 'none'
  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', onPointerUp)
  windowsStore.bringToFront(props.window.id)
}

function onPointerMove(e: PointerEvent) {
  const dx = e.clientX - dragStartX
  const dy = e.clientY - dragStartY
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  dragX.value = Math.max(
    -winWidth.value + 100,
    Math.min(dragStartWinX + dx, vw - 100),
  )
  dragY.value = Math.max(0, Math.min(dragStartWinY + dy, vh - 50))
}

function onPointerUp() {
  windowsStore.updatePosition(props.window.id, dragX.value, dragY.value)
  isDragging.value = false
  document.body.style.userSelect = ''
  document.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('pointerup', onPointerUp)
  document.removeEventListener('pointercancel', onPointerUp)
}

function onResizePointerDown(dir: ResizeDir, e: PointerEvent) {
  e.preventDefault()
  e.stopPropagation()
  resizeDir = dir
  rsStartX = e.clientX
  rsStartY = e.clientY
  rsStartWinX = resolveStartX()
  rsStartWinY = props.window.y
  // ⚠️ isResizing を true にする前にサイズを読む。
  // winWidth/winHeight computed は isResizing 中は resizeW/resizeH (初期 0) を返すため、
  // 順序を逆にすると start 値が 0 になりリサイズ計算が壊れて左上に飛ぶ。
  rsStartWinW = winWidth.value
  rsStartWinH = winHeight.value
  resizeX.value = rsStartWinX
  resizeY.value = rsStartWinY
  resizeW.value = rsStartWinW
  resizeH.value = rsStartWinH
  isResizing.value = true
  document.body.style.userSelect = 'none'
  document.addEventListener('pointermove', onResizePointerMove)
  document.addEventListener('pointerup', onResizePointerUp)
  document.addEventListener('pointercancel', onResizePointerUp)
  windowsStore.bringToFront(props.window.id)
}

function onResizePointerMove(e: PointerEvent) {
  const dx = e.clientX - rsStartX
  const dy = e.clientY - rsStartY
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  let nx = rsStartWinX
  let ny = rsStartWinY
  let nw = rsStartWinW
  let nh = rsStartWinH

  if (resizeDir.includes('e')) {
    nw = Math.max(WINDOW_MIN_SIZE.width, Math.min(rsStartWinW + dx, vw - nx))
  }
  if (resizeDir.includes('w')) {
    // 左端を動かす: 幅が縮むと x が増える
    const maxW = rsStartWinX + rsStartWinW // 左端を画面外 (x<0) には出さない
    nw = Math.max(WINDOW_MIN_SIZE.width, Math.min(rsStartWinW - dx, maxW))
    nx = rsStartWinX + (rsStartWinW - nw)
  }
  if (resizeDir.includes('s')) {
    nh = Math.max(WINDOW_MIN_SIZE.height, Math.min(rsStartWinH + dy, vh - ny))
  }
  if (resizeDir.includes('n')) {
    const maxH = rsStartWinY + rsStartWinH
    nh = Math.max(WINDOW_MIN_SIZE.height, Math.min(rsStartWinH - dy, maxH))
    ny = rsStartWinY + (rsStartWinH - nh)
  }

  resizeX.value = nx
  resizeY.value = ny
  resizeW.value = nw
  resizeH.value = nh
}

function onResizePointerUp() {
  windowsStore.updatePosition(props.window.id, resizeX.value, resizeY.value)
  windowsStore.updateSize(props.window.id, resizeW.value, resizeH.value)
  isResizing.value = false
  document.body.style.userSelect = ''
  document.removeEventListener('pointermove', onResizePointerMove)
  document.removeEventListener('pointerup', onResizePointerUp)
  document.removeEventListener('pointercancel', onResizePointerUp)
}

function onWindowMouseDown() {
  // spotlight 中なら認識した = 即解除
  spotlightStore.clear(windowTargetId(props.window.id))
  windowsStore.bringToFront(props.window.id)
}

onBeforeUnmount(() => {
  if (isDragging.value) onPointerUp()
  if (isResizing.value) onResizePointerUp()
})
</script>

<template>
  <div
    :class="[$style.deckWindow, { [$style.dragging]: isDragging, [$style.resizing]: isResizing, [$style.userSized]: isUserSized, [$style.minimized]: isMinimized, [$style.maximized]: isMaximized, [$style.mobile]: isCompact, [$style.spotlighted]: isSpotlighted, [$style.closing]: closing }]"
    :style="windowStyle"
    @mousedown="onWindowMouseDown"
  >
    <div :class="$style.windowHeader" @pointerdown="onHeaderPointerDown">
      <i :class="[icons[window.type], $style.windowIcon]" />
      <span :class="$style.windowTitle">{{ windowTitle }}</span>
      <button
        v-if="editAction"
        class="_button"
        :class="$style.windowBtn"
        :disabled="editAction.disabled"
        :title="editAction.title ?? '編集'"
        @click="runEditAction"
      >
        <i :class="`ti ti-${editAction.icon ?? 'pencil'}`" />
      </button>
      <button
        v-if="isTauri && externalLink"
        class="_button"
        :class="$style.windowBtn"
        :disabled="externalLink.disabled"
        :title="externalLink.title ?? 'Web UIで開く'"
        @click="openExternalLink"
      >
        <i :class="`ti ti-${externalLink.icon ?? 'world'}`" />
      </button>
      <button
        v-if="isTauri && externalFile"
        class="_button"
        :class="$style.windowBtn"
        :disabled="externalFile.disabled"
        :title="`OS の既定エディタで ${externalFile.name} を開く`"
        @click="openExternalFile"
      >
        <i class="ti ti-external-link" />
      </button>
      <button class="_button" :class="$style.windowBtn" title="最小化" @click="windowsStore.toggleMinimize(window.id)">
        <i class="ti ti-minus" />
      </button>
      <button class="_button" :class="$style.windowBtn" title="最大化" @click="windowsStore.toggleMaximize(window.id)">
        <i :class="isMaximized ? 'ti ti-picture-in-picture' : 'ti ti-square'" />
      </button>
      <button class="_button" :class="[$style.windowBtn, $style.windowClose]" title="閉じる" @click="emit('close')">
        <i class="ti ti-x" />
      </button>
    </div>
    <div :class="$style.windowBody">
      <slot />
    </div>
    <template v-if="!isMaximized && !isMinimized && !isCompact">
      <div :class="[$style.resizeHandle, $style.handleN]" @pointerdown="onResizePointerDown('n', $event)" />
      <div :class="[$style.resizeHandle, $style.handleS]" @pointerdown="onResizePointerDown('s', $event)" />
      <div :class="[$style.resizeHandle, $style.handleE]" @pointerdown="onResizePointerDown('e', $event)" />
      <div :class="[$style.resizeHandle, $style.handleW]" @pointerdown="onResizePointerDown('w', $event)" />
      <div :class="[$style.resizeHandle, $style.handleNE]" @pointerdown="onResizePointerDown('ne', $event)" />
      <div :class="[$style.resizeHandle, $style.handleNW]" @pointerdown="onResizePointerDown('nw', $event)" />
      <div :class="[$style.resizeHandle, $style.handleSE]" @pointerdown="onResizePointerDown('se', $event)" />
      <div :class="[$style.resizeHandle, $style.handleSW]" @pointerdown="onResizePointerDown('sw', $event)" />
    </template>
  </div>
</template>

<style lang="scss" module>
.deckWindow {
  position: fixed;
  left: 0;
  top: 0;
  translate: var(--nd-win-x, 0) var(--nd-win-y, 0);
  width: var(--nd-win-w, auto);
  max-height: var(--nd-win-h, none);
  display: flex;
  flex-direction: column;
  background: var(--nd-panel);
  border-radius: var(--nd-radius);
  box-shadow: 0 8px 32px var(--nd-shadow);
  // overflow: visible にして 8 方向ハンドルが外側にはみ出せるようにする。
  // 角丸は .windowHeader / .windowBody 側で個別に持たせて見た目を維持。
  // contain: paint を付けると要素境界外の paint と pointer hit が切られて
  // 外側に出したリサイズハンドルが効かなくなるので layout のみに留める。
  overflow: visible;
  contain: layout;
  animation: windowIn 0.2s var(--nd-ease-spring);
}

@keyframes windowIn {
  from { opacity: 0; transform: scale(0.88) translateY(6px); }
}

/* 閉じアニメ: windowIn の逆方向。DeckWindowLayer の leave 遅延中に付与される */
.closing {
  animation: windowOut 0.2s var(--nd-ease-decel) both;
  pointer-events: none;
}

@keyframes windowOut {
  to { opacity: 0; transform: scale(0.92) translateY(4px); }
}

.dragging {
  opacity: 0.92;
  will-change: translate;
}

// AI 操作の可視化 (Spotlight): dispatcher が windows.open / windows.focus
// 成功時に光らせる。塗りつぶしだとウィンドウ内容が読めなくなるので、
// 外周の朱色 glow で「この window が AI 由来で操作された」ことだけ示す。
.spotlighted {
  &::after {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: inherit;
    pointer-events: none;
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--nd-warn) 70%, transparent),
      0 0 24px 8px color-mix(in srgb, var(--nd-warn) 40%, transparent);
    animation: spotlightWindowAppear 2.4s ease-out 1 forwards;
  }

  // モバイルはウィンドウが画面端に張り付くため、外側 (inset:-2px) の光が
  // viewport 外にはみ出て上辺しか見えない。内側に、かつ content
  // (header/body は z-index:1) より前面で、全辺 (上下左右) を光らせる。
  &.mobile::after {
    inset: 0;
    z-index: 4;
    box-shadow:
      inset 0 0 0 2px color-mix(in srgb, var(--nd-warn) 80%, transparent),
      inset 0 0 24px 8px color-mix(in srgb, var(--nd-warn) 35%, transparent);
  }

  @media (prefers-reduced-motion: reduce) {
    &::after {
      animation: none;
      opacity: 1;
    }
  }
}

@keyframes spotlightWindowAppear {
  0%   { opacity: 0; }
  10%  { opacity: 1; }
  85%  { opacity: 1; }
  100% { opacity: 0; }
}

.resizing {
  will-change: width, height, translate;
}

// ユーザーが一度でもリサイズしたら高さを固定する。未リサイズ時は max-height で内容に追従。
.userSized {
  height: var(--nd-win-h, auto);
  max-height: none;
}

.maximized {
  top: var(--nd-app-inset-top, 0px);
  left: 0;
  right: 0;
  bottom: 0;
  width: 100% !important;
  height: auto !important;
  max-height: none !important;
  border-radius: 0;

  .windowHeader {
    border-radius: 0;
  }

  .windowBody {
    border-radius: 0;
  }
}

.minimized {
  .windowBody {
    display: none;
  }

  .windowHeader {
    border-radius: var(--nd-radius);
  }
}

.windowHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 8px 0 16px;
  background: var(--nd-windowHeader);
  backdrop-filter: var(--nd-vibrancy);
  -webkit-backdrop-filter: var(--nd-vibrancy);
  border-bottom: 1px solid var(--nd-divider);
  border-top-left-radius: var(--nd-radius);
  border-top-right-radius: var(--nd-radius);
  cursor: grab;
  flex-shrink: 0;
  user-select: none;
  position: relative;
  z-index: 1;

  .dragging & {
    cursor: grabbing;
  }
}

.windowIcon {
  font-size: 1em;
  opacity: 0.6;
  flex-shrink: 0;
}

.windowTitle {
  flex: 1;
  font-weight: bold;
  font-size: 0.9em;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.windowBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.6;
  flex-shrink: 0;
  transition:
    background var(--nd-duration-fast),
    opacity var(--nd-duration-fast);

  &:hover:not(:disabled) {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
}

.windowClose {
  &:hover {
    color: var(--nd-love);
  }
}

.windowBody {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: text;
  -webkit-user-select: text;
  border-bottom-left-radius: var(--nd-radius);
  border-bottom-right-radius: var(--nd-radius);
  position: relative;
  z-index: 1;
}

// 8 方向リサイズハンドル。.deckWindow を overflow: visible にしてあるので外側に少しはみ出して配置する。
// edge は太さ 6px、corner は 14×14 で、いずれも本体の box-shadow 領域内に収まる。
// pointer 操作のみで色は持たず、cursor の見た目だけでアフォーダンスを示す。
.resizeHandle {
  position: absolute;
  z-index: 5;
  user-select: none;
  touch-action: none;
}

.handleN { top: -3px; left: 14px; right: 14px; height: 6px; cursor: ns-resize; }
.handleS { bottom: -3px; left: 14px; right: 14px; height: 6px; cursor: ns-resize; }
.handleE { right: -3px; top: 14px; bottom: 14px; width: 6px; cursor: ew-resize; }
.handleW { left: -3px; top: 14px; bottom: 14px; width: 6px; cursor: ew-resize; }
.handleNE { top: -3px; right: -3px; width: 14px; height: 14px; cursor: nesw-resize; }
.handleNW { top: -3px; left: -3px; width: 14px; height: 14px; cursor: nwse-resize; }
.handleSE { bottom: -3px; right: -3px; width: 14px; height: 14px; cursor: nwse-resize; }
.handleSW { bottom: -3px; left: -3px; width: 14px; height: 14px; cursor: nesw-resize; }

.mobile {
  left: 0 !important;
  top: var(--nd-app-inset-top, 0px) !important;
  right: 0 !important;
  // ボトムバー (mobile nav) の上端で止め、覆い隠さない。height: auto + top/bottom
  // で高さが決まるので、ウィンドウが画面下まで伸びすぎる問題も同時に解消する。
  bottom: var(--nd-mobileNavHeight, 0px) !important;
  width: 100% !important;
  height: auto !important;
  max-height: none !important;
  translate: none !important;
  border-radius: 0;
  // ウィンドウより navbar (drawer 2001 / overlay 2000) と bottom nav (1999) を
  // 上位にする。ウィンドウを開いていてもナビを開いて操作できるよう、
  // 意味的に正しい window レイヤー (--nd-z-window=1700) に下げる。
  z-index: var(--nd-z-window) !important;

  .windowBtn {
    width: 44px;
    height: 44px;
  }
}
</style>

import { computed, onUnmounted, type Ref, ref, watch } from 'vue'

const MIN_SCALE = 1
const MAX_SCALE = 8
const DOUBLE_TAP_SCALE = 2.5
// ピンチ終了時にこの倍率未満なら等倍へスナップバック
const RESET_SNAP_SCALE = 1.05

/**
 * ライトボックス画像のピンチズーム / パン / ダブルタップズーム。
 *
 * 対象要素（コンテナ）にタッチイベントを直接バインドし、
 * transform 用のインラインスタイルを返す。ズーム中は
 * `zoomed` が true になるので、スワイプナビ等との排他に使う。
 */
export function usePinchZoom(targetRef: Ref<HTMLElement | null>) {
  const scale = ref(1)
  const translateX = ref(0)
  const translateY = ref(0)

  const zoomed = computed(() => scale.value > 1)
  const transformStyle = computed(() =>
    zoomed.value
      ? {
          transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
        }
      : undefined,
  )

  function reset() {
    scale.value = 1
    translateX.value = 0
    translateY.value = 0
  }

  /** 画像がコンテナから離れすぎないよう平行移動量を制限 */
  function clampTranslate() {
    if (!boundEl) return
    const maxX = ((scale.value - 1) * boundEl.clientWidth) / 2
    const maxY = ((scale.value - 1) * boundEl.clientHeight) / 2
    translateX.value = Math.min(maxX, Math.max(-maxX, translateX.value))
    translateY.value = Math.min(maxY, Math.max(-maxY, translateY.value))
  }

  let boundEl: HTMLElement | null = null

  // --- Pinch ---
  let pinching = false
  let pinchStartDist = 0
  let pinchStartScale = 1
  let pinchStartMidX = 0
  let pinchStartMidY = 0
  let pinchStartTx = 0
  let pinchStartTy = 0

  // --- Pan (1本指、ズーム中のみ) ---
  let panning = false
  let panStartX = 0
  let panStartY = 0
  let panStartTx = 0
  let panStartTy = 0

  function touchDistance(a: Touch, b: Touch): number {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  }

  function beginPinch(a: Touch, b: Touch) {
    pinching = true
    panning = false
    pinchStartDist = touchDistance(a, b)
    pinchStartScale = scale.value
    pinchStartMidX = (a.clientX + b.clientX) / 2
    pinchStartMidY = (a.clientY + b.clientY) / 2
    pinchStartTx = translateX.value
    pinchStartTy = translateY.value
  }

  function beginPan(t: Touch) {
    panning = true
    panStartX = t.clientX
    panStartY = t.clientY
    panStartTx = translateX.value
    panStartTy = translateY.value
  }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]]
      if (a && b) beginPinch(a, b)
    } else if (e.touches.length === 1 && zoomed.value) {
      const t = e.touches[0]
      if (t) beginPan(t)
    }
  }

  function onTouchMove(e: TouchEvent) {
    if (pinching && e.touches.length >= 2) {
      const [a, b] = [e.touches[0], e.touches[1]]
      if (!a || !b) return
      e.preventDefault()

      const next = Math.min(
        MAX_SCALE,
        Math.max(
          MIN_SCALE,
          (pinchStartScale * touchDistance(a, b)) / pinchStartDist,
        ),
      )
      const midX = (a.clientX + b.clientX) / 2
      const midY = (a.clientY + b.clientY) / 2
      const rect = boundEl?.getBoundingClientRect()
      if (!rect) return
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2

      // ピンチ開始時に中点の下にあった画像上の点を、現在の中点に追従させる
      const ratio = next / pinchStartScale
      translateX.value =
        midX - cx - ratio * (pinchStartMidX - cx - pinchStartTx)
      translateY.value =
        midY - cy - ratio * (pinchStartMidY - cy - pinchStartTy)
      scale.value = next
      clampTranslate()
    } else if (panning && e.touches.length === 1 && zoomed.value) {
      const t = e.touches[0]
      if (!t) return
      e.preventDefault()
      translateX.value = panStartTx + (t.clientX - panStartX)
      translateY.value = panStartTy + (t.clientY - panStartY)
      clampTranslate()
    }
  }

  function onTouchEnd(e: TouchEvent) {
    if (pinching && e.touches.length < 2) {
      pinching = false
      if (scale.value < RESET_SNAP_SCALE) {
        reset()
      } else {
        // 残った1本指でそのままパンに移行
        const t = e.touches[0]
        if (t) beginPan(t)
      }
    } else if (panning && e.touches.length === 0) {
      panning = false
    }
  }

  function onDblclick(e: MouseEvent) {
    if (zoomed.value) {
      reset()
      return
    }
    const rect = boundEl?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    scale.value = DOUBLE_TAP_SCALE
    // タップ位置を中心にズームイン
    translateX.value = (e.clientX - cx) * (1 - DOUBLE_TAP_SCALE)
    translateY.value = (e.clientY - cy) * (1 - DOUBLE_TAP_SCALE)
    clampTranslate()
  }

  function bind(el: HTMLElement) {
    if (boundEl === el) return
    unbind()
    boundEl = el
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    el.addEventListener('dblclick', onDblclick)
  }

  function unbind() {
    if (!boundEl) return
    boundEl.removeEventListener('touchstart', onTouchStart)
    boundEl.removeEventListener('touchmove', onTouchMove)
    boundEl.removeEventListener('touchend', onTouchEnd)
    boundEl.removeEventListener('touchcancel', onTouchEnd)
    boundEl.removeEventListener('dblclick', onDblclick)
    boundEl = null
  }

  watch(
    targetRef,
    (v) => {
      if (v) bind(v)
      else unbind()
    },
    { flush: 'post' },
  )

  onUnmounted(unbind)

  return { transformStyle, zoomed, reset }
}

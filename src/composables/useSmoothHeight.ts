import { onScopeDispose, type Ref, watch } from 'vue'
import { motionDuration, motionEasing } from '@/utils/motion'

interface SmoothHeightOptions {
  /** false の間は補間しない (リサイズ中・最大化中など、高さを外から決めているとき) */
  enabled?: () => boolean
  /** これ未満の変化は補間しない (1 行の伸び縮みまで動かすと入力が重く見える) */
  minDelta?: number
}

/**
 * 内容に追従して高さが変わる要素 (height: auto) の伸び縮みを補間する。
 *
 * ResizeObserver の通知はレイアウト後・描画前に来るので、そこで「前の高さ →
 * 新しい高さ」の WAAPI アニメを始めれば、新しい高さが一度も描画されずに
 * 滑らかに伸びる (FLIP の高さ版)。アニメが終わると fill が外れて height: auto
 * に戻る。補間中に内容がさらに変わった場合は、終わった時点の高さから続けて
 * 補間する。
 */
export function useSmoothHeight(
  target: Ref<HTMLElement | null | undefined>,
  options: SmoothHeightOptions = {},
): void {
  const { enabled = () => true, minDelta = 24 } = options
  let last = -1
  let anim: Animation | null = null
  let observer: ResizeObserver | null = null

  function animate(el: HTMLElement, from: number, to: number) {
    const duration = motionDuration('--nd-duration-slow', 280)
    if (duration <= 0) return
    anim = el.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration,
      easing: motionEasing('--nd-ease-decel'),
    })
    const done = () => {
      anim = null
      // 補間中に内容が変わっていたら、今の自然な高さへ続けて補間する
      const now = el.offsetHeight
      const prev = last
      last = now
      if (enabled() && Math.abs(now - prev) >= minDelta) animate(el, prev, now)
    }
    anim.onfinish = done
    anim.oncancel = () => {
      anim = null
      last = el.offsetHeight
    }
  }

  function onResize() {
    const el = target.value
    // 補間中の高さ変化は自分のアニメによるもの
    if (!el || anim) return
    // transform (開閉アニメの scale) の影響を受けないレイアウト上の高さ
    const h = el.offsetHeight
    const prev = last
    last = h
    if (prev < 0 || !enabled() || Math.abs(h - prev) < minDelta) return
    animate(el, prev, h)
  }

  watch(
    target,
    (el) => {
      observer?.disconnect()
      anim?.cancel()
      last = -1
      if (!el || typeof ResizeObserver === 'undefined') return
      observer = new ResizeObserver(onResize)
      observer.observe(el)
    },
    { immediate: true, flush: 'post' },
  )

  onScopeDispose(() => {
    observer?.disconnect()
    anim?.cancel()
  })
}

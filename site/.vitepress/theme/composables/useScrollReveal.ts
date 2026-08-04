import { onMounted, onUnmounted } from 'vue'

/**
 * Hub の vFadeIn / vTextUnderline 相当。
 * [data-fade] は往復フェードイン、.u-line はグラデ下線をスクロールで伸ばす。
 * どちらも Hub と同じ rootMargin で、外れたら元に戻す。
 */
export function useScrollReveal() {
  const observers: IntersectionObserver[] = []

  onMounted(() => {
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    const supported = 'IntersectionObserver' in window

    const lines = document.querySelectorAll<HTMLElement>('.u-line')
    if (reduceMotion || !supported) {
      for (const el of lines) el.classList.add('is-drawn')
    } else {
      const lineObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            entry.target.classList.toggle('is-drawn', entry.isIntersecting)
          }
        },
        { root: null, rootMargin: '9999px 0px -300px 0px', threshold: 0 },
      )
      for (const el of lines) lineObserver.observe(el)
      observers.push(lineObserver)
    }

    if (reduceMotion || !supported) return

    const fadeTargets = document.querySelectorAll<HTMLElement>('[data-fade]')
    if (fadeTargets.length === 0) return

    const fadeObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          entry.target.classList.toggle('is-shown', entry.isIntersecting)
        }
      },
      { root: null, rootMargin: '9999px 0px -200px 0px', threshold: 0 },
    )
    for (const el of fadeTargets) {
      el.classList.add('fade')
      fadeObserver.observe(el)
    }
    observers.push(fadeObserver)
  })

  onUnmounted(() => {
    for (const observer of observers) observer.disconnect()
    observers.length = 0
  })
}

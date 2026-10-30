/**
 * 代表窓と見ている窓 (#1131)。
 *
 * プロセスに 1 つの裏の仕事 (HEARTBEAT の表示、トレイ、OS バッジ、ファイル移行、
 * プラグインの無人の副作用、窓を問わない外部問い合わせの応答) は「代表窓」が担う。
 * 誰が代表かは Rust の名簿が決める (`main` が居ればそれ、無ければ最も古いデッキ窓)。
 * JS は起動時に 1 回名乗り (`deck_window_announce`)、以後は役の変更を受けて
 * `isRepresentative` を更新するだけ。`label === 'main'` の比較を新しく書かない。
 *
 * ブラウザ (Dev Dashboard) は Tauri 外なので常に代表。
 */
import { computed, ref, watch } from 'vue'
import { commands, events } from '@/bindings'
import { currentWindowLabel, isTauri } from '@/utils/settingsFs'
import { unwrap } from '@/utils/tauriInvoke'

const representative = ref<string | null>(null)
const viewing = ref<string | null>(null)
let announcing: Promise<void> | null = null

function apply(roles: {
  representative: string | null
  viewing: string | null
}): void {
  representative.value = roles.representative
  viewing.value = roles.viewing
}

const isRepresentative = computed(() => {
  if (!isTauri) return true
  const me = currentWindowLabel()
  return me !== null && representative.value === me
})

const isViewing = computed(() => {
  if (!isTauri) return true
  const me = currentWindowLabel()
  return me !== null && viewing.value === me
})

/**
 * この窓が名乗る。1 ウィンドウ 1 回 (重ねて呼んでも command は 1 回)。
 * 役の変更の購読を先に張ってから名乗るので、返事と変更の間に穴が無い。
 */
export function announceWindow(): Promise<void> {
  if (announcing) return announcing
  announcing = (async () => {
    if (!isTauri) return
    await events.windowRolesChanged.listen((e) => apply(e.payload))
    const view = unwrap(await commands.deckWindowAnnounce())
    apply(view)
  })().catch((e) => {
    console.warn('[window-roles] announce failed:', e)
  })
  return announcing
}

/** 代表になった時点で解決する (既に代表なら即)。代表から外れる経路は無い */
export function whenRepresentative(): Promise<void> {
  if (isRepresentative.value) return Promise.resolve()
  return new Promise((resolve) => {
    const stop = watch(
      isRepresentative,
      (v) => {
        if (!v) return
        stop()
        resolve()
      },
      // 役の変更は Tauri のイベントで届く (描画とは無関係) ので、次の tick を待たず
      // その場で解決する
      { flush: 'sync' },
    )
  })
}

export function useRepresentative() {
  return { isRepresentative, isViewing, representative, viewing }
}

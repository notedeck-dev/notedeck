import { useIntersectionObserver } from '@vueuse/core'
import {
  type ComputedRef,
  computed,
  type InjectionKey,
  inject,
  onBeforeUnmount,
  onScopeDispose,
  provide,
  type Ref,
  reactive,
  type ShallowRef,
  watch,
} from 'vue'
import { useDeckStore } from '@/stores/deck'
import { usePerformanceStore } from '@/stores/performance'
import { useUiStore } from '@/stores/ui'

/**
 * Per-cell registry for column visibility / mount / live-budget state.
 *
 * The registry owns three reactive maps:
 *  - visibility: IntersectionObserver 由来の可視判定
 *  - mounted:    DOM マウント判定 (columnShell ↔ <component> の切替)
 *  - live:       streaming が許可されたカラム (maxLiveColumns 予算)
 *
 * Each DeckStackCell synchronously registers itself during setup so the
 * initial `mounted` state is decided deterministically, independent of
 * IntersectionObserver attach timing. This eliminates the Vue 3.5 race where
 * `{ immediate: true, flush: 'post' }` fires before template refs populate.
 */
export interface ColumnMountRegistry {
  /** Called by a cell during `setup`. */
  register(colId: string, opts: { initialMounted: boolean }): void
  /** Called by a cell during `onBeforeUnmount`. */
  unregister(colId: string): void
  /** Called by a cell's IntersectionObserver callback. */
  setIntersecting(colId: string, visible: boolean): void
  /** Called by DeckColumnsArea when active column or layout changes. */
  updateLiveBudget(
    orderedColumnIds: string[],
    activeColumnId: string | null,
  ): void
  /** Reactive read used by cell-side `shouldMount` computed. */
  isMounted(colId: string): boolean
}

const COLUMN_VISIBILITY_KEY: InjectionKey<Map<string, boolean>> =
  Symbol('columnVisibility')
const COLUMN_MOUNTED_KEY: InjectionKey<Map<string, boolean>> =
  Symbol('columnMounted')
const COLUMN_LIVE_KEY: InjectionKey<Map<string, boolean>> = Symbol('columnLive')
const COLUMN_REGISTRY_KEY: InjectionKey<ColumnMountRegistry> = Symbol(
  'columnMountRegistry',
)
const COLUMNS_ROOT_KEY: InjectionKey<
  Readonly<ShallowRef<HTMLElement | null>> | Ref<HTMLElement | null>
> = Symbol('columnsRoot')

/** Provide column mount state from DeckColumnsArea. */
export function provideColumnMountRegistry(
  rootRef?: Readonly<ShallowRef<HTMLElement | null>> | Ref<HTMLElement | null>,
): ColumnMountRegistry {
  const perfStore = usePerformanceStore()
  const uiStore = useUiStore()
  const visibility = reactive(new Map<string, boolean>())
  const mounted = reactive(new Map<string, boolean>())
  const live = reactive(new Map<string, boolean>())

  const unloadTimers = new Map<string, ReturnType<typeof setTimeout>>()

  // 復帰直後、背景化前に張られた unload timer が凍結明けに IO の初期エントリ
  // より先に発火すると unmount→remount フラップが起きる。timer は全部捨てて、
  // 直後の re-observe 初期エントリに再評価させる (依然不可視なら
  // setIntersecting(false) が新しい timer を張り直す)。
  watch(
    () => uiStore.deckResumeSignal,
    () => {
      for (const timer of unloadTimers.values()) clearTimeout(timer)
      unloadTimers.clear()
    },
  )

  function register(colId: string, opts: { initialMounted: boolean }): void {
    if (!mounted.has(colId)) {
      mounted.set(colId, opts.initialMounted)
    }
  }

  function unregister(colId: string): void {
    const timer = unloadTimers.get(colId)
    if (timer != null) {
      clearTimeout(timer)
      unloadTimers.delete(colId)
    }
    visibility.delete(colId)
    mounted.delete(colId)
    live.delete(colId)
  }

  function setIntersecting(colId: string, visible: boolean): void {
    visibility.set(colId, visible)

    if (visible) {
      const timer = unloadTimers.get(colId)
      if (timer != null) {
        clearTimeout(timer)
        unloadTimers.delete(colId)
      }
      mounted.set(colId, true)
    } else if (!unloadTimers.has(colId)) {
      const timer = setTimeout(() => {
        unloadTimers.delete(colId)
        if (!visibility.get(colId)) {
          mounted.set(colId, false)
          live.delete(colId)
        }
      }, perfStore.get('columnUnloadDelay'))
      unloadTimers.set(colId, timer)
    }
  }

  function updateLiveBudget(
    orderedColumnIds: string[],
    activeColumnId: string | null,
  ): void {
    const maxLive = perfStore.get('maxLiveColumns')
    const activeIndex = activeColumnId
      ? orderedColumnIds.indexOf(activeColumnId)
      : 0

    const candidates: { id: string; distance: number }[] = []
    for (let i = 0; i < orderedColumnIds.length; i++) {
      const id = orderedColumnIds[i]
      if (id && mounted.get(id)) {
        candidates.push({ id, distance: Math.abs(i - activeIndex) })
      }
    }

    candidates.sort((a, b) => a.distance - b.distance)
    const liveSet = new Set(candidates.slice(0, maxLive).map((c) => c.id))

    for (const id of orderedColumnIds) {
      if (liveSet.has(id)) {
        live.set(id, true)
      } else if (live.has(id)) {
        live.set(id, false)
      }
    }
  }

  function isMounted(colId: string): boolean {
    return mounted.get(colId) ?? false
  }

  const registry: ColumnMountRegistry = {
    register,
    unregister,
    setIntersecting,
    updateLiveBudget,
    isMounted,
  }

  provide(COLUMN_VISIBILITY_KEY, visibility)
  provide(COLUMN_MOUNTED_KEY, mounted)
  provide(COLUMN_LIVE_KEY, live)
  provide(COLUMN_REGISTRY_KEY, registry)
  if (rootRef) provide(COLUMNS_ROOT_KEY, rootRef)

  onScopeDispose(() => {
    for (const timer of unloadTimers.values()) clearTimeout(timer)
    unloadTimers.clear()
  })

  return registry
}

/**
 * Cell-side hook: binds an IntersectionObserver to `cellRef` and registers
 * mount lifecycle with the parent registry.
 *
 * `register()` runs synchronously in setup so `shouldMount` is decided
 * immediately, independent of observer attach timing.
 */
export function useColumnMount(
  colId: string,
  cellRef: Readonly<ShallowRef<HTMLElement | null>>,
  opts: {
    isCompact: Ref<boolean>
    isActive: Ref<boolean>
    /**
     * While true, keep this column mounted even when off-screen. Set by the
     * Stream Inspector (capturing) so off-screen columns stay subscribed and
     * observable on mobile, where they would otherwise unload after a few
     * seconds. Debug-scoped: only true while an inspector column exists.
     */
    keepMounted?: Ref<boolean>
  },
): { shouldMount: ComputedRef<boolean> } {
  const registry = inject(COLUMN_REGISTRY_KEY, null)
  if (!registry) {
    // Fallback path (e.g. PiP standalone window): always mount, no budget.
    return { shouldMount: computed(() => true) }
  }

  registry.register(colId, { initialMounted: !opts.isCompact.value })

  const rootRef = inject(COLUMNS_ROOT_KEY, null)
  const observer = useIntersectionObserver(
    cellRef,
    ([entry]) => {
      if (document.hidden) return
      if (!entry) return
      registry.setIntersecting(colId, entry.isIntersecting)
    },
    { root: rootRef ?? undefined, threshold: 0, rootMargin: '0px 10%' },
  )

  // Android 背景化中は `document.hidden` ガードで交差イベントを捨てるため、
  // 復帰時に visibility マップが stale なままになりうる (IO は交差状態が
  // 変わらない限り再発火しない)。observer を張り直すと observe() が仕様上
  // 必ず現在の交差状態で初期エントリを配送するので、それで復元する。
  // stale のままだと [isVisible, isLive] watch が発火せず、カラムが
  // Suspended に落ちたまま新着を捨て続ける (#506)。
  const uiStore = useUiStore()
  watch(
    () => uiStore.deckResumeSignal,
    () => {
      observer.pause()
      observer.resume()
    },
  )

  onBeforeUnmount(() => registry.unregister(colId))

  const shouldMount = computed(
    () =>
      opts.isActive.value ||
      registry.isMounted(colId) ||
      (opts.keepMounted?.value ?? false),
  )
  return { shouldMount }
}

/**
 * Inject visibility + live state for streaming control.
 * Returns `true` when the column is visible/live or when the maps are
 * unavailable (e.g. standalone PiP window without a provider).
 */
export function useColumnLive(columnId: string): {
  isVisible: ComputedRef<boolean>
  isLive: ComputedRef<boolean>
} {
  const visibility = inject(COLUMN_VISIBILITY_KEY, null)
  const live = inject(COLUMN_LIVE_KEY, null)
  const deckStore = useDeckStore()
  // アクティブカラムは IO 判定に関わらず常に可視扱いにする。
  // shouldMount が isActive を例外にしているのと同じ理由: アクティブ =
  // ユーザーが見ているカラムで、モバイル swipe モードでは唯一の表示カラム。
  // IO の判定が stale false になっても (Android 背景化中の破棄イベント等)、
  // 表示中カラムのストリームが warm→Suspended に落ちて新着が止まる事故を
  // 構造的に防ぐ (#506 フォローアップ)。
  const isVisible = computed(
    () =>
      deckStore.activeColumnId === columnId ||
      (visibility?.get(columnId) ?? true),
  )
  const isLive = computed(() => live?.get(columnId) ?? true)
  return { isVisible, isLive }
}

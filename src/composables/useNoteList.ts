import { computed, onScopeDispose, shallowRef } from 'vue'
import type {
  NormalizedNote,
  NoteUpdateEvent,
  ServerAdapter,
} from '@/adapters/types'
import {
  clusterByIdentity,
  type NoteGroup,
  truncateByGroups,
} from '@/services/noteGroup'
import { type VariantKey, variantKey, variantKeyOf } from '@/services/noteKey'
import { useAccountsStore } from '@/stores/accounts'
import { useNoteStore } from '@/stores/notes'
import { usePerformanceStore } from '@/stores/performance'
import { useSuspensionsStore } from '@/stores/suspensions'
import { insertIntoSorted } from '@/utils/sortNotes'
import { commands } from '@/utils/tauriInvoke'
import { useNoteGroupContext } from './useNoteGroups'
import { useNoteVisibility, type VisibilityOpts } from './useNoteVisibility'

/** @deprecated Use usePerformanceStore().get('noteListMax') instead. Kept for test compatibility. */
export const NOTE_LIST_MAX = 200

export interface UseNoteListOptions {
  getAdapter: () => ServerAdapter | null
  deleteHandler: (note: NormalizedNote) => Promise<boolean>
  closePostForm: () => void
  onNotesChanged?: (notes: NormalizedNote[]) => void
  maxNotes?: number
  /** 面ごとの述語 opt-out（お気に入り・プロフィール等）。既定は全適用 */
  visibility?: VisibilityOpts
  /**
   * 束ねる面 (#1058)。同一 identity の variant を 1 行 (group) に畳み、上限も
   * group 数で数える。`notes` は各 group の主ビュー、`groups` が表示単位
   */
  bundle?: boolean
}

export function useNoteList(options: UseNoteListOptions) {
  const noteStore = useNoteStore()
  const accountsStore = useAccountsStore()
  const visibility = useNoteVisibility()
  const perfStore = usePerformanceStore()
  const suspensionsStore = useSuspensionsStore()
  const maxNotes = options.maxNotes ?? perfStore.get('noteListMax')
  const bundle = options.bundle === true
  const groupContext = bundle ? useNoteGroupContext(options.visibility) : null
  /**
   * 列のメンバーシップ。キーは variant key = (取得元アカウント, ノート ID) の複合
   * (#1010)。ノート ID 単独だと別サーバー由来の同じ ID が衝突する
   */
  const orderedKeys = shallowRef<VariantKey[]>([])
  const noteKeys = new Set<VariantKey>()
  let onNotesChangedFn = options.onNotesChanged

  // Listen for global note deletions so ALL columns clean up their orderedKeys
  const unsubDelete = noteStore.onDelete((key) => {
    if (noteKeys.has(key)) {
      orderedKeys.value = orderedKeys.value.filter((k) => k !== key)
      noteKeys.delete(key)
    }
  })
  onScopeDispose(unsubDelete)

  // カラムの表示中キーを noteStore に root として登録。退避時に保護される。
  const unregisterRoot = noteStore.registerRoot(() => noteKeys)
  onScopeDispose(unregisterRoot)

  /**
   * 書込基底となる unfiltered なノート列（#831 層 1 / Step 0）。
   * 全ての read-modify-write（マージ・挿入・削除・truncate）はこちらを基底に
   * する。filtered な `notes` を基底にすると、隠れているノートが書き戻しの
   * たびに列から落ちて焼き込まれ、ミュート解除で復活しなくなる。
   */
  const rawNotes = computed({
    get: () => noteStore.resolve(orderedKeys.value),
    set: (newNotes: NormalizedNote[]) => {
      // 束ねる面は同 identity を隣接させてから group 数で切り詰める (§4)
      const trimmed = bundle
        ? truncateByGroups(clusterByIdentity(newNotes), maxNotes)
        : newNotes.length > maxNotes
          ? newNotes.slice(0, maxNotes)
          : newNotes
      // skipTrigger: orderedKeys assignment below already drives this column's reactivity.
      // A global triggerRef would redundantly invalidate ALL columns' notes computeds.
      noteStore.put(trimmed, true)
      const keys: VariantKey[] = new Array(trimmed.length)
      // 凍結 probe の供給点（#828）。全書込経路（connect / streaming /
      // loadMore / キャッシュ復元 / snapshot / resume / refresh）はこの setter
      // を通るため、ここで新規ノートを拾えば経路列挙が不要になる。
      // setter を迂回する書込を増やさないことを規約とする。
      const inserted: NormalizedNote[] = []
      for (let i = 0; i < trimmed.length; i++) {
        // biome-ignore lint/style/noNonNullAssertion: bounded loop
        const note = trimmed[i]!
        const key = variantKeyOf(note)
        keys[i] = key
        if (!noteKeys.has(key)) inserted.push(note)
      }
      noteKeys.clear()
      for (const key of keys) noteKeys.add(key)
      orderedKeys.value = keys
      if (inserted.length > 0) suspensionsStore.probeNotes(inserted)
      // noteCapture の購読同期 (#939)。ストリーミングの新着 flush
      // (useStreamingBatch) は setNotes を通らず setter へ直接書くため、
      // setNotes 側で通知すると WS 由来の新着が一度も subNote されず、
      // 他者リアクションの noteUpdated が届かない。書込経路の合流点である
      // ここで、可視ノートのみ (= capture の購読対象) を通知する
      onNotesChangedFn?.(notes.value)
    },
  })

  /**
   * 表示専用の filtered な列（readonly）。削除済みノートはキャッシュ再読込で
   * noteMap/orderedIds に復活しうるため、表示時の可視性述語で除外する（#602）。
   * muted/archived の合成もこの述語に集約。書込は rawNotes 側で行う。
   */
  /**
   * 束ねる面の表示単位。同一 identity の variant を畳み、可視性は group 層で
   * 評価する (ユーザー意思は variant の OR / サーバー判断は origin のみ)。
   * 束ねない面では空配列。
   */
  const groups = computed<NoteGroup[]>(() =>
    groupContext ? groupContext.groupsOf(rawNotes.value) : [],
  )

  const notes = computed(() =>
    bundle
      ? groups.value.map((g) => g.primary)
      : visibility.filterVisible(rawNotes.value, options.visibility),
  )

  function setOnNotesChanged(fn: (notes: NormalizedNote[]) => void) {
    onNotesChangedFn = fn
  }

  /**
   * 保持上限を超えたときにどちら側を捨てるか (#834)。
   *
   * 列は新しい順なので、既定の 'oldest' は末尾 (古い側) を捨てる = 上から
   * 新着が流れ込む経路に合う。下方向のページングは逆で、足したばかりの
   * 古いノートが即座に捨てられて画面が変わらなくなるため 'newest' を使う。
   */
  type TrimSide = 'oldest' | 'newest'

  function setNotes(newNotes: NormalizedNote[], trim: TrimSide = 'oldest') {
    // rawNotes setter 側の切り捨ては 'oldest' 固定なので、'newest' のときは
    // ここで先に上限まで削っておく (setter 側は結果的に no-op になる)
    rawNotes.value =
      trim === 'newest' && newNotes.length > maxNotes
        ? newNotes.slice(newNotes.length - maxNotes)
        : newNotes
  }

  /**
   * Incrementally merge fetched notes into the current list.
   * - Notes already displayed are updated in-place (no list re-render).
   * - Genuinely new notes are inserted in sorted order.
   */
  function mergeUpdate(newNotes: NormalizedNote[]): void {
    const existing = newNotes.filter((n) => noteKeys.has(variantKeyOf(n)))
    const brandNew = newNotes.filter((n) => !noteKeys.has(variantKeyOf(n)))
    if (existing.length > 0) noteStore.put(existing)
    if (brandNew.length > 0)
      setNotes(insertIntoSorted(rawNotes.value, brandNew))
  }

  /** echo 抑止用: イベントを受けたアカウントのサーバー内 userId */
  const myUserIdOf = (accountId: string) =>
    accountsStore.accountMap.get(accountId)?.userId

  function onNoteUpdate(event: NoteUpdateEvent) {
    if (event.type === 'deleted') {
      // noteStore.remove() triggers global onDelete listeners,
      // which clean up orderedKeys/noteKeys in ALL columns
      noteStore.remove(variantKey(event.accountId, event.noteId))
      commands.apiDeleteCachedNote(event.accountId, event.noteId).catch((e) => {
        if (import.meta.env.DEV)
          console.debug('[delete-cached-note] ignored:', e)
      })
      return
    }
    noteStore.applyUpdate(event, myUserIdOf)
  }

  async function handlePosted(editedNoteId?: string) {
    options.closePostForm()
    if (editedNoteId) {
      const adapter = options.getAdapter()
      if (!adapter) return
      try {
        const updated = await adapter.api.getNote(editedNoteId)
        noteStore.put([updated])
      } catch (e) {
        // note may have been deleted
        if (import.meta.env.DEV)
          console.debug('[handlePosted] note fetch failed:', e)
      }
    }
  }

  /** ユーザー操作で削除中のノートの行キー。NoteScroller の leave アニメに使う */
  const removingKeys = shallowRef<ReadonlySet<VariantKey>>(new Set())

  async function removeNote(note: NormalizedNote) {
    const key = variantKeyOf(note)
    // リストから消す前にフェードアウトを見せる (reduced-motion では即時)
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      removingKeys.value = new Set([...removingKeys.value, key])
      await new Promise((resolve) => setTimeout(resolve, 180))
      const next = new Set(removingKeys.value)
      next.delete(key)
      removingKeys.value = next
    }
    const prevKeys = orderedKeys.value
    // 同じアカウント経由で見えている Renote 行も道連れにする
    rawNotes.value = rawNotes.value.filter(
      (n) =>
        n._accountId !== note._accountId ||
        (n.id !== note.id && n.renoteId !== note.id),
    )

    if (await options.deleteHandler(note)) {
      noteStore.remove(key)
      commands.apiDeleteCachedNote(note._accountId, note.id).catch((e) => {
        if (import.meta.env.DEV)
          console.debug('[delete-cached-note] ignored:', e)
      })
    } else {
      // 楽観削除の巻き戻し。orderedKeys を直接書かずに setter を通す — 直接
      // 書くと noteCapture の購読同期が走らず、ノートは表示に戻るのに購読は
      // 外れたままになり、そのノートへの他者リアクションが以後届かなくなる
      rawNotes.value = noteStore.resolve(prevKeys)
    }
  }

  return {
    notes,
    groups,
    // unfiltered な書込基底。同期位置の決定（sinceId / untilId / 空ガード等）は
    // 隠れたノートを含むこちらを読む（#831 §1.4 の読取判別規則）
    rawNotes,
    // 表示述語でフィルタされない「列のメンバーシップ」。snapshot 保存はこれを使う
    // ことで、ミュート等の可視性状態を焼き込まず、解除で復活できる（#574）。
    orderedKeys,
    noteKeys,
    setNotes,
    mergeUpdate,
    setOnNotesChanged,
    onNoteUpdate,
    handlePosted,
    removeNote,
    removingKeys,
  }
}

import { defineStore } from 'pinia'
import { shallowRef, triggerRef } from 'vue'
import type { NormalizedNote, NoteUpdateEvent } from '@/adapters/types'
import { useFrameScheduler } from '@/composables/useFrameScheduler'
import { createBoundedCache } from '@/services/boundedCache'
import { evictByLiveness } from '@/services/mapEviction'
import {
  type NoteIdentity,
  nestedVariantKey,
  noteIdentityOf,
  type VariantKey,
  variantKey,
  variantKeyOf,
} from '@/services/noteKey'
import {
  createUpdateDeduper,
  mergeNoteUpdate,
  noteUpdateSig,
} from '@/services/streamUpdateMerge'
import { usePerformanceStore } from '@/stores/performance'

/** Window for dropping duplicate noteUpdated events (channel + note capture から
 *  同一イベントが二重に来る場合の対策). 1.5s なら同じユーザの逐次操作 (react→unreact)
 *  は別 sig で別個に通る。 */
const NOTE_UPDATE_DEDUP_WINDOW_MS = 1500

/**
 * 削除 tombstone の上限 (セッション揮発)。押し出された tombstone のノートは
 * キャッシュ再読込で復活し得るが、実用上この件数を超えて削除が観測される
 * セッションは稀で、上限なしで単調増加させるよりよい (#987 の不変条件)。
 */
const TOMBSTONE_MAX = 5000

/**
 * ノートストア。キーは variant key = (取得元アカウント, ノート ID) の複合 (#1010)。
 * ノート ID はサーバー内でしか一意でないため、ID 単独をキーにしない。
 */
export const useNoteStore = defineStore('notes', () => {
  const perfStore = usePerformanceStore()
  const { schedule } = useFrameScheduler()
  const noteMap = shallowRef(new Map<VariantKey, NormalizedNote>())
  const deleteListeners = new Set<
    (key: VariantKey, tombstone: boolean) => void
  >()
  /**
   * 削除済みノートの tombstone（セッション揮発）。SQLite 再読込で復活した
   * 削除済みノートを表示述語 isDeleted で握り潰すため（#602）。表示述語の
   * 素材その1で、将来 muted/archived と OR 合成する拡張点（合成は consumption 層）。
   */
  const deletedKeys = createBoundedCache<VariantKey, true>(TOMBSTONE_MAX)
  /**
   * origin (そのノートが最初に投稿されたサーバー) の variant が削除された identity。
   * 削除された variant は map と順序配列から消えるので、束ねる面が「origin で
   * 削除された」事実を観測する手段がこれしか無い (#1058 §5.5)。非 origin の
   * 削除 (連合先モデレーターの判断と区別できない) は記録しない。
   */
  const deletedAtOrigin = createBoundedCache<NoteIdentity, true>(TOMBSTONE_MAX)
  /** Dedup of the same update arriving via multiple delivery paths. */
  const updateDeduper = createUpdateDeduper(NOTE_UPDATE_DEDUP_WINDOW_MS)
  /**
   * 現在どのカラムからも参照されているキー集合を供給する root 群。
   * 退避時に「どの root にも含まれない」ノートを優先削除し、アクティブカラムの
   * 表示継続性を保つ。各カラムは useNoteList でセットを登録／解除する。
   */
  const roots = new Set<() => Iterable<VariantKey>>()

  /** Batch triggerRef calls into one per animation frame (streaming events fire rapidly) */
  let triggerScheduled = false
  const doTrigger = () => {
    triggerScheduled = false
    triggerRef(noteMap)
  }

  function scheduleTrigger() {
    if (triggerScheduled) return
    triggerScheduled = true
    schedule(doTrigger, 'normal')
  }

  /**
   * root を登録。戻り値の関数で解除する。
   * useNoteList がカラムの可視キー集合を登録することで、退避時に
   * アクティブカラム表示中のノートが優先的に保護される。
   */
  function registerRoot(provider: () => Iterable<VariantKey>): () => void {
    roots.add(provider)
    return () => {
      roots.delete(provider)
    }
  }

  /** すべての root に含まれるキーの和集合を返す */
  function collectLiveKeys(): Set<VariantKey> {
    const live = new Set<VariantKey>()
    for (const provider of roots) {
      for (const key of provider()) live.add(key)
    }
    return live
  }

  /**
   * 退避戦略:
   *   1) どの root からも参照されていないノートを古い順に削除
   *   2) それでも上限を超えるなら LRU フォールバック（古い順に削除）
   */
  function evictIfNeeded() {
    const map = noteMap.value
    const max = perfStore.get('noteStoreMax')
    if (map.size <= max) return

    const live = collectLiveKeys()
    // renote 参照ノートも生存扱い（resolve() で辿られる）
    if (live.size > 0) {
      for (const key of live) {
        const note = map.get(key)
        if (note?.renoteId) live.add(nestedVariantKey(note, note.renoteId))
      }
    }

    evictByLiveness(map, max, live, (note) => note.createdAt, variantKeyOf)
  }

  /**
   * Insert notes into the global store.
   * @param skipTrigger - When true, skip scheduling triggerRef. Use this when
   *   the caller already drives reactivity via its own ref (e.g. orderedKeys in useNoteList).
   */
  function put(notes: NormalizedNote[], skipTrigger = false) {
    const map = noteMap.value
    // First pass: insert all notes and renotes.
    // LRU refresh on access is handled by get(); put() preserves arrival order
    // so hot streaming paths avoid a redundant delete op per note.
    for (const note of notes) {
      map.set(variantKeyOf(note), note)
      if (note.renote)
        map.set(nestedVariantKey(note, note.renote.id), note.renote)
    }
    // Second pass: eagerly sync renote references so resolve() avoids spread
    for (const note of notes) {
      if (note.renoteId) {
        const latest = map.get(nestedVariantKey(note, note.renoteId))
        if (latest && note.renote !== latest) {
          note.renote = latest
        }
      }
    }
    evictIfNeeded()
    if (!skipTrigger) scheduleTrigger()
  }

  function get(key: VariantKey): NormalizedNote | undefined {
    const map = noteMap.value
    const note = map.get(key)
    // Refresh insertion order so recently accessed notes survive FIFO eviction
    if (note) {
      map.delete(key)
      map.set(key, note)
    }
    return note
  }

  /** Resolve an ordered list of keys into NormalizedNote[], with latest renote from store.
   *  Pure function — does not mutate the Map (renote syncing is handled eagerly in put()). */
  function resolve(keys: readonly VariantKey[]): NormalizedNote[] {
    const map = noteMap.value
    const result: NormalizedNote[] = []
    for (const key of keys) {
      const note = map.get(key)
      if (!note) continue
      // Return a fresh object when renote reference is stale so Vue detects the prop update.
      // No Map mutation — keeps this function safe for use inside computed getters.
      if (note.renoteId) {
        const renote = map.get(nestedVariantKey(note, note.renoteId))
        if (renote && renote !== note.renote) {
          result.push({ ...note, renote })
          continue
        }
      }
      result.push(note)
    }
    return result
  }

  /**
   * ノートを削除する。
   * @param tombstone - true（既定）で tombstone に記録し、再読込での復活を
   *   表示述語が抑止する。背景検証の verify-miss は heuristic（一時的 false-negative
   *   で生きたノートを永久に隠す危険）なので false を渡して tombstone しない。
   *   origin の variant なら identity 単位でも記録する (map に本体が無い経路は
   *   identity が分からないのでスキップ。退避済みなら表示にも居ない)。
   */
  function remove(
    key: VariantKey,
    tombstone = true,
    /** map に本体が無い面 (通知 / ルックアップ) から identity を記録するための本体 */
    removed?: NormalizedNote,
  ) {
    const note = noteMap.value.get(key) ?? removed
    if (tombstone) {
      deletedKeys.set(key, true)
      if (note?._isOrigin) deletedAtOrigin.set(noteIdentityOf(note), true)
    }
    noteMap.value.delete(key)
    scheduleTrigger()
    for (const listener of deleteListeners) listener(key, tombstone)
  }

  /** ノートが削除済み tombstone かを返す。表示述語の素材（#602）。 */
  function isDeleted(key: VariantKey): boolean {
    return deletedKeys.has(key)
  }

  /** origin の variant が削除された identity か (#1058 §5.5 のサーバー判断の権威)。 */
  function isDeletedAtOrigin(identity: NoteIdentity): boolean {
    return deletedAtOrigin.has(identity)
  }

  /**
   * 削除の購読。`tombstone` が false の除去 (整合検査のミス等) は「消えた」
   * のではなく「手元から外した」だけなので、表示を落とす側は true だけ見る
   */
  function onDelete(
    listener: (key: VariantKey, tombstone: boolean) => void,
  ): () => void {
    deleteListeners.add(listener)
    return () => deleteListeners.delete(listener)
  }

  /**
   * ストリームの noteUpdated を反映する。
   * @param myUserIdOf - echo 抑止用。イベントを受けたアカウントのサーバー内 userId
   *   を返す (`reacted.userId` はそのサーバー上の id なので、アカウントごとに引く)
   */
  function applyUpdate(
    event: NoteUpdateEvent,
    myUserIdOf: (accountId: string) => string | undefined,
  ) {
    const key = variantKey(event.accountId, event.noteId)
    if (event.type === 'deleted') {
      // delete は idempotent なので dedup 不要
      remove(key)
      return
    }

    // Channel auto-capture と subNote の両経路から同じ noteUpdated が
    // 来うるため (例: 共通 timeline 購読中の note を別途 subNote 中の場合)、
    // 短い窓で同一 sig の重複を弾く。userId / reaction / choice まで含める
    // ので「同ユーザの逐次 react→unreact」は別 sig として通る。
    if (!updateDeduper.shouldApply(key, noteUpdateSig(event))) return

    const note = noteMap.value.get(key)
    if (!note) return

    const merged = mergeNoteUpdate(note, event, myUserIdOf(event.accountId))
    if (!merged) return
    noteMap.value.set(key, merged)
    scheduleTrigger()
  }

  /** Update a single note in the store (batched trigger for streaming perf) */
  function update(key: VariantKey, note: NormalizedNote) {
    noteMap.value.set(key, note)
    scheduleTrigger()
  }

  /** Trigger reactivity after direct note mutation (e.g. toggleReaction) */
  function notifyMutation() {
    scheduleTrigger()
  }

  return {
    noteMap,
    put,
    get,
    resolve,
    update,
    remove,
    isDeleted,
    isDeletedAtOrigin,
    onDelete,
    applyUpdate,
    notifyMutation,
    registerRoot,
  }
})

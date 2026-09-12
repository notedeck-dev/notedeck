import { events } from '@/bindings'
import { recordStreamHealth, removeStreamHealth } from '@/core/streamHealth'
import { commands, unwrap } from '@/utils/tauriInvoke'
import type {
  NoteUpdateEvent,
  RawStreamEvent,
  StreamAdapter,
  StreamConnectionState,
} from '../types'
import { toNoteUpdateEvent } from './query'

export class MisskeyStream implements StreamAdapter {
  private accountId: string
  private _state: StreamConnectionState = 'initializing'
  private eventHandlers = new Map<string, Set<() => void>>()

  /** Online→offline debounce so brief reconnects don't flicker the badge (#507). */
  private static readonly OFFLINE_GRACE_MS = 5000
  private graceTimer: ReturnType<typeof setTimeout> | null = null
  /** Whether we've ever reached 'connected'. Before that, drops surface immediately. */
  private hasConnected = false

  // Centralized listeners (registered once in connect(), cleaned up in disconnect())
  private unlistenFns: (() => void)[] = []
  /** Incremented on each registerListeners() call; stale listeners check this to self-discard. */
  private _listenerGeneration = 0

  /**
   * Per-note capture handlers (subNote / unsubNote)。同じ variant を複数のカラムが
   * 購読するので noteId → ハンドラ集合。集合が空になったときだけ Rust 側へ
   * unsub を送る (後勝ちで上書きすると片方の unsub でもう片方も切れる、#1058)
   */
  private noteCaptureHandlers = new Map<
    string,
    Set<(event: NoteUpdateEvent) => void>
  >()
  /** Raw event observers (StreamInspector). */
  private rawEventHandlers = new Set<(event: RawStreamEvent) => void>()

  constructor(accountId: string) {
    this.accountId = accountId
  }

  get state(): StreamConnectionState {
    return this._state
  }

  // 接続状態は Rust の stream-status イベントだけを信じる。invoke の
  // resolve は「接続確立」を意味しない (初回失敗も再接続ループに委ねて
  // Ok を返す)。冪等 return 時も Rust が現在状態を emit してくれる。
  connect(): void {
    this.registerListeners()

    commands
      .streamConnect(this.accountId)
      .then((result) => {
        unwrap(result)
      })
      .catch((e) => {
        console.error('[stream] connect failed:', e)
        this.setStatus('disconnected')
      })
  }

  reconnect(): void {
    // Remove potentially stale listeners (may have been lost during background suspension)
    for (const fn of this.unlistenFns) fn()
    this.unlistenFns = []

    // Re-register fresh listeners (handler maps are preserved)
    this.registerListeners()

    // Ensure Rust-side connection is alive。冪等 return でも Rust が現在
    // 状態を emit するので、背景化中に取り逃した遷移はここで補正される
    commands
      .streamConnect(this.accountId)
      .then((result) => {
        unwrap(result)
      })
      .catch((e) => {
        // Connection might be reconnecting on Rust side — that's fine
        if (import.meta.env.DEV) console.debug('[stream] reconnect ignored:', e)
      })
  }

  private registerListeners(): void {
    // Bump generation so any in-flight listen() from a previous call will self-discard
    const gen = ++this._listenerGeneration

    // 統合チャネル (stream-envelope) は Inspector 用の raw tap としてのみ
    // 購読する。個別の消費 (status / capture / chat reaction) は専用の
    // typed イベントに移行済み (#781)。Inspector は意図的に raw 表示なので、
    // typed union → Record への cast はこの raw 境界 1 箇所に閉じる。
    events.streamEnvelope
      .listen(({ payload: e }) => {
        // Stale listener guard: if a newer registerListeners() has been called,
        // this callback belongs to a superseded generation — ignore it.
        if (gen !== this._listenerGeneration) return

        if (e.payload.accountId !== this.accountId) return

        if (this.rawEventHandlers.size > 0) {
          const raw: RawStreamEvent = {
            kind: e.kind,
            payload: e.payload as unknown as Record<string, unknown>,
          }
          for (const h of this.rawEventHandlers) h(raw)
        }
      })
      .then((fn) => {
        if (gen !== this._listenerGeneration) {
          // This listener was superseded before its Promise resolved — unlisten immediately
          fn()
          return
        }
        this.unlistenFns.push(fn)
      })
      .catch((e) =>
        console.error('[stream] failed to listen stream-envelope:', e),
      )

    // 接続状態は typed stream-status イベントだけを信じる (#781 Phase 2)
    events.streamStatus
      .listen((event) => {
        if (gen !== this._listenerGeneration) return
        if (event.payload.accountId !== this.accountId) return
        this.setStatus(event.payload.state)
      })
      .then((fn) => {
        if (gen !== this._listenerGeneration) {
          fn()
          return
        }
        this.unlistenFns.push(fn)
      })
      .catch((e) =>
        console.error('[stream] failed to listen stream-status:', e),
      )

    // Rust 側 flusher が DELTA_FLUSH_WINDOW (16ms) でまとめた capture batch を購読。
    // 個別 stream-note-capture-updated は Rust 側で抑止されているので、ここが
    // 唯一の note capture 配信経路になる。
    events.noteCaptureBatch
      .listen((event) => {
        if (gen !== this._listenerGeneration) return
        for (const c of event.payload.captures) {
          if (c.accountId !== this.accountId) continue
          const handlers = this.noteCaptureHandlers.get(c.noteId)
          if (!handlers) continue
          const ev = toNoteUpdateEvent(c.accountId, c.noteId, c)
          for (const h of handlers) h(ev)
        }
      })
      .then((fn) => {
        if (gen !== this._listenerGeneration) {
          fn()
          return
        }
        this.unlistenFns.push(fn)
      })
      .catch((e) =>
        console.error('[stream] failed to listen note-capture-batch:', e),
      )
  }

  cleanup(): void {
    // Invalidate any in-flight listen() Promises so their callbacks become no-ops
    this._listenerGeneration++
    for (const fn of this.unlistenFns) fn()
    this.unlistenFns = []
    this.noteCaptureHandlers.clear()
    this.eventHandlers.clear()
    this.clearGraceTimer()
    this.hasConnected = false
    this._state = 'disconnected'
  }

  disconnect(): void {
    // cleanup が eventHandlers を消すので通知が必要なら先に emit する。
    // 呼び出し元はアカウントのライフサイクル終端 (削除/ログアウト) のみで、
    // カラム側の遷移は hasToken watch とカラム削除が駆動するため通知不要。
    this.cleanup()
    removeStreamHealth(this.accountId)
    commands.streamDisconnect(this.accountId).catch((e) => {
      console.warn('[stream] disconnect failed:', e)
    })
  }

  subNote(noteId: string, handler: (event: NoteUpdateEvent) => void): void {
    const handlers = this.noteCaptureHandlers.get(noteId)
    if (handlers) {
      handlers.add(handler)
      return
    }
    this.noteCaptureHandlers.set(noteId, new Set([handler]))
    commands.streamSubNote(this.accountId, noteId).catch((e) => {
      console.warn('[stream] subNote failed:', e)
    })
  }

  unsubNote(noteId: string, handler?: (event: NoteUpdateEvent) => void): void {
    const handlers = this.noteCaptureHandlers.get(noteId)
    if (!handlers) return
    if (handler) handlers.delete(handler)
    else handlers.clear()
    if (handlers.size > 0) return
    this.noteCaptureHandlers.delete(noteId)
    commands.streamUnsubNote(this.accountId, noteId).catch((e) => {
      console.warn('[stream] unsubNote failed:', e)
    })
  }

  on(
    event: 'connected' | 'disconnected' | 'reconnecting',
    handler: () => void,
  ): void {
    const set = this.eventHandlers.get(event) ?? new Set()
    set.add(handler)
    this.eventHandlers.set(event, set)
  }

  off(event: string, handler: () => void): void {
    this.eventHandlers.get(event)?.delete(handler)
  }

  onRawEvent(handler: (event: RawStreamEvent) => void): void {
    this.rawEventHandlers.add(handler)
  }

  offRawEvent(handler: (event: RawStreamEvent) => void): void {
    this.rawEventHandlers.delete(handler)
  }

  private clearGraceTimer(): void {
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer)
      this.graceTimer = null
    }
  }

  /**
   * Single funnel for connection-status transitions. Recovery to 'connected'
   * is surfaced immediately; an online→offline transition is debounced by
   * OFFLINE_GRACE_MS so brief reconnects (mobile handoff, app resume, the
   * notecli read-idle watchdog's reconnect cycle) don't flicker the offline
   * badge (#507). Centralizing here means all columns sharing this per-account
   * adapter benefit without each holding its own timer.
   */
  private setStatus(state: StreamConnectionState): void {
    // 診断用の生の遷移記録 (#698)。表示用 _state は grace でデバウンス
    // されるが、健康状態の「いつから」は生の真実を記録する
    recordStreamHealth(this.accountId, state)

    if (state === 'connected') {
      this.hasConnected = true
      this.clearGraceTimer()
      this._state = 'connected'
      this.emit('connected')
      return
    }

    // Initial connection failure (never connected): surface immediately —
    // there is no live state to protect from flicker.
    if (!this.hasConnected) {
      this._state = state
      this.emit(state)
      return
    }

    // A live connection dropped. Debounce the offline transition. Don't restart
    // the timer on repeated 'reconnecting', so a persistent outage still falls
    // to offline after the grace window instead of being deferred forever.
    if (this.graceTimer !== null) return
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null
      this._state = state
      this.emit(state)
    }, MisskeyStream.OFFLINE_GRACE_MS)
  }

  private emit(event: string): void {
    for (const handler of this.eventHandlers.get(event) ?? []) {
      handler()
    }
  }
}

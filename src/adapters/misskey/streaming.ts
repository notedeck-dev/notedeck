import { events } from '@/bindings'
import { listenTauri } from '@/utils/tauriEvents'
import { commands, unwrap } from '@/utils/tauriInvoke'
import type {
  NoteUpdateEvent,
  RawStreamEvent,
  StreamAdapter,
  StreamConnectionState,
} from '../types'

export class MisskeyStream implements StreamAdapter {
  private accountId: string
  private _state: StreamConnectionState = 'initializing'
  private eventHandlers = new Map<string, Set<() => void>>()

  // Centralized listeners (registered once in connect(), cleaned up in disconnect())
  private unlistenFns: (() => void)[] = []
  /** Incremented on each registerListeners() call; stale listeners check this to self-discard. */
  private _listenerGeneration = 0

  /** Per-note capture handlers (subNote / unsubNote). */
  private noteCaptureHandlers = new Map<
    string,
    (event: NoteUpdateEvent) => void
  >()
  /** Raw event observers (StreamInspector). */
  private rawEventHandlers = new Set<(event: RawStreamEvent) => void>()

  constructor(accountId: string) {
    this.accountId = accountId
  }

  get state(): StreamConnectionState {
    return this._state
  }

  connect(): void {
    this.registerListeners()

    commands
      .streamConnect(this.accountId)
      .then((result) => {
        unwrap(result)
        this._state = 'connected'
        this.emit('connected')
      })
      .catch((e) => {
        console.error('[stream] connect failed:', e)
        this._state = 'disconnected'
        this.emit('disconnected')
      })
  }

  reconnect(): void {
    // Remove potentially stale listeners (may have been lost during background suspension)
    for (const fn of this.unlistenFns) fn()
    this.unlistenFns = []

    // Re-register fresh listeners (handler maps are preserved)
    this.registerListeners()

    // Ensure Rust-side connection is alive (idempotent — returns Ok if already connected)
    commands
      .streamConnect(this.accountId)
      .then((result) => {
        unwrap(result)
        this._state = 'connected'
        this.emit('connected')
      })
      .catch((e) => {
        // Connection might be reconnecting on Rust side — that's fine
        if (import.meta.env.DEV) console.debug('[stream] reconnect ignored:', e)
      })
  }

  private registerListeners(): void {
    // Bump generation so any in-flight listen() from a previous call will self-discard
    const gen = ++this._listenerGeneration

    listenTauri('stream-event', ({ kind, payload: p }) => {
      // Stale listener guard: if a newer registerListeners() has been called,
      // this callback belongs to a superseded generation — ignore it.
      if (gen !== this._listenerGeneration) return

      if (p.accountId !== this.accountId) return

      // Emit raw envelope to inspector subscribers before dispatch
      if (this.rawEventHandlers.size > 0) {
        const raw: RawStreamEvent = {
          kind,
          payload: p as unknown as Record<string, unknown>,
        }
        for (const h of this.rawEventHandlers) h(raw)
      }

      switch (kind) {
        case 'stream-status':
          if (p.state) {
            this._state = p.state
            this.emit(p.state)
          }
          break
        // 旧来の note / mention / notification / main / chat / note-update /
        // note-capture 系は全て Rust QueryRuntime + NoteCaptureBatch 経由に
        // 移行済み。ここでは raw observer (rawEventHandlers) にだけ流す。
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
      .catch((e) => console.error('[stream] failed to listen stream-event:', e))

    // Rust 側 flusher が DELTA_FLUSH_WINDOW (16ms) でまとめた capture batch を購読。
    // 個別 stream-note-capture-updated は Rust 側で抑止されているので、ここが
    // 唯一の note capture 配信経路になる。
    events.noteCaptureBatch
      .listen((event) => {
        if (gen !== this._listenerGeneration) return
        for (const c of event.payload.captures) {
          if (c.accountId !== this.accountId) continue
          this.noteCaptureHandlers.get(c.noteId)?.({
            noteId: c.noteId,
            type: c.updateType as NoteUpdateEvent['type'],
            body: (c.body ?? {}) as NoteUpdateEvent['body'],
          })
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
    this._state = 'disconnected'
  }

  disconnect(): void {
    this.cleanup()
    commands.streamDisconnect(this.accountId).catch((e) => {
      console.warn('[stream] disconnect failed:', e)
    })
    this.emit('disconnected')
  }

  subNote(noteId: string, handler: (event: NoteUpdateEvent) => void): void {
    this.noteCaptureHandlers.set(noteId, handler)
    commands.streamSubNote(this.accountId, noteId).catch((e) => {
      console.warn('[stream] subNote failed:', e)
    })
  }

  unsubNote(noteId: string): void {
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

  private emit(event: string): void {
    for (const handler of this.eventHandlers.get(event) ?? []) {
      handler()
    }
  }
}

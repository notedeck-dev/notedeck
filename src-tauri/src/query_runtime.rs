use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notecli::error::NoteDeckError;
use notecli::models::{
    ChatMessage, NormalizedNote, NormalizedNotification, NoteUpdateBody, TimelineKey,
};
use notecli::streaming::{StreamEvent, StreamingManager};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager, State};
use tauri_specta::Event;
use tokio::sync::Notify;
use tokio::task::JoinHandle;

use crate::commands::{get_credentials, AppState};

const MAX_READ_MODEL_ITEMS: usize = 200;
/// `Warm` 状態が継続したらこの時間で `Suspended` に escalate する。
/// `MisskeyStream` の旧 pool で使っていた 8s と同じ値。
const WARM_GRACE: Duration = Duration::from_millis(8000);
/// 高頻度 stream event を 1 フレーム分まとめて 1 個の query-delta event に
/// 集約するための debounce 窓。連続イベント時に IPC 数を桁で減らせる。
const DELTA_FLUSH_WINDOW: Duration = Duration::from_millis(16);

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum QueryKey {
    /// notes 系購読の統一キー。`key` は `TimelineKey` の canonical 文字列
    /// (home / antenna:{id} / channel:{id} / role:{id} / user-list:{id} / mentions)。
    /// 折り畳まないと同一購読が 2 通りのキー表現を持ち dedup が破れる。
    /// mentions は識別子としてのみここに属し、購読自体は main チャンネル経由。
    Timeline {
        account_id: String,
        key: String,
    },
    Notifications {
        account_id: String,
    },
    ChatUser {
        account_id: String,
        other_id: String,
    },
    ChatRoom {
        account_id: String,
        room_id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum QueryRuntimeState {
    Live,
    Warm,
    Suspended,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QuerySnapshot {
    pub query_id: String,
    pub key: QueryKey,
    pub runtime_state: QueryRuntimeState,
    pub subscriber_count: u32,
    pub revision: u64,
    pub source_subscription_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QueryReadModelSnapshot {
    pub query_id: String,
    pub revision: u64,
    /// Note ids in display order (newest first). 消費側は JS noteStore から
    /// hydrate するか、未取得 id を adapter API でフェッチする。note 本体は
    /// Rust 側に持たない (二重化回避)。
    pub item_ids: Vec<String>,
}

/// Read-model item flowing through a query delta (#781). Internally tagged so
/// the frontend receives a discriminated union; every variant carries `id`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum QueryItem {
    // Box/Arc は serde/specta とも透過 (ワイヤ形・TS 型は不変)。Note は
    // StreamNoteEvent が Arc で持つため Arc 共有でクローンを O(1) にする。
    Note(std::sync::Arc<NormalizedNote>),
    Notification(Box<NormalizedNotification>),
    ChatMessage(Box<ChatMessage>),
}

impl QueryItem {
    fn id(&self) -> &str {
        match self {
            Self::Note(n) => &n.id,
            Self::Notification(n) => &n.id,
            Self::ChatMessage(m) => &m.id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct QueryDelta {
    pub query_id: String,
    pub revision: u64,
    pub inserts: Vec<QueryItem>,
    pub deletes: Vec<String>,
    /// Partial note updates (reaction add/remove, poll vote, etc.) routed
    /// from `stream-note-updated`. Items in the read model are not rewritten —
    /// consumers apply these to their own per-note state.
    pub updates: Vec<NoteUpdate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteUpdate {
    pub note_id: String,
    /// flatten でワイヤ形 `{ noteId, updateType, body }` を維持する
    #[serde(flatten)]
    pub update: NoteUpdateBody,
}

/// Per-note capture (`subNote`) update. account_id まで付けて mixed-account batch
/// でも JS 側で正しく fan-out できるようにする。
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteCapture {
    pub account_id: String,
    pub note_id: String,
    #[serde(flatten)]
    pub update: NoteUpdateBody,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct NoteCaptureBatch {
    pub captures: Vec<NoteCapture>,
}

#[derive(Debug)]
struct QueryEntry {
    query_id: String,
    key: QueryKey,
    canonical_key: String,
    runtime_state: QueryRuntimeState,
    subscriber_count: u32,
    revision: u64,
    source_subscription_id: Option<String>,
    /// Recent note ids in display order (newest first). `id_set` と一致する。
    /// note 本体は保持せず、JS noteStore (src/stores/notes.ts) が唯一の真実。
    /// dedupe (insert で同一 id を retain しない) と snapshot で消費側に hydrate
    /// のヒントを返すために使う。
    recent_ids: VecDeque<String>,
    /// O(1) dedupe lookup。`recent_ids` と等しい集合 (insert/delete で同期管理)。
    id_set: HashSet<String>,
    /// Accumulated changes since the last delta flush. `None` when no events
    /// have arrived in the current window. Note 本体は pending.inserts に乗せて
    /// JS 側に流す (16ms debounce window でしか保持されない短期バッファ)。
    pending: Option<PendingDelta>,
}

#[derive(Debug, Default)]
struct PendingDelta {
    inserts: Vec<QueryItem>,
    deletes: Vec<String>,
    updates: Vec<NoteUpdate>,
}

#[derive(Default)]
struct QueryRuntimeInner {
    entries: HashMap<String, QueryEntry>,
    ids_by_key: HashMap<String, String>,
    query_ids_by_subscription: HashMap<String, String>,
    /// Pending Warm → Suspended escalation tasks per query. State 遷移時に
    /// abort して入れ替える。
    warm_timers: HashMap<String, JoinHandle<()>>,
    /// Set of query_id whose `entry.pending` is non-None. drain_pending()
    /// が O(active query) で済むよう、全エントリを舐めずに済ませる。
    pending_query_ids: HashSet<String>,
    /// Pending per-note capture updates (subNote 経由)。channel-bound な
    /// query_id を持たないので、QueryEntry とは別に flat な Vec で管理し、
    /// flusher が 1 つの NoteCaptureBatch にまとめて emit する。
    pending_captures: Vec<NoteCapture>,
}

#[derive(Default)]
pub struct QueryRuntime {
    inner: Mutex<QueryRuntimeInner>,
    /// 1 つでも entry に pending が積まれたら notify_one。常駐 flusher task が
    /// notified().await で起き、DELTA_FLUSH_WINDOW スリープ後に drain して emit。
    /// Arc にしてあるのは flusher task が State guard を超えて await できるように
    /// するため。
    flush_notify: Arc<Notify>,
}

impl QueryRuntime {
    pub fn flush_notify(&self) -> Arc<Notify> {
        self.flush_notify.clone()
    }
}

/// Long-running flusher task. Spawned once at app startup. `notified()` で起き
/// (multiple notifies coalesce to one wakeup), DELTA_FLUSH_WINDOW スリープして
/// 同じ window 内の追加イベントを取り込んでから drain & emit する。
pub async fn run_delta_flusher(app: AppHandle) {
    let notify = match app.try_state::<QueryRuntime>() {
        Some(runtime) => runtime.flush_notify(),
        None => return,
    };
    loop {
        notify.notified().await;
        tokio::time::sleep(DELTA_FLUSH_WINDOW).await;
        let Some(runtime) = app.try_state::<QueryRuntime>() else {
            return;
        };
        for delta in runtime.drain_pending() {
            if let Err(e) = delta.emit(&app) {
                tracing::warn!("[query-delta] emit failed: {e}");
            }
        }
        let captures = runtime.drain_captures();
        if !captures.is_empty() {
            if let Err(e) = (NoteCaptureBatch { captures }).emit(&app) {
                tracing::warn!("[note-capture-batch] emit failed: {e}");
            }
        }
    }
}

impl QueryRuntime {
    pub fn open(&self, key: QueryKey) -> Result<QuerySnapshot, NoteDeckError> {
        let canonical_key = canonicalize_key(&key)?;
        let mut inner = self.lock()?;

        if let Some(query_id) = inner.ids_by_key.get(&canonical_key).cloned() {
            let entry = inner
                .entries
                .get_mut(&query_id)
                .ok_or_else(|| runtime_error("query index is inconsistent"))?;
            entry.subscriber_count = entry.subscriber_count.saturating_add(1);
            entry.runtime_state = QueryRuntimeState::Live;
            entry.revision = entry.revision.saturating_add(1);
            return Ok(snapshot(entry));
        }

        let query_id = format!("q:{}", uuid::Uuid::new_v4());
        let entry = QueryEntry {
            query_id: query_id.clone(),
            key,
            canonical_key: canonical_key.clone(),
            runtime_state: QueryRuntimeState::Live,
            subscriber_count: 1,
            revision: 1,
            source_subscription_id: None,
            recent_ids: VecDeque::new(),
            id_set: HashSet::new(),
            pending: None,
        };
        let result = snapshot(&entry);
        inner.ids_by_key.insert(canonical_key, query_id.clone());
        inner.entries.insert(query_id, entry);
        Ok(result)
    }

    pub fn attach_stream_subscription(
        &self,
        query_id: &str,
        subscription_id: String,
    ) -> Result<QuerySnapshot, NoteDeckError> {
        let mut inner = self.lock()?;
        let old_subscription_id = {
            let entry = inner
                .entries
                .get_mut(query_id)
                .ok_or_else(|| runtime_error(format!("unknown query id: {query_id}")))?;

            if entry.source_subscription_id.as_ref() == Some(&subscription_id) {
                return Ok(snapshot(entry));
            }

            let old = entry
                .source_subscription_id
                .replace(subscription_id.clone());
            entry.revision = entry.revision.saturating_add(1);
            old
        };

        if let Some(old) = old_subscription_id {
            inner.query_ids_by_subscription.remove(&old);
        }
        inner
            .query_ids_by_subscription
            .insert(subscription_id, query_id.to_string());
        let entry = inner
            .entries
            .get(query_id)
            .ok_or_else(|| runtime_error(format!("unknown query id: {query_id}")))?;
        Ok(snapshot(entry))
    }

    /// main のような共有 subscription を query に紐付ける。snapshot の
    /// source_subscription_id (JS 側の Stream Inspector フィルタ等) は設定するが、
    /// イベント配送用の query_ids_by_subscription には登録しない — main 由来
    /// イベントは ingest_stream_event が (account, 種別) で解決する (#984)。
    pub fn attach_shared_stream_subscription(
        &self,
        query_id: &str,
        subscription_id: String,
    ) -> Result<QuerySnapshot, NoteDeckError> {
        let mut inner = self.lock()?;
        let entry = inner
            .entries
            .get_mut(query_id)
            .ok_or_else(|| runtime_error(format!("unknown query id: {query_id}")))?;
        if entry.source_subscription_id.as_ref() != Some(&subscription_id) {
            entry.source_subscription_id = Some(subscription_id);
            entry.revision = entry.revision.saturating_add(1);
        }
        Ok(snapshot(entry))
    }

    pub fn stream_subscription_for(
        &self,
        query_id: &str,
    ) -> Result<Option<(String, String)>, NoteDeckError> {
        let inner = self.lock()?;
        let Some(entry) = inner.entries.get(query_id) else {
            return Ok(None);
        };
        let Some(subscription_id) = entry.source_subscription_id.clone() else {
            return Ok(None);
        };
        Ok(Some((account_id(&entry.key).to_string(), subscription_id)))
    }

    pub fn set_runtime_state(
        &self,
        query_id: &str,
        state: QueryRuntimeState,
    ) -> Result<QuerySnapshot, NoteDeckError> {
        let mut inner = self.lock()?;
        let became_suspended = {
            let entry = inner
                .entries
                .get_mut(query_id)
                .ok_or_else(|| runtime_error(format!("unknown query id: {query_id}")))?;
            if entry.runtime_state == state {
                return Ok(snapshot(entry));
            }
            entry.runtime_state = state;
            entry.revision = entry.revision.saturating_add(1);
            if state == QueryRuntimeState::Suspended {
                // 不可視カラムは items を保持しない。Live 復帰時は JS 側 noteStore +
                // 各カラムの orderedIds で表示が維持され、新規 delta だけが流入する。
                entry.recent_ids.clear();
                entry.recent_ids.shrink_to_fit();
                entry.id_set.clear();
                entry.id_set.shrink_to_fit();
                entry.pending = None;
                true
            } else {
                false
            }
        };
        let snap = {
            let entry = inner
                .entries
                .get(query_id)
                .expect("entry just verified to exist");
            snapshot(entry)
        };
        if became_suspended {
            inner.pending_query_ids.remove(query_id);
        }
        Ok(snap)
    }

    /// 既存の warm timer を abort して取り除く。state が Warm 以外に
    /// 遷移したとき・query が close されたときに呼ぶ。
    pub fn cancel_warm_timer(&self, query_id: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(handle) = inner.warm_timers.remove(query_id) {
                handle.abort();
            }
        }
    }

    pub fn register_warm_timer(&self, query_id: &str, handle: JoinHandle<()>) {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(old) = inner.warm_timers.insert(query_id.to_string(), handle) {
                old.abort();
            }
        }
    }

    pub fn close(&self, query_id: &str) -> Result<Option<(String, String)>, NoteDeckError> {
        let mut inner = self.lock()?;
        let Some(entry) = inner.entries.get_mut(query_id) else {
            return Ok(None);
        };

        entry.subscriber_count = entry.subscriber_count.saturating_sub(1);
        entry.revision = entry.revision.saturating_add(1);
        if entry.subscriber_count > 0 {
            return Ok(None);
        }

        let canonical_key = entry.canonical_key.clone();
        let source = entry
            .source_subscription_id
            .clone()
            .map(|subscription_id| (account_id(&entry.key).to_string(), subscription_id));
        if let Some((_, subscription_id)) = source.as_ref() {
            inner.query_ids_by_subscription.remove(subscription_id);
        }
        inner.ids_by_key.remove(&canonical_key);
        inner.pending_query_ids.remove(query_id);
        inner.entries.remove(query_id);
        Ok(source)
    }

    pub fn snapshot(&self, query_id: &str) -> Result<Option<QuerySnapshot>, NoteDeckError> {
        let inner = self.lock()?;
        Ok(inner.entries.get(query_id).map(snapshot))
    }

    pub fn read_model_snapshot(
        &self,
        query_id: &str,
        limit: Option<u32>,
    ) -> Result<Option<QueryReadModelSnapshot>, NoteDeckError> {
        let inner = self.lock()?;
        let Some(entry) = inner.entries.get(query_id) else {
            return Ok(None);
        };
        let limit = limit.unwrap_or(MAX_READ_MODEL_ITEMS as u32) as usize;
        Ok(Some(QueryReadModelSnapshot {
            query_id: entry.query_id.clone(),
            revision: entry.revision,
            item_ids: entry.recent_ids.iter().take(limit).cloned().collect(),
        }))
    }

    /// Apply a stream event to the read model and accumulate it into the
    /// query's pending delta. Returns `true` if a flush should be scheduled
    /// (caller wakes the flusher via `flush_notify`).
    pub fn ingest_stream_event(&self, event: &StreamEvent) -> bool {
        // Per-note capture (subNote) は subscription_id を持たず、QueryEntry とは
        // 別経路で flat に蓄積する。
        if let StreamEvent::NoteCaptureUpdated(capture) = event {
            let Ok(mut inner) = self.inner.lock() else {
                return false;
            };
            inner.pending_captures.push(NoteCapture {
                account_id: capture.account_id.clone(),
                note_id: capture.note_id.clone(),
                update: capture.update.clone(),
            });
            return true;
        }

        // main チャンネル由来 (notification / mention) は subscription_id で引かない。
        // main はアカウント単位 1 本の共有チャンネル (notecli 側で dedup, #984) で、
        // mentions と notifications の両 query がぶら下がるため、1:1 の
        // query_ids_by_subscription では配れない。NoteCaptureUpdated と同様に
        // (account_id, 種別) から対象 query を直接解決する。
        let main_route = match event {
            StreamEvent::Notification(e) => Some((
                QueryKey::Notifications {
                    account_id: e.account_id.clone(),
                },
                StreamChangeKind::Insert(QueryItem::Notification(Box::new(e.notification.clone()))),
            )),
            StreamEvent::Mention(e) => Some((
                QueryKey::Timeline {
                    account_id: e.account_id.clone(),
                    key: TimelineKey::Mentions.as_canonical(),
                },
                StreamChangeKind::Insert(QueryItem::Note(e.note.clone())),
            )),
            _ => None,
        };
        if let Some((key, kind)) = main_route {
            let Ok(canonical_key) = canonicalize_key(&key) else {
                return false;
            };
            let Ok(mut inner) = self.inner.lock() else {
                return false;
            };
            let Some(query_id) = inner.ids_by_key.get(&canonical_key).cloned() else {
                // 対象 query が開いていなければ捨てる (OS 通知・未読バッジは
                // subscription 非依存の別経路なので影響しない)。
                return false;
            };
            let Some(entry) = inner.entries.get_mut(&query_id) else {
                return false;
            };
            if kind.apply(entry) {
                inner.pending_query_ids.insert(query_id);
                return true;
            }
            return false;
        }

        let Some(change) = StreamChange::from_event(event) else {
            return false;
        };
        let Ok(mut inner) = self.inner.lock() else {
            return false;
        };
        let Some(query_id) = inner
            .query_ids_by_subscription
            .get(change.subscription_id)
            .cloned()
        else {
            return false;
        };
        let Some(entry) = inner.entries.get_mut(&query_id) else {
            return false;
        };
        if change.kind.apply(entry) {
            inner.pending_query_ids.insert(query_id);
            true
        } else {
            false
        }
    }

    /// Drain pending captures into a single batch. Empty Vec when nothing
    /// has accumulated.
    pub fn drain_captures(&self) -> Vec<NoteCapture> {
        let Ok(mut inner) = self.inner.lock() else {
            return Vec::new();
        };
        std::mem::take(&mut inner.pending_captures)
    }

    /// Drain pending deltas across all queries with pending changes.
    /// O(pending query 数) — `entries` 全走査は不要。
    pub fn drain_pending(&self) -> Vec<QueryDelta> {
        let Ok(mut inner) = self.inner.lock() else {
            return Vec::new();
        };
        let ids: Vec<String> = inner.pending_query_ids.drain().collect();
        let mut out = Vec::with_capacity(ids.len());
        for query_id in ids {
            let Some(entry) = inner.entries.get_mut(&query_id) else {
                continue;
            };
            let Some(pending) = entry.pending.take() else {
                continue;
            };
            out.push(QueryDelta {
                query_id: entry.query_id.clone(),
                revision: entry.revision,
                inserts: pending.inserts,
                deletes: pending.deletes,
                updates: pending.updates,
            });
        }
        out
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, QueryRuntimeInner>, NoteDeckError> {
        self.inner
            .lock()
            .map_err(|_| runtime_error("query runtime lock poisoned"))
    }
}

/// Decoded change extracted from a stream-* event before it is applied to a query entry.
struct StreamChange<'a> {
    subscription_id: &'a str,
    kind: StreamChangeKind,
}

enum StreamChangeKind {
    Insert(QueryItem),
    Delete(String),
    Update(NoteUpdate),
}

impl<'a> StreamChange<'a> {
    /// typed StreamEvent から read model への変更を取り出す (#781 Phase 3)。
    /// 生 JSON の再 parse はもう存在しない — 型は WS 境界で確定済み。
    /// Notification / Mention は main 由来のため ingest_stream_event の
    /// (account, 種別) ルーティングが先に処理し、ここには来ない。
    fn from_event(event: &'a StreamEvent) -> Option<Self> {
        let (subscription_id, kind) = match event {
            StreamEvent::Note(e) => (
                e.subscription_id.as_str(),
                StreamChangeKind::Insert(QueryItem::Note(e.note.clone())),
            ),
            StreamEvent::ChatMessage(e) => (
                e.subscription_id.as_str(),
                StreamChangeKind::Insert(QueryItem::ChatMessage(Box::new(e.message.clone()))),
            ),
            StreamEvent::NoteUpdated(e) => (
                e.subscription_id.as_str(),
                match &e.update {
                    NoteUpdateBody::Deleted(_) => StreamChangeKind::Delete(e.note_id.clone()),
                    update => StreamChangeKind::Update(NoteUpdate {
                        note_id: e.note_id.clone(),
                        update: update.clone(),
                    }),
                },
            ),
            StreamEvent::ChatMessageDeleted(e) => (
                e.subscription_id.as_str(),
                StreamChangeKind::Delete(e.message_id.clone()),
            ),
            _ => return None,
        };
        Some(Self {
            subscription_id,
            kind,
        })
    }
}

impl StreamChangeKind {
    /// recent_ids / id_set / revision を即時更新しつつ、emit するための変更を
    /// `entry.pending` に積む。返り値は「flusher を起こすべきか」のフラグ
    /// (= 何かが pending に入ったか)。
    fn apply(self, entry: &mut QueryEntry) -> bool {
        // Suspended カラムには何も書き込まない (set_runtime_state(Suspended)
        // で recent_ids/pending を空にしてあるため)。WebSocket subscription
        // 自体も suspend されているはずだが、レース対策として gate しておく。
        if entry.runtime_state == QueryRuntimeState::Suspended {
            return false;
        }
        match self {
            StreamChangeKind::Insert(item) => {
                let id = item.id().to_string();
                if entry.id_set.contains(&id) {
                    // 既存 id は順序を更新するため一度抜く (同じ Vec 上で先頭に詰め直す)。
                    entry.recent_ids.retain(|i| i != &id);
                } else {
                    entry.id_set.insert(id.clone());
                }
                entry.recent_ids.push_front(id);
                while entry.recent_ids.len() > MAX_READ_MODEL_ITEMS {
                    if let Some(evicted) = entry.recent_ids.pop_back() {
                        entry.id_set.remove(&evicted);
                    }
                }
                entry.revision = entry.revision.saturating_add(1);
                entry
                    .pending
                    .get_or_insert_with(PendingDelta::default)
                    .inserts
                    .push(item);
                true
            }
            StreamChangeKind::Delete(id) => {
                if !entry.id_set.remove(&id) {
                    return false;
                }
                entry.recent_ids.retain(|i| i != &id);
                entry.revision = entry.revision.saturating_add(1);
                entry
                    .pending
                    .get_or_insert_with(PendingDelta::default)
                    .deletes
                    .push(id);
                true
            }
            StreamChangeKind::Update(update) => {
                entry.revision = entry.revision.saturating_add(1);
                entry
                    .pending
                    .get_or_insert_with(PendingDelta::default)
                    .updates
                    .push(update);
                true
            }
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn query_subscribe_timeline(
    app_state: State<'_, AppState>,
    streaming: State<'_, StreamingManager>,
    runtime: State<'_, QueryRuntime>,
    account_id: String,
    timeline_type: String,
    list_id: Option<String>,
) -> Result<QuerySnapshot, NoteDeckError> {
    let db = app_state.db().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    streaming.connect(&account_id, &host, &token).await?;

    // 境界アダプタ: ('user-list', listId) → canonical キー合成 (api_get_timeline と同規約)
    let tl_key = if timeline_type == "user-list" {
        match list_id {
            Some(ref list_id) => TimelineKey::UserList {
                list_id: list_id.clone(),
            },
            None => {
                return Err(NoteDeckError::InvalidInput(
                    "user-list timeline requires listId".to_string(),
                ))
            }
        }
    } else {
        TimelineKey::parse(&timeline_type)?
    };
    let key = QueryKey::Timeline {
        account_id: account_id.clone(),
        key: tl_key.as_canonical(),
    };
    let opened = runtime.open(key)?;
    if opened.source_subscription_id.is_some() {
        return Ok(opened);
    }

    let subscription_id = streaming.subscribe_notes(&account_id, tl_key, None).await?;
    runtime.attach_stream_subscription(&opened.query_id, subscription_id)
}

#[tauri::command]
#[specta::specta]
pub async fn query_subscribe_antenna(
    app_state: State<'_, AppState>,
    streaming: State<'_, StreamingManager>,
    runtime: State<'_, QueryRuntime>,
    account_id: String,
    antenna_id: String,
) -> Result<QuerySnapshot, NoteDeckError> {
    let db = app_state.db().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    streaming.connect(&account_id, &host, &token).await?;

    let tl_key = TimelineKey::Antenna {
        antenna_id: antenna_id.clone(),
    };
    let opened = runtime.open(QueryKey::Timeline {
        account_id: account_id.clone(),
        key: tl_key.as_canonical(),
    })?;
    if opened.source_subscription_id.is_some() {
        return Ok(opened);
    }

    let subscription_id = streaming.subscribe_notes(&account_id, tl_key, None).await?;
    runtime.attach_stream_subscription(&opened.query_id, subscription_id)
}

#[tauri::command]
#[specta::specta]
pub async fn query_subscribe_channel(
    app_state: State<'_, AppState>,
    streaming: State<'_, StreamingManager>,
    runtime: State<'_, QueryRuntime>,
    account_id: String,
    channel_id: String,
) -> Result<QuerySnapshot, NoteDeckError> {
    let db = app_state.db().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    streaming.connect(&account_id, &host, &token).await?;

    let tl_key = TimelineKey::Channel {
        channel_id: channel_id.clone(),
    };
    let opened = runtime.open(QueryKey::Timeline {
        account_id: account_id.clone(),
        key: tl_key.as_canonical(),
    })?;
    if opened.source_subscription_id.is_some() {
        return Ok(opened);
    }

    let subscription_id = streaming.subscribe_notes(&account_id, tl_key, None).await?;
    runtime.attach_stream_subscription(&opened.query_id, subscription_id)
}

#[tauri::command]
#[specta::specta]
pub async fn query_subscribe_role(
    app_state: State<'_, AppState>,
    streaming: State<'_, StreamingManager>,
    runtime: State<'_, QueryRuntime>,
    account_id: String,
    role_id: String,
) -> Result<QuerySnapshot, NoteDeckError> {
    let db = app_state.db().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    streaming.connect(&account_id, &host, &token).await?;

    let tl_key = TimelineKey::Role {
        role_id: role_id.clone(),
    };
    let opened = runtime.open(QueryKey::Timeline {
        account_id: account_id.clone(),
        key: tl_key.as_canonical(),
    })?;
    if opened.source_subscription_id.is_some() {
        return Ok(opened);
    }

    let subscription_id = streaming.subscribe_notes(&account_id, tl_key, None).await?;
    runtime.attach_stream_subscription(&opened.query_id, subscription_id)
}

#[tauri::command]
#[specta::specta]
pub async fn query_subscribe_mentions(
    app_state: State<'_, AppState>,
    streaming: State<'_, StreamingManager>,
    runtime: State<'_, QueryRuntime>,
    account_id: String,
) -> Result<QuerySnapshot, NoteDeckError> {
    let db = app_state.db().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    streaming.connect(&account_id, &host, &token).await?;

    // mentions は QueryKey 識別子としてのみ Timeline に折り畳む。
    // 購読は従来どおり main チャンネル経由 (ws_channel を持たない種別)。
    let opened = runtime.open(QueryKey::Timeline {
        account_id: account_id.clone(),
        key: TimelineKey::Mentions.as_canonical(),
    })?;
    if opened.source_subscription_id.is_some() {
        return Ok(opened);
    }

    // main はアカウント単位 1 本の共有チャンネル (notecli 側で dedup)。
    // イベントは (account, 種別) で解決するため shared attach を使う (#984)。
    let subscription_id = streaming.subscribe_main(&account_id).await?;
    runtime.attach_shared_stream_subscription(&opened.query_id, subscription_id)
}

#[tauri::command]
#[specta::specta]
pub async fn query_subscribe_notifications(
    app_state: State<'_, AppState>,
    streaming: State<'_, StreamingManager>,
    runtime: State<'_, QueryRuntime>,
    account_id: String,
) -> Result<QuerySnapshot, NoteDeckError> {
    let db = app_state.db().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    streaming.connect(&account_id, &host, &token).await?;

    let opened = runtime.open(QueryKey::Notifications {
        account_id: account_id.clone(),
    })?;
    if opened.source_subscription_id.is_some() {
        return Ok(opened);
    }

    // main はアカウント単位 1 本の共有チャンネル (notecli 側で dedup)。
    // イベントは (account, 種別) で解決するため shared attach を使う (#984)。
    let subscription_id = streaming.subscribe_main(&account_id).await?;
    runtime.attach_shared_stream_subscription(&opened.query_id, subscription_id)
}

#[tauri::command]
#[specta::specta]
pub async fn query_subscribe_chat_user(
    app_state: State<'_, AppState>,
    streaming: State<'_, StreamingManager>,
    runtime: State<'_, QueryRuntime>,
    account_id: String,
    other_id: String,
) -> Result<QuerySnapshot, NoteDeckError> {
    let db = app_state.db().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    streaming.connect(&account_id, &host, &token).await?;

    let opened = runtime.open(QueryKey::ChatUser {
        account_id: account_id.clone(),
        other_id: other_id.clone(),
    })?;
    if opened.source_subscription_id.is_some() {
        return Ok(opened);
    }

    let subscription_id = streaming
        .subscribe_chat_user(&account_id, &other_id)
        .await?;
    runtime.attach_stream_subscription(&opened.query_id, subscription_id)
}

#[tauri::command]
#[specta::specta]
pub async fn query_subscribe_chat_room(
    app_state: State<'_, AppState>,
    streaming: State<'_, StreamingManager>,
    runtime: State<'_, QueryRuntime>,
    account_id: String,
    room_id: String,
) -> Result<QuerySnapshot, NoteDeckError> {
    let db = app_state.db().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    streaming.connect(&account_id, &host, &token).await?;

    let opened = runtime.open(QueryKey::ChatRoom {
        account_id: account_id.clone(),
        room_id: room_id.clone(),
    })?;
    if opened.source_subscription_id.is_some() {
        return Ok(opened);
    }

    let subscription_id = streaming.subscribe_chat_room(&account_id, &room_id).await?;
    runtime.attach_stream_subscription(&opened.query_id, subscription_id)
}

// query_open (QueryKey を invoke 引数に取る汎用オープン) は削除した。
// 折り畳み後は key 文字列が無検証で entry 化され TimelineKey の構築規約の
// 裏口になる上、フロント呼び出しもゼロだった。復活させる場合は
// TimelineKey::parse による検証を必須とすること (issue notecli#30 仕様 v5 §6-5)。

#[tauri::command]
#[specta::specta]
pub async fn query_set_runtime_state(
    app: AppHandle,
    streaming: State<'_, StreamingManager>,
    runtime: State<'_, QueryRuntime>,
    query_id: String,
    state: QueryRuntimeState,
) -> Result<QuerySnapshot, NoteDeckError> {
    let result = runtime.set_runtime_state(&query_id, state)?;
    let stream_target = runtime.stream_subscription_for(&query_id)?;

    match state {
        QueryRuntimeState::Live => {
            // 既存の warm escalation を取り消す
            runtime.cancel_warm_timer(&query_id);
            if let Some((account_id, subscription_id)) = stream_target {
                streaming
                    .resume_subscription(&account_id, &subscription_id)
                    .await?;
            }
        }
        QueryRuntimeState::Suspended => {
            runtime.cancel_warm_timer(&query_id);
            if let Some((account_id, subscription_id)) = stream_target {
                streaming
                    .suspend_subscription(&account_id, &subscription_id)
                    .await?;
            }
        }
        QueryRuntimeState::Warm => {
            // WARM_GRACE 後に Suspended に遷移する task を spawn。途中で
            // Live に戻ったら cancel_warm_timer で abort される。
            if stream_target.is_some() {
                let app_handle = app.clone();
                let query_id_owned = query_id.clone();
                let handle = tokio::spawn(async move {
                    tokio::time::sleep(WARM_GRACE).await;
                    let runtime = match app_handle.try_state::<QueryRuntime>() {
                        Some(r) => r,
                        None => return,
                    };
                    let streaming = match app_handle.try_state::<StreamingManager>() {
                        Some(s) => s,
                        None => return,
                    };
                    // この時点で Warm のままなら Suspended に escalate
                    let snap = match runtime.snapshot(&query_id_owned).ok().flatten() {
                        Some(s) => s,
                        None => return,
                    };
                    if snap.runtime_state != QueryRuntimeState::Warm {
                        return;
                    }
                    let _ =
                        runtime.set_runtime_state(&query_id_owned, QueryRuntimeState::Suspended);
                    if let Ok(Some((account_id, subscription_id))) =
                        runtime.stream_subscription_for(&query_id_owned)
                    {
                        let _ = streaming
                            .suspend_subscription(&account_id, &subscription_id)
                            .await;
                    }
                });
                runtime.register_warm_timer(&query_id, handle);
            }
        }
    }
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn query_close(
    streaming: State<'_, StreamingManager>,
    runtime: State<'_, QueryRuntime>,
    query_id: String,
) -> Result<(), NoteDeckError> {
    runtime.cancel_warm_timer(&query_id);
    if let Some((account_id, subscription_id)) = runtime.close(&query_id)? {
        streaming.unsubscribe(&account_id, &subscription_id).await?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn query_get_snapshot(
    runtime: State<'_, QueryRuntime>,
    query_id: String,
) -> Result<Option<QuerySnapshot>, NoteDeckError> {
    runtime.snapshot(&query_id)
}

#[tauri::command]
#[specta::specta]
pub async fn query_get_read_model_snapshot(
    runtime: State<'_, QueryRuntime>,
    query_id: String,
    limit: Option<u32>,
) -> Result<Option<QueryReadModelSnapshot>, NoteDeckError> {
    runtime.read_model_snapshot(&query_id, limit)
}

fn snapshot(entry: &QueryEntry) -> QuerySnapshot {
    QuerySnapshot {
        query_id: entry.query_id.clone(),
        key: entry.key.clone(),
        runtime_state: entry.runtime_state,
        subscriber_count: entry.subscriber_count,
        revision: entry.revision,
        source_subscription_id: entry.source_subscription_id.clone(),
    }
}

fn canonicalize_key(key: &QueryKey) -> Result<String, NoteDeckError> {
    serde_json::to_string(key).map_err(|e| runtime_error(format!("invalid query key: {e}")))
}

fn runtime_error(message: impl Into<String>) -> NoteDeckError {
    NoteDeckError::InvalidInput(message.into())
}

fn account_id(key: &QueryKey) -> &str {
    match key {
        QueryKey::Timeline { account_id, .. }
        | QueryKey::Notifications { account_id }
        | QueryKey::ChatUser { account_id, .. }
        | QueryKey::ChatRoom { account_id, .. } => account_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notecli::models::{NoteDeletedBody, NoteReactedBody};
    use notecli::streaming::{
        StreamMentionEvent, StreamNoteEvent, StreamNoteUpdatedEvent, StreamNotificationEvent,
    };
    use serde_json::json;

    fn home_key(account: &str) -> QueryKey {
        QueryKey::Timeline {
            account_id: account.into(),
            key: "home".into(),
        }
    }

    fn open_home(rt: &QueryRuntime, account: &str) -> QuerySnapshot {
        rt.open(home_key(account)).expect("open should succeed")
    }

    fn test_note(note_id: &str) -> std::sync::Arc<NormalizedNote> {
        // serde 経由で構築し、default フィールドの列挙を避ける
        std::sync::Arc::new(
            serde_json::from_value(json!({
                "id": note_id,
                "_accountId": "acct-1",
                "_serverHost": "misskey.example",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "user": { "id": "u1", "username": "alice" },
                "visibility": "public",
                "renoteCount": 0,
                "repliesCount": 0
            }))
            .expect("test note fixture should deserialize"),
        )
    }

    fn note_event(sub_id: &str, note_id: &str) -> StreamEvent {
        StreamEvent::Note(Box::new(StreamNoteEvent {
            account_id: "acct-1".into(),
            subscription_id: sub_id.into(),
            note: test_note(note_id),
        }))
    }

    fn delete_event(sub_id: &str, note_id: &str) -> StreamEvent {
        StreamEvent::NoteUpdated(Box::new(StreamNoteUpdatedEvent {
            account_id: "acct-1".into(),
            subscription_id: sub_id.into(),
            note_id: note_id.into(),
            update: NoteUpdateBody::Deleted(NoteDeletedBody {
                deleted_at: Some("2026-01-01T00:00:00.000Z".into()),
            }),
        }))
    }

    fn reaction_event(sub_id: &str, note_id: &str) -> StreamEvent {
        StreamEvent::NoteUpdated(Box::new(StreamNoteUpdatedEvent {
            account_id: "acct-1".into(),
            subscription_id: sub_id.into(),
            note_id: note_id.into(),
            update: NoteUpdateBody::Reacted(NoteReactedBody {
                reaction: ":+1:".into(),
                emoji: None,
                user_id: Some("u1".into()),
            }),
        }))
    }

    fn mentions_key(account: &str) -> QueryKey {
        QueryKey::Timeline {
            account_id: account.into(),
            key: "mentions".into(),
        }
    }

    fn notifications_key(account: &str) -> QueryKey {
        QueryKey::Notifications {
            account_id: account.into(),
        }
    }

    fn notification_event(sub_id: &str, account: &str, notification_id: &str) -> StreamEvent {
        StreamEvent::Notification(Box::new(StreamNotificationEvent {
            account_id: account.into(),
            subscription_id: sub_id.into(),
            notification: serde_json::from_value(json!({
                "id": notification_id,
                "_accountId": account,
                "_serverHost": "misskey.example",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "type": "reaction"
            }))
            .expect("test notification fixture should deserialize"),
        }))
    }

    fn mention_event(sub_id: &str, account: &str, note_id: &str) -> StreamEvent {
        StreamEvent::Mention(Box::new(StreamMentionEvent {
            account_id: account.into(),
            subscription_id: sub_id.into(),
            note: test_note(note_id),
        }))
    }

    /// main 由来イベントは subscription_id ではなく (account, 種別) で解決する。
    /// main はアカウント単位 1 本の共有チャンネルで、mentions / notifications の
    /// 両 query がぶら下がるため、1:1 の subscription マップでは配れない (#984)。
    #[test]
    fn main_events_route_by_account_and_kind() {
        let rt = QueryRuntime::default();
        let mentions = rt.open(mentions_key("acct-1")).unwrap();
        let notifications = rt.open(notifications_key("acct-1")).unwrap();

        // どちらの query にも attach していない状態で main イベントが届く
        // (subscription_id はどの query とも紐付いていない共有 main の id)。
        assert!(rt.ingest_stream_event(&notification_event("sub-main", "acct-1", "notif-1")));
        assert!(rt.ingest_stream_event(&mention_event("sub-main", "acct-1", "note-1")));

        let notif_snap = rt
            .read_model_snapshot(&notifications.query_id, None)
            .unwrap()
            .unwrap();
        assert_eq!(
            notif_snap.item_ids,
            vec!["notif-1"],
            "通知は通知 query だけに入る"
        );

        let mention_snap = rt
            .read_model_snapshot(&mentions.query_id, None)
            .unwrap()
            .unwrap();
        assert_eq!(
            mention_snap.item_ids,
            vec!["note-1"],
            "メンションはメンション query だけに入る"
        );
    }

    /// 別アカウントの main イベントは別アカウントの query に入らない。
    #[test]
    fn main_events_do_not_cross_accounts() {
        let rt = QueryRuntime::default();
        let n1 = rt.open(notifications_key("acct-1")).unwrap();
        let n2 = rt.open(notifications_key("acct-2")).unwrap();

        assert!(rt.ingest_stream_event(&notification_event("sub-main", "acct-2", "notif-x")));

        let snap1 = rt.read_model_snapshot(&n1.query_id, None).unwrap().unwrap();
        assert!(snap1.item_ids.is_empty());
        let snap2 = rt.read_model_snapshot(&n2.query_id, None).unwrap().unwrap();
        assert_eq!(snap2.item_ids, vec!["notif-x"]);
    }

    /// メンション query を suspend / close しても通知の配送は止まらない (#984 の
    /// 巻き添えパターンの回帰テスト)。
    #[test]
    fn notification_delivery_survives_mentions_suspend_and_close() {
        let rt = QueryRuntime::default();
        let mentions = rt.open(mentions_key("acct-1")).unwrap();
        let notifications = rt.open(notifications_key("acct-1")).unwrap();

        rt.set_runtime_state(&mentions.query_id, QueryRuntimeState::Suspended)
            .unwrap();
        assert!(rt.ingest_stream_event(&notification_event("sub-main", "acct-1", "notif-1")));

        rt.close(&mentions.query_id).unwrap();
        assert!(rt.ingest_stream_event(&notification_event("sub-main", "acct-1", "notif-2")));

        let snap = rt
            .read_model_snapshot(&notifications.query_id, None)
            .unwrap()
            .unwrap();
        assert_eq!(snap.item_ids, vec!["notif-2", "notif-1"]);
    }

    /// 開いていない種別の main イベントは黙って捨てる (OS 通知・未読バッジは
    /// 別経路なので影響しない)。
    #[test]
    fn main_events_without_open_query_are_dropped() {
        let rt = QueryRuntime::default();
        assert!(!rt.ingest_stream_event(&notification_event("sub-main", "acct-1", "notif-1")));
    }

    /// T1: 同一 key で 2 回 open すると subscriber=2、query_id は同一、
    /// revision は 1 回目で 1、2 回目で 2 になる。
    #[test]
    fn open_creates_entry_and_increments_revision() {
        let rt = QueryRuntime::default();
        let s1 = open_home(&rt, "acct-1");
        assert_eq!(s1.subscriber_count, 1);
        assert_eq!(s1.revision, 1);

        let s2 = open_home(&rt, "acct-1");
        assert_eq!(s2.query_id, s1.query_id);
        assert_eq!(s2.subscriber_count, 2);
        assert_eq!(s2.revision, 2);
    }

    /// T2: 2 回 open → 2 回 close で entry が消える。snapshot が None を返す。
    #[test]
    fn close_decrements_then_removes() {
        let rt = QueryRuntime::default();
        let s = open_home(&rt, "acct-1");
        let _ = open_home(&rt, "acct-1");

        // 1 回目 close: subscriber 1 残るので Some(None)
        let after_first = rt.close(&s.query_id).unwrap();
        assert!(after_first.is_none(), "subscription はまだ生きているはず");
        assert!(rt.snapshot(&s.query_id).unwrap().is_some());

        // 2 回目 close: 0 になり entry が消える。subscription が attach されていないので戻り値は None。
        let after_second = rt.close(&s.query_id).unwrap();
        assert!(after_second.is_none());
        assert!(rt.snapshot(&s.query_id).unwrap().is_none());
    }

    /// T3: attach 後の close は `(account_id, subscription_id)` を返す。
    #[test]
    fn close_returns_subscription_for_unsubscribe() {
        let rt = QueryRuntime::default();
        let s = open_home(&rt, "acct-1");
        rt.attach_stream_subscription(&s.query_id, "sub-A".into())
            .unwrap();

        let result = rt.close(&s.query_id).unwrap();
        assert_eq!(result, Some(("acct-1".to_string(), "sub-A".to_string())));
    }

    /// T4: 同じ id を 2 回 insert しても read model は長さ 1。
    #[test]
    fn ingest_insert_dedupes_by_id() {
        let rt = QueryRuntime::default();
        let s = open_home(&rt, "acct-1");
        rt.attach_stream_subscription(&s.query_id, "sub-A".into())
            .unwrap();

        assert!(rt.ingest_stream_event(&note_event("sub-A", "n1")));
        assert!(rt.ingest_stream_event(&note_event("sub-A", "n1")));

        let snap = rt.read_model_snapshot(&s.query_id, None).unwrap().unwrap();
        assert_eq!(snap.item_ids.len(), 1);
        assert_eq!(snap.item_ids[0], "n1");
    }

    /// T5: 存在しない id の delete は false。存在する id の delete は revision++。
    #[test]
    fn ingest_delete_removes_only_when_present() {
        let rt = QueryRuntime::default();
        let s = open_home(&rt, "acct-1");
        rt.attach_stream_subscription(&s.query_id, "sub-A".into())
            .unwrap();

        // unknown id - 何も起きない
        assert!(!rt.ingest_stream_event(&delete_event("sub-A", "ghost")));

        // 既存 id - 削除される
        assert!(rt.ingest_stream_event(&note_event("sub-A", "n1")));
        let rev_before = rt.snapshot(&s.query_id).unwrap().unwrap().revision;
        assert!(rt.ingest_stream_event(&delete_event("sub-A", "n1")));
        let rev_after = rt.snapshot(&s.query_id).unwrap().unwrap().revision;
        assert!(rev_after > rev_before, "delete で revision が上がるはず");

        let snap = rt.read_model_snapshot(&s.query_id, None).unwrap().unwrap();
        assert!(snap.item_ids.is_empty());
    }

    /// T6: stream-note-updated (reaction 等) は recent_ids は変えず、pending.updates にだけ積む。
    #[test]
    fn ingest_update_does_not_modify_recent_ids() {
        let rt = QueryRuntime::default();
        let s = open_home(&rt, "acct-1");
        rt.attach_stream_subscription(&s.query_id, "sub-A".into())
            .unwrap();
        rt.ingest_stream_event(&note_event("sub-A", "n1"));

        // drain して initial insert を流し、テスト対象を分離
        let _ = rt.drain_pending();

        assert!(rt.ingest_stream_event(&reaction_event("sub-A", "n1")));

        let snap = rt.read_model_snapshot(&s.query_id, None).unwrap().unwrap();
        assert_eq!(
            snap.item_ids.len(),
            1,
            "reaction で recent_ids は変わらない"
        );

        let drained = rt.drain_pending();
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].updates.len(), 1);
        assert_eq!(drained[0].updates[0].note_id, "n1");
        assert!(matches!(
            drained[0].updates[0].update,
            NoteUpdateBody::Reacted(_)
        ));
        assert!(drained[0].inserts.is_empty());
        assert!(drained[0].deletes.is_empty());
    }

    /// T7: MAX_READ_MODEL_ITEMS + 1 件 insert で recent_ids は MAX に切り詰められる。
    #[test]
    fn truncate_at_max() {
        let rt = QueryRuntime::default();
        let s = open_home(&rt, "acct-1");
        rt.attach_stream_subscription(&s.query_id, "sub-A".into())
            .unwrap();

        for i in 0..(MAX_READ_MODEL_ITEMS + 1) {
            let id = format!("n{i}");
            rt.ingest_stream_event(&note_event("sub-A", &id));
        }

        let snap = rt.read_model_snapshot(&s.query_id, None).unwrap().unwrap();
        assert_eq!(snap.item_ids.len(), MAX_READ_MODEL_ITEMS);
    }

    /// T8: drain_pending は積まれた pending を 1 度だけ返し、再度呼ぶと空。新規イベントで再び返る。
    #[test]
    fn pending_query_ids_drained_atomically() {
        let rt = QueryRuntime::default();
        let s = open_home(&rt, "acct-1");
        rt.attach_stream_subscription(&s.query_id, "sub-A".into())
            .unwrap();

        rt.ingest_stream_event(&note_event("sub-A", "n1"));
        let first = rt.drain_pending();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].inserts.len(), 1);

        // 2 回目はもう空
        let second = rt.drain_pending();
        assert!(second.is_empty(), "drain は冪等で 2 度目は空");

        // 新規イベントで再度積まれる
        rt.ingest_stream_event(&note_event("sub-A", "n2"));
        let third = rt.drain_pending();
        assert_eq!(third.len(), 1);
    }

    /// T9: read_model_snapshot は limit を尊重し、None なら MAX_READ_MODEL_ITEMS まで返す。
    #[test]
    fn read_model_snapshot_respects_limit() {
        let rt = QueryRuntime::default();
        let s = open_home(&rt, "acct-1");
        rt.attach_stream_subscription(&s.query_id, "sub-A".into())
            .unwrap();

        for i in 0..50 {
            let id = format!("n{i}");
            rt.ingest_stream_event(&note_event("sub-A", &id));
        }

        let limited = rt
            .read_model_snapshot(&s.query_id, Some(10))
            .unwrap()
            .unwrap();
        assert_eq!(limited.item_ids.len(), 10);

        let unlimited = rt.read_model_snapshot(&s.query_id, None).unwrap().unwrap();
        assert_eq!(unlimited.item_ids.len(), 50);
    }

    /// T10: attach されていない subscription_id の event は false で破棄される。
    #[test]
    fn unknown_subscription_id_is_dropped() {
        let rt = QueryRuntime::default();
        let s = open_home(&rt, "acct-1");
        // attach せずに event を流す
        assert!(!rt.ingest_stream_event(&note_event("sub-orphan", "n1")));

        let snap = rt.read_model_snapshot(&s.query_id, None).unwrap().unwrap();
        assert!(snap.item_ids.is_empty());
    }

    /// T11: Suspended に遷移すると recent_ids と pending が完全にクリアされる。
    #[test]
    fn suspended_state_clears_recent_ids_and_pending() {
        let rt = QueryRuntime::default();
        let s = open_home(&rt, "acct-1");
        rt.attach_stream_subscription(&s.query_id, "sub-A".into())
            .unwrap();
        // 5 件 insert
        for i in 0..5 {
            rt.ingest_stream_event(&note_event("sub-A", &format!("n{i}")));
        }
        // pending には 5 件積まれている (まだ drain していない)
        let pre = rt.read_model_snapshot(&s.query_id, None).unwrap().unwrap();
        assert_eq!(pre.item_ids.len(), 5);

        rt.set_runtime_state(&s.query_id, QueryRuntimeState::Suspended)
            .unwrap();

        let post = rt.read_model_snapshot(&s.query_id, None).unwrap().unwrap();
        assert!(post.item_ids.is_empty(), "Suspended で recent_ids クリア");
        // 蓄積していた pending も破棄される (drain は空)
        let drained = rt.drain_pending();
        assert!(drained.is_empty(), "Suspended で pending もクリア");
    }

    /// T12: Suspended 中の event は false を返し、recent_ids も pending も増えない。
    #[test]
    fn suspended_state_drops_incoming_events() {
        let rt = QueryRuntime::default();
        let s = open_home(&rt, "acct-1");
        rt.attach_stream_subscription(&s.query_id, "sub-A".into())
            .unwrap();
        rt.set_runtime_state(&s.query_id, QueryRuntimeState::Suspended)
            .unwrap();

        // Suspended 中はレース対策で gate される
        assert!(!rt.ingest_stream_event(&note_event("sub-A", "n1")));

        let snap = rt.read_model_snapshot(&s.query_id, None).unwrap().unwrap();
        assert!(snap.item_ids.is_empty());
        assert!(rt.drain_pending().is_empty());
    }

    /// T13: Suspended → Live 復帰直後は recent_ids 空、新規 insert で 1 件になる。
    #[test]
    fn live_after_suspended_starts_empty_until_new_event() {
        let rt = QueryRuntime::default();
        let s = open_home(&rt, "acct-1");
        rt.attach_stream_subscription(&s.query_id, "sub-A".into())
            .unwrap();
        rt.ingest_stream_event(&note_event("sub-A", "old"));

        rt.set_runtime_state(&s.query_id, QueryRuntimeState::Suspended)
            .unwrap();
        rt.set_runtime_state(&s.query_id, QueryRuntimeState::Live)
            .unwrap();

        let after_resume = rt.read_model_snapshot(&s.query_id, None).unwrap().unwrap();
        assert!(after_resume.item_ids.is_empty(), "復帰直後は空");

        rt.ingest_stream_event(&note_event("sub-A", "fresh"));
        let after_event = rt.read_model_snapshot(&s.query_id, None).unwrap().unwrap();
        assert_eq!(after_event.item_ids, vec!["fresh".to_string()]);
    }

    /// T14: Suspended 遷移時に pending_query_ids からも除去される (drain が空 Vec)。
    #[test]
    fn pending_query_ids_purged_on_suspend() {
        let rt = QueryRuntime::default();
        let s = open_home(&rt, "acct-1");
        rt.attach_stream_subscription(&s.query_id, "sub-A".into())
            .unwrap();
        // pending に何か積む
        rt.ingest_stream_event(&note_event("sub-A", "n1"));

        // Suspended に遷移すると pending_query_ids からも消える
        rt.set_runtime_state(&s.query_id, QueryRuntimeState::Suspended)
            .unwrap();

        let drained = rt.drain_pending();
        assert!(drained.is_empty(), "Suspended で drain は空 Vec");
    }
}

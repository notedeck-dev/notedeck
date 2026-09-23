//! メディアの先行取得キュー。
//!
//! 流速の速い TL では新規ノートのカスタム絵文字が「初めて見る」ものばかりで、
//! 表示のたびに上流取得 + 変換 (100〜500ms) を待つと絵文字だけ遅れて出る。
//! 辞書 (`/api/emojis`) が届いた時点で全絵文字の variant を低優先で
//! 取りにいき、ノートが来たときにはディスク/メモリキャッシュに居る状態を
//! 作る。既にキャッシュ済みのものは取り出し時に飛ばすので、2 回目以降の
//! 起動では差分だけが走る。
//!
//! 表示要求 (`<img>`) と同じ `ensure_media_inner` を通るので、429 の throttle
//! 窓・circuit breaker・negative cache・取得セマフォはそのまま効く。worker
//! 数と間隔を絞って、表示要求の枠と CDN のレート制限を食わないようにする。
//! Tauri 非依存。`commands/utility.rs` の `warm_media` が IPC アダプタ。

use std::collections::{HashSet, VecDeque};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{Mutex, Notify};

use crate::image_cache::ImageCache;
use crate::media_proxy::{ensure_media_inner, MediaRequest};

/// キューの上限。超えたら古い方から落とす (大規模サーバー 1 host 分 +
/// 余裕。無制限にしない — #987)
pub const MAX_QUEUE: usize = 40_000;
/// 並列 worker 数。表示要求の取得セマフォ (既定 30) を食わない程度
const WORKERS: usize = 2;
/// 1 件取得ごとの間隔。2 worker で毎秒 20 件程度 = CDN の 429 を誘わない
const PACE: Duration = Duration::from_millis(100);

struct Queue {
    items: VecDeque<MediaRequest>,
    keys: HashSet<String>,
}

pub struct MediaWarmer {
    cache: Arc<ImageCache>,
    queue: Mutex<Queue>,
    notify: Notify,
}

impl MediaWarmer {
    pub fn new(cache: Arc<ImageCache>) -> Arc<Self> {
        Arc::new(Self {
            cache,
            queue: Mutex::new(Queue {
                items: VecDeque::new(),
                keys: HashSet::new(),
            }),
            notify: Notify::new(),
        })
    }

    /// worker を起動する。tokio runtime の中で呼ぶ
    pub fn spawn_workers(self: &Arc<Self>) {
        for _ in 0..WORKERS {
            let me = Arc::clone(self);
            tokio::spawn(async move { me.run().await });
        }
    }

    /// キューに積む。既に積まれている key は無視し、上限を超えたら古い方から
    /// 落とす。受理した件数を返す
    pub async fn enqueue(&self, reqs: Vec<MediaRequest>) -> usize {
        let mut q = self.queue.lock().await;
        let mut accepted = 0;
        for req in reqs {
            if !req.url.starts_with("https://") {
                continue;
            }
            let key = req.cache_key();
            if !q.keys.insert(key) {
                continue;
            }
            q.items.push_back(req);
            accepted += 1;
            while q.items.len() > MAX_QUEUE {
                if let Some(old) = q.items.pop_front() {
                    q.keys.remove(&old.cache_key());
                }
            }
        }
        drop(q);
        if accepted > 0 {
            self.notify.notify_waiters();
        }
        accepted
    }

    #[cfg(test)]
    pub async fn queued(&self) -> usize {
        self.queue.lock().await.items.len()
    }

    async fn pop(&self) -> Option<MediaRequest> {
        let mut q = self.queue.lock().await;
        let req = q.items.pop_front()?;
        q.keys.remove(&req.cache_key());
        Some(req)
    }

    /// 1 件処理する。キャッシュ済みなら取りにいかず `Some(false)`、取得を
    /// 試みたら `Some(true)`、キューが空なら `None`
    pub async fn run_one(&self) -> Option<bool> {
        let req = self.pop().await?;
        if self
            .cache
            .check_cache_only(&req.cache_key())
            .await
            .is_some()
        {
            return Some(false);
        }
        // 失敗は fetch_streaming が negative cache / circuit に記録するので
        // ここでは握りつぶす (表示要求が来たときに同じ判断で弾かれる)
        if let Err(e) = ensure_media_inner(&self.cache, &req).await {
            tracing::debug!(url = %req.url, error = %e, "media warm skipped");
        }
        Some(true)
    }

    async fn run(self: Arc<Self>) {
        loop {
            match self.run_one().await {
                Some(true) => tokio::time::sleep(PACE).await,
                Some(false) => {}
                None => self.notify.notified().await,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(url: &str) -> MediaRequest {
        MediaRequest {
            url: url.to_string(),
            w: None,
            h: Some(128),
            format: None,
            static_frame: false,
        }
    }

    #[tokio::test]
    async fn enqueue_dedups_and_rejects_non_https() {
        let dir = tempfile::tempdir().unwrap();
        let warmer = MediaWarmer::new(Arc::new(ImageCache::new(dir.path())));
        let n = warmer
            .enqueue(vec![
                req("https://a.example/1.png"),
                req("https://a.example/1.png"),
                req("http://a.example/2.png"),
                req("https://a.example/3.png"),
            ])
            .await;
        assert_eq!(n, 2);
        assert_eq!(warmer.queued().await, 2);
    }

    #[tokio::test]
    async fn enqueue_drops_oldest_beyond_cap() {
        let dir = tempfile::tempdir().unwrap();
        let warmer = MediaWarmer::new(Arc::new(ImageCache::new(dir.path())));
        let reqs: Vec<_> = (0..MAX_QUEUE + 5)
            .map(|i| req(&format!("https://a.example/{i}.png")))
            .collect();
        warmer.enqueue(reqs).await;
        assert_eq!(warmer.queued().await, MAX_QUEUE);
        // 先頭 5 件が落ち、6 件目が先頭
        let first = warmer.pop().await.unwrap();
        assert_eq!(first.url, "https://a.example/5.png");
        // 落とした key は再投入できる
        assert_eq!(
            warmer.enqueue(vec![req("https://a.example/0.png")]).await,
            1
        );
    }

    #[tokio::test]
    async fn run_one_skips_cached_and_returns_none_when_empty() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Arc::new(ImageCache::new(dir.path()));
        let r = req("https://a.example/cached.png");
        cache
            .store_variant(&r.cache_key(), vec![1, 2, 3], "image/webp")
            .await;
        let warmer = MediaWarmer::new(cache);
        warmer.enqueue(vec![r]).await;
        assert_eq!(warmer.run_one().await, Some(false));
        assert_eq!(warmer.run_one().await, None);
    }
}

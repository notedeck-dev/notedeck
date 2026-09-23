//! アプリ終了時のタスク所有 (#1098)。
//!
//! 監査時点で常駐ループ・背景タスクの spawn が 18 箇所あり、どれも所有者が
//! いなかった。終了は `exit()` 任せで、進行中の書き込み (export の index 等) が
//! 途中で切れる余地があった。ここで「誰が止めるか」を一箇所にする。
//!
//! - 常駐ループは [`Shutdown::spawn`] で追跡し、[`Shutdown::trigger`] で abort
//! - 自分で片付けたいもの (axum の graceful shutdown 等) は [`Shutdown::token`]
//!   の `cancelled()` を待つ
//! - managed state を引けない箇所 (export のキャンセル判定) は
//!   [`is_shutting_down`] を読む。managed state と process-global の二本立て
//!   になるのは、そこだけ state を辿る手段が無いため
//!
//! 発火点は `RunEvent::ExitRequested` (lib.rs)。トレイへの hide は終了ではない
//! ので発火しない。

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tokio::sync::watch;
use tokio::task::JoinHandle;

static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

/// 終了処理が始まっているか。managed state を辿れない箇所向け。
pub fn is_shutting_down() -> bool {
    SHUTTING_DOWN.load(Ordering::Relaxed)
}

pub struct Shutdown {
    tx: watch::Sender<bool>,
    tasks: Mutex<Vec<JoinHandle<()>>>,
    /// 常駐タスクを載せる runtime。Tauri 側は `tauri::async_runtime::handle()` の
    /// 中身を渡す (この module は Tauri を知らない、#1106)
    handle: tokio::runtime::Handle,
}

impl Shutdown {
    pub fn new(handle: tokio::runtime::Handle) -> Self {
        let (tx, _rx) = watch::channel(false);
        Self {
            tx,
            tasks: Mutex::new(Vec::new()),
            handle,
        }
    }

    /// 常駐タスクを追跡付きで spawn する。`trigger()` で abort される。
    pub fn spawn<F>(&self, fut: F)
    where
        F: Future<Output = ()> + Send + 'static,
    {
        let handle = self.handle.spawn(fut);
        self.tasks
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .push(handle);
    }

    /// 終了通知の受け口。
    pub fn token(&self) -> ShutdownToken {
        ShutdownToken(self.tx.subscribe())
    }

    /// 終了を宣言し、追跡中のタスクを全て abort する。冪等。
    pub fn trigger(&self) {
        SHUTTING_DOWN.store(true, Ordering::Relaxed);
        // send() は受信者ゼロだと値を更新しないので send_replace を使う
        self.tx.send_replace(true);
        let handles = std::mem::take(&mut *self.tasks.lock().unwrap_or_else(|p| p.into_inner()));
        for h in handles {
            h.abort();
        }
    }
}

#[derive(Clone)]
pub struct ShutdownToken(watch::Receiver<bool>);

impl ShutdownToken {
    /// `trigger()` されるまで待つ。送信側が落ちた場合も終了として扱う。
    pub async fn cancelled(mut self) {
        if *self.0.borrow() {
            return;
        }
        while self.0.changed().await.is_ok() {
            if *self.0.borrow() {
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;
    use std::sync::Arc;
    use std::time::Duration;

    #[tokio::test]
    async fn token_resolves_after_trigger() {
        let s = Shutdown::new(tokio::runtime::Handle::current());
        let token = s.token();
        let waiter = tokio::spawn(token.cancelled());
        s.trigger();
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .expect("cancelled() should resolve after trigger")
            .expect("waiter task should not panic");
    }

    #[tokio::test]
    async fn token_taken_after_trigger_resolves_immediately() {
        let s = Shutdown::new(tokio::runtime::Handle::current());
        s.trigger();
        tokio::time::timeout(Duration::from_millis(100), s.token().cancelled())
            .await
            .expect("already-triggered token must not block");
    }

    #[tokio::test]
    async fn trigger_aborts_tracked_tasks() {
        let s = Shutdown::new(tokio::runtime::Handle::current());
        let ticks = Arc::new(AtomicU64::new(0));
        let counter = ticks.clone();
        s.spawn(async move {
            loop {
                counter.fetch_add(1, Ordering::Relaxed);
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(ticks.load(Ordering::Relaxed) > 0, "task should have run");
        s.trigger();
        // abort は次の await 境界で効く。少し待ってから止まっていることを見る
        tokio::time::sleep(Duration::from_millis(10)).await;
        let after = ticks.load(Ordering::Relaxed);
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(
            ticks.load(Ordering::Relaxed),
            after,
            "aborted task must stop ticking"
        );
        assert!(is_shutting_down());
    }
}

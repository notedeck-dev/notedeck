//! 冷えた起動のあいだに届いた利用者向けの遷移 (通知クリック / deep link) を、
//! 最初のデッキ窓が名乗るまで溜める箱 (#1131)。
//!
//! Tauri のイベントは購読者が居ないと捨てられる。起動直後の通知クリックや
//! `notedeck://` は JS の購読前に届くので、Rust が預かって窓が名乗った時点で流す。
//! 遷移系だけを溜め、件数と寿命に上限を置く (古い deep link のアクションを
//! 数分後に再生しない)。Windows の `PendingNotificationClick` を一般化したもの。

use std::collections::VecDeque;
use std::time::{Duration, Instant};

pub struct PendingInbox<T> {
    items: VecDeque<(Instant, T)>,
    cap: usize,
    ttl: Duration,
}

impl<T> PendingInbox<T> {
    pub fn new(cap: usize, ttl: Duration) -> Self {
        Self {
            items: VecDeque::new(),
            cap,
            ttl,
        }
    }

    /// 預ける。上限を超えたら最も古いものから捨てる
    pub fn push_at(&mut self, now: Instant, item: T) {
        self.items.push_back((now, item));
        while self.items.len() > self.cap {
            self.items.pop_front();
        }
    }

    pub fn push(&mut self, item: T) {
        self.push_at(Instant::now(), item);
    }

    /// 寿命内のものを古い順に全部取り出す。期限切れは捨てる
    pub fn drain_fresh_at(&mut self, now: Instant) -> Vec<T> {
        let ttl = self.ttl;
        self.items
            .drain(..)
            .filter_map(|(at, item)| (now.duration_since(at) <= ttl).then_some(item))
            .collect()
    }

    pub fn drain_fresh(&mut self) -> Vec<T> {
        self.drain_fresh_at(Instant::now())
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_order_and_drops_the_oldest_beyond_the_cap() {
        let mut inbox = PendingInbox::new(2, Duration::from_secs(60));
        let t = Instant::now();
        inbox.push_at(t, "a");
        inbox.push_at(t, "b");
        inbox.push_at(t, "c");
        assert_eq!(inbox.drain_fresh_at(t), vec!["b", "c"]);
        assert!(inbox.is_empty());
    }

    #[test]
    fn expired_items_are_not_replayed() {
        let mut inbox = PendingInbox::new(8, Duration::from_secs(10));
        let t0 = Instant::now();
        inbox.push_at(t0, "old");
        inbox.push_at(t0 + Duration::from_secs(8), "fresh");
        assert_eq!(
            inbox.drain_fresh_at(t0 + Duration::from_secs(12)),
            vec!["fresh"]
        );
    }
}

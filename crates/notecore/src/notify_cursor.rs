//! OS 通知の処理位置 (純関数、#330 段階 C)。
//!
//! Android ではストリーミング (アプリが生きている間) とワーカー (15 分おき) の 2 経路が
//! 同じ口座の通知を OS 通知にする。どちらが出したかに関わらず「ここまでは OS 通知に
//! した」を口座 × 種別で 1 つ持ち、処理した側が進める。ワーカーはこの位置より新しい
//! ものだけを取りに行くので、同じ通知を 15 分ごとに出し直さない。
//!
//! 既読 (サーバーの位置) とは別物: 既読は利用者が見たかどうか、処理位置は OS 通知に
//! したかどうか。見ていない通知は既読でなくても 2 度は知らせない。
//!
//! Misskey の ID (aid / aidx / meid / ulid / objectid) は同じサーバー内では固定長で
//! 時系列に整列するので、文字列の大小比較で新旧を決められる。ファイルへの保存は
//! 手元側 (I/O を持つ側) の仕事で、ここは JSON の文字列と値の往復だけ持つ。

use std::collections::BTreeMap;

use crate::notify_plan::{notify_tag, NotifyKind};

/// 口座 × 種別ごとの「OS 通知にした最新の Misskey ID」
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NotifyCursor {
    /// キーは `notify_tag` と同じ (`notif:<口座>` / `chat:<口座>`)
    positions: BTreeMap<String, String>,
}

impl NotifyCursor {
    /// 保存した JSON から戻す。壊れていれば空 (初回と同じ扱い)
    pub fn from_json(text: &str) -> Self {
        let positions = serde_json::from_str::<BTreeMap<String, String>>(text).unwrap_or_default();
        Self { positions }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(&self.positions).unwrap_or_else(|_| "{}".to_string())
    }

    /// その口座・種別の処理位置 (無ければ None = まだ何も出していない)
    pub fn position(&self, account_id: &str, kind: NotifyKind) -> Option<&str> {
        self.positions
            .get(&notify_tag(account_id, kind))
            .map(String::as_str)
    }

    /// OS 通知にした ID を記録する。今の位置より新しいときだけ進め、進んだら true
    pub fn advance(&mut self, account_id: &str, kind: NotifyKind, id: &str) -> bool {
        let key = notify_tag(account_id, kind);
        match self.positions.get(&key) {
            Some(current) if current.as_str() >= id => false,
            _ => {
                self.positions.insert(key, id.to_string());
                true
            }
        }
    }

    /// 処理位置より新しいものだけを古い順に返す。位置が無ければ全部
    pub fn newer_than<T>(
        &self,
        account_id: &str,
        kind: NotifyKind,
        items: Vec<T>,
        id_of: impl Fn(&T) -> &str,
    ) -> Vec<T> {
        let position = self.position(account_id, kind);
        let mut fresh: Vec<T> = items
            .into_iter()
            .filter(|item| position.is_none_or(|p| id_of(item) > p))
            .collect();
        fresh.sort_by(|a, b| id_of(a).cmp(id_of(b)));
        fresh
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advance_only_moves_forward_and_is_per_account_and_kind() {
        let mut c = NotifyCursor::default();
        assert!(c.advance("a", NotifyKind::Notification, "aaa2"));
        assert!(!c.advance("a", NotifyKind::Notification, "aaa1"));
        assert!(!c.advance("a", NotifyKind::Notification, "aaa2"));
        assert!(c.advance("a", NotifyKind::Notification, "aaa3"));
        assert_eq!(c.position("a", NotifyKind::Notification), Some("aaa3"));
        // 種別と口座は独立
        assert_eq!(c.position("a", NotifyKind::Message), None);
        assert_eq!(c.position("b", NotifyKind::Notification), None);
        assert!(c.advance("a", NotifyKind::Message, "m1"));
        assert_eq!(c.position("a", NotifyKind::Message), Some("m1"));
    }

    #[test]
    fn newer_than_filters_by_position_and_sorts_oldest_first() {
        let mut c = NotifyCursor::default();
        let all = vec!["n5", "n2", "n9"];
        // 位置が無ければ全部 (古い順)
        assert_eq!(
            c.newer_than("a", NotifyKind::Notification, all.clone(), |s| s),
            vec!["n2", "n5", "n9"]
        );
        c.advance("a", NotifyKind::Notification, "n5");
        assert_eq!(
            c.newer_than("a", NotifyKind::Notification, all, |s| s),
            vec!["n9"]
        );
    }

    #[test]
    fn json_roundtrip_and_broken_input_fall_back_to_empty() {
        let mut c = NotifyCursor::default();
        c.advance("a", NotifyKind::Notification, "n1");
        c.advance("a", NotifyKind::Message, "m1");
        let restored = NotifyCursor::from_json(&c.to_json());
        assert_eq!(restored, c);
        assert_eq!(NotifyCursor::from_json("not json"), NotifyCursor::default());
        assert_eq!(NotifyCursor::from_json(""), NotifyCursor::default());
    }
}

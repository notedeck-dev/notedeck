//! 開いている窓の名簿と、そこから決まる 2 つの役 (#1131)。
//!
//! - **代表窓**: プロセスに 1 つの裏の仕事 (トレイ / バッジ / HEARTBEAT の表示 /
//!   ファイル移行 / プラグインの無人の副作用 / 窓を問わない外部問い合わせ) を担う
//!   デッキ窓。状態機械は持たず、参照のたびに「`main` が居ればそれ、無ければ最も
//!   古いデッキ窓」で決める (リロードや WebProcess の再起動で役が死なないように)
//! - **見ている窓**: 最後にフォーカスされたデッキ窓。利用者向けの遷移 (通知クリック /
//!   deep link) と、窓ごとに値が違う問い・確認を出し得る問いの答え手
//!
//! Tauri に依存しない純粋な構造で、`AppHandle` を持たない。窓のイベントを受けて
//! 更新するのは `lib.rs` 側 (`on_window_event`)、emit も `lib.rs` が行う。

use serde::{Deserialize, Serialize};
use specta::Type;

/// 窓の種別。ラベルの接頭辞ではミラーとポップアウトを区別できないので、URL で決める
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum WindowKind {
    /// 起動時に Tauri が作る窓 (label `main`)
    Main,
    /// 利用者が開いた 2 枚目以降のデッキ窓 (`/?profile=`)
    Mirror,
    /// カラム群を切り出した子窓 (`/?profile=&window=`)
    Popout,
    /// カラム 1 本かウィンドウ内容 1 つの子窓 (`/pip`)
    Pip,
}

impl WindowKind {
    /// デッキ全体を描く窓か (代表窓と見ている窓の候補)
    pub fn is_deck(self) -> bool {
        matches!(self, WindowKind::Main | WindowKind::Mirror)
    }
}

/// 窓の label と URL から種別を決める。JS の自称には頼らない
pub fn kind_from_url(label: &str, path: &str, query: Option<&str>) -> WindowKind {
    if label == "main" {
        return WindowKind::Main;
    }
    if path == "/pip" || path.starts_with("/pip/") {
        return WindowKind::Pip;
    }
    let has_window_param = query
        .map(|q| {
            q.split('&')
                .any(|kv| kv.split('=').next().is_some_and(|k| k == "window"))
        })
        .unwrap_or(false);
    if has_window_param {
        WindowKind::Popout
    } else {
        WindowKind::Mirror
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub label: String,
    pub kind: WindowKind,
    /// 名乗った順。代表窓の選び方 (最も古い) に使う
    pub seq: u64,
}

/// 2 つの役の現在値。変わったときに全窓へ流す
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Roles {
    pub representative: Option<String>,
    pub viewing: Option<String>,
}

#[derive(Debug, Default)]
pub struct WindowRegistry {
    entries: Vec<Entry>,
    next_seq: u64,
    /// 最後にフォーカスされたデッキ窓 (名簿から消えたら無効)
    last_focused: Option<String>,
}

impl WindowRegistry {
    /// 窓が名乗る。同じ label の再登録は冪等 (seq を保つ)。役が変わったら新しい値を返す
    pub fn announce(&mut self, label: &str, kind: WindowKind) -> (Roles, Option<Roles>) {
        let before = self.roles();
        if let Some(e) = self.entries.iter_mut().find(|e| e.label == label) {
            e.kind = kind;
        } else {
            self.entries.push(Entry {
                label: label.to_string(),
                kind,
                seq: self.next_seq,
            });
            self.next_seq += 1;
        }
        let after = self.roles();
        let changed = (after != before).then_some(after.clone());
        (after, changed)
    }

    /// 窓が消えた。役が変わったら新しい値を返す
    pub fn remove(&mut self, label: &str) -> Option<Roles> {
        let before = self.roles();
        self.entries.retain(|e| e.label != label);
        if self.last_focused.as_deref() == Some(label) {
            self.last_focused = None;
        }
        let after = self.roles();
        (after != before).then_some(after)
    }

    /// 窓がフォーカスされた。デッキ窓だけが「見ている窓」になる
    pub fn focused(&mut self, label: &str) -> Option<Roles> {
        let is_deck = self
            .entries
            .iter()
            .any(|e| e.label == label && e.kind.is_deck());
        if !is_deck {
            return None;
        }
        let before = self.roles();
        self.last_focused = Some(label.to_string());
        let after = self.roles();
        (after != before).then_some(after)
    }

    pub fn contains(&self, label: &str) -> bool {
        self.entries.iter().any(|e| e.label == label)
    }

    pub fn kind(&self, label: &str) -> Option<WindowKind> {
        self.entries
            .iter()
            .find(|e| e.label == label)
            .map(|e| e.kind)
    }

    /// `main` を除いた窓の数 (生成数の上限に数える単位)
    // #1131 の後続 (宛先付きイベント / 親子と上限) で使う。使った段で外す
    #[allow(dead_code)]
    pub fn sub_window_count(&self) -> usize {
        self.entries
            .iter()
            .filter(|e| e.kind != WindowKind::Main)
            .count()
    }

    /// 代表窓: `main` が居ればそれ、無ければ最も古いデッキ窓
    pub fn representative(&self) -> Option<String> {
        let mut decks: Vec<&Entry> = self.entries.iter().filter(|e| e.kind.is_deck()).collect();
        if let Some(main) = decks.iter().find(|e| e.kind == WindowKind::Main) {
            return Some(main.label.clone());
        }
        decks.sort_by_key(|e| e.seq);
        decks.first().map(|e| e.label.clone())
    }

    /// 見ている窓: 最後にフォーカスされたデッキ窓。無ければ代表窓
    pub fn viewing(&self) -> Option<String> {
        self.last_focused
            .as_deref()
            .filter(|l| self.contains(l))
            .map(str::to_string)
            .or_else(|| self.representative())
    }

    pub fn roles(&self) -> Roles {
        Roles {
            representative: self.representative(),
            viewing: self.viewing(),
        }
    }

    /// 前に出す窓: 見ている窓が可視ならそれ、不可視なら最も古い可視のデッキ窓、
    /// どれも無ければ代表窓 (呼び元が show する)
    pub fn front_target(&self, is_visible: impl Fn(&str) -> bool) -> Option<String> {
        if let Some(v) = self.viewing() {
            if is_visible(&v) {
                return Some(v);
            }
        }
        let mut decks: Vec<&Entry> = self
            .entries
            .iter()
            .filter(|e| e.kind.is_deck() && is_visible(&e.label))
            .collect();
        decks.sort_by_key(|e| e.seq);
        decks
            .first()
            .map(|e| e.label.clone())
            .or_else(|| self.representative())
    }

    /// 外部からの問い合わせの答え手。窓ごとに値が違う問いと、確認ダイアログを
    /// 出し得る問い (隠れた窓に出すと利用者に見えずタイムアウトする) は見ている窓、
    /// それ以外の窓を問わない問いは代表窓
    pub fn query_target(&self, query_type: &str) -> Option<String> {
        const VIEWING_PREFIXES: [&str; 8] = [
            "deck/",
            "health/",
            "startup/",
            "perf/",
            "logs/",
            "inspector/",
            "querybridge/",
            "commands/",
        ];
        const VIEWING_EXACT: [&str; 3] = [
            "acp/confirm",
            "ai/execute-capability",
            "capabilities/execute",
        ];
        let to_viewing = VIEWING_PREFIXES.iter().any(|p| query_type.starts_with(p))
            || VIEWING_EXACT.contains(&query_type);
        if to_viewing {
            self.viewing()
        } else {
            self.representative()
        }
    }

    /// デッキ窓が 1 つも無いか
    // #1131 の後続 (宛先付きイベント / 親子と上限) で使う。使った段で外す
    #[allow(dead_code)]
    pub fn has_no_deck_window(&self) -> bool {
        !self.entries.iter().any(|e| e.kind.is_deck())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_is_decided_by_label_and_url_not_by_claim() {
        assert_eq!(kind_from_url("main", "/", None), WindowKind::Main);
        assert_eq!(
            kind_from_url("deck-1", "/", Some("profile=p")),
            WindowKind::Mirror
        );
        assert_eq!(
            kind_from_url("deck-2", "/", Some("profile=p&window=deck-2")),
            WindowKind::Popout
        );
        assert_eq!(
            kind_from_url("pip-1", "/pip", Some("col=abc")),
            WindowKind::Pip
        );
        // `window` を含む別のキーに騙されない
        assert_eq!(
            kind_from_url("deck-3", "/", Some("profile=p&windowish=1")),
            WindowKind::Mirror
        );
    }

    #[test]
    fn main_is_the_representative_while_it_lives_then_the_oldest_deck_window() {
        let mut r = WindowRegistry::default();
        r.announce("deck-a", WindowKind::Mirror);
        assert_eq!(r.representative().as_deref(), Some("deck-a"));
        r.announce("main", WindowKind::Main);
        assert_eq!(r.representative().as_deref(), Some("main"));
        r.announce("deck-b", WindowKind::Mirror);
        assert_eq!(
            r.remove("main").unwrap().representative.as_deref(),
            Some("deck-a")
        );
        assert_eq!(
            r.remove("deck-a").unwrap().representative.as_deref(),
            Some("deck-b")
        );
        assert!(r.remove("deck-b").unwrap().representative.is_none());
        assert!(r.has_no_deck_window());
    }

    #[test]
    fn announce_is_idempotent_and_keeps_the_order() {
        let mut r = WindowRegistry::default();
        r.announce("main", WindowKind::Main);
        r.announce("deck-a", WindowKind::Mirror);
        r.announce("deck-b", WindowKind::Mirror);
        // リロードした deck-a が名乗り直しても順位は変わらない
        let (roles, changed) = r.announce("deck-a", WindowKind::Mirror);
        assert!(changed.is_none());
        assert_eq!(roles.representative.as_deref(), Some("main"));
        r.remove("main");
        assert_eq!(r.representative().as_deref(), Some("deck-a"));
    }

    #[test]
    fn popout_and_pip_never_become_representative_or_viewing() {
        let mut r = WindowRegistry::default();
        r.announce("deck-x", WindowKind::Popout);
        r.announce("pip-1", WindowKind::Pip);
        assert!(r.representative().is_none());
        assert!(r.focused("pip-1").is_none());
        assert!(r.viewing().is_none());
        r.announce("main", WindowKind::Main);
        assert!(r.focused("deck-x").is_none());
        assert_eq!(r.viewing().as_deref(), Some("main"));
        assert_eq!(r.sub_window_count(), 2);
    }

    #[test]
    fn viewing_follows_focus_among_deck_windows_and_falls_back_to_representative() {
        let mut r = WindowRegistry::default();
        r.announce("main", WindowKind::Main);
        r.announce("deck-a", WindowKind::Mirror);
        assert_eq!(r.viewing().as_deref(), Some("main"));
        let roles = r.focused("deck-a").unwrap();
        assert_eq!(roles.viewing.as_deref(), Some("deck-a"));
        assert_eq!(roles.representative.as_deref(), Some("main"));
        // 同じ窓への再フォーカスは変化なし
        assert!(r.focused("deck-a").is_none());
        // 見ていた窓が消えたら代表窓へ
        let roles = r.remove("deck-a").unwrap();
        assert_eq!(roles.viewing.as_deref(), Some("main"));
    }

    #[test]
    fn queries_about_a_window_or_needing_confirmation_go_to_the_viewing_window() {
        let mut r = WindowRegistry::default();
        r.announce("main", WindowKind::Main);
        r.announce("deck-a", WindowKind::Mirror);
        r.focused("deck-a");
        for q in [
            "deck/active",
            "health/streams",
            "acp/confirm",
            "capabilities/execute",
        ] {
            assert_eq!(r.query_target(q).as_deref(), Some("deck-a"), "{q}");
        }
        for q in [
            "capabilities/list",
            "permissions/resolved",
            "ai/confirm-preview",
        ] {
            assert_eq!(r.query_target(q).as_deref(), Some("main"), "{q}");
        }
        r.remove("main");
        r.remove("deck-a");
        assert!(r.query_target("deck/active").is_none());
    }

    #[test]
    fn front_target_prefers_the_visible_window_the_user_looks_at() {
        let mut r = WindowRegistry::default();
        r.announce("main", WindowKind::Main);
        r.announce("deck-a", WindowKind::Mirror);
        r.focused("deck-a");
        // 見ている窓が可視ならそれ
        assert_eq!(r.front_target(|_| true).as_deref(), Some("deck-a"));
        // 見ている窓が隠れていれば、可視のデッキ窓のうち最も古いもの
        assert_eq!(r.front_target(|l| l == "main").as_deref(), Some("main"));
        // 全部隠れていれば代表窓 (呼び元が show する)
        assert_eq!(r.front_target(|_| false).as_deref(), Some("main"));
    }
}

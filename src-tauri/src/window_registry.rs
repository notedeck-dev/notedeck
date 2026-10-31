//! 開いている窓の名簿と、そこから決まる 2 つの役 (#1131)。
//!
//! - **代表窓**: プロセスに 1 つの裏の仕事 (トレイ / バッジ / HEARTBEAT の表示 /
//!   ファイル移行 / プラグインの無人の副作用 / 窓を問わない外部問い合わせ) を担う
//!   デッキ窓。状態機械は持たず、参照のたびに「`main` が居ればそれ、無ければ最も
//!   古いデッキ窓」で決める (リロードや WebProcess の再起動で役が死なないように)
//! - **見ている窓**: 最後にフォーカスされたデッキ窓。利用者向けの遷移 (通知クリック /
//!   deep link) と、窓ごとに値が違う問い・確認を出し得る問いの答え手
//!
//! 親子関係・生成数の上限・閉じた理由もここが持つ (段 4)。子を作るのは
//! `commands/sub_window.rs`、窓のイベントを受けて名簿を更新し効果を emit するのは
//! `window_events.rs`。
//!
//! Tauri に依存しない純粋な構造で、`AppHandle` を持たない。効果 (誰に何を知らせるか)
//! は値で返し、呼び元が emit する。

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

    /// デッキ画面を描く窓か (PiP の「デッキに戻す」の届け先になれる)
    pub fn is_deck_screen(self) -> bool {
        matches!(
            self,
            WindowKind::Main | WindowKind::Mirror | WindowKind::Popout
        )
    }
}

/// `main` を除いた窓 (生成中を含む) の上限。資源保護のための定数で、設定項目にしない。
/// 自動で開く経路 (起動時 / プロファイル切替の復元 / capability) だけ拒み、
/// 人の操作は警告して開く (#1131 §4)
pub const MAX_SUB_WINDOWS: usize = 12;

/// 子窓が閉じた理由。Rust が決める (JS に「閉じる前に告げる」口は作らない)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum CloseReason {
    /// その窓で CloseRequested を見た (× / `close()`)。カラムは回収する
    User,
    /// 見ていない (終了 / クラッシュ / `destroy()`)。回収せず次回起動で開き直す
    Lost,
    /// 生成に失敗した (上限 / ビルダーの失敗)。開いた側が後始末する
    Failed,
}

/// 窓が消えたときの効果。呼び元 (`window_events.rs`) が emit / destroy する
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RemoveEffects {
    /// 役が変わった
    pub roles: Option<Roles>,
    /// 消えた窓の知らせ (名簿に居た窓だけ)
    pub closed: Option<ClosedChild>,
    /// デッキ窓が 0 になったので destroy する残りの子
    pub orphans: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClosedChild {
    pub label: String,
    pub kind: WindowKind,
    pub reason: CloseReason,
    /// 届け先: 親が生きていれば親、居なければ代表窓。どちらも無ければ None
    pub to: Option<String>,
}

/// JS が渡すポップアウトの label (プロファイルの `windows[].id`)。接頭辞と形式だけ
/// 許し、`main` / `pip-*` は名乗れない
pub fn is_valid_popout_label(label: &str) -> bool {
    let Some(rest) = label.strip_prefix("deck-") else {
        return false;
    };
    let mut parts = rest.split('-');
    let ok =
        |p: Option<&str>| p.is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()));
    ok(parts.next()) && ok(parts.next()) && parts.next().is_none()
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
    /// 開いた窓 (ポップアウト / PiP)。ミラーと `main` は None (対等)
    pub parent: Option<String>,
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
    /// 生成中の label (上限に数える。生成が終わるか失敗したら外す)
    creating: Vec<String>,
    /// CloseRequested を見た label (Destroyed で消す。label の再利用に持ち越さない)
    close_seen: Vec<String>,
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
                parent: None,
            });
            self.next_seq += 1;
        }
        let after = self.roles();
        let changed = (after != before).then_some(after.clone());
        (after, changed)
    }

    /// Rust が子窓を作った。名乗り (`announce`) より先に載せ、親を記録する。
    /// 後から同じ窓が名乗っても親と順位は変わらない
    pub fn register(
        &mut self,
        label: &str,
        kind: WindowKind,
        parent: Option<&str>,
    ) -> Option<Roles> {
        self.creating.retain(|l| l != label);
        let before = self.roles();
        if let Some(e) = self.entries.iter_mut().find(|e| e.label == label) {
            e.kind = kind;
            e.parent = parent.map(str::to_string);
        } else {
            self.entries.push(Entry {
                label: label.to_string(),
                kind,
                seq: self.next_seq,
                parent: parent.map(str::to_string),
            });
            self.next_seq += 1;
        }
        let after = self.roles();
        (after != before).then_some(after)
    }

    /// 生成を始めた (上限に数え始める)。終わったら `register` か `end_create`
    pub fn begin_create(&mut self, label: &str) {
        if !self.creating.iter().any(|l| l == label) {
            self.creating.push(label.to_string());
        }
    }

    /// 生成に失敗した
    pub fn end_create(&mut self, label: &str) {
        self.creating.retain(|l| l != label);
    }

    /// 上限の判定: 今の枚数 (生成中を含む) と、上限に達しているか
    pub fn limit_check(&self) -> (usize, bool) {
        let count = self.sub_window_count();
        (count, count >= MAX_SUB_WINDOWS)
    }

    /// その窓で CloseRequested を見た (閉じた理由を `User` にする印)
    pub fn on_close_requested(&mut self, label: &str) {
        if !self.close_seen.iter().any(|l| l == label) {
            self.close_seen.push(label.to_string());
        }
    }

    /// 窓が消えた。役の変化・親への知らせ・孤児の destroy を効果として返す
    pub fn remove(&mut self, label: &str) -> RemoveEffects {
        let before = self.roles();
        let removed = self
            .entries
            .iter()
            .position(|e| e.label == label)
            .map(|i| self.entries.remove(i));
        self.creating.retain(|l| l != label);
        let seen_close = self.close_seen.iter().any(|l| l == label);
        self.close_seen.retain(|l| l != label);
        if self.last_focused.as_deref() == Some(label) {
            self.last_focused = None;
        }
        let after = self.roles();
        let roles = (after != before).then_some(after);

        let closed = removed.as_ref().map(|e| ClosedChild {
            label: e.label.clone(),
            kind: e.kind,
            reason: if seen_close {
                CloseReason::User
            } else {
                CloseReason::Lost
            },
            to: self.delivery_target(e.parent.as_deref()),
        });

        // デッキ窓が 0 になったら残る子 (ポップアウト / PiP) も終わり
        let orphans = if removed.is_some() && self.has_no_deck_window() {
            self.entries.iter().map(|e| e.label.clone()).collect()
        } else {
            Vec::new()
        };

        RemoveEffects {
            roles,
            closed,
            orphans,
        }
    }

    /// 子窓からの知らせの届け先: 親が生きていれば親、居なければ代表窓
    pub fn delivery_target(&self, parent: Option<&str>) -> Option<String> {
        parent
            .filter(|p| self.contains(p))
            .map(str::to_string)
            .or_else(|| self.representative())
    }

    pub fn parent(&self, label: &str) -> Option<&str> {
        self.entries
            .iter()
            .find(|e| e.label == label)
            .and_then(|e| e.parent.as_deref())
    }

    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    /// PiP の「デッキに戻す」の届け先: 親を辿って最も近いデッキ画面を描く窓
    /// (デッキ窓かポップアウト)。途切れていれば代表窓
    pub fn nearest_deck_screen(&self, label: &str) -> Option<String> {
        let mut cur = self.parent(label);
        // 名簿は小さいので、循環があっても止まるよう歩数で切る
        for _ in 0..self.entries.len() {
            let Some(l) = cur else { break };
            match self.kind(l) {
                Some(k) if k.is_deck_screen() => return Some(l.to_string()),
                Some(_) => cur = self.parent(l),
                None => break,
            }
        }
        self.representative()
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

    /// `main` を除いた窓の数 + 生成中 (生成数の上限に数える単位)
    pub fn sub_window_count(&self) -> usize {
        self.entries
            .iter()
            .filter(|e| e.kind != WindowKind::Main)
            .count()
            + self.creating.len()
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
            r.remove("main").roles.unwrap().representative.as_deref(),
            Some("deck-a")
        );
        assert_eq!(
            r.remove("deck-a").roles.unwrap().representative.as_deref(),
            Some("deck-b")
        );
        assert!(r.remove("deck-b").roles.unwrap().representative.is_none());
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
        let roles = r.remove("deck-a").roles.unwrap();
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

    #[test]
    fn popout_labels_must_have_the_profile_form_and_cannot_claim_main_or_pip() {
        assert!(is_valid_popout_label("deck-1730000000000-1"));
        assert!(!is_valid_popout_label("main"));
        assert!(!is_valid_popout_label("pip-1-1"));
        assert!(!is_valid_popout_label("deck-"));
        assert!(!is_valid_popout_label("deck-a-1"));
        assert!(!is_valid_popout_label("deck-1-1-1"));
        assert!(!is_valid_popout_label("deck-1-1/../x"));
    }

    #[test]
    fn children_are_registered_with_their_parent_and_announce_keeps_it() {
        let mut r = WindowRegistry::default();
        r.announce("main", WindowKind::Main);
        r.register("deck-1-1", WindowKind::Popout, Some("main"));
        r.register("pip-1-1", WindowKind::Pip, Some("deck-1-1"));
        // 子が名乗り直しても親は残る
        r.announce("pip-1-1", WindowKind::Pip);
        assert_eq!(r.parent("pip-1-1"), Some("deck-1-1"));
        assert_eq!(r.parent("deck-1-1"), Some("main"));
        assert_eq!(r.parent("main"), None);
        // ミラーは対等 (親無し)
        r.register("deck-2-1", WindowKind::Mirror, None);
        assert_eq!(r.parent("deck-2-1"), None);
    }

    #[test]
    fn closing_a_child_tells_its_parent_with_the_reason_rust_decided() {
        let mut r = WindowRegistry::default();
        r.announce("main", WindowKind::Main);
        r.register("deck-1-1", WindowKind::Popout, Some("main"));
        r.register("deck-1-2", WindowKind::Popout, Some("main"));
        // × で閉じた: CloseRequested を見ている
        r.on_close_requested("deck-1-1");
        let fx = r.remove("deck-1-1");
        let closed = fx.closed.unwrap();
        assert_eq!(closed.reason, CloseReason::User);
        assert_eq!(closed.to.as_deref(), Some("main"));
        assert_eq!(closed.kind, WindowKind::Popout);
        assert!(fx.orphans.is_empty());
        // destroy() で消えた: 見ていない
        let fx = r.remove("deck-1-2");
        assert_eq!(fx.closed.unwrap().reason, CloseReason::Lost);
        // 名簿に居ない label は知らせない
        assert!(r.remove("deck-9-9").closed.is_none());
    }

    #[test]
    fn close_seen_is_not_carried_over_when_the_label_is_reused() {
        let mut r = WindowRegistry::default();
        r.announce("main", WindowKind::Main);
        r.register("deck-1-1", WindowKind::Popout, Some("main"));
        r.on_close_requested("deck-1-1");
        r.remove("deck-1-1");
        r.register("deck-1-1", WindowKind::Popout, Some("main"));
        assert_eq!(
            r.remove("deck-1-1").closed.unwrap().reason,
            CloseReason::Lost
        );
    }

    #[test]
    fn a_child_whose_parent_is_gone_reports_to_the_representative() {
        let mut r = WindowRegistry::default();
        r.announce("main", WindowKind::Main);
        r.announce("deck-m", WindowKind::Mirror);
        r.register("pip-1-1", WindowKind::Pip, Some("deck-m"));
        r.remove("deck-m");
        assert_eq!(
            r.remove("pip-1-1").closed.unwrap().to.as_deref(),
            Some("main")
        );
    }

    #[test]
    fn when_the_last_deck_window_goes_the_children_are_orphans() {
        let mut r = WindowRegistry::default();
        r.announce("main", WindowKind::Main);
        r.register("deck-1-1", WindowKind::Popout, Some("main"));
        r.register("pip-1-1", WindowKind::Pip, Some("deck-1-1"));
        let fx = r.remove("main");
        assert_eq!(
            fx.orphans,
            vec!["deck-1-1".to_string(), "pip-1-1".to_string()]
        );
        // 知らせの届け先は無い (親も代表も居ない)
        assert_eq!(fx.closed.unwrap().to, None);
        // ミラーが残っていれば孤児にならない
        let mut r = WindowRegistry::default();
        r.announce("main", WindowKind::Main);
        r.announce("deck-m", WindowKind::Mirror);
        r.register("deck-1-1", WindowKind::Popout, Some("main"));
        assert!(r.remove("main").orphans.is_empty());
    }

    #[test]
    fn the_limit_counts_sub_windows_and_pending_creations_but_not_main() {
        let mut r = WindowRegistry::default();
        r.announce("main", WindowKind::Main);
        assert_eq!(r.limit_check(), (0, false));
        for i in 0..MAX_SUB_WINDOWS - 1 {
            r.register(&format!("deck-1-{i}"), WindowKind::Popout, Some("main"));
        }
        r.begin_create("pip-9-9");
        assert_eq!(r.limit_check(), (MAX_SUB_WINDOWS, true));
        // 二重の begin は 1 つに数える
        r.begin_create("pip-9-9");
        assert_eq!(r.limit_check().0, MAX_SUB_WINDOWS);
        // 失敗で外れる
        r.end_create("pip-9-9");
        assert_eq!(r.limit_check(), (MAX_SUB_WINDOWS - 1, false));
        // 成功で名簿へ (生成中からは外れる)
        r.begin_create("pip-9-9");
        r.register("pip-9-9", WindowKind::Pip, Some("main"));
        assert_eq!(r.limit_check(), (MAX_SUB_WINDOWS, true));
    }

    #[test]
    fn pip_return_goes_to_the_nearest_deck_screen_ancestor() {
        let mut r = WindowRegistry::default();
        r.announce("main", WindowKind::Main);
        r.register("deck-1-1", WindowKind::Popout, Some("main"));
        r.register("pip-1-1", WindowKind::Pip, Some("deck-1-1"));
        r.register("pip-1-2", WindowKind::Pip, Some("pip-1-1"));
        // 親がポップアウトならそこへ
        assert_eq!(
            r.nearest_deck_screen("pip-1-1").as_deref(),
            Some("deck-1-1")
        );
        // 親が PiP なら辿る
        assert_eq!(
            r.nearest_deck_screen("pip-1-2").as_deref(),
            Some("deck-1-1")
        );
        // 途中が消えていれば代表窓
        r.remove("deck-1-1");
        assert_eq!(r.nearest_deck_screen("pip-1-2").as_deref(), Some("main"));
        assert_eq!(r.nearest_deck_screen("pip-1-1").as_deref(), Some("main"));
    }
}

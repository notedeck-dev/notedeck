//! 口座ごとの push の状態と後始末 (純関数、#330 の登録手順の作り直し)。
//!
//! 状態: 使っていない (Off) / 準備中 / 登録待ち / 有効 / 登録し直しが要る / 解除待ち。
//! 配送アプリへの登録は「口座 + 世代」で分け、新しい世代の送り先を受け取ってから古い
//! 世代を外す (最後の登録が消えて、選んだ配送アプリまで消える瞬間を作らない)。
//! 後始末 (本家への解除・レジストリの印・配送アプリからの取り外し) は状態とは別のキューで
//! 持ち、口座を消しても残す。ここは状態の遷移だけで、ネットワーク・端末には触らない
//! (実行は手元側、tests/lint/rustCoreBoundary が検査)。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// 準備中のまま放っておかれた登録を、起動時の突き合わせで片付けるまでの猶予。
/// 配送アプリの選択画面やブラウザへの切り替えで準備が長引くことがあるので短くしない
const STALE_PREPARING_MS: u64 = 10 * 60 * 1000;
/// 確定待ちで NoteDeck からテスト通知を送り直すまでの時間
const RESEND_AFTER_MS: u64 = 3 * 60 * 1000;
/// 巡回が「push で来ていない」と見なす通知の古さ (届くまでの遅れを見込む)
pub const MISSED_AFTER_MS: u64 = 5 * 60 * 1000;
/// 未着を何回続けて見たら登録し直しが要るとするか
const MISSED_STREAK: u32 = 2;
/// 後始末の再試行の上限。超えたら本家への手順は諦め、端末の分だけ片付ける
pub const MAX_CLEANUP_ATTEMPTS: u32 = 20;

/// 口座の状態
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    #[default]
    Off,
    /// 配送アプリに新しい世代を登録して、送り先を待っている
    Preparing,
    /// 送り先がそろい、本家での実行 (Scratchpad) か最初の push を待っている
    Pending,
    Active,
    NeedsReregistration,
    /// 解除の後始末が終わるのを待っている
    Unregistering,
}

/// 「登録し直しが要る」の理由
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Reason {
    /// 配送アプリの送り先か鍵が変わった / 登録が外れた / 準備が途中で止まった
    EndpointChanged,
    /// サーバーの鍵が変わった / Web Push が止まった
    ServerChanged,
    /// 巡回が「有効なのに push で来ていない未読」を続けて見つけた (推定)
    Missing,
    /// v1.94.0 のサーバー単位の登録からの移行
    Migrated,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AccountPush {
    pub host: String,
    pub phase: Phase,
    pub reason: Option<Reason>,
    /// 今の世代 (0 = まだ一度も登録していない)
    pub generation: u32,
    /// 今の試行の合言葉 (レジストリの key)
    pub nonce: Option<String>,
    /// 今の世代の送り先と鍵の指紋 (変化を見つける。秘密そのものは置かない)
    pub fingerprint: Option<String>,
    /// 本家に登録したときのサーバーの VAPID 公開鍵
    pub server_key: Option<String>,
    /// 確定に使ったテスト通知の ID (巡回とストリーミングはこれを出さない)
    pub confirm_id: Option<String>,
    /// 準備を始めた時刻 (ms)
    pub preparing_since_ms: Option<u64>,
    /// 有効になった時刻 (ms)。これより前の通知は未着の推定に数えない
    pub active_since_ms: Option<u64>,
    /// 「到着待ち」を最初に見た時刻 (ms)
    pub awaiting_since_ms: Option<u64>,
    /// 到着待ちが続いたので NoteDeck からテスト通知を送り直したか
    pub test_resent: bool,
    /// 巡回が未着を見つけた連続回数
    pub miss_streak: u32,
}

/// 後始末 1 件 (口座 + 世代)。各手順は終わったら false / None にする
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cleanup {
    pub account_id: String,
    pub host: String,
    pub generation: u32,
    /// 本家への `sw/unregister` が残っている
    pub unregister: bool,
    /// レジストリのこの key の項目を取り消し済みにする
    pub tombstone: Option<String>,
    /// 配送アプリから外す
    pub remove_instance: bool,
    pub attempts: u32,
}

impl Cleanup {
    pub fn is_done(&self) -> bool {
        !self.unregister && self.tombstone.is_none() && !self.remove_instance
    }
}

/// 後始末の 1 回の実行で終わった手順
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CleanupDone {
    pub unregister: bool,
    pub tombstone: bool,
    pub remove_instance: bool,
    /// どれかの手順が失敗した (再試行の回数を数える)
    pub failed: bool,
}

/// 端末の push の状態 (状態ファイルの中身)
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PushStore {
    pub accounts: BTreeMap<String, AccountPush>,
    pub cleanup: Vec<Cleanup>,
    /// v1.94.0 のサーバー単位の登録からの移行を済ませたか
    pub migrated_from_host_instances: bool,
}

/// 届いた push の扱い
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Delivery {
    /// 捨てる (解除待ち・使っていない・古い世代)
    Drop,
    /// 出す
    Show,
    /// これで登録が確定した。テスト通知なら確定の文言で出す
    Confirmed,
}

/// 配送アプリに登録する instance の名前 (口座 ID + 世代)。区切りの `#` はホスト名に
/// 現れないので、v1.94.0 のサーバー単位の名前 (ホスト、ポート付きを含む) と混ざらない
pub fn instance_name(account_id: &str, generation: u32) -> String {
    format!("{account_id}#{generation}")
}

/// instance の名前から (口座 ID, 世代) を引く。v1.94.0 のサーバー単位の名前は None
pub fn parse_instance(instance: &str) -> Option<(String, u32)> {
    let (account, generation) = instance.rsplit_once('#')?;
    let generation = generation.parse().ok()?;
    (!account.is_empty()).then(|| (account.to_string(), generation))
}

/// 本家の `createdAt` (`toISOString()` の UTC、例 `2026-10-24T01:02:03.456Z`) を ms に
pub fn iso_to_ms(text: &str) -> Option<u64> {
    let (date, time) = text.strip_suffix('Z')?.split_once('T')?;
    let mut d = date.splitn(3, '-').map(|p| p.parse::<i64>().ok());
    let (year, month, day) = (d.next()??, d.next()??, d.next()??);
    let (hms, frac) = time.split_once('.').unwrap_or((time, "0"));
    let mut t = hms.splitn(3, ':').map(|p| p.parse::<i64>().ok());
    let (hour, minute, second) = (t.next()??, t.next()??, t.next()??);
    let millis: i64 = format!("{frac:0<3}").get(..3)?.parse().ok()?;
    // 暦日から 1970-01-01 起点の日数 (Howard Hinnant の days_from_civil)
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let ms = ((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000 + millis;
    u64::try_from(ms).ok()
}

impl PushStore {
    pub fn from_json(text: &str) -> Self {
        serde_json::from_str(text).unwrap_or_default()
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }

    pub fn account(&self, account_id: &str) -> Option<&AccountPush> {
        self.accounts.get(account_id)
    }

    /// 新しい世代で作り直す口座か (使っていない / 登録し直しが要る / 準備が途中で
    /// 止まった)。有効・登録待ちは触らない (未実行の登録待ちは同じコードを渡し直す)
    pub fn needs_new_generation(&self, account_id: &str) -> bool {
        matches!(
            self.accounts.get(account_id).map(|a| a.phase),
            None | Some(Phase::Off | Phase::NeedsReregistration | Phase::Preparing)
        )
    }

    /// 新しい世代の登録を始める。返り値は新しい世代
    pub fn begin_generation(&mut self, account_id: &str, host: &str, now_ms: u64) -> u32 {
        let rec = self.accounts.entry(account_id.to_string()).or_default();
        rec.host = host.to_string();
        rec.phase = Phase::Preparing;
        rec.generation += 1;
        rec.fingerprint = None;
        rec.confirm_id = None;
        rec.preparing_since_ms = Some(now_ms);
        rec.active_since_ms = None;
        rec.awaiting_since_ms = None;
        rec.test_resent = false;
        rec.miss_streak = 0;
        rec.generation
    }

    /// 新しい世代の送り先がそろった。登録待ちにし、ひとつ前の世代の後始末を積む
    /// (古い世代はこの後で外すので、配送アプリの登録が空になる瞬間が無い)。
    /// 世代が合わなければ何もせず false
    pub fn generation_ready(
        &mut self,
        account_id: &str,
        generation: u32,
        fingerprint: &str,
    ) -> bool {
        let Some(rec) = self.accounts.get_mut(account_id) else {
            return false;
        };
        if rec.phase != Phase::Preparing || rec.generation != generation {
            return false;
        }
        rec.phase = Phase::Pending;
        rec.reason = None;
        rec.fingerprint = Some(fingerprint.to_string());
        rec.preparing_since_ms = None;
        let host = rec.host.clone();
        if generation > 1 {
            self.push_cleanup(Cleanup {
                account_id: account_id.to_string(),
                host,
                generation: generation - 1,
                unregister: true,
                tombstone: None,
                remove_instance: true,
                attempts: 0,
            });
        }
        true
    }

    /// 新しい世代の準備が失敗した。その世代は取り外しへ回し、前の状態の見え方に戻す
    /// (一度でも登録していれば登録し直しが要る、そうでなければ使っていない)
    pub fn generation_failed(&mut self, account_id: &str, generation: u32) {
        let Some(rec) = self.accounts.get_mut(account_id) else {
            return;
        };
        if rec.phase != Phase::Preparing || rec.generation != generation {
            return;
        }
        rec.preparing_since_ms = None;
        if rec.reason.is_none() && generation <= 1 {
            rec.phase = Phase::Off;
        } else {
            rec.phase = Phase::NeedsReregistration;
            rec.reason.get_or_insert(Reason::EndpointChanged);
        }
        let host = rec.host.clone();
        self.push_cleanup(Cleanup {
            account_id: account_id.to_string(),
            host,
            generation,
            unregister: false,
            tombstone: None,
            remove_instance: true,
            attempts: 0,
        });
    }

    /// 合言葉を決めた (サーバー単位の試行ごと)
    pub fn set_nonce(&mut self, account_id: &str, nonce: &str) {
        if let Some(rec) = self.accounts.get_mut(account_id) {
            rec.nonce = Some(nonce.to_string());
        }
    }

    /// 復号できて宛先のユーザーが一致する push が届いた。`test_id` はテスト通知なら
    /// その通知 ID。確定は種別を問わず、時刻は比べない (鍵が新しいので古い push は
    /// 復号できない)
    pub fn on_push(
        &mut self,
        account_id: &str,
        generation: u32,
        test_id: Option<&str>,
        now_ms: u64,
    ) -> Delivery {
        let Some(rec) = self.accounts.get_mut(account_id) else {
            return Delivery::Drop;
        };
        if rec.generation != generation {
            return Delivery::Drop;
        }
        match rec.phase {
            Phase::Preparing | Phase::Pending => {
                rec.phase = Phase::Active;
                rec.reason = None;
                rec.preparing_since_ms = None;
                rec.active_since_ms = Some(now_ms);
                rec.awaiting_since_ms = None;
                rec.miss_streak = 0;
                rec.confirm_id = test_id.map(str::to_string);
                Delivery::Confirmed
            }
            Phase::Active => Delivery::Show,
            Phase::NeedsReregistration => {
                // 推定 (未着) で落としたものは、届いた時点で戻す
                if rec.reason == Some(Reason::Missing) {
                    rec.phase = Phase::Active;
                    rec.reason = None;
                    rec.miss_streak = 0;
                }
                Delivery::Show
            }
            Phase::Off | Phase::Unregistering => Delivery::Drop,
        }
    }

    /// 確定に使ったテスト通知か (巡回とストリーミングが出さない)
    pub fn is_confirmation(&self, account_id: &str, notification_id: &str) -> bool {
        self.accounts
            .get(account_id)
            .and_then(|a| a.confirm_id.as_deref())
            == Some(notification_id)
    }

    /// やめる / 口座の削除 / ログアウト。今の世代の後始末を積んで解除待ちにする
    pub fn begin_disable(&mut self, account_id: &str) {
        let Some(rec) = self.accounts.get_mut(account_id) else {
            return;
        };
        if rec.phase == Phase::Off && rec.nonce.is_none() {
            return;
        }
        rec.phase = Phase::Unregistering;
        rec.reason = None;
        let cleanup = Cleanup {
            account_id: account_id.to_string(),
            host: rec.host.clone(),
            generation: rec.generation,
            unregister: rec.generation > 0,
            tombstone: rec.nonce.take(),
            remove_instance: rec.generation > 0,
            attempts: 0,
        };
        self.push_cleanup(cleanup);
        self.settle(account_id);
    }

    /// 使うプッシュ通知アプリを切り替えた。登録待ち・有効の口座は今の送り先が前のアプリの
    /// ものなので、登録し直しが要る。前の世代は新しい世代がそろってから外す
    /// (`generation_ready`。先に外すと最後の登録が消えて、選んだアプリまで忘れられる)
    pub fn distributor_switched(&mut self) {
        for rec in self.accounts.values_mut() {
            if matches!(rec.phase, Phase::Pending | Phase::Active) {
                rec.phase = Phase::NeedsReregistration;
                rec.reason = Some(Reason::EndpointChanged);
            }
        }
    }

    /// 後始末の 1 件を実行した結果を書く。終わったものはキューから外し、解除待ちの
    /// 口座の今の世代が片付いたら使っていない状態にする
    pub fn cleanup_progress(&mut self, account_id: &str, generation: u32, done: CleanupDone) {
        let Some(slot) = self
            .cleanup
            .iter_mut()
            .find(|c| c.account_id == account_id && c.generation == generation)
        else {
            return;
        };
        if done.unregister {
            slot.unregister = false;
        }
        if done.tombstone {
            slot.tombstone = None;
        }
        if done.remove_instance {
            slot.remove_instance = false;
        }
        if done.failed {
            slot.attempts += 1;
        }
        self.cleanup.retain(|c| !c.is_done());
        self.settle(account_id);
    }

    fn settle(&mut self, account_id: &str) {
        let Some(rec) = self.accounts.get(account_id) else {
            return;
        };
        if rec.phase != Phase::Unregistering {
            return;
        }
        let generation = rec.generation;
        let still = self
            .cleanup
            .iter()
            .any(|c| c.account_id == account_id && c.generation == generation);
        if !still {
            if let Some(rec) = self.accounts.get_mut(account_id) {
                rec.phase = Phase::Off;
                rec.fingerprint = None;
                rec.confirm_id = None;
            }
        }
    }

    fn push_cleanup(&mut self, cleanup: Cleanup) {
        if cleanup.is_done() {
            return;
        }
        // 同じ世代の後始末は 1 件にまとめる
        if let Some(existing) = self
            .cleanup
            .iter_mut()
            .find(|c| c.account_id == cleanup.account_id && c.generation == cleanup.generation)
        {
            existing.unregister |= cleanup.unregister;
            existing.remove_instance |= cleanup.remove_instance;
            if existing.tombstone.is_none() {
                existing.tombstone = cleanup.tombstone;
            }
            return;
        }
        self.cleanup.push(cleanup);
    }

    /// 配送アプリの送り先か鍵が変わった / 登録が外れた (`fingerprint` が None)
    pub fn endpoint_changed(
        &mut self,
        account_id: &str,
        generation: u32,
        fingerprint: Option<&str>,
    ) {
        let Some(rec) = self.accounts.get_mut(account_id) else {
            return;
        };
        if rec.generation != generation || !matches!(rec.phase, Phase::Pending | Phase::Active) {
            return;
        }
        if fingerprint.is_some() && rec.fingerprint.as_deref() == fingerprint {
            return;
        }
        rec.phase = Phase::NeedsReregistration;
        rec.reason = Some(Reason::EndpointChanged);
    }

    /// サーバーを照合した。`vapid` は今の鍵 (None = Web Push が止まった)
    pub fn server_checked(&mut self, account_id: &str, vapid: Option<&str>) {
        let Some(rec) = self.accounts.get_mut(account_id) else {
            return;
        };
        if rec.phase != Phase::Active {
            return;
        }
        let changed = match (vapid, rec.server_key.as_deref()) {
            (None, _) => true,
            (Some(now), Some(registered)) => {
                now.trim_end_matches('=') != registered.trim_end_matches('=')
            }
            (Some(_), None) => false,
        };
        if changed {
            rec.phase = Phase::NeedsReregistration;
            rec.reason = Some(Reason::ServerChanged);
        }
    }

    /// NoteDeck が自分の項目で「済み」を見た (コードが走った)。サーバーの鍵を覚え、
    /// 到着待ちを最初に見てから 3 分過ぎていて、まだ送り直していなければ true
    /// (呼び手がテスト通知を 1 回送る)
    pub fn awaiting(&mut self, account_id: &str, server_key: Option<&str>, now_ms: u64) -> bool {
        let Some(rec) = self.accounts.get_mut(account_id) else {
            return false;
        };
        if rec.phase != Phase::Pending {
            return false;
        }
        if let Some(key) = server_key {
            rec.server_key = Some(key.to_string());
        }
        let since = *rec.awaiting_since_ms.get_or_insert(now_ms);
        if rec.test_resent || now_ms.saturating_sub(since) < RESEND_AFTER_MS {
            return false;
        }
        rec.test_resent = true;
        true
    }

    /// 巡回が処理位置より新しい通知を見つけた。`created_ms` はその作成時刻。有効になって
    /// から作られ、届くまでの遅れを見込んでも push で来ていないものがあれば未着と数え、
    /// 続いたら登録し直しが要る。何も無ければ数え直す
    pub fn worker_observed(&mut self, account_id: &str, created_ms: &[u64], now_ms: u64) {
        let Some(rec) = self.accounts.get_mut(account_id) else {
            return;
        };
        if rec.phase != Phase::Active {
            return;
        }
        let since = rec.active_since_ms.unwrap_or(u64::MAX);
        let missed = created_ms
            .iter()
            .any(|&t| t >= since && now_ms.saturating_sub(t) >= MISSED_AFTER_MS);
        if !missed {
            rec.miss_streak = 0;
            return;
        }
        rec.miss_streak += 1;
        if rec.miss_streak >= MISSED_STREAK {
            rec.phase = Phase::NeedsReregistration;
            rec.reason = Some(Reason::Missing);
            rec.miss_streak = 0;
        }
    }

    /// v1.94.0 のサーバー単位の登録を解除した口座を、登録し直しが要る状態にする
    pub fn mark_migrated(&mut self, account_id: &str, host: &str) {
        let rec = self.accounts.entry(account_id.to_string()).or_default();
        rec.host = host.to_string();
        rec.phase = Phase::NeedsReregistration;
        rec.reason = Some(Reason::Migrated);
    }

    /// 起動時の突き合わせ。`instances` は配送アプリに登録されている (口座, 世代)。
    /// 準備中のまま長く止まっているものは失敗扱いにし、状態の知らない登録
    /// (古い世代・消えた口座・やめた口座) は本家への解除をしてから外す
    pub fn reconcile(&mut self, instances: &[(String, u32)], now_ms: u64) {
        let stale: Vec<(String, u32)> = self
            .accounts
            .iter()
            .filter(|(_, a)| {
                a.phase == Phase::Preparing
                    && a.preparing_since_ms
                        .is_none_or(|t| now_ms.saturating_sub(t) >= STALE_PREPARING_MS)
            })
            .map(|(id, a)| (id.clone(), a.generation))
            .collect();
        for (account, generation) in stale {
            self.generation_failed(&account, generation);
        }
        for (account, generation) in instances {
            let current = self.accounts.get(account).is_some_and(|a| {
                a.generation == *generation
                    && matches!(
                        a.phase,
                        Phase::Preparing
                            | Phase::Pending
                            | Phase::Active
                            | Phase::NeedsReregistration
                    )
            });
            let queued = self
                .cleanup
                .iter()
                .any(|c| &c.account_id == account && c.generation == *generation);
            if !current && !queued {
                let host = self
                    .accounts
                    .get(account)
                    .map(|a| a.host.clone())
                    .unwrap_or_default();
                self.push_cleanup(Cleanup {
                    account_id: account.clone(),
                    host,
                    generation: *generation,
                    unregister: true,
                    tombstone: None,
                    remove_instance: true,
                    attempts: 0,
                });
            }
        }
    }

    /// 起動時と復帰時に知らせる口座 (登録し直しが要る)
    pub fn needing_attention(&self) -> Vec<&str> {
        self.accounts
            .iter()
            .filter(|(_, a)| a.phase == Phase::NeedsReregistration)
            .map(|(id, _)| id.as_str())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready(store: &mut PushStore, account: &str) -> u32 {
        let generation = store.begin_generation(account, "h", 0);
        assert!(store.generation_ready(account, generation, "fp"));
        generation
    }

    #[test]
    fn instance_names_round_trip_and_host_names_are_not_parsed() {
        assert_eq!(instance_name("acct-1", 3), "acct-1#3");
        assert_eq!(parse_instance("acct-1#3"), Some(("acct-1".into(), 3)));
        // v1.94.0 はホスト (ポート付きもある) を instance にしていた
        assert_eq!(parse_instance("misskey.example"), None);
        assert_eq!(parse_instance("misskey.example:3000"), None);
        assert_eq!(parse_instance("#3"), None);
    }

    #[test]
    fn iso_timestamps_convert_to_epoch_ms() {
        assert_eq!(iso_to_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(
            iso_to_ms("2026-10-24T01:02:03.456Z"),
            Some(1_792_803_723_456)
        );
        assert_eq!(iso_to_ms("2000-02-29T12:00:00Z"), Some(951_825_600_000));
        assert_eq!(iso_to_ms("2026-10-24 01:02:03"), None);
    }

    /// 準備 → 送り先 → 届いた push で確定。テスト通知の ID を覚える
    #[test]
    fn first_decrypted_push_confirms_and_remembers_the_test_id() {
        let mut s = PushStore::default();
        assert!(s.needs_new_generation("a"));
        let generation = ready(&mut s, "a");
        assert_eq!(s.account("a").unwrap().phase, Phase::Pending);
        assert!(
            !s.needs_new_generation("a"),
            "未実行の登録待ちは作り直さない"
        );
        assert_eq!(
            s.on_push("a", generation, Some("n1"), 7),
            Delivery::Confirmed
        );
        let a = s.account("a").unwrap();
        assert_eq!(a.phase, Phase::Active);
        assert_eq!(a.active_since_ms, Some(7));
        assert!(s.is_confirmation("a", "n1"));
        assert!(!s.is_confirmation("a", "n2"));
        assert_eq!(s.on_push("a", generation, None, 8), Delivery::Show);
        // 古い世代宛て・知らない口座宛ては捨てる
        assert_eq!(s.on_push("a", generation + 1, None, 9), Delivery::Drop);
        assert_eq!(s.on_push("x", 1, None, 9), Delivery::Drop);
    }

    /// 新しい世代がそろってから古い世代の後始末を積む (配送アプリの登録が空にならない)
    #[test]
    fn old_generation_is_cleaned_up_only_after_the_new_one_is_ready() {
        let mut s = PushStore::default();
        let first = ready(&mut s, "a");
        s.on_push("a", first, None, 0);
        s.distributor_switched();
        assert_eq!(
            s.account("a").map(|a| (a.phase, a.reason)),
            Some((Phase::NeedsReregistration, Some(Reason::EndpointChanged)))
        );
        assert!(s.cleanup.is_empty(), "切り替えた時点ではまだ外さない");
        assert!(s.needs_new_generation("a"));
        let second = s.begin_generation("a", "h", 0);
        assert!(s.cleanup.is_empty());
        assert!(s.generation_ready("a", second, "fp2"));
        assert_eq!(s.cleanup.len(), 1);
        let c = &s.cleanup[0];
        assert_eq!(
            (c.generation, c.unregister, c.remove_instance),
            (first, true, true)
        );
        // 世代が合わなければ何もしない
        assert!(!s.generation_ready("a", 9, "x"));
    }

    /// 準備の失敗: その世代は外し、一度も登録していなければ使っていない状態に戻る
    #[test]
    fn failed_generation_is_removed_and_the_state_falls_back() {
        let mut s = PushStore::default();
        let generation = s.begin_generation("a", "h", 0);
        s.generation_failed("a", generation);
        assert_eq!(s.account("a").unwrap().phase, Phase::Off);
        assert!(s.cleanup[0].remove_instance && !s.cleanup[0].unregister);

        let mut s = PushStore::default();
        let first = ready(&mut s, "b");
        s.endpoint_changed("b", first, None);
        let second = s.begin_generation("b", "h", 0);
        s.generation_failed("b", second);
        let b = s.account("b").unwrap();
        assert_eq!(
            (b.phase, b.reason),
            (Phase::NeedsReregistration, Some(Reason::EndpointChanged))
        );
    }

    /// やめる: 解除待ち → 後始末が全部終わったら使っていない。解除待ち宛ての push は捨てる
    #[test]
    fn disable_waits_for_cleanup_and_drops_pushes_meanwhile() {
        let mut s = PushStore::default();
        let generation = ready(&mut s, "a");
        s.set_nonce("a", "nonce1");
        s.on_push("a", generation, Some("t"), 0);
        s.begin_disable("a");
        assert_eq!(s.account("a").unwrap().phase, Phase::Unregistering);
        assert_eq!(s.on_push("a", generation, None, 0), Delivery::Drop);
        assert_eq!(s.cleanup[0].tombstone.as_deref(), Some("nonce1"));
        let done = |unregister, tombstone, remove_instance, failed| CleanupDone {
            unregister,
            tombstone,
            remove_instance,
            failed,
        };
        s.cleanup_progress("a", generation, done(false, true, true, true));
        assert_eq!(
            s.account("a").unwrap().phase,
            Phase::Unregistering,
            "解除が残っている"
        );
        assert_eq!(s.cleanup[0].attempts, 1);
        s.cleanup_progress("a", generation, done(true, false, false, false));
        assert_eq!(s.account("a").unwrap().phase, Phase::Off);
        assert!(s.cleanup.is_empty());
        assert!(!s.is_confirmation("a", "t"), "確定の ID も忘れる");
    }

    /// 送り先の変化・サーバーの変化で登録し直しが要る。届いた push は出す
    #[test]
    fn reregistration_reasons_keep_showing_pushes() {
        let mut s = PushStore::default();
        let generation = ready(&mut s, "a");
        s.awaiting("a", Some("KEY="), 0);
        s.on_push("a", generation, None, 0);
        s.endpoint_changed("a", generation, Some("fp"));
        assert_eq!(
            s.account("a").unwrap().phase,
            Phase::Active,
            "同じ指紋なら変えない"
        );
        s.server_checked("a", Some("KEY"));
        assert_eq!(
            s.account("a").unwrap().phase,
            Phase::Active,
            "= の有無は同じ鍵"
        );
        s.server_checked("a", Some("OTHER"));
        assert_eq!(s.account("a").unwrap().reason, Some(Reason::ServerChanged));
        assert_eq!(s.on_push("a", generation, None, 0), Delivery::Show);
        assert_eq!(s.account("a").unwrap().phase, Phase::NeedsReregistration);
        assert_eq!(s.needing_attention(), vec!["a"]);
    }

    /// 未着の推定: 有効になる前の通知と、届くまでの遅れの内の通知は数えない。2 回続いたら
    /// 登録し直しが要る。届いたら戻す
    #[test]
    fn missing_pushes_are_estimated_conservatively() {
        let mut s = PushStore::default();
        let generation = ready(&mut s, "b");
        let start = 1_000_000;
        s.on_push("b", generation, None, start);
        let now = start + 60 * 60 * 1000;
        s.worker_observed("b", &[start - 1], now);
        s.worker_observed("b", &[now - MISSED_AFTER_MS + 1], now);
        assert_eq!(s.account("b").unwrap().miss_streak, 0);
        s.worker_observed("b", &[start + 1], now);
        assert_eq!(
            s.account("b").unwrap().phase,
            Phase::Active,
            "1 回では変えない"
        );
        s.worker_observed("b", &[], now);
        s.worker_observed("b", &[start + 1], now);
        assert_eq!(s.account("b").unwrap().phase, Phase::Active, "続いていない");
        s.worker_observed("b", &[start + 2], now);
        assert_eq!(s.account("b").unwrap().reason, Some(Reason::Missing));
        assert_eq!(s.on_push("b", generation, None, now), Delivery::Show);
        assert_eq!(s.account("b").unwrap().phase, Phase::Active, "届いたら戻す");
    }

    /// 到着待ちを最初に見てから 3 分過ぎたら 1 回だけテスト通知を送り直す
    #[test]
    fn awaiting_resends_the_test_once_after_three_minutes() {
        let mut s = PushStore::default();
        ready(&mut s, "a");
        assert!(!s.awaiting("a", Some("K"), 1_000));
        assert!(!s.awaiting("a", None, 1_000 + 179_999));
        assert!(s.awaiting("a", None, 1_000 + 180_000));
        assert!(!s.awaiting("a", None, 1_000 + 999_999));
        assert_eq!(s.account("a").unwrap().server_key.as_deref(), Some("K"));
    }

    /// 起動時の突き合わせ: 長く止まった準備は失敗扱い、知らない登録は解除してから外す
    #[test]
    fn reconcile_resolves_stale_preparing_and_unknown_instances() {
        let mut s = PushStore::default();
        s.begin_generation("fresh", "h", 1_000);
        s.begin_generation("stale", "h", 0);
        s.reconcile(
            &[("ghost".into(), 4), ("fresh".into(), 1)],
            STALE_PREPARING_MS,
        );
        assert_eq!(
            s.account("fresh").unwrap().phase,
            Phase::Preparing,
            "まだ待つ"
        );
        assert_eq!(s.account("stale").unwrap().phase, Phase::Off);
        assert!(s
            .cleanup
            .iter()
            .any(|c| c.account_id == "ghost" && c.unregister && c.remove_instance));
        assert!(s
            .cleanup
            .iter()
            .any(|c| c.account_id == "stale" && c.remove_instance));
        assert!(!s.cleanup.iter().any(|c| c.account_id == "fresh"));
        // 2 回目は同じ後始末を積まない
        let before = s.cleanup.len();
        s.reconcile(&[("ghost".into(), 4)], STALE_PREPARING_MS);
        assert_eq!(s.cleanup.len(), before);
    }

    #[test]
    fn migration_marks_accounts_for_reregistration() {
        let mut s = PushStore::default();
        s.mark_migrated("a", "h");
        let a = s.account("a").unwrap();
        assert_eq!(
            (a.phase, a.reason),
            (Phase::NeedsReregistration, Some(Reason::Migrated))
        );
        assert!(s.needs_new_generation("a"));
    }

    #[test]
    fn json_round_trip_and_broken_input() {
        let mut s = PushStore::default();
        ready(&mut s, "a");
        assert_eq!(PushStore::from_json(&s.to_json()), s);
        assert_eq!(PushStore::from_json("nope"), PushStore::default());
    }
}

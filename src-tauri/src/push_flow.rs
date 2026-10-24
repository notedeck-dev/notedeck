//! push の登録・解除・後始末の手順 (#330、2026-10-24 の作り直し)。
//!
//! 遷移は `notecore::push_state` の純関数、状態ファイルは `push_store_file`。ここは
//! 本家 ([`Server`])・プッシュ通知アプリ ([`Distributor`])・keychain ([`Vault`]) を順に
//! 呼ぶだけで、実物は notecli と `android_push` (JNI)、テストは偽物で回す。
//!
//! - 秘密 (送り先と鍵の三つ組) はコードに入れない。NoteDeck が自分のトークンでレジストリに
//!   書き、Scratchpad のコードが合言葉で読む (`notecore::push_register`)
//! - プッシュ通知アプリへの登録は口座 + 世代。新しい世代の送り先を受け取ってから古い
//!   世代を外す。三つ組は keychain に口座 + 世代で持ち、本家の解除が通るまで残す
//! - 確定は届いた push (`android_push` の受信の入口)。ここは「未実行」と「到着待ち」を
//!   レジストリの印で見分け、到着待ちが続けばテスト通知を 1 回送り直す
// 使うのは Android だけ (ほかの OS ではテストからだけ呼ぶ)
#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use std::collections::BTreeSet;
use std::path::Path;
use std::time::Duration;

use notecli::error::NoteDeckError;
use notecli::models::Account;
use notecore::push_register::{self, EntryState, PushKeys, Target, REGISTRY_SCOPE};
use notecore::push_state::{self, CleanupDone, Phase, Reason, MAX_CLEANUP_ATTEMPTS};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::commands::{
    PushAccountRow, PushDistributor, PushDistributorState, PushHostStatus, PushOverview,
    PushProblem, PushReason, PushState,
};
use crate::push_store_file;

/// プッシュ通知アプリが送り先を返すまで待つ上限。複数のアプリから選ぶ OS の画面が
/// 出ることがあるので短くしない
const ENDPOINT_WAIT: Duration = Duration::from_secs(60);
const ENDPOINT_POLL: Duration = Duration::from_millis(500);

/// Kotlin が「プッシュ通知アプリを選べなかった」ときに残す失敗の種別
/// (PushBridge.FAILURE_NOT_CHOSEN と同じ値)
pub const FAILURE_NOT_CHOSEN: &str = "NOT_CHOSEN";

/// 手順に要る口座の情報。トークンが無ければゲスト / ログアウト済み
#[derive(Debug, Clone)]
pub struct PushAccount {
    pub id: String,
    pub host: String,
    pub user_id: String,
    pub username: String,
    pub token: Option<String>,
}

impl PushAccount {
    #[cfg(target_os = "android")]
    pub fn from_account(account: &Account) -> Self {
        Self::with_token(account, crate::android_worker::token_for(account))
    }

    pub fn with_token(account: &Account, token: Option<String>) -> Self {
        Self {
            id: account.id.clone(),
            host: account.host.clone(),
            user_id: account.user_id.clone(),
            username: account.username.clone(),
            token,
        }
    }
}

/// プッシュ通知アプリが発行した送り先と鍵 (Kotlin の `PushBridge.endpoint`)
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub url: String,
    pub pub_key: String,
    pub auth: String,
}

impl Endpoint {
    fn keys(&self) -> PushKeys {
        PushKeys {
            endpoint: self.url.clone(),
            auth: self.auth.clone(),
            publickey: self.pub_key.clone(),
        }
    }

    /// 変化を見つけるための指紋 (状態ファイルに秘密を置かない)
    fn fingerprint(&self) -> String {
        let digest = Sha256::digest(format!("{}\n{}\n{}", self.url, self.pub_key, self.auth));
        digest.iter().take(8).map(|b| format!("{b:02x}")).collect()
    }
}

/// プッシュ通知アプリ (UnifiedPush の connector)。実物は Kotlin の PushBridge
pub trait Distributor {
    /// Kotlin 側が使える状態か (Activity も Context も無いプロセスでは使えない)。
    /// 使えないときに送り先を読むと「無い」と区別できないので、突き合わせを止める
    fn available(&self) -> bool;
    fn state(&self) -> PushDistributorState;
    /// 登録を始められたら true。送り先は後から [`Distributor::endpoint`] に届く
    fn register(&self, instance: &str, vapid: &str, message: &str) -> bool;
    fn endpoint(&self, instance: &str) -> Option<Endpoint>;
    fn failure(&self, instance: &str) -> Option<String>;
    fn unregister(&self, instance: &str);
    fn instances(&self) -> Vec<String>;
    /// 入っているプッシュ通知アプリ (今使っているものに印)
    fn installed(&self) -> Vec<PushDistributor>;
    /// 使うプッシュ通知アプリを決める
    fn choose(&self, package: &str);
}

/// 三つ組の置き場 (実物は OS の keychain)
pub trait Vault {
    fn get(&self, key: &str) -> Option<String>;
    fn set(&self, key: &str, value: &str) -> bool;
    fn delete(&self, key: &str);
}

/// 本家の API (実物は notecli)
pub(crate) trait Server {
    async fn meta(&self, host: &str, token: &str) -> Result<Value, NoteDeckError>;
    async fn registry_get(
        &self,
        host: &str,
        token: &str,
        key: &str,
    ) -> Result<Option<Value>, NoteDeckError>;
    async fn registry_set(
        &self,
        host: &str,
        token: &str,
        key: &str,
        value: Value,
    ) -> Result<(), NoteDeckError>;
    async fn sw_unregister(
        &self,
        host: &str,
        token: &str,
        keys: &PushKeys,
    ) -> Result<(), NoteDeckError>;
    async fn test_notification(&self, host: &str, token: &str) -> Result<(), NoteDeckError>;
}

impl Server for notecli::api::MisskeyClient {
    async fn meta(&self, host: &str, token: &str) -> Result<Value, NoteDeckError> {
        self.get_meta(host, token).await
    }

    async fn registry_get(
        &self,
        host: &str,
        token: &str,
        key: &str,
    ) -> Result<Option<Value>, NoteDeckError> {
        notecli::api::MisskeyClient::registry_get(self, host, token, &REGISTRY_SCOPE, key).await
    }

    async fn registry_set(
        &self,
        host: &str,
        token: &str,
        key: &str,
        value: Value,
    ) -> Result<(), NoteDeckError> {
        notecli::api::MisskeyClient::registry_set(self, host, token, &REGISTRY_SCOPE, key, value)
            .await
    }

    async fn sw_unregister(
        &self,
        host: &str,
        token: &str,
        keys: &PushKeys,
    ) -> Result<(), NoteDeckError> {
        notecli::api::MisskeyClient::sw_unregister(
            self,
            host,
            token,
            &keys.endpoint,
            &keys.auth,
            &keys.publickey,
        )
        .await
    }

    async fn test_notification(&self, host: &str, token: &str) -> Result<(), NoteDeckError> {
        notecli::api::MisskeyClient::test_notification(self, host, token).await
    }
}

/// 手順の文脈。プッシュ通知アプリと keychain も型で受ける (`dyn` にすると await を
/// またいで持つ参照が Send でなくなり、Tauri のコマンドにできない)
pub(crate) struct Ctx<'a, S, D, V> {
    pub app_dir: &'a Path,
    pub server: &'a S,
    pub distributor: &'a D,
    pub vault: &'a V,
    pub now_ms: u64,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---- keychain の三つ組 ----

/// keychain に置く三つ組。v1.94.0 の写し (`serverKey` 付き) もこの形で読める
#[derive(Debug, Serialize, Deserialize)]
struct StoredKeys {
    endpoint: String,
    auth: String,
    publickey: String,
}

/// keychain の鍵名 (トークンと同じ名前空間、AI キーと同じやり方)
fn vault_key(account_id: &str, generation: u32) -> String {
    format!("push-subscription:{account_id}:{generation}")
}

/// v1.94.0 の鍵名 (口座ごとに 1 つ)
fn legacy_vault_key(account_id: &str) -> String {
    format!("push-subscription:{account_id}")
}

fn load_keys(vault: &impl Vault, key: &str) -> Option<PushKeys> {
    let stored: StoredKeys = serde_json::from_str(&vault.get(key)?).ok()?;
    Some(PushKeys {
        endpoint: stored.endpoint,
        auth: stored.auth,
        publickey: stored.publickey,
    })
}

// ---- 状態の見え方 ----

fn state_view(phase: Phase) -> PushState {
    match phase {
        Phase::Off => PushState::Off,
        Phase::Preparing => PushState::Preparing,
        Phase::Pending => PushState::Pending,
        Phase::Active => PushState::Active,
        Phase::NeedsReregistration => PushState::NeedsReregistration,
        Phase::Unregistering => PushState::Unregistering,
    }
}

fn reason_view(reason: Reason) -> PushReason {
    match reason {
        Reason::EndpointChanged => PushReason::EndpointChanged,
        Reason::ServerChanged => PushReason::ServerChanged,
        Reason::Missing => PushReason::Missing,
        Reason::Migrated => PushReason::Migrated,
    }
}

/// 登録し直しが要る口座 (トークンのあるもの)
pub fn needing_attention(app_dir: &Path, accounts: &[PushAccount]) -> Vec<String> {
    let store = push_store_file::load(app_dir);
    store
        .needing_attention()
        .into_iter()
        .filter(|id| accounts.iter().any(|a| a.id == *id && a.token.is_some()))
        .map(str::to_string)
        .collect()
}

/// 確定に使ったテスト通知か (巡回とストリーミングが出さない)
pub fn is_confirmation(app_dir: &Path, account_id: &str, notification_id: &str) -> bool {
    push_store_file::load(app_dir).is_confirmation(account_id, notification_id)
}

// ---- レジストリ ----

/// 自分の項目の状態。合言葉かトークンが無い / 項目が無ければ None
async fn entry_state<S: Server, D: Distributor, V: Vault>(
    ctx: &Ctx<'_, S, D, V>,
    account: &PushAccount,
    nonce: Option<&str>,
) -> Result<Option<EntryState>, NoteDeckError> {
    let (Some(nonce), Some(token)) = (nonce, account.token.as_deref()) else {
        return Ok(None);
    };
    Ok(ctx
        .server
        .registry_get(&account.host, token, nonce)
        .await?
        .map(|v| push_register::parse_entry(&v)))
}

/// 書込が通らなかった理由。権限が無い (古いトークン) / 失効はログインし直し
fn write_problem(e: &NoteDeckError) -> PushProblem {
    match e {
        NoteDeckError::Api {
            status: 401 | 403, ..
        } => PushProblem::Relogin,
        _ => PushProblem::Network,
    }
}

// ---- サーバー単位の状態 ----

/// 送り先と鍵が変わっていないか (登録待ち・有効の口座)
fn refresh_endpoints<S, D: Distributor, V>(ctx: &Ctx<'_, S, D, V>, accounts: &[&PushAccount]) {
    if !ctx.distributor.available() {
        return;
    }
    let store = push_store_file::load(ctx.app_dir);
    let observed: Vec<(String, u32, Option<String>)> = accounts
        .iter()
        .filter_map(|a| store.account(&a.id).map(|rec| (a, rec)))
        .filter(|(_, rec)| matches!(rec.phase, Phase::Pending | Phase::Active))
        .map(|(a, rec)| {
            let instance = push_state::instance_name(&a.id, rec.generation);
            let fingerprint = ctx.distributor.endpoint(&instance).map(|e| e.fingerprint());
            (a.id.clone(), rec.generation, fingerprint)
        })
        .collect();
    if observed.is_empty() {
        return;
    }
    push_store_file::update(ctx.app_dir, |s| {
        for (account, generation, fingerprint) in &observed {
            s.endpoint_changed(account, *generation, fingerprint.as_deref());
        }
    });
}

/// サーバー単位の状態。登録待ちの口座はレジストリの印で「未実行」と「到着待ち」を見分け、
/// 未実行のものがあればコードを組む
pub(crate) async fn host_status<S: Server, D: Distributor, V: Vault>(
    ctx: &Ctx<'_, S, D, V>,
    host: &str,
    accounts: &[PushAccount],
    lang: &str,
) -> PushHostStatus {
    let on_host: Vec<&PushAccount> = accounts.iter().filter(|a| a.host == host).collect();
    refresh_endpoints(ctx, &on_host);
    let store = push_store_file::load(ctx.app_dir);
    let mut rows = Vec::new();
    let mut unexecuted: Vec<(&PushAccount, String)> = Vec::new();
    for account in &on_host {
        let mut row = PushAccountRow {
            account_id: account.id.clone(),
            state: PushState::Off,
            reason: None,
            awaiting: false,
            resent: false,
        };
        let Some(token) = account.token.as_deref() else {
            row.state = PushState::Unavailable;
            rows.push(row);
            continue;
        };
        if let Some(rec) = store.account(&account.id) {
            row.state = state_view(rec.phase);
            row.reason = rec.reason.map(reason_view);
            if rec.phase == Phase::Pending {
                match entry_state(ctx, account, rec.nonce.as_deref()).await {
                    Ok(Some(EntryState::Pending)) => {
                        if let Some(nonce) = &rec.nonce {
                            unexecuted.push((account, nonce.clone()));
                        }
                    }
                    Ok(Some(EntryState::Done { server_key })) => {
                        row.awaiting = true;
                        let resend = push_store_file::update(ctx.app_dir, |s| {
                            s.awaiting(&account.id, server_key.as_deref(), ctx.now_ms)
                        });
                        if resend {
                            if let Err(e) = ctx.server.test_notification(host, token).await {
                                tracing::info!("[push] test notification failed: {e}");
                            }
                        }
                        row.resent = rec.test_resent || resend;
                    }
                    // 項目が無い / 取り消し済み (再ログインでトークンが変わった、本家の
                    // 設定で消した): コードは見つけられないので、準備し直してもらう
                    Ok(_) => row.state = PushState::NeedsReregistration,
                    // 読めなければ登録待ちのまま (次の読み直しで分かる)
                    Err(e) => tracing::info!("[push] registry read failed: {e}"),
                }
            }
        }
        rows.push(row);
    }
    let code = unexecuted.first().map(|(_, nonce)| {
        let targets: Vec<Target> = unexecuted
            .iter()
            .filter(|(_, n)| n == nonce)
            .map(|(a, _)| Target {
                user_id: a.user_id.clone(),
                name: format!("@{}", a.username),
            })
            .collect();
        push_register::register_code(nonce, &targets, lang)
    });
    PushHostStatus {
        host: host.to_string(),
        accounts: rows,
        code,
        scratchpad_url: push_register::scratchpad_url(host),
    }
}

/// 端末の push の全体 (窓が読む)。サーバーの並びは口座の並びのまま
pub(crate) async fn overview<S: Server, D: Distributor, V: Vault>(
    ctx: &Ctx<'_, S, D, V>,
    accounts: &[PushAccount],
    lang: &str,
) -> PushOverview {
    let mut hosts: Vec<&str> = Vec::new();
    for account in accounts {
        if !hosts.contains(&account.host.as_str()) {
            hosts.push(&account.host);
        }
    }
    let mut statuses = Vec::new();
    for host in hosts {
        statuses.push(host_status(ctx, host, accounts, lang).await);
    }
    PushOverview {
        distributor: ctx.distributor.state(),
        apps: ctx.distributor.installed(),
        hosts: statuses,
    }
}

/// 使うプッシュ通知アプリを決める。今と同じなら何もしない。切り替えたら、登録待ち・有効の
/// 口座は前のアプリの送り先なので登録し直しが要る
pub(crate) fn choose_distributor<S, D: Distributor, V>(ctx: &Ctx<'_, S, D, V>, package: &str) {
    if ctx
        .distributor
        .installed()
        .iter()
        .any(|app| app.package == package && app.active)
    {
        return;
    }
    ctx.distributor.choose(package);
    push_store_file::update(ctx.app_dir, |s| s.distributor_switched());
}

// ---- 準備 ----

/// 新しい世代をプッシュ通知アプリに登録し、送り先を keychain に置く。返り値は指紋
async fn register_generation<S, D: Distributor, V: Vault>(
    ctx: &Ctx<'_, S, D, V>,
    account: &PushAccount,
    generation: u32,
    vapid: &str,
) -> Result<String, PushProblem> {
    let instance = push_state::instance_name(&account.id, generation);
    // プッシュ通知アプリの画面で口座を見分けられるように添える
    let message = format!("@{}@{}", account.username, account.host);
    if !ctx.distributor.register(&instance, vapid, &message) {
        return Err(PushProblem::NoDistributor);
    }
    let started = std::time::Instant::now();
    let endpoint = loop {
        if let Some(endpoint) = ctx.distributor.endpoint(&instance) {
            break endpoint;
        }
        match ctx.distributor.failure(&instance).as_deref() {
            Some(FAILURE_NOT_CHOSEN) => return Err(PushProblem::ChooseDistributor),
            Some(_) => return Err(PushProblem::DistributorFailed),
            None => {}
        }
        if started.elapsed() > ENDPOINT_WAIT {
            return Err(PushProblem::DistributorFailed);
        }
        tokio::time::sleep(ENDPOINT_POLL).await;
    };
    if !push_register::endpoint_usable(&endpoint.url) {
        return Err(PushProblem::EndpointUnusable);
    }
    let keys = endpoint.keys();
    let stored = serde_json::to_string(&StoredKeys {
        endpoint: keys.endpoint,
        auth: keys.auth,
        publickey: keys.publickey,
    })
    .map_err(|_| PushProblem::Storage)?;
    if !ctx.vault.set(&vault_key(&account.id, generation), &stored) {
        return Err(PushProblem::Storage);
    }
    Ok(endpoint.fingerprint())
}

/// 口座をオンにする準備。使っていない / 登録し直しが要る口座は新しい世代で登録し、同じ
/// サーバーの登録待ちの口座と合わせてレジストリに書く (1 つのコードで全部 ▶ できる)。
/// 未実行の登録待ちだけなら何も書かず同じコードを渡し直す。`only` があれば新しく登録するのは
/// その口座だけ (None ならサーバーの該当する口座すべて)。`random` は合言葉の乱数
pub(crate) async fn prepare<S: Server, D: Distributor, V: Vault>(
    ctx: &Ctx<'_, S, D, V>,
    host: &str,
    accounts: &[PushAccount],
    only: Option<&str>,
    random: [u8; 10],
) -> Result<(), PushProblem> {
    let on_host: Vec<&PushAccount> = accounts
        .iter()
        .filter(|a| a.host == host && a.token.is_some())
        .collect();
    let Some(first) = on_host.first() else {
        return Err(PushProblem::Unavailable);
    };
    if ctx.distributor.state() == PushDistributorState::None {
        return Err(PushProblem::NoDistributor);
    }
    let meta = ctx
        .server
        .meta(host, first.token.as_deref().unwrap_or_default())
        .await
        .map_err(|_| PushProblem::Network)?;
    let vapid = push_register::server_vapid(&meta).ok_or(PushProblem::ServerUnsupported)?;
    // 口座を振り分ける: 新しい世代 / 項目の書き直し / 未実行のまま (同じコード)
    let store = push_store_file::load(ctx.app_dir);
    let mut fresh = Vec::new();
    let mut rewrite = Vec::new();
    let mut unchanged: Vec<(&PushAccount, Option<String>)> = Vec::new();
    for account in &on_host {
        if store.needs_new_generation(&account.id) {
            if only.is_none_or(|id| id == account.id) {
                fresh.push(*account);
            }
            continue;
        }
        let Some(rec) = store.account(&account.id) else {
            continue;
        };
        // 有効・解除待ちは触らない
        if rec.phase != Phase::Pending {
            continue;
        }
        match entry_state(ctx, account, rec.nonce.as_deref()).await {
            Ok(Some(EntryState::Pending)) => unchanged.push((account, rec.nonce.clone())),
            // 到着待ちはコードが走った後なので触らない
            Ok(Some(EntryState::Done { .. })) => {}
            Ok(_) => rewrite.push(*account),
            Err(e) => return Err(write_problem(&e)),
        }
    }

    for account in &fresh {
        let generation = push_store_file::update(ctx.app_dir, |s| {
            s.begin_generation(&account.id, host, ctx.now_ms)
        });
        match register_generation(ctx, account, generation, &vapid).await {
            Ok(fingerprint) => {
                push_store_file::update(ctx.app_dir, |s| {
                    s.generation_ready(&account.id, generation, &fingerprint)
                });
            }
            Err(problem) => {
                push_store_file::update(ctx.app_dir, |s| {
                    s.generation_failed(&account.id, generation)
                });
                run_cleanup(ctx, accounts).await;
                return Err(problem);
            }
        }
    }

    let nonces: BTreeSet<Option<&String>> = unchanged.iter().map(|(_, n)| n.as_ref()).collect();
    if fresh.is_empty() && rewrite.is_empty() && nonces.len() <= 1 {
        // 未実行の登録待ちだけ (または何もない)。同じコードを渡し直す
        run_cleanup(ctx, accounts).await;
        return Ok(());
    }

    // 合言葉はサーバー単位の試行ごと。前の項目は消さずに取り消し済みにする
    // (消すと、合言葉を知る第三者が置いた偽の登録待ちが「ちょうど 1 件」になる)
    let nonce = push_register::new_nonce(random);
    let targets = fresh
        .iter()
        .chain(rewrite.iter())
        .copied()
        .chain(unchanged.iter().map(|(a, _)| *a));
    for account in targets {
        let token = account.token.as_deref().unwrap_or_default();
        let store = push_store_file::load(ctx.app_dir);
        let Some(rec) = store.account(&account.id) else {
            continue;
        };
        let keys = load_keys(ctx.vault, &vault_key(&account.id, rec.generation))
            .ok_or(PushProblem::Storage)?;
        ctx.server
            .registry_set(host, token, &nonce, push_register::pending_value(&keys))
            .await
            .map_err(|e| write_problem(&e))?;
        if let Some(old) = rec.nonce.as_deref().filter(|old| *old != nonce) {
            if let Err(e) = ctx
                .server
                .registry_set(host, token, old, push_register::superseded_value())
                .await
            {
                tracing::info!("[push] could not supersede the previous entry: {e}");
            }
        }
        push_store_file::update(ctx.app_dir, |s| s.set_nonce(&account.id, &nonce));
    }
    run_cleanup(ctx, accounts).await;
    Ok(())
}

// ---- 解除と後始末 ----

/// やめる。後始末を積んですぐ試す (通らなければ解除待ちで残る)
pub(crate) async fn disable<S: Server, D: Distributor, V: Vault>(
    ctx: &Ctx<'_, S, D, V>,
    account_id: &str,
    accounts: &[PushAccount],
) {
    push_store_file::update(ctx.app_dir, |s| s.begin_disable(account_id));
    run_cleanup(ctx, accounts).await;
}

/// 本家の購読を解除する。トークンが失効していたら未認証で (三つ組は口座 + 世代ごとに
/// 一意なので、ほかの口座を巻き込まない)
async fn unregister<S: Server>(
    server: &S,
    host: &str,
    token: Option<&str>,
    keys: &PushKeys,
) -> Result<(), NoteDeckError> {
    if let Some(token) = token {
        match server.sw_unregister(host, token, keys).await {
            Err(NoteDeckError::Api { status: 401, .. }) => {}
            other => return other,
        }
    }
    server.sw_unregister(host, "", keys).await
}

/// 後始末のキューを 1 巡する。通らなかった手順は残し、回数を数える
pub(crate) async fn run_cleanup<S: Server, D: Distributor, V: Vault>(
    ctx: &Ctx<'_, S, D, V>,
    accounts: &[PushAccount],
) {
    let queue = push_store_file::load(ctx.app_dir).cleanup;
    for item in queue {
        let account = accounts.iter().find(|a| a.id == item.account_id);
        let token = account.and_then(|a| a.token.as_deref());
        let host = match (item.host.as_str(), account) {
            ("", Some(a)) => a.host.as_str(),
            (host, _) => host,
        };
        // 上限を超えた / ホストが分からないものは本家への手順を諦める
        let give_up = item.attempts >= MAX_CLEANUP_ATTEMPTS || host.is_empty();
        let key = vault_key(&item.account_id, item.generation);
        let mut done = CleanupDone::default();
        if item.unregister {
            match load_keys(ctx.vault, &key) {
                Some(keys) if !give_up => match unregister(ctx.server, host, token, &keys).await {
                    Ok(()) => done.unregister = true,
                    Err(e) => {
                        tracing::info!("[push] unregister failed: {e}");
                        done.failed = true;
                    }
                },
                _ => done.unregister = true,
            }
        }
        if let Some(nonce) = &item.tombstone {
            match token {
                Some(token) if !give_up => {
                    match ctx
                        .server
                        .registry_set(host, token, nonce, push_register::superseded_value())
                        .await
                    {
                        // 失効したトークンの領域は、次に走ったコードが取り消し済みにする
                        Ok(()) | Err(NoteDeckError::Api { status: 401, .. }) => {
                            done.tombstone = true;
                        }
                        Err(e) => {
                            tracing::info!("[push] tombstone failed: {e}");
                            done.failed = true;
                        }
                    }
                }
                _ => done.tombstone = true,
            }
        }
        if item.remove_instance && ctx.distributor.available() {
            ctx.distributor.unregister(&push_state::instance_name(
                &item.account_id,
                item.generation,
            ));
            done.remove_instance = true;
        }
        if !item.unregister || done.unregister {
            ctx.vault.delete(&key);
        }
        push_store_file::update(ctx.app_dir, |s| {
            s.cleanup_progress(&item.account_id, item.generation, done)
        });
    }
}

// ---- 起動時の突き合わせ ----

/// v1.94.0 のサーバー単位の登録を外す: 口座ごとの写しで本家の購読を解除し (ログアウト
/// 済みなら未認証)、全部通ってからサーバー単位の登録を外して、登録し直しが要るにする
async fn migrate<S: Server, D: Distributor, V: Vault>(
    ctx: &Ctx<'_, S, D, V>,
    accounts: &[PushAccount],
) {
    if push_store_file::load(ctx.app_dir).migrated_from_host_instances {
        return;
    }
    let mut complete = true;
    for account in accounts {
        let key = legacy_vault_key(&account.id);
        if ctx.vault.get(&key).is_none() {
            continue;
        }
        if let Some(keys) = load_keys(ctx.vault, &key) {
            if let Err(e) =
                unregister(ctx.server, &account.host, account.token.as_deref(), &keys).await
            {
                tracing::info!("[push] legacy unregister failed: {e}");
                complete = false;
                continue;
            }
        }
        ctx.vault.delete(&key);
        push_store_file::update(ctx.app_dir, |s| s.mark_migrated(&account.id, &account.host));
    }
    if !complete {
        return;
    }
    for instance in ctx.distributor.instances() {
        if push_state::parse_instance(&instance).is_none() {
            ctx.distributor.unregister(&instance);
        }
    }
    push_store_file::update(ctx.app_dir, |s| s.migrated_from_host_instances = true);
}

/// 起動時と巡回の突き合わせ。`check_server` ならサーバーの鍵と Web Push の停止も見る
pub(crate) async fn reconcile<S: Server, D: Distributor, V: Vault>(
    ctx: &Ctx<'_, S, D, V>,
    accounts: &[PushAccount],
    check_server: bool,
) {
    if !ctx.distributor.available() {
        return;
    }
    migrate(ctx, accounts).await;
    let instances: Vec<(String, u32)> = ctx
        .distributor
        .instances()
        .iter()
        .filter_map(|i| push_state::parse_instance(i))
        .collect();
    push_store_file::update(ctx.app_dir, |s| s.reconcile(&instances, ctx.now_ms));
    let all: Vec<&PushAccount> = accounts.iter().collect();
    refresh_endpoints(ctx, &all);
    if check_server {
        check_servers(ctx, accounts).await;
    }
    run_cleanup(ctx, accounts).await;
}

/// 有効な口座のサーバーで、鍵が変わっていないか・Web Push が止まっていないか
async fn check_servers<S: Server, D: Distributor, V: Vault>(
    ctx: &Ctx<'_, S, D, V>,
    accounts: &[PushAccount],
) {
    let store = push_store_file::load(ctx.app_dir);
    let active: Vec<&PushAccount> = accounts
        .iter()
        .filter(|a| {
            a.token.is_some()
                && store
                    .account(&a.id)
                    .is_some_and(|rec| rec.phase == Phase::Active)
        })
        .collect();
    let hosts: BTreeSet<&str> = active.iter().map(|a| a.host.as_str()).collect();
    for host in hosts {
        let Some(account) = active.iter().find(|a| a.host == host) else {
            continue;
        };
        let meta = match ctx
            .server
            .meta(host, account.token.as_deref().unwrap_or_default())
            .await
        {
            Ok(meta) => meta,
            Err(e) => {
                tracing::info!("[push] meta failed: {e}");
                continue;
            }
        };
        let vapid = push_register::server_vapid(&meta);
        push_store_file::update(ctx.app_dir, |s| {
            for a in active.iter().filter(|a| a.host == host) {
                s.server_checked(&a.id, vapid.as_deref());
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::*;

    const HOST: &str = "misskey.example";
    /// `=` を除いて 87 文字の base64url (connector が受け付ける VAPID 公開鍵の形)
    const VAPID: &str =
        "BAbcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_abcdefghijklmnopqrstuv=";

    #[derive(Default)]
    struct FakeServer {
        /// (トークン, key) → 値
        registry: RefCell<BTreeMap<(String, String), Value>>,
        unregistered: RefCell<Vec<(String, String)>>,
        tests_sent: Cell<u32>,
        meta: RefCell<Value>,
        /// sw/unregister を token ごとに失敗させる (status)
        unregister_status: RefCell<BTreeMap<String, u16>>,
        offline: Cell<bool>,
        write_status: Cell<Option<u16>>,
    }

    fn api_error(status: u16) -> NoteDeckError {
        NoteDeckError::Api {
            endpoint: "x".into(),
            status,
            api_code: None,
            message: "x".into(),
        }
    }

    fn network_error() -> NoteDeckError {
        NoteDeckError::InvalidInput("offline".into())
    }

    impl FakeServer {
        fn new() -> Self {
            let s = Self::default();
            *s.meta.borrow_mut() = json!({ "enableServiceWorker": true, "swPublickey": VAPID });
            s
        }

        fn entry(&self, token: &str, key: &str) -> Option<Value> {
            self.registry
                .borrow()
                .get(&(token.to_string(), key.to_string()))
                .cloned()
        }

        /// Scratchpad のコードが走ったことにする
        fn run_code(&self, token: &str, key: &str) {
            self.registry.borrow_mut().insert(
                (token.into(), key.into()),
                json!({ "v": 1, "state": "done", "key": VAPID, "userId": "u" }),
            );
        }
    }

    impl Server for FakeServer {
        async fn meta(&self, _: &str, _: &str) -> Result<Value, NoteDeckError> {
            if self.offline.get() {
                return Err(network_error());
            }
            Ok(self.meta.borrow().clone())
        }
        async fn registry_get(
            &self,
            _: &str,
            token: &str,
            key: &str,
        ) -> Result<Option<Value>, NoteDeckError> {
            if self.offline.get() {
                return Err(network_error());
            }
            Ok(self.entry(token, key))
        }
        async fn registry_set(
            &self,
            _: &str,
            token: &str,
            key: &str,
            value: Value,
        ) -> Result<(), NoteDeckError> {
            if self.offline.get() {
                return Err(network_error());
            }
            if let Some(status) = self.write_status.get() {
                return Err(api_error(status));
            }
            self.registry
                .borrow_mut()
                .insert((token.into(), key.into()), value);
            Ok(())
        }
        async fn sw_unregister(
            &self,
            _: &str,
            token: &str,
            keys: &PushKeys,
        ) -> Result<(), NoteDeckError> {
            if self.offline.get() {
                return Err(network_error());
            }
            if let Some(status) = self.unregister_status.borrow().get(token) {
                return Err(api_error(*status));
            }
            self.unregistered
                .borrow_mut()
                .push((token.into(), keys.endpoint.clone()));
            Ok(())
        }
        async fn test_notification(&self, _: &str, _: &str) -> Result<(), NoteDeckError> {
            self.tests_sent.set(self.tests_sent.get() + 1);
            Ok(())
        }
    }

    struct FakeDistributor {
        available: Cell<bool>,
        state: Cell<PushDistributorState>,
        /// instance → 添えた文
        registered: RefCell<BTreeMap<String, String>>,
        /// 発行する送り先の URL (instance ごとに末尾を変える)
        endpoint_base: RefCell<String>,
        failure: RefCell<Option<String>>,
        /// 送り先を差し替えたい instance
        replaced: RefCell<BTreeMap<String, Endpoint>>,
        /// 入っているアプリ (package, 使っているか)
        apps: RefCell<Vec<(String, bool)>>,
    }

    impl FakeDistributor {
        fn new() -> Self {
            Self {
                available: Cell::new(true),
                state: Cell::new(PushDistributorState::Ready),
                registered: RefCell::default(),
                endpoint_base: RefCell::new("https://ntfy.example/up".into()),
                failure: RefCell::default(),
                replaced: RefCell::default(),
                apps: RefCell::new(vec![("io.heckel.ntfy".into(), true)]),
            }
        }

        fn instances_sorted(&self) -> Vec<String> {
            self.registered.borrow().keys().cloned().collect()
        }
    }

    impl Distributor for FakeDistributor {
        fn available(&self) -> bool {
            self.available.get()
        }
        fn state(&self) -> PushDistributorState {
            self.state.get()
        }
        fn register(&self, instance: &str, _vapid: &str, message: &str) -> bool {
            if self.state.get() == PushDistributorState::None {
                return false;
            }
            self.registered
                .borrow_mut()
                .insert(instance.into(), message.into());
            true
        }
        fn endpoint(&self, instance: &str) -> Option<Endpoint> {
            if self.failure.borrow().is_some() || !self.registered.borrow().contains_key(instance) {
                return None;
            }
            if let Some(e) = self.replaced.borrow().get(instance) {
                return Some(e.clone());
            }
            Some(Endpoint {
                url: format!("{}/{instance}", self.endpoint_base.borrow()),
                pub_key: format!("pub-{instance}"),
                auth: format!("auth-{instance}"),
            })
        }
        fn failure(&self, _: &str) -> Option<String> {
            self.failure.borrow().clone()
        }
        fn unregister(&self, instance: &str) {
            self.registered.borrow_mut().remove(instance);
        }
        fn instances(&self) -> Vec<String> {
            self.instances_sorted()
        }
        fn installed(&self) -> Vec<PushDistributor> {
            self.apps
                .borrow()
                .iter()
                .map(|(package, active)| PushDistributor {
                    package: package.clone(),
                    label: package.clone(),
                    active: *active,
                })
                .collect()
        }
        fn choose(&self, package: &str) {
            for (p, active) in self.apps.borrow_mut().iter_mut() {
                *active = p == package;
            }
        }
    }

    #[derive(Default)]
    struct FakeVault(RefCell<BTreeMap<String, String>>);

    impl Vault for FakeVault {
        fn get(&self, key: &str) -> Option<String> {
            self.0.borrow().get(key).cloned()
        }
        fn set(&self, key: &str, value: &str) -> bool {
            self.0.borrow_mut().insert(key.into(), value.into());
            true
        }
        fn delete(&self, key: &str) {
            self.0.borrow_mut().remove(key);
        }
    }

    struct World {
        dir: tempfile::TempDir,
        server: FakeServer,
        distributor: FakeDistributor,
        vault: FakeVault,
        accounts: Vec<PushAccount>,
        now: Cell<u64>,
    }

    fn account(id: &str, username: &str, token: Option<&str>) -> PushAccount {
        PushAccount {
            id: id.into(),
            host: HOST.into(),
            user_id: format!("user-{id}"),
            username: username.into(),
            token: token.map(str::to_string),
        }
    }

    impl World {
        fn new() -> Self {
            Self {
                dir: tempfile::tempdir().unwrap(),
                server: FakeServer::new(),
                distributor: FakeDistributor::new(),
                vault: FakeVault::default(),
                accounts: vec![
                    account("a", "alice", Some("tokA")),
                    account("b", "bob", Some("tokB")),
                ],
                now: Cell::new(1_000_000),
            }
        }

        fn ctx(&self) -> Ctx<'_, FakeServer, FakeDistributor, FakeVault> {
            Ctx {
                app_dir: self.dir.path(),
                server: &self.server,
                distributor: &self.distributor,
                vault: &self.vault,
                now_ms: self.now.get(),
            }
        }

        fn store(&self) -> push_state::PushStore {
            push_store_file::load(self.dir.path())
        }

        fn phase(&self, id: &str) -> Phase {
            self.store()
                .account(id)
                .map(|a| a.phase)
                .unwrap_or_default()
        }

        fn nonce(&self, id: &str) -> String {
            self.store().account(id).unwrap().nonce.clone().unwrap()
        }

        async fn prepare(&self, redo: Option<&str>, seed: u8) -> Result<(), PushProblem> {
            prepare(&self.ctx(), HOST, &self.accounts, redo, [seed; 10]).await
        }

        async fn status(&self) -> PushHostStatus {
            host_status(&self.ctx(), HOST, &self.accounts, "ja-JP").await
        }

        /// 届いた push で確定したことにする
        fn confirm(&self, id: &str) {
            let generation = self.store().account(id).unwrap().generation;
            push_store_file::update(self.dir.path(), |s| {
                s.on_push(id, generation, None, self.now.get())
            });
        }
    }

    /// 同じサーバーの 2 口座をまとめて準備: 口座 + 世代で登録し、同じ合言葉で
    /// それぞれのトークンの領域に登録待ちを書き、コードに両方が入る
    #[tokio::test]
    async fn prepare_registers_each_account_and_writes_one_nonce() {
        let w = World::new();
        assert_eq!(w.prepare(None, 1).await, Ok(()));
        assert_eq!(w.distributor.instances(), vec!["a#1", "b#1"]);
        assert_eq!(
            w.distributor
                .registered
                .borrow()
                .get("a#1")
                .map(String::as_str),
            Some("@alice@misskey.example")
        );
        let nonce = w.nonce("a");
        assert_eq!(w.nonce("b"), nonce);
        let entry = w.server.entry("tokA", &nonce).unwrap();
        assert_eq!(entry["state"], "pending");
        assert_eq!(entry["endpoint"], "https://ntfy.example/up/a#1");
        assert!(w.server.entry("tokB", &nonce).is_some());
        assert!(w.vault.get("push-subscription:a:1").is_some());

        let status = w.status().await;
        let code = status.code.unwrap();
        assert!(code.contains(&nonce));
        assert!(code.contains("user-a") && code.contains("user-b"));
        assert!(status
            .accounts
            .iter()
            .all(|r| r.state == PushState::Pending && !r.awaiting));
    }

    /// 未実行の間はもう一度押しても何も書かず、同じコード (同じ合言葉) を渡す
    #[tokio::test]
    async fn preparing_again_while_unexecuted_keeps_the_same_code() {
        let w = World::new();
        w.prepare(None, 1).await.unwrap();
        let before = w.server.registry.borrow().len();
        let nonce = w.nonce("a");
        w.prepare(None, 2).await.unwrap();
        assert_eq!(w.nonce("a"), nonce);
        assert_eq!(w.server.registry.borrow().len(), before);
        assert_eq!(w.distributor.instances(), vec!["a#1", "b#1"]);
    }

    /// コードが走ると「到着待ち」になり、コードから外れる。3 分届かなければ 1 回だけ
    /// テスト通知を送り直す。届いたら有効
    #[tokio::test]
    async fn awaiting_is_seen_from_the_registry_and_the_test_is_resent_once() {
        let w = World::new();
        w.prepare(None, 1).await.unwrap();
        w.server.run_code("tokA", &w.nonce("a"));
        let status = w.status().await;
        let a = &status.accounts[0];
        assert!(a.awaiting && !a.resent);
        let code = status.code.unwrap();
        assert!(!code.contains("user-a") && code.contains("user-b"));

        w.now.set(w.now.get() + 3 * 60 * 1000);
        assert!(w.status().await.accounts[0].resent);
        w.now.set(w.now.get() + 3 * 60 * 1000);
        w.status().await;
        assert_eq!(w.server.tests_sent.get(), 1);

        w.confirm("a");
        assert_eq!(w.status().await.accounts[0].state, PushState::Active);
    }

    /// 新しく足した口座があれば合言葉を作り直し、未実行の口座も書き直して前の項目を
    /// 取り消し済みにする (コードは 1 つで両方を登録できる)
    #[tokio::test]
    async fn a_new_account_on_the_host_renews_the_nonce_for_everyone_unexecuted() {
        let mut w = World::new();
        w.accounts.truncate(1);
        w.prepare(None, 1).await.unwrap();
        let old = w.nonce("a");
        w.accounts.push(account("b", "bob", Some("tokB")));
        w.prepare(None, 2).await.unwrap();
        let new = w.nonce("a");
        assert_ne!(new, old);
        assert_eq!(w.nonce("b"), new);
        assert_eq!(w.server.entry("tokA", &old).unwrap()["state"], "superseded");
        assert_eq!(w.server.entry("tokA", &new).unwrap()["state"], "pending");
        assert_eq!(
            w.distributor.instances(),
            vec!["a#1", "b#1"],
            "a は作り直さない"
        );
    }

    /// オンにするのは押した口座だけ。同じサーバーのほかの口座は使っていないまま
    #[tokio::test]
    async fn only_the_pressed_account_is_turned_on() {
        let w = World::new();
        assert_eq!(w.prepare(Some("b"), 1).await, Ok(()));
        assert_eq!(w.distributor.instances(), vec!["b#1"]);
        assert_eq!(w.phase("a"), Phase::Off);
        assert_eq!(w.phase("b"), Phase::Pending);
        // あとから押した a も、未実行の b と同じ 1 つのコードに入る
        w.prepare(Some("a"), 2).await.unwrap();
        assert_eq!(w.nonce("a"), w.nonce("b"));
        let code = w.status().await.code.unwrap();
        assert!(code.contains("user-a") && code.contains("user-b"));
    }

    /// プッシュ通知アプリを切り替えると、使っている口座は登録し直しが要る。もう一度オンに
    /// すると、新しい世代がそろってから前の世代を本家で解除し、登録を外す
    #[tokio::test]
    async fn switching_apps_needs_reregistration_and_replaces_the_generation() {
        let w = World::new();
        w.prepare(None, 1).await.unwrap();
        w.server.run_code("tokA", &w.nonce("a"));
        w.confirm("a");
        let old = w.nonce("a");
        w.distributor
            .apps
            .borrow_mut()
            .push(("org.unifiedpush.distributor.sunup".into(), false));
        choose_distributor(&w.ctx(), "io.heckel.ntfy");
        assert_eq!(w.phase("a"), Phase::Active, "同じアプリを選んでも変えない");
        choose_distributor(&w.ctx(), "org.unifiedpush.distributor.sunup");
        assert_eq!(w.phase("a"), Phase::NeedsReregistration);
        assert_eq!(w.phase("b"), Phase::NeedsReregistration);
        assert!(w.store().cleanup.is_empty(), "前の世代はまだ外さない");
        assert_eq!(w.prepare(Some("a"), 2).await, Ok(()));
        assert_eq!(w.phase("a"), Phase::Pending);
        assert_eq!(w.distributor.instances(), vec!["a#2", "b#1"]);
        assert_eq!(
            w.server.unregistered.borrow().as_slice(),
            &[(
                "tokA".to_string(),
                "https://ntfy.example/up/a#1".to_string()
            )]
        );
        assert!(w.vault.get("push-subscription:a:1").is_none());
        assert!(w.vault.get("push-subscription:a:2").is_some());
        assert_eq!(w.server.entry("tokA", &old).unwrap()["state"], "superseded");
        assert!(w.store().cleanup.is_empty());
    }

    /// やめる: 本家で解除 (失効なら未認証で)・印を取り消し済みに・登録を外す
    #[tokio::test]
    async fn disable_cleans_up_and_falls_back_to_unauthenticated_unregister() {
        let w = World::new();
        w.prepare(None, 1).await.unwrap();
        w.confirm("a");
        let nonce = w.nonce("a");
        w.server
            .unregister_status
            .borrow_mut()
            .insert("tokA".into(), 401);
        disable(&w.ctx(), "a", &w.accounts).await;
        assert_eq!(w.phase("a"), Phase::Off);
        assert_eq!(
            w.server.unregistered.borrow().as_slice(),
            &[(String::new(), "https://ntfy.example/up/a#1".to_string())]
        );
        assert_eq!(
            w.server.entry("tokA", &nonce).unwrap()["state"],
            "superseded"
        );
        assert_eq!(w.distributor.instances(), vec!["b#1"]);
        assert!(w.vault.get("push-subscription:a:1").is_none());
        assert_eq!(
            w.phase("b"),
            Phase::Pending,
            "同じサーバーの別の口座は巻き込まない"
        );
    }

    /// 解除が通らなければ解除待ちで残り、三つ組も残す。次の後始末で片付く
    #[tokio::test]
    async fn failed_disable_is_retried_later() {
        let w = World::new();
        w.prepare(None, 1).await.unwrap();
        w.server.offline.set(true);
        disable(&w.ctx(), "a", &w.accounts).await;
        assert_eq!(w.phase("a"), Phase::Unregistering);
        assert!(w.vault.get("push-subscription:a:1").is_some());
        assert_eq!(w.store().cleanup[0].attempts, 1);
        w.server.offline.set(false);
        run_cleanup(&w.ctx(), &w.accounts).await;
        assert_eq!(w.phase("a"), Phase::Off);
        assert!(w.vault.get("push-subscription:a:1").is_none());
    }

    /// 事前判定と失敗の理由
    #[tokio::test]
    async fn prepare_reports_problems_before_sending_anyone_to_the_browser() {
        let w = World::new();
        *w.server.meta.borrow_mut() = json!({ "enableServiceWorker": false, "swPublickey": VAPID });
        assert_eq!(
            w.prepare(None, 1).await,
            Err(PushProblem::ServerUnsupported)
        );

        let w = World::new();
        w.distributor.state.set(PushDistributorState::None);
        assert_eq!(w.prepare(None, 1).await, Err(PushProblem::NoDistributor));

        let w = World::new();
        w.server.write_status.set(Some(403));
        assert_eq!(w.prepare(None, 1).await, Err(PushProblem::Relogin));

        let w = World::new();
        *w.distributor.endpoint_base.borrow_mut() = "http://lan.example/up".into();
        assert_eq!(w.prepare(None, 1).await, Err(PushProblem::EndpointUnusable));
        assert!(w.distributor.instances().is_empty(), "使えない登録は外す");
        assert_eq!(w.phase("a"), Phase::Off);

        let w = World::new();
        *w.distributor.failure.borrow_mut() = Some(FAILURE_NOT_CHOSEN.into());
        assert_eq!(
            w.prepare(None, 1).await,
            Err(PushProblem::ChooseDistributor)
        );

        let mut w = World::new();
        w.accounts = vec![account("g", "guest", None)];
        assert_eq!(w.prepare(None, 1).await, Err(PushProblem::Unavailable));
    }

    /// 再ログインでトークンが変わると自分の項目が見つからない。状態は「登録し直し」に
    /// 見せ、準備し直すと新しい合言葉で書き直す (世代はそのまま)
    #[tokio::test]
    async fn relogin_makes_the_entry_stale_and_prepare_rewrites_it() {
        let mut w = World::new();
        w.prepare(None, 1).await.unwrap();
        w.accounts[0].token = Some("tokA2".into());
        let status = w.status().await;
        assert_eq!(status.accounts[0].state, PushState::NeedsReregistration);
        w.prepare(None, 2).await.unwrap();
        let nonce = w.nonce("a");
        assert_eq!(w.server.entry("tokA2", &nonce).unwrap()["state"], "pending");
        assert_eq!(w.distributor.instances(), vec!["a#1", "b#1"]);
    }

    /// 起動時: 送り先が変わっていれば登録し直し、知らない登録は解除してから外す
    #[tokio::test]
    async fn reconcile_detects_endpoint_changes_and_cleans_unknown_instances() {
        let w = World::new();
        w.prepare(None, 1).await.unwrap();
        w.confirm("a");
        w.distributor.replaced.borrow_mut().insert(
            "a#1".into(),
            Endpoint {
                url: "https://ntfy.example/changed".into(),
                pub_key: "p".into(),
                auth: "x".into(),
            },
        );
        w.distributor
            .registered
            .borrow_mut()
            .insert("gone#3".into(), String::new());
        reconcile(&w.ctx(), &w.accounts, false).await;
        assert_eq!(w.phase("a"), Phase::NeedsReregistration);
        assert_eq!(needing_attention(w.dir.path(), &w.accounts), vec!["a"]);
        assert_eq!(w.distributor.instances(), vec!["a#1", "b#1"]);

        // Kotlin が使えないプロセスでは「送り先が無い」と区別できないので何もしない
        let w = World::new();
        w.prepare(None, 1).await.unwrap();
        w.confirm("a");
        w.distributor.available.set(false);
        reconcile(&w.ctx(), &w.accounts, false).await;
        assert_eq!(w.phase("a"), Phase::Active);
    }

    /// サーバーの鍵が変わったら登録し直し
    #[tokio::test]
    async fn server_key_change_needs_reregistration() {
        let w = World::new();
        w.prepare(None, 1).await.unwrap();
        w.server.run_code("tokA", &w.nonce("a"));
        w.status().await;
        w.confirm("a");
        reconcile(&w.ctx(), &w.accounts, true).await;
        assert_eq!(w.phase("a"), Phase::Active);
        *w.server.meta.borrow_mut() = json!({ "enableServiceWorker": false });
        reconcile(&w.ctx(), &w.accounts, true).await;
        assert_eq!(w.phase("a"), Phase::NeedsReregistration);
    }

    /// v1.94.0 からの移行: 口座ごとの写しで解除し (ログアウト済みは未認証)、全部通って
    /// からサーバー単位の登録を外す。通らなければ次の起動でやり直す
    #[tokio::test]
    async fn migration_unregisters_legacy_subscriptions_then_removes_host_instances() {
        let mut w = World::new();
        w.accounts[1].token = None;
        let legacy = |endpoint: &str| {
            json!({ "endpoint": endpoint, "auth": "a", "publickey": "p", "serverKey": "k" })
                .to_string()
        };
        w.vault
            .set("push-subscription:a", &legacy("https://ntfy.example/host"));
        w.vault
            .set("push-subscription:b", &legacy("https://ntfy.example/host"));
        w.distributor
            .registered
            .borrow_mut()
            .insert(HOST.into(), String::new());

        w.server.offline.set(true);
        reconcile(&w.ctx(), &w.accounts, false).await;
        assert_eq!(w.distributor.instances(), vec![HOST.to_string()]);
        assert!(!w.store().migrated_from_host_instances);

        w.server.offline.set(false);
        reconcile(&w.ctx(), &w.accounts, false).await;
        assert!(w.distributor.instances().is_empty());
        assert!(w.store().migrated_from_host_instances);
        assert!(w.vault.get("push-subscription:a").is_none());
        let tokens: Vec<String> = w
            .server
            .unregistered
            .borrow()
            .iter()
            .map(|(t, _)| t.clone())
            .collect();
        assert_eq!(tokens, vec!["tokA".to_string(), String::new()]);
        assert_eq!(w.phase("a"), Phase::NeedsReregistration);
        assert_eq!(
            needing_attention(w.dir.path(), &w.accounts),
            vec!["a"],
            "トークンの無い b は出さない"
        );
    }
}

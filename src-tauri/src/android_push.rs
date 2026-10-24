//! push (UnifiedPush) の Rust 側 (#330 §5)。Kotlin 側は PushBridge.kt /
//! NotedeckPushService.kt。
//!
//! 背面の通知の本体はワーカー (android_worker) で、push は口座ごとのオプトインで
//! 「ワーカーを速くする」だけ。描画・同一性 ((tag, id))・処理位置・可視カラムの抑止は
//! ストリーミング / ワーカーと共通。
//!
//! - 購読登録: 本家の `sw/register` はネイティブトークン限定なので、利用者に本家 Web の
//!   Scratchpad でコードを 1 回実行してもらい、応答を貼ってもらう (`notecore::push_register`)
//! - 受信: 配送アプリが復号できたものだけが Kotlin から来る。どの口座かは instance
//!   (= ホスト) と中身の `userId` の組で引く
//! - 登録の写し (三つ組 + サーバーの鍵) は keychain に口座ごとに置く (設定ディレクトリに
//!   置くと設定バックアップに秘密が混ざる、§4.3)。解除が通ったら消す
//!
//! JNI の入口は Activity の無いプロセスでも走るので、ワーカーと同じく `ndk_context` と
//! Tauri の runtime には触らない。release は `panic = "abort"` なので Result 一本で書く。

use std::path::{Path, PathBuf};

use jni::objects::{JClass, JObject, JString, JValue};
use jni::JNIEnv;
use notecli::models::Account;
use notecore::notify_plan::{self, notify_tag, NotifyKind};
use notecore::push_payload::{self, PushEvent};
use notecore::push_register::{self, PushKeys, VerifyError};
use serde::{Deserialize, Serialize};

/// 配送アプリがエンドポイントを返すまで待つ上限。複数の配送アプリから選ぶ OS の画面が
/// 出ることがあるので短くしない
const ENDPOINT_WAIT: std::time::Duration = std::time::Duration::from_secs(60);
const ENDPOINT_POLL: std::time::Duration = std::time::Duration::from_millis(500);

// ---- 受信 (Kotlin → Rust) ----

/// Kotlin の `PushBridge.onMessage(context, dataDir, instance, payload)` から呼ばれる入口
// nd-entry: local
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_notedeck_desktop_PushBridge_onMessage(
    mut env: JNIEnv,
    _class: JClass,
    context: JObject,
    data_dir: JString,
    instance: JString,
    payload: JString,
) {
    let read = |env: &mut JNIEnv, s: &JString| env.get_string(s).map(String::from);
    let (Ok(dir), Ok(host), Ok(payload)) = (
        read(&mut env, &data_dir),
        read(&mut env, &instance),
        read(&mut env, &payload),
    ) else {
        tracing::warn!("[push] unreadable arguments");
        return;
    };
    let app_dir = PathBuf::from(dir);
    crate::ui_lang::init_if_unset(&app_dir);
    crate::android_notify::register_bridge(&mut env);
    // 「トークンを持つ口座宛て」だけ扱うのでトークンの有無を見る (§5.4)
    if let Err(e) = notecli::keychain::init_store_with_android_context(&mut env, &context) {
        tracing::warn!("[push] keychain unavailable: {e}");
        return;
    }
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            tracing::warn!("[push] runtime: {e}");
            return;
        }
    };
    runtime.block_on(deliver(&app_dir, &host, &payload));
}

async fn deliver(app_dir: &Path, host: &str, payload: &str) {
    let Some(user_id) = push_payload::payload_user_id(payload) else {
        return;
    };
    let accounts = match notecli::db::Database::open_read_only(&app_dir.join("notecli.db"))
        .and_then(|db| db.load_accounts())
    {
        Ok(accounts) => accounts,
        Err(e) => {
            tracing::info!("[push] accounts unavailable: {e}");
            return;
        }
    };
    // (ホスト, ユーザー ID) の組で引く。届いた instance のホスト以外の口座には振り分けない
    let Some(account) = accounts
        .iter()
        .find(|a| a.host == host && a.user_id == user_id)
        .filter(|a| crate::android_worker::token_for(a).is_some())
    else {
        return;
    };
    let lang = crate::ui_lang::current();
    match push_payload::parse(payload, host, &account.id, now_ms()) {
        PushEvent::ReadAllNotifications => {
            // 前面でも消す (他端末で読んだ分も届く)
            crate::android_notify::cancel(&notify_tag(&account.id, NotifyKind::Notification));
        }
        PushEvent::Notification(n) => {
            // 前面でその口座の通知カラムが見えていればアプリ内の表示で足りる (§3.3)
            if crate::android_notify::is_foreground()
                && crate::os_notify::VisibleNotificationScopes::process().contains(&account.id)
            {
                return;
            }
            if !unhandled(app_dir, &account.id, NotifyKind::Notification, &n.id) {
                return;
            }
            if let Some(plan) = notify_plan::plan(&n, &lang) {
                let images = crate::android_worker::image_cache(app_dir);
                crate::android_worker::show(images.as_ref(), &plan).await;
            }
            crate::notify_cursor_file::advance(
                app_dir,
                &account.id,
                NotifyKind::Notification,
                &n.id,
            );
        }
        PushEvent::Chat(m) => {
            if m.from_user_id == account.user_id
                || !unhandled(app_dir, &account.id, NotifyKind::Message, &m.id)
            {
                return;
            }
            let plan = notify_plan::plan_chat(&m, host, &lang);
            let images = crate::android_worker::image_cache(app_dir);
            crate::android_worker::show(images.as_ref(), &plan).await;
            crate::notify_cursor_file::advance(app_dir, &account.id, NotifyKind::Message, &m.id);
        }
        PushEvent::Ignored => {}
    }
}

/// 処理位置より新しいか (ストリーミング / ワーカーがもう扱った分は出さない)
fn unhandled(app_dir: &Path, account_id: &str, kind: NotifyKind, id: &str) -> bool {
    !crate::notify_cursor_file::load(app_dir)
        .newer_than(account_id, kind, vec![id], |s| *s)
        .is_empty()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---- Kotlin (PushBridge) の呼び出し ----

/// 配送アプリの状態 (Kotlin の `distributorState`)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Distributor {
    /// 入っていない
    None,
    /// 使うものが決まっている (または 1 つだけ)
    Ready,
    /// 複数あって既定が無い (登録時に OS の選択画面が出る)
    Choose,
}

pub fn distributor() -> Distributor {
    let state = crate::android_notify::with_push_class("distributorState", |env, class| {
        let value = env
            .call_static_method(class, "distributorState", "()Ljava/lang/String;", &[])?
            .l()?;
        object_to_string(env, value)
    })
    .flatten();
    match state.as_deref() {
        Some("ready") => Distributor::Ready,
        Some("choose") => Distributor::Choose,
        _ => Distributor::None,
    }
}

/// Kotlin が保存したエンドポイントと鍵 (`PushBridge.endpoint`)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Endpoint {
    url: String,
    pub_key: String,
    auth: String,
}

impl Endpoint {
    fn keys(&self) -> PushKeys {
        PushKeys {
            endpoint: self.url.clone(),
            auth: self.auth.clone(),
            publickey: self.pub_key.clone(),
        }
    }
}

fn string_call(name: &'static str, instance: &str) -> Option<String> {
    crate::android_notify::with_push_class(name, |env, class| {
        let arg: JObject = env.new_string(instance)?.into();
        let value = env
            .call_static_method(
                class,
                name,
                "(Ljava/lang/String;)Ljava/lang/String;",
                &[JValue::Object(&arg)],
            )?
            .l()?;
        object_to_string(env, value)
    })
    .flatten()
}

fn endpoint(host: &str) -> Option<Endpoint> {
    serde_json::from_str(&string_call("endpoint", host)?).ok()
}

fn failure(host: &str) -> Option<String> {
    string_call("failure", host)
}

fn register(host: &str, vapid: &str) -> bool {
    crate::android_notify::with_push_class("register", |env, class| {
        let host: JObject = env.new_string(host)?.into();
        let vapid: JObject = env.new_string(vapid)?.into();
        env.call_static_method(
            class,
            "register",
            "(Ljava/lang/String;Ljava/lang/String;)Z",
            &[JValue::Object(&host), JValue::Object(&vapid)],
        )?
        .z()
    })
    .unwrap_or(false)
}

fn unregister(host: &str) {
    crate::android_notify::with_push_class("unregister", |env, class| {
        let host: JObject = env.new_string(host)?.into();
        env.call_static_method(
            class,
            "unregister",
            "(Ljava/lang/String;)V",
            &[JValue::Object(&host)],
        )?;
        Ok(())
    });
}

fn object_to_string(
    env: &mut JNIEnv,
    value: JObject,
) -> Result<Option<String>, jni::errors::Error> {
    if value.is_null() {
        return Ok(None);
    }
    let value = JString::from(value);
    let text: String = env.get_string(&value)?.into();
    Ok(Some(text))
}

// ---- 登録の写し (keychain) ----

/// 本家に登録した三つ組とサーバーの鍵。エンドポイントか鍵が変わったら登録し直しが要る
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Subscription {
    endpoint: String,
    auth: String,
    publickey: String,
    server_key: String,
}

impl Subscription {
    fn matches(&self, current: &Endpoint) -> bool {
        self.endpoint == current.url
            && self.auth == current.auth
            && self.publickey == current.pub_key
    }
}

/// keychain の鍵名。トークン (口座 ID) と同じ名前空間に置く (AI キーと同じやり方)
fn secret_id(account_id: &str) -> String {
    format!("push-subscription:{account_id}")
}

fn load_subscription(account_id: &str) -> Option<Subscription> {
    let text = notecli::keychain::get_token(&secret_id(account_id))
        .ok()
        .flatten()?;
    serde_json::from_str(&text).ok()
}

// ---- コマンドの本体 (commands/push.rs から呼ぶ) ----

/// 口座の push の状態
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    /// プッシュ通知アプリ (配送アプリ) が入っていない
    NoDistributor,
    /// 使っていない (ワーカーの定期確認だけ)
    Off,
    /// 使っている
    Active,
    /// エンドポイントか鍵が変わった / 配送アプリから外れた。本家での登録し直しが要る
    NeedsRegistration,
    /// 配送アプリ側で操作が要る (ACTION_REQUIRED)
    ActionRequired,
}

pub fn state(account: &Account) -> State {
    let Some(subscription) = load_subscription(&account.id) else {
        return match distributor() {
            Distributor::None => State::NoDistributor,
            _ => State::Off,
        };
    };
    if failure(&account.host).as_deref() == Some("ACTION_REQUIRED") {
        return State::ActionRequired;
    }
    match endpoint(&account.host) {
        Some(current) if subscription.matches(&current) => State::Active,
        _ => State::NeedsRegistration,
    }
}

/// 登録の準備で止まった理由
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrepareError {
    /// 配送アプリが入っていない / 登録を始められない
    NoDistributor,
    /// 配送アプリが登録に失敗した / 時間内に返事が無い
    DistributorFailed,
}

/// 配送アプリにホストを登録し、本家で実行してもらうコードを組む。
/// `vapid` はサーバーの VAPID 公開鍵 (meta の swPublickey)
pub async fn prepare(
    account: &Account,
    vapid: &str,
    lang: &str,
) -> Result<(String, String), PrepareError> {
    if distributor() == Distributor::None {
        return Err(PrepareError::NoDistributor);
    }
    if !register(&account.host, vapid) {
        return Err(PrepareError::NoDistributor);
    }
    let started = std::time::Instant::now();
    let current = loop {
        if let Some(current) = endpoint(&account.host) {
            break current;
        }
        if failure(&account.host).is_some() || started.elapsed() > ENDPOINT_WAIT {
            return Err(PrepareError::DistributorFailed);
        }
        tokio::time::sleep(ENDPOINT_POLL).await;
    };
    let code = push_register::register_code(&account.username, &current.keys(), lang);
    Ok((code, push_register::scratchpad_url(&account.host)))
}

/// 登録を受け入れられなかった理由
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompleteError {
    Verify(VerifyError),
    /// 端末のエンドポイントが無くなった (準備からやり直す)
    EndpointGone,
    /// 写しを保存できなかった
    Storage,
}

/// 貼り戻された応答を検証して写しを保存する
pub fn complete(account: &Account, response: &str) -> Result<(), CompleteError> {
    let current = endpoint(&account.host).ok_or(CompleteError::EndpointGone)?;
    let registered = push_register::verify_response(response, &account.user_id, &current.url)
        .map_err(CompleteError::Verify)?;
    let subscription = Subscription {
        endpoint: current.url,
        auth: current.auth,
        publickey: current.pub_key,
        server_key: registered.server_key,
    };
    let text = serde_json::to_string(&subscription).map_err(|_| CompleteError::Storage)?;
    notecli::keychain::store_token(&secret_id(&account.id), &text)
        .map_err(|_| CompleteError::Storage)
}

/// 本家の購読を解除し (失敗しても進める)、写しを消す。同じホストの口座が誰も使って
/// いなければ配送アプリからも外す。`others` は同じ端末のほかの口座。
/// 写しを消せなかったときだけ Err (消えていない写しは「使っている」と表示され続ける)
pub async fn disable(
    client: &notecli::api::MisskeyClient,
    account: &Account,
    token: &str,
    others: &[Account],
) -> Result<(), notecli::error::NoteDeckError> {
    // 登録していない口座は何もしない (同じホストで登録しかけている別口座の
    // エンドポイントを巻き込まない)
    let Some(subscription) = load_subscription(&account.id) else {
        return Ok(());
    };
    if let Err(e) = client
        .sw_unregister(
            &account.host,
            token,
            &subscription.endpoint,
            &subscription.auth,
            &subscription.publickey,
        )
        .await
    {
        tracing::warn!("[push] unregister failed: {e}");
    }
    let forgotten = notecli::keychain::delete_token(&secret_id(&account.id));
    let host_still_used = others.iter().any(|a| {
        a.id != account.id && a.host == account.host && load_subscription(&a.id).is_some()
    });
    if !host_still_used {
        unregister(&account.host);
    }
    forgotten
}

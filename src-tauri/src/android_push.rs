//! push (UnifiedPush) の Android 側の入口と実物 (#330)。Kotlin 側は PushBridge.kt /
//! NotedeckPushService.kt、手順の本体は `push_flow`、状態の遷移は `notecore::push_state`。
//!
//! 背面の通知の本体はワーカー (android_worker) で、push は口座ごとのオプトインで
//! 「ワーカーを速くする」だけ。描画・同一性 ((tag, id))・処理位置・可視カラムの抑止は
//! ストリーミング / ワーカーと共通。
//!
//! - 受信: プッシュ通知アプリが復号できたものだけが Kotlin から来る。instance は
//!   「口座 + 世代」で、中身の `userId` がその口座と一致するものだけ扱う。登録待ちの
//!   口座に届いたら、前面の抑止・処理位置・描画より前に「有効」を書く (確定)
//! - プッシュ通知アプリと keychain は `push_flow` の trait の実物としてここで実装する
//!
//! JNI の入口は Activity の無いプロセスでも走るので、ワーカーと同じく `ndk_context` と
//! Tauri の runtime には触らない。release は `panic = "abort"` なので Result 一本で書く。

use std::path::{Path, PathBuf};

use jni::objects::{JClass, JObject, JString, JValue};
use jni::JNIEnv;
use notecore::notify_plan::{self, notify_tag, NotifyKind};
use notecore::push_payload::{self, PushEvent};
use notecore::push_state::{self, Delivery};

use crate::commands::{PushDistributor, PushDistributorState};
use crate::push_flow::{Distributor, Endpoint, Vault};

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
    let (Ok(dir), Ok(instance), Ok(payload)) = (
        read(&mut env, &data_dir),
        read(&mut env, &instance),
        read(&mut env, &payload),
    ) else {
        tracing::warn!("[push] unreadable arguments");
        return;
    };
    // v1.94.0 のサーバー単位の登録宛ては、移行 (起動時の突き合わせ) で外すまで捨てる
    let Some((account_id, generation)) = push_state::parse_instance(&instance) else {
        return;
    };
    let app_dir = PathBuf::from(dir);
    crate::ui_lang::init_if_unset(&app_dir);
    crate::android_notify::register_bridge(&mut env);
    // 「トークンを持つ口座宛て」だけ扱うのでトークンの有無を見る
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
    runtime.block_on(deliver(&app_dir, &account_id, generation, &payload));
}

async fn deliver(app_dir: &Path, account_id: &str, generation: u32, payload: &str) {
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
    let Some(account) = accounts
        .iter()
        .find(|a| a.id == account_id && a.user_id == user_id)
        .filter(|a| crate::android_worker::token_for(a).is_some())
    else {
        return;
    };
    let now = crate::push_flow::now_ms();
    let event = push_payload::parse(payload, &account.host, &account.id, now);
    let test_id = match &event {
        PushEvent::Notification(n) if n.notification_type == "test" => Some(n.id.clone()),
        _ => None,
    };
    // 確定は種別を問わず、表示の判定より前に書く
    let delivery = crate::push_store_file::update(app_dir, |s| {
        s.on_push(&account.id, generation, test_id.as_deref(), now)
    });
    if delivery == Delivery::Drop {
        return;
    }
    let lang = crate::ui_lang::current();
    match event {
        PushEvent::ReadAllNotifications => {
            // 前面でも消す (他端末で読んだ分も届く)
            crate::android_notify::cancel(&notify_tag(&account.id, NotifyKind::Notification));
        }
        PushEvent::Notification(n) => {
            if delivery == Delivery::Confirmed && test_id.is_some() {
                // 確定に使ったテスト通知は専用の文言で出し、処理位置は進めない
                // (ストリーミングが先に出していても同じ (tag, id) で上書きする)
                if let Some(mut plan) = notify_plan::plan(&n, &lang) {
                    plan.title = notecore::i18n::render(
                        &lang,
                        "_native.push.confirmed",
                        &serde_json::json!({ "user": format!("@{}", account.username) }),
                    );
                    plan.body = None;
                    crate::android_worker::show(None, &plan).await;
                }
                return;
            }
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
            let plan = notify_plan::plan_chat(&m, &account.host, &lang);
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

// ---- Kotlin (PushBridge) の呼び出し ----

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

/// 引数なしで文字列を返す静的メソッド
fn call_string(name: &'static str) -> Option<String> {
    crate::android_notify::with_push_class(name, |env, class| {
        let value = env
            .call_static_method(class, name, "()Ljava/lang/String;", &[])?
            .l()?;
        object_to_string(env, value)
    })
    .flatten()
}

/// 文字列 1 つを受けて文字列を返す静的メソッド
fn call_string_arg(name: &'static str, arg: &str) -> Option<String> {
    crate::android_notify::with_push_class(name, |env, class| {
        let arg: JObject = env.new_string(arg)?.into();
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

/// 文字列 1 つを受けて何も返さない静的メソッド
fn call_void_arg(name: &'static str, arg: &str) {
    crate::android_notify::with_push_class(name, |env, class| {
        let arg: JObject = env.new_string(arg)?.into();
        env.call_static_method(
            class,
            name,
            "(Ljava/lang/String;)V",
            &[JValue::Object(&arg)],
        )?;
        Ok(())
    });
}

/// プッシュ通知アプリの実物 (Kotlin の PushBridge)
pub struct KotlinDistributor;

impl Distributor for KotlinDistributor {
    fn available(&self) -> bool {
        crate::android_notify::with_push_class("isReady", |env, class| {
            env.call_static_method(class, "isReady", "()Z", &[])?.z()
        })
        .unwrap_or(false)
    }

    fn state(&self) -> PushDistributorState {
        match call_string("distributorState").as_deref() {
            Some("ready") => PushDistributorState::Ready,
            Some("choose") => PushDistributorState::Choose,
            _ => PushDistributorState::None,
        }
    }

    fn register(&self, instance: &str, vapid: &str, message: &str) -> bool {
        crate::android_notify::with_push_class("register", |env, class| {
            let instance: JObject = env.new_string(instance)?.into();
            let vapid: JObject = env.new_string(vapid)?.into();
            let message: JObject = env.new_string(message)?.into();
            env.call_static_method(
                class,
                "register",
                "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Z",
                &[
                    JValue::Object(&instance),
                    JValue::Object(&vapid),
                    JValue::Object(&message),
                ],
            )?
            .z()
        })
        .unwrap_or(false)
    }

    fn endpoint(&self, instance: &str) -> Option<Endpoint> {
        serde_json::from_str(&call_string_arg("endpoint", instance)?).ok()
    }

    fn failure(&self, instance: &str) -> Option<String> {
        call_string_arg("failure", instance)
    }

    fn unregister(&self, instance: &str) {
        call_void_arg("unregister", instance);
    }

    fn instances(&self) -> Vec<String> {
        call_string("instances")
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default()
    }
}

/// 入っているプッシュ通知アプリ (OS の選択画面を出せなかったときの一覧)
pub fn distributors() -> Vec<PushDistributor> {
    #[derive(serde::Deserialize)]
    struct Item {
        package: String,
        label: String,
    }
    call_string("distributors")
        .and_then(|json| serde_json::from_str::<Vec<Item>>(&json).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|i| PushDistributor {
            package: i.package,
            label: i.label,
        })
        .collect()
}

pub fn save_distributor(package: &str) {
    call_void_arg("saveDistributor", package);
}

/// 三つ組の置き場の実物 (OS の keychain。トークンと同じ名前空間)
pub struct Keychain;

impl Vault for Keychain {
    fn get(&self, key: &str) -> Option<String> {
        notecli::keychain::get_token(key).ok().flatten()
    }

    fn set(&self, key: &str, value: &str) -> bool {
        notecli::keychain::store_token(key, value).is_ok()
    }

    fn delete(&self, key: &str) {
        if let Err(e) = notecli::keychain::delete_token(key) {
            tracing::info!("[push] keychain delete failed: {e}");
        }
    }
}

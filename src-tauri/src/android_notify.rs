//! Android の OS 通知の描画経路 (Activity 非依存、#330 §4.1)。
//!
//! 以前は Activity のインスタンスメソッドを `ndk_context` 経由で呼んでいた。
//! `ndk_context` は Activity の生成で初期化され破棄で解放されるので、戻るキーで
//! Activity を閉じてプロセスだけ残った状態で通知が届くと、解放済みの文脈を
//! 取りに行って abort していた。
//!
//! 今は起動時に Kotlin (NotificationBridge.register) が JavaVM と描画ヘルパー
//! (NotificationRenderer) のクラス参照を 1 回預け、以後はそれを使って静的メソッドを
//! 呼ぶ。通知の経路では誰も `ndk_context` に触らない。ワーカー (android_worker、
//! 段階 C) と push の経路 (段階 F) も同じ入口を使う。
//!
//! release は `panic = "abort"` なので、この境界の中は Result 一本で書く
//! (unwrap / expect / 添字アクセスを使わない)。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use jni::objects::{GlobalRef, JClass, JObject, JValue};
use jni::{JNIEnv, JavaVM};

struct Bridge {
    vm: JavaVM,
    renderer_class: GlobalRef,
}

static BRIDGE: OnceLock<Bridge> = OnceLock::new();

/// Activity が前面にあるか (onStart / onStop)。プロセスが死ねば消える静的な状態
static FOREGROUND: AtomicBool = AtomicBool::new(false);

/// 前面なら true。WebView の可視性は凍結中に古いまま残りうるので、前面で通知カラムが
/// 見えているときの抑止 (#330 §3.3) はこのフラグと組で判定する
pub fn is_foreground() -> bool {
    FOREGROUND.load(Ordering::Relaxed)
}

/// Kotlin の `NotificationBridge.setForeground(boolean)` から呼ばれる入口
// nd-entry: local
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_notedeck_desktop_NotificationBridge_setForeground(
    _env: JNIEnv,
    _class: JClass,
    foreground: jni::sys::jboolean,
) {
    FOREGROUND.store(foreground != 0, Ordering::Relaxed);
}

/// JNI シグネチャ: `NotificationRenderer.show(String tag, int id, String channelId, String title,
/// String body, String deepLink, String avatarPath, String imagePath)`
const SHOW_SIG: &str = "(Ljava/lang/String;ILjava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V";
/// `NotificationRenderer.cancel(String tag)` / `ensureChannels(String json)`
const STRING_ARG_SIG: &str = "(Ljava/lang/String;)V";

/// Kotlin の `NotificationBridge.register(context)` から呼ばれる入口。
/// JavaVM とクラス参照を預かるだけで、Context は使わない (ワーカーの keychain は
/// 自分の入口で受け取る)。冪等 (2 回目以降は何もしない)
// nd-entry: local
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_notedeck_desktop_NotificationBridge_register(
    mut env: JNIEnv,
    _class: JClass,
    _context: JObject,
) {
    register_bridge(&mut env);
}

/// 入口の登録 (JavaVM + 描画ヘルパーのクラス参照)。登録済みなら何もしない。
/// Activity の onCreate からと、Activity 無しのワーカー (android_worker) からの両方が
/// 呼ぶ: ワーカーだけのプロセスでは誰も register を通っていない
pub fn register_bridge(env: &mut JNIEnv) {
    if BRIDGE.get().is_some() {
        return;
    }
    let result = (|| -> Result<Bridge, jni::errors::Error> {
        let vm = env.get_java_vm()?;
        // Java のスレッドから呼ばれているので、アプリのクラスローダーで解決できる
        let class = env.find_class("com/notedeck/desktop/NotificationRenderer")?;
        let renderer_class = env.new_global_ref(class)?;
        Ok(Bridge { vm, renderer_class })
    })();
    match result {
        Ok(bridge) => {
            let _ = BRIDGE.set(bridge);
            // 通知チャネルは入口が揃ってから作る (Tauri の setup はこの登録より先に走る)
            ensure_channels(&crate::streaming::android_channels());
        }
        Err(e) => {
            if env.exception_check().unwrap_or(false) {
                let _ = env.exception_describe();
                let _ = env.exception_clear();
            }
            tracing::warn!("[notification] bridge register failed: {e}");
        }
    }
}

/// 預かった参照でヘルパーの静的メソッドを呼ぶ共通部。入口 (register) 前は何もしない
fn call_static(
    name: &str,
    sig: &str,
    build: impl for<'a> FnOnce(&mut JNIEnv<'a>) -> Result<Vec<JObject<'a>>, jni::errors::Error>,
    int_arg: Option<i32>,
) {
    let Some(bridge) = BRIDGE.get() else {
        tracing::warn!("[notification] bridge not registered: {name} dropped");
        return;
    };
    let mut env = match bridge.vm.attach_current_thread() {
        Ok(env) => env,
        Err(e) => {
            tracing::warn!("[notification] attach_current_thread failed: {e}");
            return;
        }
    };
    let result = (|| -> Result<(), jni::errors::Error> {
        let objs = build(&mut env)?;
        let mut args: Vec<JValue> = Vec::with_capacity(objs.len() + 1);
        // show は (tag, id, ...) の順で、id だけ int。他は String だけ
        for (idx, o) in objs.iter().enumerate() {
            args.push(JValue::Object(o));
            if idx == 0 {
                if let Some(id) = int_arg {
                    args.push(JValue::Int(id));
                }
            }
        }
        env.call_static_method(&bridge.renderer_class, name, sig, &args)?;
        Ok(())
    })();
    if let Err(e) = result {
        // Err を warn するだけで済ませると JVM 側の pending exception が残り、
        // 同一スレッドの次の JNI 呼び出しで ART が abort する。必ずクリアする
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_describe();
            let _ = env.exception_clear();
        }
        tracing::warn!("[notification] JNI call {name} failed: {e}");
    }
}

// Option<&str> → Java の String / null
fn jstr<'a>(env: &mut JNIEnv<'a>, s: Option<&str>) -> Result<JObject<'a>, jni::errors::Error> {
    match s {
        Some(s) => Ok(env.new_string(s)?.into()),
        None => Ok(JObject::null()),
    }
}

/// 通知を描く。`avatar_path` / `image_path` は ImageCache のローカルファイル。
/// (tag, id) は notecore の notify_plan が決める
#[allow(clippy::too_many_arguments)]
pub fn show(
    tag: &str,
    id: i32,
    channel_id: &str,
    title: &str,
    body: Option<&str>,
    deep_link: Option<&str>,
    avatar_path: Option<&str>,
    image_path: Option<&str>,
) {
    call_static(
        "show",
        SHOW_SIG,
        |env| {
            Ok(vec![
                jstr(env, Some(tag))?,
                jstr(env, Some(channel_id))?,
                jstr(env, Some(title))?,
                jstr(env, body)?,
                jstr(env, deep_link)?,
                jstr(env, avatar_path)?,
                jstr(env, image_path)?,
            ])
        },
        Some(id),
    );
}

/// 通知が OS で許可されているか。入口の登録前は None
pub fn notifications_enabled() -> Option<bool> {
    let bridge = BRIDGE.get()?;
    let mut env = bridge.vm.attach_current_thread().ok()?;
    let result = env
        .call_static_method(&bridge.renderer_class, "notificationsEnabled", "()Z", &[])
        .and_then(|v| v.z());
    match result {
        Ok(enabled) => Some(enabled),
        Err(e) => {
            if env.exception_check().unwrap_or(false) {
                let _ = env.exception_describe();
                let _ = env.exception_clear();
            }
            tracing::warn!("[notification] notificationsEnabled failed: {e}");
            None
        }
    }
}

/// OS のこのアプリの通知設定を開く
pub fn open_settings() {
    call_static("openSettings", "()V", |_env| Ok(vec![]), None);
}

/// tag の通知を全部消す (既読になった口座の分)
pub fn cancel(tag: &str) {
    call_static(
        "cancel",
        STRING_ARG_SIG,
        |env| Ok(vec![jstr(env, Some(tag))?]),
        None,
    );
}

/// 通知チャネルを種別群で作る / 表示言語で名前を付け直す。`channels` は
/// (id, name, important)。以前の 1 本だけのチャネルは Kotlin 側が消す
pub fn ensure_channels(channels: &[(String, String, bool)]) {
    // 入口の登録前 (Tauri の setup 中の表示言語の決定) は、登録時に作るので黙って戻る
    if BRIDGE.get().is_none() {
        return;
    }
    let json = serde_json::Value::Array(
        channels
            .iter()
            .map(|(id, name, important)| {
                serde_json::json!({ "id": id, "name": name, "important": important })
            })
            .collect(),
    )
    .to_string();
    call_static(
        "ensureChannels",
        STRING_ARG_SIG,
        |env| Ok(vec![jstr(env, Some(&json))?]),
        None,
    );
}

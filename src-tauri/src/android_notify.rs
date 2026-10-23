//! Android の OS 通知の描画経路 (Activity 非依存、#330 §4.1)。
//!
//! 以前は Activity のインスタンスメソッドを `ndk_context` 経由で呼んでいた。
//! `ndk_context` は Activity の生成で初期化され破棄で解放されるので、戻るキーで
//! Activity を閉じてプロセスだけ残った状態で通知が届くと、解放済みの文脈を
//! 取りに行って abort していた。
//!
//! 今は起動時に Kotlin (NotificationBridge.register) が JavaVM と描画ヘルパー
//! (NotificationRenderer) のクラス参照を 1 回預け、以後はそれを使って静的メソッドを
//! 呼ぶ。通知の経路では誰も `ndk_context` に触らない。ワーカー / push の経路
//! (段階 C / F) も同じ入口を使う。
//!
//! release は `panic = "abort"` なので、この境界の中は Result 一本で書く
//! (unwrap / expect / 添字アクセスを使わない)。

use std::sync::OnceLock;

use jni::objects::{GlobalRef, JClass, JObject, JValue};
use jni::{JNIEnv, JavaVM};

struct Bridge {
    vm: JavaVM,
    renderer_class: GlobalRef,
}

static BRIDGE: OnceLock<Bridge> = OnceLock::new();

/// JNI シグネチャ: `NotificationRenderer.show(int, String, String, String, String, String)`
const SHOW_SIG: &str =
    "(ILjava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V";

/// Kotlin の `NotificationBridge.register(context)` から呼ばれる入口。
/// JavaVM とクラス参照を預かるだけで、Context は今は使わない (ワーカーの keychain
/// 用に将来渡す)。冪等 (2 回目以降は何もしない)
// nd-entry: local
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_notedeck_desktop_NotificationBridge_register(
    mut env: JNIEnv,
    _class: JClass,
    _context: JObject,
) {
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

/// 通知を描く。`avatar_path` / `image_path` は ImageCache のローカルファイル。
/// 入口 (register) 前に呼ばれたら何もしない
pub fn show(
    id: i32,
    title: &str,
    body: Option<&str>,
    deep_link: Option<&str>,
    avatar_path: Option<&str>,
    image_path: Option<&str>,
) {
    let Some(bridge) = BRIDGE.get() else {
        tracing::warn!("[notification] bridge not registered: dropped");
        return;
    };
    let mut env = match bridge.vm.attach_current_thread() {
        Ok(env) => env,
        Err(e) => {
            tracing::warn!("[notification] attach_current_thread failed: {e}");
            return;
        }
    };

    // Option<&str> → Java の String / null
    fn jstr<'a>(env: &mut JNIEnv<'a>, s: Option<&str>) -> Result<JObject<'a>, jni::errors::Error> {
        match s {
            Some(s) => Ok(env.new_string(s)?.into()),
            None => Ok(JObject::null()),
        }
    }

    let result = (|| -> Result<(), jni::errors::Error> {
        let j_title = jstr(&mut env, Some(title))?;
        let j_body = jstr(&mut env, body)?;
        let j_link = jstr(&mut env, deep_link)?;
        let j_avatar = jstr(&mut env, avatar_path)?;
        let j_image = jstr(&mut env, image_path)?;
        env.call_static_method(
            &bridge.renderer_class,
            "show",
            SHOW_SIG,
            &[
                JValue::Int(id),
                JValue::Object(&j_title),
                JValue::Object(&j_body),
                JValue::Object(&j_link),
                JValue::Object(&j_avatar),
                JValue::Object(&j_image),
            ],
        )?;
        Ok(())
    })();
    if let Err(e) = result {
        // Err を warn するだけで済ませると JVM 側の pending exception が残り、
        // 同一スレッドの次の JNI 呼び出しで ART が abort する。必ずクリアする
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_describe();
            let _ = env.exception_clear();
        }
        tracing::warn!("[notification] JNI call failed: {e}");
    }
}

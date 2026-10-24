//! Android の通知ワーカーの本体 (#330 段階 C)。
//!
//! WorkManager が 15 分おきに Kotlin の `NotificationWorker` を起こし、それが
//! `NotificationBridge.runWorker` でここに入る。Kotlin 側は薄く (ライブラリの読込、
//! 描画ヘルパーの初期化、OS の通知許可の確認、戻り値で retry) 、口座の読取 /
//! トークン / Misskey への問い合わせ / 文言 / 描画の呼出は全部 Rust が持つ。以前の
//! Kotlin 実装は口座一覧の写し (`poll_accounts.json`) と keyring の内部形式の復号を
//! 自前で持ち、通知も種別を持たない要約 1 件だったが、ストリーミングと同じ
//! `notify_plan` を通すので文言 / チャネル / タップ先 / (tag, id) が揃う。
//!
//! Activity が無いプロセスで走ることがあるので、`ndk_context` には触らない:
//! 描画は `android_notify` の入口 (Kotlin が預けた JavaVM + クラス参照)、keychain は
//! Kotlin から渡された application Context で開く。release は `panic = "abort"`
//! なのでこの中は Result 一本で書く (unwrap / expect / 添字アクセスを使わない)。
//!
//! 流れ (口座ごと): `i` で未読数と未読メッセージの有無 → 未読があれば処理位置
//! (`notify_cursor_file`) より新しい通知を取って 1 件ずつ描く → 位置を進める。
//! 位置が無い初めての巡回は新しい 1 件だけ描く (`notify_cursor::FIRST_RUN_NOTIFY`)。
//! 未読 0 なら出ている通知を tag ごと消す (他端末で読んだ分)。画像 (アバター /
//! 絵文字) は本文を先に出してから取り、取れたら同じ (tag, id) で描き直す (#330 §4.1)。
//!
//! runtime / HTTP クライアント / 画像キャッシュはこの巡回の中で作って捨てる。Tauri の
//! runtime (`tauri::async_runtime`) には触らない: 未初期化のまま触ると既定の runtime が
//! 立ち、後から Activity が起動したときの `async_runtime::set` が panic (= abort) する。
//! reqwest のクライアントは作った runtime に縛られるので、アプリ側のものも借りない。
//! 画像キャッシュはアプリと同じディスク領域を指す (同じ URL を同時に取ったときだけ
//! 同じ中身を 2 回書く)。

use std::path::{Path, PathBuf};

use jni::objects::{JClass, JObject, JString};
use jni::sys::jint;
use jni::JNIEnv;
use notecli::api::MisskeyClient;
use notecli::error::NoteDeckError;
use notecli::models::{Account, ChatMessage, TimelineOptions};
use notecore::image_cache::ImageCache;
use notecore::notify_plan::{self, notify_tag, NotifyKind, NotifyPlan};

/// Kotlin への戻り値。`Result.success()`
const RESULT_SUCCESS: jint = 0;
/// `Result.retry()` (全口座がネットワークの失敗)
const RESULT_RETRY: jint = 1;

/// 1 回の巡回で口座ごとに取る通知の上限 (本家 `i/notifications` の最大)
const MAX_NOTIFICATIONS: u64 = 100;
/// メッセージ履歴 (相手ごと / ルームごとの最新 1 件) の取得数
const CHAT_HISTORY_LIMIT: i64 = 30;
/// 画像の取得の上限 (アプリの共有クライアントと同じ)
const IMAGE_FETCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Kotlin の `NotificationBridge.runWorker(context, dataDir)` から呼ばれる入口。
/// `data_dir` は Tauri の `app_data_dir()` と同じ場所 (`Context.getDataDir()`)
// nd-entry: local
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_notedeck_desktop_NotificationBridge_runWorker(
    mut env: JNIEnv,
    _class: JClass,
    context: JObject,
    data_dir: JString,
) -> jint {
    // 前面ならアプリのストリーミングが配っている (見ている通知カラムの抑止もそちら)
    if crate::android_notify::is_foreground() {
        return RESULT_SUCCESS;
    }
    let app_dir: PathBuf = match env.get_string(&data_dir) {
        Ok(s) => PathBuf::from(String::from(s)),
        Err(e) => {
            tracing::warn!("[worker] data dir unreadable: {e}");
            return RESULT_SUCCESS;
        }
    };
    // 表示言語 → 入口 (初回登録時にチャネルを作るので言語が先)
    crate::ui_lang::init_if_unset(&app_dir);
    crate::android_notify::register_bridge(&mut env);
    if let Err(e) = notecli::keychain::init_store_with_android_context(&mut env, &context) {
        tracing::warn!("[worker] keychain unavailable: {e}");
        return RESULT_SUCCESS;
    }
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            tracing::warn!("[worker] runtime: {e}");
            return RESULT_SUCCESS;
        }
    };
    runtime.block_on(run(&app_dir))
}

async fn run(app_dir: &Path) -> jint {
    let accounts = match notecli::db::Database::open_read_only(&app_dir.join("notecli.db"))
        .and_then(|db| db.load_accounts())
    {
        Ok(accounts) => accounts,
        Err(e) => {
            // DB がまだ無い (口座を足していない) のは正常
            tracing::info!("[worker] accounts unavailable: {e}");
            return RESULT_SUCCESS;
        }
    };
    let client = match MisskeyClient::new() {
        Ok(client) => client,
        Err(e) => {
            tracing::warn!("[worker] http client: {e}");
            return RESULT_SUCCESS;
        }
    };
    let lang = crate::ui_lang::current();
    // 作れなければ画像なしで描く
    let images = image_cache(app_dir);
    let mut attempted = 0;
    let mut network_failures = 0;
    for account in &accounts {
        // ゲスト口座 (トークン無し) は通知を持たない
        let Some(token) = token_for(account) else {
            continue;
        };
        attempted += 1;
        match poll_account(&client, images.as_ref(), account, &token, &lang, app_dir).await {
            Ok(()) => {}
            Err(NoteDeckError::Network(e)) => {
                network_failures += 1;
                tracing::warn!(host = %account.host, "[worker] network: {e}");
            }
            Err(e) => tracing::warn!(host = %account.host, "[worker] poll failed: {e}"),
        }
    }
    // 全口座がネットワークで落ちたときだけ WorkManager に再試行を頼む (圏外など)
    if attempted > 0 && network_failures == attempted {
        RESULT_RETRY
    } else {
        RESULT_SUCCESS
    }
}

/// 口座のトークン。keychain 優先、無ければ DB の列 (keychain が永続しない環境の
/// フォールバック)。どちらも空ならゲスト
fn token_for(account: &Account) -> Option<String> {
    let from_keychain = notecli::keychain::get_token(&account.id)
        .ok()
        .flatten()
        .filter(|t| !t.is_empty());
    from_keychain.or_else(|| (!account.token.is_empty()).then(|| account.token.clone()))
}

async fn poll_account(
    client: &MisskeyClient,
    images: Option<&ImageCache>,
    account: &Account,
    token: &str,
    lang: &str,
    app_dir: &Path,
) -> Result<(), NoteDeckError> {
    let me = client.get_self(&account.host, token).await?;
    let unread = me
        .get("unreadNotificationsCount")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let has_unread_chat = me
        .get("hasUnreadChatMessages")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);

    if unread == 0 {
        crate::android_notify::cancel(&notify_tag(&account.id, NotifyKind::Notification));
    } else {
        let cursor = crate::notify_cursor_file::load(app_dir);
        // 新しい方から未読数ぶんを取り、処理位置で絞る。本家の既読は位置 1 本なので、
        // 未読は常に新しい方の n 件。sinceId に処理位置を渡してはいけない: 本家は
        // sinceId だけのとき古い順で返すので、位置が古いと既読の分を取って新しい未読を
        // 取りこぼす。markAsRead は必ず false: 既読は「通知カラムを見たとき」だけ (#330 §3.2)
        let options = TimelineOptions::new(unread.min(MAX_NOTIFICATIONS) as i64, None, None);
        let fetched = client
            .get_notifications(&account.host, token, &account.id, options, false)
            .await?;
        let fresh = cursor.newer_than(&account.id, NotifyKind::Notification, fetched, |n| &n.id);
        // 初めての巡回は新しい 1 件だけ知らせ、残りは位置だけ進める (notify_cursor)
        let silent = cursor.silent_prefix(&account.id, NotifyKind::Notification, fresh.len());
        for n in fresh.iter().skip(silent) {
            if let Some(plan) = notify_plan::plan(n, lang) {
                show(images, &plan).await;
            }
        }
        // 位置は最後にまとめて進める。途中で落ちても、次の巡回で出し直す分は (tag, id) が
        // 同じなので上書きになるだけで 2 件にならない
        if let Some(newest) = fresh.last() {
            crate::notify_cursor_file::advance(
                app_dir,
                &account.id,
                NotifyKind::Notification,
                &newest.id,
            );
        }
    }

    if !has_unread_chat {
        crate::android_notify::cancel(&notify_tag(&account.id, NotifyKind::Message));
        return Ok(());
    }
    // 相手ごと / ルームごとの最新 1 件。未読で他人からのものだけが対象
    let mut messages = client
        .get_chat_history(&account.host, token, CHAT_HISTORY_LIMIT, false)
        .await?;
    messages.extend(
        client
            .get_chat_history(&account.host, token, CHAT_HISTORY_LIMIT, true)
            .await?,
    );
    ChatMessage::fill_account_id(&mut messages, &account.id);
    let unread_messages: Vec<ChatMessage> = messages
        .into_iter()
        .filter(|m| m.is_read == Some(false) && m.from_user_id != account.user_id)
        .collect();
    let cursor = crate::notify_cursor_file::load(app_dir);
    let fresh = cursor.newer_than(&account.id, NotifyKind::Message, unread_messages, |m| &m.id);
    let silent = cursor.silent_prefix(&account.id, NotifyKind::Message, fresh.len());
    for m in fresh.iter().skip(silent) {
        show(images, &notify_plan::plan_chat(m, &account.host, lang)).await;
    }
    if let Some(newest) = fresh.last() {
        crate::notify_cursor_file::advance(app_dir, &account.id, NotifyKind::Message, &newest.id);
    }
    Ok(())
}

/// この巡回で使う画像キャッシュ (アプリと同じディスク領域)。クライアントを作れなければ None
fn image_cache(app_dir: &Path) -> Option<ImageCache> {
    let http = reqwest::Client::builder()
        .timeout(IMAGE_FETCH_TIMEOUT)
        .build()
        .ok()?;
    let perf = std::sync::Arc::new(tokio::sync::RwLock::new(
        notecore::perf_config::PerformanceConfig::default(),
    ));
    Some(ImageCache::with_client(app_dir, http, perf))
}

/// 本文を先に描き、画像 (アバター / リアクションの絵文字) が取れたら同じ (tag, id) で
/// 描き直す。描き直しは OS が音を鳴らし直さない (NotificationRenderer の onlyAlertOnce)
async fn show(images: Option<&ImageCache>, plan: &NotifyPlan) {
    draw(plan, None, None);
    let Some(cache) = images else {
        return;
    };
    let icon = match plan.icon_url.as_deref() {
        Some(url) => {
            notecore::notify_media::ensure_local_file(
                cache,
                url,
                Some(crate::android_notify::AVATAR_MAX_WIDTH),
            )
            .await
        }
        None => None,
    };
    // 絵文字はアニメーション保持のため変換なし (原本)。decode の上限は Kotlin 側
    let image = match plan.image_url.as_deref() {
        Some(url) => notecore::notify_media::ensure_local_file(cache, url, None).await,
        None => None,
    };
    if icon.is_some() || image.is_some() {
        draw(
            plan,
            icon.as_deref().and_then(|p| p.to_str()),
            image.as_deref().and_then(|p| p.to_str()),
        );
    }
}

fn draw(plan: &NotifyPlan, avatar_path: Option<&str>, image_path: Option<&str>) {
    crate::android_notify::show(
        &plan.tag,
        plan.id,
        plan.channel.id(),
        &plan.title,
        plan.body.as_deref(),
        plan.deep_link.as_deref(),
        avatar_path,
        image_path,
    );
}

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
//! 絵文字) は起動中と同じく揃ってから 1 回で描く (#1195。以前は本文を先に出して描き直して
//! いた)。待つのは 1 回の巡回の合計で `image_deadline::WORKER_TOTAL` まで、超えたら手元の
//! 画像だけで描く。取得は締切後も続き、巡回はそれがキャッシュに書き終わるのを待って終える。
//!
//! runtime / HTTP クライアント / 画像キャッシュは巡回と push で共有する 1 組 (`background`)
//! で、入口ごとに作り直さない (作り直すと締切後の取得も失敗の記憶も入口と一緒に消える)。
//! Tauri の runtime (`tauri::async_runtime`) には触らない: 未初期化のまま触ると既定の
//! runtime が立ち、後から Activity が起動したときの `async_runtime::set` が panic (= abort)
//! する。reqwest のクライアントは作った runtime に縛られるので、アプリ側のものも借りない。
//! 画像キャッシュはアプリと同じディスク領域を指す (同じ URL を同時に取ったときだけ
//! 同じ中身を 2 回書く) が、メモリ層は持たない (背景プロセスの常駐メモリを増やさない)。

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use jni::objects::{JClass, JObject, JString};
use jni::sys::jint;
use jni::JNIEnv;
use notecli::api::MisskeyClient;
use notecli::error::NoteDeckError;
use notecli::models::{Account, ChatMessage, NormalizedNotification, TimelineOptions};
use notecore::image_cache::ImageCache;
use notecore::notify_media::{self, ImageJob};
use notecore::notify_plan::{self, notify_tag, NotifyKind, NotifyPlan};

use crate::android_notify::image_deadline;

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
    let Some(background) = background(&app_dir) else {
        return RESULT_SUCCESS;
    };
    background.runtime.block_on(run(&app_dir, background))
}

/// 巡回と push が共有する非同期の土台 (#1195)。プロセスに 1 組
pub(crate) struct Background {
    pub(crate) runtime: tokio::runtime::Runtime,
    /// 作れなければ None (画像なしで描く)
    pub(crate) images: Option<Arc<ImageCache>>,
}

static BACKGROUND: OnceLock<Option<Background>> = OnceLock::new();

/// 初回の入口で作り、以後は同じものを返す。runtime を作れなければ None
pub(crate) fn background(app_dir: &Path) -> Option<&'static Background> {
    BACKGROUND
        .get_or_init(|| {
            // push の配送は複数のスレッドから同時に来るので、どのスレッドからも
            // block_on できる multi-thread にする。仕事は軽いので worker は 1 本
            let runtime = match tokio::runtime::Builder::new_multi_thread()
                .worker_threads(1)
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    tracing::warn!("[worker] runtime: {e}");
                    return None;
                }
            };
            // クライアントは使う runtime の中で作る (作った runtime に縛られる)
            let images = runtime.block_on(async { image_cache(app_dir).map(Arc::new) });
            Some(Background { runtime, images })
        })
        .as_ref()
}

async fn run(app_dir: &Path, background: &Background) -> jint {
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
    // push (#330) の後始末と突き合わせ。前面に出ていない間の解除の再試行もここで進む
    let push_accounts: Vec<crate::push_flow::PushAccount> = accounts
        .iter()
        .map(crate::push_flow::PushAccount::from_account)
        .collect();
    let push_ctx = crate::push_flow::Ctx {
        app_dir,
        server: &client,
        distributor: &crate::android_push::KotlinDistributor,
        vault: &crate::android_push::Keychain,
        now_ms: crate::push_flow::now_ms(),
    };
    crate::push_flow::reconcile(&push_ctx, &push_accounts, false).await;
    let images = background.images.as_ref();
    // 画像を待つのは巡回の合計で締切まで。仕掛かりの取得は巡回を終える前に待つ
    let deadline = tokio::time::Instant::now() + image_deadline::WORKER_TOTAL;
    let mut pending: Vec<ImageJob> = Vec::new();
    let mut attempted = 0;
    let mut network_failures = 0;
    for account in &accounts {
        // ゲスト口座 (トークン無し) は通知を持たない
        let Some(token) = token_for(account) else {
            continue;
        };
        attempted += 1;
        match poll_account(
            &client,
            images,
            account,
            &token,
            &lang,
            app_dir,
            deadline,
            &mut pending,
        )
        .await
        {
            Ok(()) => {}
            Err(NoteDeckError::Network(e)) => {
                network_failures += 1;
                tracing::warn!(host = %account.host, "[worker] network: {e}");
            }
            Err(e) => tracing::warn!(host = %account.host, "[worker] poll failed: {e}"),
        }
    }
    // 全口座がネットワークで落ちたときだけ WorkManager に再試行を頼む (圏外など)
    // 締切に間に合わなかった画像もキャッシュに入れてから終える (次の巡回で待たない)
    for job in &mut pending {
        job.finish().await;
    }
    if attempted > 0 && network_failures == attempted {
        RESULT_RETRY
    } else {
        RESULT_SUCCESS
    }
}

/// 口座のトークン。keychain 優先、無ければ DB の列 (keychain が永続しない環境の
/// フォールバック)。どちらも空ならゲスト
pub(crate) fn token_for(account: &Account) -> Option<String> {
    let from_keychain = notecli::keychain::get_token(&account.id)
        .ok()
        .flatten()
        .filter(|t| !t.is_empty());
    from_keychain.or_else(|| (!account.token.is_empty()).then(|| account.token.clone()))
}

#[allow(clippy::too_many_arguments)]
async fn poll_account(
    client: &MisskeyClient,
    images: Option<&Arc<ImageCache>>,
    account: &Account,
    token: &str,
    lang: &str,
    app_dir: &Path,
    deadline: tokio::time::Instant,
    pending: &mut Vec<ImageJob>,
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
        observe_push(app_dir, &account.id, &[]);
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
        // push が有効なのに push で来ていない未読があれば数える (続いたら登録し直し)
        observe_push(app_dir, &account.id, &fresh);
        // 初めての巡回は新しい 1 件だけ知らせ、残りは位置だけ進める (notify_cursor)
        let silent = cursor.silent_prefix(&account.id, NotifyKind::Notification, fresh.len());
        for n in fresh.iter().skip(silent) {
            // push の登録の確定に使ったテスト通知は push の側で出した
            if n.notification_type == "test"
                && crate::push_flow::is_confirmation(app_dir, &account.id, &n.id)
            {
                continue;
            }
            if let Some(plan) = notify_plan::plan(n, lang) {
                pending.extend(show(images, &plan, deadline).await);
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
        let plan = notify_plan::plan_chat(m, &account.host, lang);
        pending.extend(show(images, &plan, deadline).await);
    }
    if let Some(newest) = fresh.last() {
        crate::notify_cursor_file::advance(app_dir, &account.id, NotifyKind::Message, &newest.id);
    }
    Ok(())
}

/// 処理位置より新しい通知を push の状態に渡す (有効な口座だけが数える)
fn observe_push(app_dir: &Path, account_id: &str, fresh: &[NormalizedNotification]) {
    let created: Vec<u64> = fresh
        .iter()
        .filter_map(|n| notecore::push_state::iso_to_ms(&n.created_at))
        .collect();
    let now = crate::push_flow::now_ms();
    crate::push_store_file::update(app_dir, |s| s.worker_observed(account_id, &created, now));
}

/// 巡回 / push の画像キャッシュ (アプリと同じディスク領域、メモリ層なし)。クライアントを
/// 作れなければ None
fn image_cache(app_dir: &Path) -> Option<ImageCache> {
    // SSRF の防御はアプリの共有クライアントと同じ: リダイレクト先の検証と、名前解決の
    // 結果を接続前に確かめる resolver (private / loopback に解決される公開ホスト名を
    // 弾く、#857)。通知の画像の URL は他人が書いたものなので省かない
    let http = reqwest::Client::builder()
        .timeout(IMAGE_FETCH_TIMEOUT)
        .redirect(notecore::ssrf::external_redirect_policy(5))
        .dns_resolver(std::sync::Arc::new(notecore::ssrf::ValidatingResolver))
        .build()
        .ok()?;
    let perf = Arc::new(tokio::sync::RwLock::new(
        notecore::perf_config::PerformanceConfig {
            memory_cache_max_total: 0,
            ..notecore::perf_config::PerformanceConfig::default()
        },
    ));
    Some(ImageCache::with_client(app_dir, http, perf))
}

/// 画像 (アバター / リアクションの絵文字) を締切まで待ってから 1 回で描く (#1195)。
/// 締切を過ぎたら手元にある画像だけで描き、遅れて届いた画像では描き直さない。取得は
/// 締切後も続くので、返した job を待てばキャッシュに書き終わる (巡回はそれを待って終える)
pub(crate) async fn show(
    images: Option<&Arc<ImageCache>>,
    plan: &NotifyPlan,
    deadline: tokio::time::Instant,
) -> Vec<ImageJob> {
    let Some(cache) = images else {
        draw(plan, None, None);
        return Vec::new();
    };
    let (prepared, jobs) = notify_media::prepare_images(
        cache.clone(),
        plan.icon_url.clone(),
        plan.image_url.clone(),
        Some(crate::android_notify::AVATAR_MAX_WIDTH),
        deadline,
    )
    .await;
    draw(
        plan,
        prepared.icon.as_deref().and_then(|p| p.to_str()),
        prepared.image.as_deref().and_then(|p| p.to_str()),
    );
    jobs
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

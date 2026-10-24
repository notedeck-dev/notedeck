//! push (口座ごとのオプトイン、#330) のコマンド。手順の本体は `push_flow`、配送アプリと
//! keychain の実物は Android の `android_push`。ほかの OS では push を扱わないので
//! 「使えない」を返す。
//!
//! 登録はサーバー単位で進める (同じサーバーの口座は 1 つのコードでまとめて ▶ できる)。
//! 窓は `push_host_status` を読み直しながら、行ごとの状態とコードを出す。

use serde::Serialize;
use specta::Type;

use super::{AppState, Result};

/// 口座の push の状態 (アカウントメニューの状態行と、窓の行)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
// 値の多くは Android でだけ作る
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub enum PushState {
    /// この端末では push を扱わない (Android 以外 / ゲスト)
    Unavailable,
    /// 使っていない (閉じている間は定期確認だけ)
    Off,
    /// プッシュ通知アプリに登録している
    Preparing,
    /// 本家での実行か、最初の push が届くのを待っている
    Pending,
    Active,
    /// 本家での登録し直しが要る
    NeedsReregistration,
    /// 解除を終えるのを待っている
    Unregistering,
}

/// 「登録し直しが要る」の理由
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub enum PushReason {
    /// プッシュ通知アプリの登録が変わった
    EndpointChanged,
    /// サーバーの設定が変わった
    ServerChanged,
    /// push で届いていないようだ (推定)
    Missing,
    /// 以前の版の登録から移った
    Migrated,
}

/// プッシュ通知アプリ (配送アプリ) の状態
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub enum PushDistributorState {
    /// 入っていない
    None,
    /// 使うものが決まっている (または 1 つだけ)
    Ready,
    /// 複数あって既定が無い
    Choose,
}

/// 窓の 1 行 (口座)
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PushAccountRow {
    pub account_id: String,
    pub state: PushState,
    pub reason: Option<PushReason>,
    /// 登録待ちのうち、コードはもう走っていて push の到着を待っている
    pub awaiting: bool,
    /// 到着待ちが続いたので NoteDeck からテスト通知を送り直した
    pub resent: bool,
}

/// サーバー単位の状態。`code` は未実行の登録待ちがあるときの Scratchpad 用のコード
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PushHostStatus {
    pub distributor: PushDistributorState,
    pub accounts: Vec<PushAccountRow>,
    pub code: Option<String>,
    pub scratchpad_url: String,
}

/// 準備 / やり直しの失敗の理由
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub enum PushProblem {
    /// この端末では使えない
    Unavailable,
    /// サーバーが Web Push を設定していない
    ServerUnsupported,
    /// プッシュ通知アプリが入っていない / 登録を始められない
    NoDistributor,
    /// プッシュ通知アプリを選べなかった (一覧から選んでもらう)
    ChooseDistributor,
    /// プッシュ通知アプリが登録に失敗した / 返事が無い
    DistributorFailed,
    /// プッシュ通知アプリの送り先が https でない
    EndpointUnusable,
    /// ログインし直しが要る (古いトークンに権限が無い / 失効した)
    Relogin,
    /// サーバーに繋がらない
    Network,
    /// 端末に保存できなかった
    Storage,
}

/// 入っているプッシュ通知アプリ
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PushDistributor {
    pub package: String,
    pub label: String,
}

#[cfg(target_os = "android")]
mod android {
    use std::path::PathBuf;

    use super::{AppState, Result};
    use crate::push_flow::{Ctx, PushAccount};

    pub(super) struct Env {
        pub app_dir: PathBuf,
        pub client: std::sync::Arc<notecli::api::MisskeyClient>,
        pub accounts: Vec<PushAccount>,
    }

    pub(super) async fn env(core: &AppState) -> Result<Env> {
        let app_dir = core.app_dir()?.to_path_buf();
        let accounts = core
            .db()
            .await
            .load_accounts()?
            .iter()
            .map(PushAccount::from_account)
            .collect();
        Ok(Env {
            app_dir,
            client: core.client().await,
            accounts,
        })
    }

    impl Env {
        pub fn ctx(
            &self,
        ) -> Ctx<
            '_,
            notecli::api::MisskeyClient,
            crate::android_push::KotlinDistributor,
            crate::android_push::Keychain,
        > {
            Ctx {
                app_dir: &self.app_dir,
                server: &self.client,
                distributor: &crate::android_push::KotlinDistributor,
                vault: &crate::android_push::Keychain,
                now_ms: crate::push_flow::now_ms(),
            }
        }

        pub fn host_of(&self, account_id: &str) -> Option<String> {
            self.accounts
                .iter()
                .find(|a| a.id == account_id)
                .map(|a| a.host.clone())
        }
    }

    pub(super) fn random() -> [u8; 10] {
        rand::random()
    }

    /// サーバーの鍵と Web Push の停止を見るのは 1 時間に 1 回 (復帰のたびに meta を引かない)
    pub(super) fn server_check_due(now_ms: u64) -> bool {
        use std::sync::atomic::{AtomicU64, Ordering};
        const INTERVAL_MS: u64 = 60 * 60 * 1000;
        static LAST: AtomicU64 = AtomicU64::new(0);
        let last = LAST.load(Ordering::Relaxed);
        if last != 0 && now_ms.saturating_sub(last) < INTERVAL_MS {
            return false;
        }
        LAST.store(now_ms, Ordering::Relaxed);
        true
    }
}

/// 口座の push の状態 (ネットワークに出ない)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn push_status(
    core: tauri::State<'_, AppState>,
    account_id: String,
) -> Result<PushState> {
    #[cfg(target_os = "android")]
    {
        let env = android::env(&core).await?;
        Ok(env
            .accounts
            .iter()
            .find(|a| a.id == account_id)
            .map(|a| crate::push_flow::state_of(&env.app_dir, a))
            .unwrap_or(PushState::Unavailable))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (core, account_id);
        Ok(PushState::Unavailable)
    }
}

/// サーバー単位の状態。登録待ちの口座はレジストリを読んで「未実行」と「到着待ち」を
/// 見分ける (窓が開いている間は数秒おきに呼ばれる)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn push_host_status(
    core: tauri::State<'_, AppState>,
    host: String,
) -> Result<PushHostStatus> {
    #[cfg(target_os = "android")]
    {
        let env = android::env(&core).await?;
        let lang = crate::ui_lang::current();
        Ok(crate::push_flow::host_status(&env.ctx(), &host, &env.accounts, &lang).await)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = core;
        Ok(PushHostStatus {
            distributor: PushDistributorState::None,
            accounts: Vec::new(),
            code: None,
            scratchpad_url: notecore::push_register::scratchpad_url(&host),
        })
    }
}

/// サーバーの口座をまとめて登録の準備をする (プッシュ通知アプリへの登録と、レジストリへの
/// 書込)。プッシュ通知アプリの返事を待つので数秒かかることがある。成功は None
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn push_prepare(
    core: tauri::State<'_, AppState>,
    host: String,
) -> Result<Option<PushProblem>> {
    #[cfg(target_os = "android")]
    {
        let env = android::env(&core).await?;
        Ok(
            crate::push_flow::prepare(&env.ctx(), &host, &env.accounts, None, android::random())
                .await
                .err(),
        )
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (core, host);
        Ok(Some(PushProblem::Unavailable))
    }
}

/// 口座の登録を新しい鍵と合言葉で作り直す。前の登録は新しい方がそろってから外す
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn push_redo(
    core: tauri::State<'_, AppState>,
    account_id: String,
) -> Result<Option<PushProblem>> {
    #[cfg(target_os = "android")]
    {
        let env = android::env(&core).await?;
        let Some(host) = env.host_of(&account_id) else {
            return Ok(Some(PushProblem::Unavailable));
        };
        Ok(crate::push_flow::prepare(
            &env.ctx(),
            &host,
            &env.accounts,
            Some(&account_id),
            android::random(),
        )
        .await
        .err())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (core, account_id);
        Ok(Some(PushProblem::Unavailable))
    }
}

/// push をやめる。本家の購読の解除・レジストリの印・登録の取り外しを後始末に積んで
/// すぐ試す。通らなかった分は解除待ちのまま残し、起動時と巡回で再試行する。
/// 口座の削除 / ログアウトの前にも呼ぶ (トークンがあるうちに認証つきで解除する)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn push_disable(core: tauri::State<'_, AppState>, account_id: String) -> Result<()> {
    #[cfg(target_os = "android")]
    {
        let env = android::env(&core).await?;
        crate::push_flow::disable(&env.ctx(), &account_id, &env.accounts).await;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (core, account_id);
        Ok(())
    }
}

/// 入っているプッシュ通知アプリ (OS の選択画面が出せなかったときに選んでもらう)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn push_distributors() -> Result<Vec<PushDistributor>> {
    #[cfg(target_os = "android")]
    {
        Ok(crate::android_push::distributors())
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(Vec::new())
    }
}

/// 使うプッシュ通知アプリを決める
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn push_choose_distributor(package_name: String) -> Result<()> {
    #[cfg(target_os = "android")]
    {
        crate::android_push::save_distributor(&package_name);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = package_name;
    }
    Ok(())
}

/// 起動時と復帰時の突き合わせ (以前の版からの移行・状態の知らない登録の後始末・
/// 送り先とサーバーの変化の検出)。返り値は登録し直しが要る口座 (受信トレイに出す)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn push_attention(core: tauri::State<'_, AppState>) -> Result<Vec<String>> {
    #[cfg(target_os = "android")]
    {
        let env = android::env(&core).await?;
        let ctx = env.ctx();
        let check_server = android::server_check_due(ctx.now_ms);
        crate::push_flow::reconcile(&ctx, &env.accounts, check_server).await;
        Ok(crate::push_flow::needing_attention(
            &env.app_dir,
            &env.accounts,
        ))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = core;
        Ok(Vec::new())
    }
}

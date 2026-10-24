//! push (口座ごとのオプトイン、#330 §5) のコマンド。本体は Android の
//! `android_push`。ほかの OS では push を扱わないので「使えない」を返す。

use serde::Serialize;
use specta::Type;

use super::{AppState, Result};

/// 口座の背面の通知の経路 (状態行に出す)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
// 値の多くは Android でだけ作る
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub enum PushStatus {
    /// この端末では push を扱わない (Android 以外 / ゲスト)
    Unavailable,
    /// プッシュ通知アプリ (配送アプリ) が入っていない
    NoDistributor,
    /// 使っていない (閉じている間は定期確認だけ)
    Off,
    /// 使っている
    Active,
    /// 端末側の登録が変わったので、本家での登録し直しが要る
    NeedsRegistration,
    /// プッシュ通知アプリ側で操作が要る
    ActionRequired,
}

/// 本家 Web の Scratchpad で実行してもらうコードと、その Scratchpad の URL
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PushPrepared {
    pub code: String,
    pub scratchpad_url: String,
}

/// 準備 / 登録の失敗の理由。成功は None
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
// 値の多くは Android でだけ作る
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub enum PushProblem {
    /// この端末では使えない
    Unavailable,
    /// サーバーが Web Push を設定していない
    ServerUnsupported,
    /// プッシュ通知アプリが入っていない / 登録を始められない
    NoDistributor,
    /// プッシュ通知アプリが登録に失敗した / 返事が無い
    DistributorFailed,
    /// 貼られた内容が登録の応答として読めない
    Unreadable,
    /// 本家 Web に別の口座でログインしていた
    OtherAccount,
    /// 古いコードを実行した (端末の登録と違う)
    OtherEndpoint,
    /// 端末の登録が無くなった (準備からやり直す)
    EndpointGone,
    /// 保存できなかった
    Storage,
}

/// 準備の結果。`prepared` か `problem` のどちらか
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PushPrepareResult {
    pub prepared: Option<PushPrepared>,
    pub problem: Option<PushProblem>,
}

#[cfg(target_os = "android")]
async fn account(core: &AppState, account_id: &str) -> Result<notecli::models::Account> {
    core.db()
        .await
        .get_account(account_id)?
        .ok_or_else(|| notecli::error::NoteDeckError::AccountNotFound(account_id.to_string()))
}

/// 口座の push の状態
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn push_status(
    core: tauri::State<'_, AppState>,
    account_id: String,
) -> Result<PushStatus> {
    #[cfg(target_os = "android")]
    {
        let account = account(&core, &account_id).await?;
        if crate::android_worker::token_for(&account).is_none() {
            return Ok(PushStatus::Unavailable);
        }
        use crate::android_push::State;
        Ok(match crate::android_push::state(&account) {
            State::NoDistributor => PushStatus::NoDistributor,
            State::Off => PushStatus::Off,
            State::Active => PushStatus::Active,
            State::NeedsRegistration => PushStatus::NeedsRegistration,
            State::ActionRequired => PushStatus::ActionRequired,
        })
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (core, account_id);
        Ok(PushStatus::Unavailable)
    }
}

/// 配送アプリに登録し、本家の Scratchpad で実行してもらうコードを組む。
/// 配送アプリの返事を待つので数秒かかることがある
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn push_prepare(
    core: tauri::State<'_, AppState>,
    account_id: String,
) -> Result<PushPrepareResult> {
    let problem = |p| PushPrepareResult {
        prepared: None,
        problem: Some(p),
    };
    #[cfg(target_os = "android")]
    {
        use crate::android_push::PrepareError;
        let account = account(&core, &account_id).await?;
        // ゲスト (トークン無し) には通知が無い
        if crate::android_worker::token_for(&account).is_none() {
            return Ok(problem(PushProblem::Unavailable));
        }
        let db = core.db().await;
        let (host, token) = notecore::credentials::get_credentials(&db, &account_id)?;
        let meta = core.client().await.get_meta(&host, &token).await?;
        let Some(vapid) = meta
            .get("swPublickey")
            .and_then(serde_json::Value::as_str)
            .filter(|k| !k.is_empty())
        else {
            return Ok(problem(PushProblem::ServerUnsupported));
        };
        let lang = crate::ui_lang::current();
        Ok(
            match crate::android_push::prepare(&account, vapid, &lang).await {
                Ok((code, scratchpad_url)) => PushPrepareResult {
                    prepared: Some(PushPrepared {
                        code,
                        scratchpad_url,
                    }),
                    problem: None,
                },
                Err(PrepareError::NoDistributor) => problem(PushProblem::NoDistributor),
                Err(PrepareError::DistributorFailed) => problem(PushProblem::DistributorFailed),
            },
        )
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (core, account_id);
        Ok(problem(PushProblem::Unavailable))
    }
}

/// 本家で実行した応答を受け取り、合っていれば push を使い始める。成功は None
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn push_complete(
    core: tauri::State<'_, AppState>,
    account_id: String,
    response: String,
) -> Result<Option<PushProblem>> {
    #[cfg(target_os = "android")]
    {
        use crate::android_push::CompleteError;
        use notecore::push_register::VerifyError;
        let account = account(&core, &account_id).await?;
        // ログアウトした口座には保存しない (再ログインで知らないうちに有効にならない)
        if crate::android_worker::token_for(&account).is_none() {
            return Ok(Some(PushProblem::Unavailable));
        }
        Ok(match crate::android_push::complete(&account, &response) {
            Ok(()) => None,
            Err(CompleteError::Verify(VerifyError::Unreadable)) => Some(PushProblem::Unreadable),
            Err(CompleteError::Verify(VerifyError::OtherAccount)) => {
                Some(PushProblem::OtherAccount)
            }
            Err(CompleteError::Verify(VerifyError::OtherEndpoint)) => {
                Some(PushProblem::OtherEndpoint)
            }
            Err(CompleteError::Verify(VerifyError::ServerWithoutKey)) => {
                Some(PushProblem::ServerUnsupported)
            }
            Err(CompleteError::EndpointGone) => Some(PushProblem::EndpointGone),
            Err(CompleteError::Storage) => Some(PushProblem::Storage),
        })
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (core, account_id, response);
        Ok(Some(PushProblem::Unavailable))
    }
}

/// push をやめる。本家の購読を解除し (失敗しても進める)、登録の写しを消す。
/// 口座の削除 / ログアウトの前にも呼ぶ (トークンがあるうちに認証つきで解除する)。
/// 写しを消せなかったら Err (呼び手の削除 / ログアウトはこの失敗を無視して進める)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn push_disable(core: tauri::State<'_, AppState>, account_id: String) -> Result<()> {
    #[cfg(target_os = "android")]
    {
        let account = account(&core, &account_id).await?;
        let db = core.db().await;
        // トークンが無ければ未認証で解除する (本家は三つ組で所有を確かめる)
        let token = notecore::credentials::get_credentials(&db, &account_id)
            .map(|(_, token)| token)
            .unwrap_or_default();
        let others = db.load_accounts()?;
        let client = core.client().await;
        crate::android_push::disable(&client, &account, &token, &others).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (core, account_id);
        Ok(())
    }
}

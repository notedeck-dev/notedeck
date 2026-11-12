//! 送信の直前の検査 (門)。
//!
//! Misskey サーバーへ要求を出す直前に 1 回通す。notecli は設定を知らないので、判定の
//! 中身は上に載るクレートが渡す (notedeck では、手動のオフラインモードのとき断る)。
//!
//! クライアントを作るときに必ず渡す。「渡さなければ常に通す」という既定は置かない:
//! 渡し忘れた場所が黙って漏れるため。検査が要らない場面 (コマンドラインの道具、テスト)
//! は [`AllowAll`] を明示して渡す。

use crate::error::NoteDeckError;

pub trait EgressGate: Send + Sync {
    /// 送ってよければ `Ok`。断るときは、利用者に見せるエラーを返す
    fn check(&self) -> Result<(), NoteDeckError>;
}

/// 常に通す。検査が要らない場面で明示して使う
pub struct AllowAll;

impl EgressGate for AllowAll {
    fn check(&self) -> Result<(), NoteDeckError> {
        Ok(())
    }
}

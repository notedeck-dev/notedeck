//! クレート共通の Result。IPC を越えるエラー型は notecli の NoteDeckError 一つ。

pub type Result<T> = std::result::Result<T, notecli::error::NoteDeckError>;

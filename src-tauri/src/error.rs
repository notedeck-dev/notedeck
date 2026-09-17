//! クレート共通の Result (#1098)。IPC を越えるエラー型は notecli の
//! NoteDeckError 一つで、specta 経由で TS 側の AppError に写像される。
//! 以前は 5 ファイルが同じ alias を各自で宣言していた。

pub(crate) type Result<T> = std::result::Result<T, notecli::error::NoteDeckError>;

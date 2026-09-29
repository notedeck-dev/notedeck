//! コマンド表からの Tauri ラッパー生成 (#1106 段階 0b)。
//!
//! notecore の表 ([`notecore::with_command_table!`]、データ系) と notemaid の表
//! ([`notemaid::with_maid_command_table!`]、AI 系) の各行から `#[tauri::command]` を
//! 生成する。ラッパーは属性検査 ([`notecore::commands::check`]) を通してから型付き本体を
//! 呼ぶだけで、ここには本体を書かない。名前と引数名は表のとおりなので、フロントの
//! `commands.xxx()` と bindings.ts は変わらない。
//!
//! 許可ウィンドウ属性 (`window = main`) を持つ行だけ `tauri::Window` を注入して label を
//! 検査する。持たない行には注入しない (specta の関数引数数の上限に当たるため、要らない
//! ものは足さない)。

/// クライアント層の切替点 (#1106 案 B)。notecore の行 (データ系) は常に in-process、
/// notemaid の行 (AI 系) だけが常駐構成で別プロセスに中継される。表のクレート名で腕を分ける
macro_rules! relay_step {
    (notecore, $name:ident, $ret:ty, $err:ty, $window:expr, [$($arg:ident),*]) => {};
    (notemaid, $name:ident, $ret:ty, $err:ty, $window:expr, [$($arg:ident),*]) => {
        if let Some(relay) = crate::client_layer::relay() {
            #[allow(unused_mut)]
            let mut params = crate::client_layer::Params::default();
            $( params.push(stringify!($arg), &$arg); )*
            return relay
                .call::<$ret, $err>(stringify!($name), params.into_value(), $window)
                .await;
        }
    };
}

/// 1 行ぶんのラッパー。`$tc` は表のクレート (notecore / notemaid)、属性の有無で腕を分ける。
macro_rules! wrapper_one {
    // 許可ウィンドウあり: Window を注入して label を検査
    ($tc:ident $kind:ident [window = $w:ident] $name:ident ( $( $arg:ident : $ty:ty ),* ) -> $ret:ty [$err:ty] = $path:path) => {
        #[tauri::command]
        #[specta::specta]
        #[allow(clippy::too_many_arguments)]
        pub async fn $name(
            window: tauri::Window,
            core: tauri::State<'_, crate::commands::AppState>,
            $( $arg: $ty, )*
        ) -> std::result::Result<$ret, $err> {
            $tc::commands::check(
                $tc::commands::CommandId::$name,
                &notecore::commands::CallContext::window(window.label()),
            )
            .map_err(<$err>::from)?;
            relay_step!($tc, $name, $ret, $err, Some(window.label().to_string()), [$($arg),*]);
            $path(&core, $( $arg, )*).await
        }
    };
    // 属性なし
    ($tc:ident $kind:ident [] $name:ident ( $( $arg:ident : $ty:ty ),* ) -> $ret:ty [$err:ty] = $path:path) => {
        #[tauri::command]
        #[specta::specta]
        #[allow(clippy::too_many_arguments)]
        pub async fn $name(
            core: tauri::State<'_, crate::commands::AppState>,
            $( $arg: $ty, )*
        ) -> std::result::Result<$ret, $err> {
            $tc::commands::check(
                $tc::commands::CommandId::$name,
                &notecore::commands::CallContext::default(),
            )
            .map_err(<$err>::from)?;
            relay_step!($tc, $name, $ret, $err, None, [$($arg),*]);
            $path(&core, $( $arg, )*).await
        }
    };
}

/// 省略時のエラー型は NoteDeckError。
macro_rules! command_error_type {
    () => {
        notecli::error::NoteDeckError
    };
    ($err:ty) => {
        $err
    };
}

macro_rules! tauri_wrappers {
    ($( $kind:ident $( ( $($attr:tt)* ) )? $name:ident ( $( $arg:ident : $ty:ty ),* $(,)? ) -> $ret:ty $( | $err:ty )? = $path:path ; )*) => {
        $(
            wrapper_one! { notecore $kind [ $( $($attr)* )? ] $name ( $( $arg : $ty ),* ) -> $ret [command_error_type!($($err)?)] = $path }
        )*
    };
}

macro_rules! maid_tauri_wrappers {
    ($( $kind:ident $( ( $($attr:tt)* ) )? $name:ident ( $( $arg:ident : $ty:ty ),* $(,)? ) -> $ret:ty $( | $err:ty )? = $path:path ; )*) => {
        $(
            wrapper_one! { notemaid $kind [ $( $($attr)* )? ] $name ( $( $arg : $ty ),* ) -> $ret [command_error_type!($($err)?)] = $path }
        )*
    };
}

notecore::with_command_table!(tauri_wrappers);
notemaid::with_maid_command_table!(maid_tauri_wrappers);

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

/// 1 行ぶんのラッパー (notecore の表 = データ系)。属性の有無で腕を分ける。
/// データ面はデバイスに 1 つなので中継は無く、常に in-process の notecore を呼ぶ (#1106 案 B)
macro_rules! tauri_wrapper_one {
    // 許可ウィンドウあり: Window を注入して label を検査
    ($kind:ident [window = $w:ident] $name:ident ( $( $arg:ident : $ty:ty ),* ) -> $ret:ty [$err:ty] = $path:path) => {
        #[tauri::command]
        #[specta::specta]
        #[allow(clippy::too_many_arguments)]
        pub async fn $name(
            window: tauri::Window,
            core: tauri::State<'_, notecore::context::Core>,
            $( $arg: $ty, )*
        ) -> std::result::Result<$ret, $err> {
            notecore::commands::check(
                notecore::commands::CommandId::$name,
                &notecore::commands::CallContext::window(window.label()),
            )
            .map_err(<$err>::from)?;
            $path(&core, $( $arg, )*).await
        }
    };
    // 属性なし
    ($kind:ident [] $name:ident ( $( $arg:ident : $ty:ty ),* ) -> $ret:ty [$err:ty] = $path:path) => {
        #[tauri::command]
        #[specta::specta]
        #[allow(clippy::too_many_arguments)]
        pub async fn $name(
            core: tauri::State<'_, notecore::context::Core>,
            $( $arg: $ty, )*
        ) -> std::result::Result<$ret, $err> {
            notecore::commands::check(
                notecore::commands::CommandId::$name,
                &notecore::commands::CallContext::default(),
            )
            .map_err(<$err>::from)?;
            $path(&core, $( $arg, )*).await
        }
    };
}

/// 1 行ぶんのラッパー (notemaid の表 = AI 系)。クライアント層の切替点 (#1106 案 B):
/// 常駐構成なら notecored に中継し、それ以外は in-process の notemaid を呼ぶ
macro_rules! maid_wrapper_one {
    ($kind:ident [window = $w:ident] $name:ident ( $( $arg:ident : $ty:ty ),* ) -> $ret:ty [$err:ty] = $path:path) => {
        #[tauri::command]
        #[specta::specta]
        #[allow(clippy::too_many_arguments)]
        pub async fn $name(
            window: tauri::Window,
            core: tauri::State<'_, notecore::context::Core>,
            $( $arg: $ty, )*
        ) -> std::result::Result<$ret, $err> {
            notemaid::commands::check(
                notemaid::commands::CommandId::$name,
                &notecore::commands::CallContext::window(window.label()),
            )
            .map_err(<$err>::from)?;
            if let Some(relay) = crate::client_layer::relay() {
                #[allow(unused_mut)]
                let mut params = crate::client_layer::Params::default();
                $( params.push(stringify!($arg), &$arg); )*
                return relay
                    .call::<$ret, $err>(stringify!($name), params.into_value(), Some(window.label().to_string()))
                    .await;
            }
            $path(&core, $( $arg, )*).await
        }
    };
    ($kind:ident [] $name:ident ( $( $arg:ident : $ty:ty ),* ) -> $ret:ty [$err:ty] = $path:path) => {
        #[tauri::command]
        #[specta::specta]
        #[allow(clippy::too_many_arguments)]
        pub async fn $name(
            core: tauri::State<'_, notecore::context::Core>,
            $( $arg: $ty, )*
        ) -> std::result::Result<$ret, $err> {
            notemaid::commands::check(
                notemaid::commands::CommandId::$name,
                &notecore::commands::CallContext::default(),
            )
            .map_err(<$err>::from)?;
            if let Some(relay) = crate::client_layer::relay() {
                #[allow(unused_mut)]
                let mut params = crate::client_layer::Params::default();
                $( params.push(stringify!($arg), &$arg); )*
                return relay
                    .call::<$ret, $err>(stringify!($name), params.into_value(), None)
                    .await;
            }
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
            tauri_wrapper_one! { $kind [ $( $($attr)* )? ] $name ( $( $arg : $ty ),* ) -> $ret [command_error_type!($($err)?)] = $path }
        )*
    };
}

macro_rules! maid_tauri_wrappers {
    ($( $kind:ident $( ( $($attr:tt)* ) )? $name:ident ( $( $arg:ident : $ty:ty ),* $(,)? ) -> $ret:ty $( | $err:ty )? = $path:path ; )*) => {
        $(
            maid_wrapper_one! { $kind [ $( $($attr)* )? ] $name ( $( $arg : $ty ),* ) -> $ret [command_error_type!($($err)?)] = $path }
        )*
    };
}

notecore::with_command_table!(tauri_wrappers);
notemaid::with_maid_command_table!(maid_tauri_wrappers);

//! コマンド表からの Tauri ラッパー生成 (#1106 段階 0b)。
//!
//! notecore の表 ([`notecore::with_command_table!`]) の各行から `#[tauri::command]` を
//! 生成する。ラッパーは属性検査 ([`notecore::commands::check`]) を通してから型付き本体を
//! 呼ぶだけで、ここには本体を書かない。名前と引数名は表のとおりなので、フロントの
//! `commands.xxx()` と bindings.ts は変わらない。
//!
//! 許可ウィンドウ属性 (`window = main`) を持つ行だけ `tauri::Window` を注入して label を
//! 検査する。持たない行には注入しない (specta の関数引数数の上限に当たるため、要らない
//! ものは足さない)。

/// 1 行ぶんのラッパー。属性の有無で腕を分ける。
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
            // クライアント層の切替点 (#1106 §4.1): 常駐構成なら中継、それ以外は埋め込み
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

notecore::with_command_table!(tauri_wrappers);

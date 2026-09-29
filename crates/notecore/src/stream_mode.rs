//! 接続モード (settings.json5 の `modes.realtime`) をコアが自分で適用する
//! (#1106)。起動時と設定の変更時に polling / realtime を token のある全アカウントへ
//! 反映する (データ面は常にアプリの中で動く)。

use crate::commands;
use crate::context::Core;

/// スカラー設定のファイル名 (ルート直下)
pub const SETTINGS_FILE: &str = "settings.json5";
/// polling の間隔 (秒) を持つパフォーマンス設定のキー
const POLLING_INTERVAL_KEY: &str = "streamPollingInterval";
const DEFAULT_POLLING_SECS: f64 = 15.0;

/// settings.json5 の本文から realtime かどうかを読む。無い / 壊れているときは realtime
pub fn realtime_enabled(text: &str) -> bool {
    json5::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|v| v.get("modes")?.get("realtime")?.as_bool())
        .unwrap_or(true)
}

/// polling の間隔 (ms)。performance.json5 の上書きがあればそれ、無ければ既定
pub fn polling_interval_ms(core: &Core) -> u64 {
    let secs = crate::performance_settings::field(POLLING_INTERVAL_KEY)
        .map(|f| {
            crate::performance_settings::load_overrides(core)
                .map(|o| crate::performance_settings::current(&o, f))
                .unwrap_or(f.default)
        })
        .unwrap_or(DEFAULT_POLLING_SECS);
    (secs * 1000.0) as u64
}

/// 設定どおりのモードを全アカウントへ送る。`at_boot` のときは polling だけ送る
/// (realtime は接続の既定で、端末の購読で張られる。アプリの起動時の適用と同じ規則)
pub async fn apply(core: &Core, at_boot: bool) {
    let Ok(base) = commands::settings::settings_base_dir(core) else {
        return;
    };
    let text = crate::settings_store::read_settings_json(&base).unwrap_or_default();
    let realtime = realtime_enabled(&text);
    if at_boot && realtime {
        return;
    }
    let (mode, interval) = if realtime {
        ("realtime", None)
    } else {
        ("polling", Some(polling_interval_ms(core)))
    };
    let accounts = match commands::admin::load_accounts(core).await {
        Ok(a) => a,
        Err(e) => {
            tracing::warn!("[stream] connection mode: cannot list accounts: {e}");
            return;
        }
    };
    for account in accounts.into_iter().filter(|a| a.has_token) {
        if let Err(e) =
            commands::streaming::stream_set_mode(core, account.id.clone(), mode.into(), interval)
                .await
        {
            tracing::warn!(account = account.id, "[stream] connection mode: {e}");
        }
    }
    tracing::info!(mode, "[stream] connection mode applied");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn realtime_is_the_default_and_false_only_when_written() {
        assert!(realtime_enabled(""));
        assert!(realtime_enabled("{ theme: 'dark' }"));
        assert!(realtime_enabled("{ modes: { offline: true } }"));
        assert!(realtime_enabled("not json"));
        assert!(!realtime_enabled("{ /* c */ modes: { realtime: false } }"));
        assert!(realtime_enabled("{ modes: { realtime: true } }"));
    }
}

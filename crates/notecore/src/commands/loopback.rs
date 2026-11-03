//! プラグインの loopback 同意 (#1293) のコマンド面。本体は `loopback_consent`。
//! どれも `authz (window = app)` (認可境界: 同意の記録に触れる) で、引数を信用せず
//! 本体が検証する

use crate::context::Core;
use crate::error::Result;
use crate::loopback_consent::{
    self, LoopbackClassification, LoopbackConsentRow, LoopbackConsentStatus,
};

pub async fn loopback_consent_status(
    core: &Core,
    plugin_id: String,
) -> Result<LoopbackConsentStatus> {
    loopback_consent::status(core, &plugin_id)
}

pub async fn loopback_consent_list(core: &Core) -> Result<Vec<LoopbackConsentRow>> {
    loopback_consent::list(core)
}

pub async fn loopback_consent_grant(
    core: &Core,
    plugin_id: String,
    port: u16,
    expected_hash: String,
) -> Result<()> {
    loopback_consent::grant(core, &plugin_id, port, &expected_hash)
}

pub async fn loopback_consent_revoke(core: &Core, plugin_id: String, port: u16) -> Result<()> {
    loopback_consent::revoke(core, &plugin_id, port)
}

pub async fn http_loopback_classify(
    core: &Core,
    url: String,
    plugin_id: String,
    body_hash: String,
) -> Result<LoopbackClassification> {
    loopback_consent::classify(core, &url, &plugin_id, &body_hash)
}

/// 動かしている本文の hash (起動時にデバイスが本文を渡す。TS は計算しない)
pub async fn plugin_body_hash(_core: &Core, content: String) -> Result<String> {
    Ok(loopback_consent::body_hash(&content))
}

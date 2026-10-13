//! federation のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

use serde::{Deserialize, Serialize};
use specta::Type;

use serde_json::{json, Value};

use crate::context::Core;
use crate::error::Result;

/// Misskey `federation/instances` / `federation/show-instance` の 1 件分。
/// 本家 schema (packages/backend/src/models/Instance.ts) に準拠。
/// `show-instance` でのみ返るフィールドは Option にする。
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FederationInstance {
    pub id: String,
    pub host: String,
    pub users_count: i64,
    pub notes_count: i64,
    pub following_count: i64,
    pub followers_count: i64,
    pub is_not_responding: bool,
    pub is_suspended: bool,
    pub is_blocked: Option<bool>,
    pub is_silenced: Option<bool>,
    pub is_media_silenced: Option<bool>,
    pub suspension_state: Option<String>,
    pub moderation_note: Option<String>,
    pub software_name: Option<String>,
    pub software_version: Option<String>,
    pub open_registrations: Option<bool>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub maintainer_name: Option<String>,
    pub maintainer_email: Option<String>,
    pub icon_url: Option<String>,
    pub favicon_url: Option<String>,
    pub theme_color: Option<String>,
    pub first_retrieved_at: String,
    pub info_updated_at: Option<String>,
    pub latest_request_sent_at: Option<String>,
    pub latest_request_received_at: Option<String>,
    pub latest_status: Option<i64>,
}

/// 古いフォークで欠ける (か null の) 件数・状態・時刻を既定値で埋める (#1255)。
/// 1 項目の欠けで 1 件ごと読めなくならないようにする。識別に使う id / host は埋めない。
/// `#[serde(default)]` にすると specta が TS 側の型を任意にしてしまうので、型は
/// 必須のまま受け取った JSON の側を直す。
fn fill_missing(v: &mut Value) {
    let Some(o) = v.as_object_mut() else { return };
    let defaults = [
        ("usersCount", json!(0)),
        ("notesCount", json!(0)),
        ("followingCount", json!(0)),
        ("followersCount", json!(0)),
        ("isNotResponding", json!(false)),
        ("isSuspended", json!(false)),
        ("firstRetrievedAt", json!("")),
    ];
    for (k, d) in defaults {
        if o.get(k).is_none_or(Value::is_null) {
            o.insert(k.into(), d);
        }
    }
}

pub async fn api_get_federation_instances(
    core: &Core,
    account_id: String,
    params: Value,
) -> Result<Vec<FederationInstance>> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    let mut raw = client
        .request(&host, &token, "federation/instances", params)
        .await?;
    if let Some(list) = raw.as_array_mut() {
        list.iter_mut().for_each(fill_missing);
    }
    Ok(serde_json::from_value(raw)?)
}

pub async fn api_get_federation_instance(
    core: &Core,
    account_id: String,
    params: Value,
) -> Result<FederationInstance> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    let mut raw = client
        .request(&host, &token, "federation/show-instance", params)
        .await?;
    fill_missing(&mut raw);
    Ok(serde_json::from_value(raw)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_missing_counts_and_flags_still_parses() {
        let mut v = json!({ "id": "i1", "host": "old.example", "usersCount": null });
        fill_missing(&mut v);
        let i: FederationInstance = serde_json::from_value(v).expect("parse");
        assert_eq!(i.host, "old.example");
        assert_eq!(i.users_count, 0);
        assert!(!i.is_not_responding);
        assert!(i.software_name.is_none());
    }

    #[test]
    fn present_values_are_kept() {
        let mut v = json!({ "id": "i1", "host": "h", "usersCount": 5, "isSuspended": true });
        fill_missing(&mut v);
        assert_eq!(v["usersCount"], 5);
        assert_eq!(v["isSuspended"], true);
    }
}

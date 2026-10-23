//! OS 通知 1 件の組み立て (純関数、#330 §4.1)。
//!
//! 入力は正規化済みの通知と表示言語、出力は見出し / 本文 / タップ時の遷移先 /
//! 添付する画像の URL。どの経路 (ストリーミング / ワーカー / 将来の push) から
//! 来ても同じ入力から同じ通知が出るよう、組み立てはここ 1 箇所にする。
//! ネットワーク・Tauri・端末 API には触らない (tests/lint/rustCoreBoundary が検査)。
//! 画像のローカル化 (キャッシュ) は手元側の仕事。

use notecli::models::NormalizedNotification;
use serde_json::json;

use crate::i18n;

/// 通知をタップしたときの遷移先。ノートがあればノート詳細、無ければユーザー詳細。
/// どちらも無ければウィンドウを前面にするだけ
#[derive(Debug, Clone, PartialEq)]
pub struct ClickTarget {
    pub account_id: String,
    pub note_id: Option<String>,
    pub user_id: Option<String>,
}

/// OS 通知 1 件分の組み立て結果
#[derive(Debug, Clone, PartialEq)]
pub struct NotifyPlan {
    pub title: String,
    pub body: Option<String>,
    pub click: Option<ClickTarget>,
    /// アクターのアバター (app 通知は送信元アプリのアイコン)。本家 web push の icon と同じ
    pub icon_url: Option<String>,
    /// リアクションのカスタム絵文字 (フルカラー)。Unicode 絵文字は本文に出るので無し
    pub image_url: Option<String>,
    /// `notedeck://` の遷移先 (Android の通知タップ用)
    pub deep_link: Option<String>,
}

/// 通知を OS 通知の内容に組み立てる。出さない種別は None
pub fn plan(n: &NormalizedNotification, lang: &str) -> Option<NotifyPlan> {
    let label = |key: &str| i18n::render(lang, key, &json!({}));
    // 送信元ユーザーが欠けていたら「誰か」(本家 sw と同じ扱い)
    let actor_name = || {
        n.user
            .as_ref()
            .and_then(|u| u.name.as_deref().or(Some(u.username.as_str())))
            .map(str::to_string)
            .unwrap_or_else(|| label("_native.notification.someone"))
    };

    // 本家 (packages/sw/src/scripts/create-notification.ts) に合わせ、アクター系
    // (見出し = ユーザー) と自己 / システム通知 (見出し = 固定) を分ける
    let (title, body): (String, Option<String>) = match n.notification_type.as_str() {
        "reaction" => {
            let body = n
                .reaction
                .as_deref()
                .map(|r| {
                    i18n::render(
                        lang,
                        "_native.notification.reactionWith",
                        &json!({ "reaction": r }),
                    )
                })
                .unwrap_or_else(|| label("_native.notification.reaction"));
            (actor_name(), Some(body))
        }
        "reply" => (actor_name(), Some(label("_native.notification.reply"))),
        "renote" => (actor_name(), Some(label("_native.notification.renote"))),
        "quote" => (actor_name(), Some(label("_native.notification.quote"))),
        "mention" => (actor_name(), Some(label("_native.notification.mention"))),
        "follow" => (actor_name(), Some(label("_native.notification.follow"))),
        "followRequestAccepted" => (
            actor_name(),
            Some(label("_native.notification.followRequestAccepted")),
        ),
        "receiveFollowRequest" => (
            actor_name(),
            Some(label("_native.notification.receiveFollowRequest")),
        ),
        "achievementEarned" => {
            let body = n.achievement.as_deref().map(|a| achievement_label(lang, a));
            (label("_native.notification.achievementEarned"), body)
        }
        "login" => (label("_native.notification.login"), None),
        "pollEnded" => (label("_native.notification.pollEnded"), None),
        // 外部アプリ (notifications/create) 由来。header があれば title=header /
        // body=body、無ければ body を title に繰り上げる (本家 sw と同じ)
        "app" => match (n.header.as_deref(), n.body.as_deref()) {
            (Some(header), body) => (header.to_string(), body.map(str::to_string)),
            (None, Some(body)) => (body.to_string(), None),
            (None, None) => (label("_native.notification.generic"), None),
        },
        "test" => (
            label("_native.notification.test"),
            Some(label("_native.notification.test")),
        ),
        _ => return None,
    };

    let click = Some(ClickTarget {
        account_id: n.account_id.clone(),
        note_id: n.note.as_ref().map(|note| note.id.clone()),
        user_id: n.user.as_ref().map(|u| u.id.clone()),
    });
    let deep_link = match (&n.note, &n.user) {
        (Some(note), _) => Some(format!("notedeck://{}/note/{}", n.server_host, note.id)),
        (None, Some(user)) => Some(format!("notedeck://{}/user/{}", n.server_host, user.id)),
        (None, None) => None,
    };
    let icon_url = n
        .user
        .as_ref()
        .and_then(|u| u.avatar_url.clone())
        .or_else(|| n.icon.clone());
    let image_url = (n.notification_type == "reaction")
        .then_some(n.reaction.as_deref())
        .flatten()
        .and_then(|r| crate::notify_media::emoji_image_url(&n.server_host, r));

    Some(NotifyPlan {
        title,
        body,
        click,
        icon_url,
        image_url,
        deep_link,
    })
}

/// 実績の表示名 (TS と同じ辞書の `_achievementLabels`)。辞書に無い実績は id のまま
pub fn achievement_label(lang: &str, name: &str) -> String {
    let key = format!("_achievementLabels.{name}");
    let text = i18n::render(lang, &key, &json!({}));
    if text == key {
        name.to_string()
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use notecli::models::NormalizedNotification;
    use serde_json::json;

    use super::*;

    fn reaction(id: &str, reaction: &str) -> NormalizedNotification {
        serde_json::from_value(json!({
            "id": id,
            "_accountId": "acct-1",
            "_serverHost": "misskey.example",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "type": "reaction",
            "reaction": reaction,
            "user": { "id": "u1", "username": "alice", "avatarUrl": "https://misskey.example/avatar.webp" },
            "note": {
                "id": "note-1",
                "_accountId": "acct-1",
                "_serverHost": "misskey.example",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "user": { "id": "u9", "username": "me" },
                "visibility": "public",
                "renoteCount": 0,
                "repliesCount": 0
            },
        }))
        .expect("fixture should deserialize")
    }

    /// アクター系は見出しが送信元ユーザー、本文が種別の文。遷移先はノート、画像は
    /// アバター + カスタム絵文字 (本家 sw の icon / badge と同じ配置)
    #[test]
    fn actor_notification_builds_title_click_and_media() {
        let p = plan(&reaction("n1", ":igyo@.:"), "ja-JP").expect("reaction is shown");
        assert_eq!(p.title, "alice");
        assert_eq!(p.body.as_deref(), Some("リアクション :igyo@.:"));
        let click = p.click.expect("actor notification carries click target");
        assert_eq!(click.account_id, "acct-1");
        assert_eq!(click.note_id.as_deref(), Some("note-1"));
        assert_eq!(click.user_id.as_deref(), Some("u1"));
        assert_eq!(
            p.deep_link.as_deref(),
            Some("notedeck://misskey.example/note/note-1")
        );
        assert_eq!(
            p.icon_url.as_deref(),
            Some("https://misskey.example/avatar.webp")
        );
        assert_eq!(
            p.image_url.as_deref(),
            Some("https://misskey.example/emoji/igyo@..webp")
        );
    }

    /// Unicode 絵文字は本文に出るので画像なし。言語を変えると本文が変わる
    #[test]
    fn unicode_reaction_has_no_image_and_follows_language() {
        let ja = plan(&reaction("n2", "👍"), "ja-JP").unwrap();
        assert!(ja.image_url.is_none());
        assert!(ja.icon_url.is_some());
        let en = plan(&reaction("n2", "👍"), "en-US").unwrap();
        assert_ne!(ja.body, en.body);
    }

    /// 外部アプリの通知は header / body / icon をそのまま載せ、header が無ければ
    /// 本家 sw と同じく body を見出しに繰り上げる。遷移先は無い
    #[test]
    fn app_notification_uses_header_body_icon() {
        let app = |header: Option<&str>| -> NormalizedNotification {
            serde_json::from_value(json!({
                "id": "a1",
                "_accountId": "acct-1",
                "_serverHost": "misskey.example",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "type": "app",
                "header": header,
                "body": "Mewkで実績を獲得しました！",
                "icon": "https://mewk.app/icon.png",
            }))
            .unwrap()
        };
        let p = plan(&app(Some("Mewk | 実績解除")), "ja-JP").unwrap();
        assert_eq!(p.title, "Mewk | 実績解除");
        assert_eq!(p.body.as_deref(), Some("Mewkで実績を獲得しました！"));
        assert_eq!(p.icon_url.as_deref(), Some("https://mewk.app/icon.png"));
        assert!(p.deep_link.is_none());
        let p = plan(&app(None), "ja-JP").unwrap();
        assert_eq!(p.title, "Mewkで実績を獲得しました！");
        assert!(p.body.is_none());
    }

    /// 出さない種別 (ロール付与など) は None
    #[test]
    fn unknown_or_suppressed_types_are_not_shown() {
        let n: NormalizedNotification = serde_json::from_value(json!({
            "id": "r1",
            "_accountId": "acct-1",
            "_serverHost": "misskey.example",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "type": "roleAssigned",
        }))
        .unwrap();
        assert!(plan(&n, "ja-JP").is_none());
    }

    #[test]
    fn achievement_label_maps_known_and_falls_back() {
        assert_eq!(achievement_label("ja-JP", "notes1"), "はじめてのノート");
        assert_eq!(achievement_label("ja-JP", "iLoveMisskey"), "I Love Misskey");
        assert_eq!(
            achievement_label("ja-JP", "unknownFutureBadge"),
            "unknownFutureBadge"
        );
    }
}

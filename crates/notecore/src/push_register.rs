//! push の購読登録を、利用者に本家 Web で 1 回実行してもらうための組み立て
//! (純関数、#330 §5 / 2026-10-24 の登録手順の作り直し)。
//!
//! 本家の `sw/register` は本人用トークン (Web UI のサインイン) でしか通らない。本家 Web の
//! Scratchpad は本人用トークンで動くので、そこでコードを 1 回実行してもらう。
//!
//! 秘密 (送り先と鍵) はコードに入れない。NoteDeck が自分のトークンで本家のレジストリに
//! 書き (アプリのトークンで書いた項目はそのトークン専用の領域に入り、他のアプリは読めない)、
//! コードは本人用トークンで領域を指定して読む。読む対象は推測できない合言葉で絞る。
//! 他のアプリも自分の領域に偽の登録待ちを置けるので、登録に進むのは「生きている領域の
//! 登録待ちがちょうど 1 件で、印 (済み / 取り消し済み) が 0 件」のときだけにする。
//! 判定表は #330 の仕様 (issuecomment-6383525709) のとおり。
//!
//! ネットワーク・端末には触らない (tests/lint/rustCoreBoundary が検査)。

use serde_json::{json, Value};

use crate::i18n;

/// レジストリの scope (要素は英数字と _ だけ、本家の制約)
pub const REGISTRY_SCOPE: [&str; 2] = ["notedeck", "push"];

/// 購読の三つ組 (配送アプリが発行した送り先と、端末が持つ鍵の公開側)。鍵は base64url
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushKeys {
    pub endpoint: String,
    pub auth: String,
    pub publickey: String,
}

/// 登録の対象の口座 (Misskey のユーザー ID と表示用の `@username`)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub user_id: String,
    pub name: String,
}

/// 本家 Web の Scratchpad
pub fn scratchpad_url(host: &str) -> String {
    format!("https://{host}/scratchpad")
}

/// 合言葉 (80 bit)。乱数は呼び手が渡す。レジストリの key に使うので英小文字と数字だけ
pub fn new_nonce(random: [u8; 10]) -> String {
    const ALPHABET: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";
    let mut bits: u128 = 0;
    for b in random {
        bits = (bits << 8) | u128::from(b);
    }
    (0..16)
        .map(|i| {
            let index = ((bits >> (75 - i * 5)) & 0x1f) as usize;
            char::from(ALPHABET[index])
        })
        .collect()
}

/// サーバーが Web Push を送れるなら VAPID 公開鍵を返す (`meta` の値から)。
/// `enableServiceWorker` が false だと本家は送らない。connector は `=` を除いてから
/// 87 文字の base64url かを確かめ、違えば例外を投げるので、ここで同じ判定をする
pub fn server_vapid(meta: &Value) -> Option<String> {
    if meta.get("enableServiceWorker").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let key = meta.get("swPublickey").and_then(Value::as_str)?;
    let stripped: String = key.chars().filter(|c| *c != '=').collect();
    let valid = stripped.len() == 87
        && stripped
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    valid.then(|| key.to_string())
}

/// 配送アプリの送り先を本家が受け付けるか。https で、userinfo を含まないこと
/// (本家は http や userinfo 付きの送り先には送らない)
pub fn endpoint_usable(endpoint: &str) -> bool {
    let Some(rest) = endpoint.strip_prefix("https://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    !authority.is_empty() && !authority.contains('@')
}

/// 登録待ちの項目の値
pub fn pending_value(keys: &PushKeys) -> Value {
    json!({
        "v": 1,
        "state": "pending",
        "endpoint": keys.endpoint,
        "auth": keys.auth,
        "publickey": keys.publickey,
    })
}

/// 取り消し済みの印 (秘密を消す)
pub fn superseded_value() -> Value {
    json!({ "v": 1, "state": "superseded" })
}

/// レジストリの項目の状態 (NoteDeck が自分の項目を読んで見分ける)
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EntryState {
    /// コードがまだ走っていない
    Pending,
    /// コードが登録した (key は応答のサーバーの VAPID 公開鍵)
    Done { server_key: Option<String> },
    /// 取り消し済み
    Superseded,
    /// 読めない
    Unknown,
}

pub fn parse_entry(value: &Value) -> EntryState {
    match value.get("state").and_then(Value::as_str) {
        Some("pending") => EntryState::Pending,
        Some("done") => EntryState::Done {
            server_key: value.get("key").and_then(Value::as_str).map(str::to_string),
        },
        Some("superseded") => EntryState::Superseded,
        _ => EntryState::Unknown,
    }
}

/// AiScript の単一引用符の文字列リテラル。`\` と `'` だけがエスケープの対象
/// (AiScript 1.2.1 で確認。`{` は引用符の中では補間されない)
fn ais_str(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
}

/// 辞書の文を、差し込み位置 (`{user}` など) を残したまま引く。コード側で replace する。
/// キーは全文で渡す (辞書の未使用検査がコードの文字列を探す)
fn template(lang: &str, key: &str) -> String {
    i18n::render(
        lang,
        key,
        &json!({ "user": "{user}", "others": "{others}", "targets": "{targets}" }),
    )
}

/// Scratchpad に貼ってもらうコード。合言葉と対象の口座の一覧だけが変わる定型文。
/// 全体を `eval { }` で包み、止めるときは return で抜ける (Core:abort は Scratchpad で
/// エラーのダイアログを重ねるので使わない)。古いコードが前に残っていても衝突しない。
/// AiScript 1.2.1 は 1 行に文を 2 つ書けないので、文ごとに改行する
pub fn register_code(nonce: &str, targets: &[Target], lang: &str) -> String {
    let separator = i18n::render(lang, "_native.notification.listSeparator", &json!({}));
    let target_list = targets
        .iter()
        .map(|t| {
            format!(
                "{{ id: {}, name: {} }}",
                ais_str(&t.user_id),
                ais_str(&t.name)
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    let t = |key: &str| ais_str(&template(lang, key));
    format!(
        r#"eval {{
	@run() {{
		let PASS = {nonce}
		let TARGETS = [{target_list}]
		let SEP = {separator}
		let TITLE = {title}
		let SCOPE = ['notedeck', 'push']
		if (USER_ID == null) {{
			Mk:dialog(TITLE, {login_first}, 'warning')
			return null
		}}
		let names = TARGETS.map(@(x) {{ x.name }}).join(SEP)
		let me = TARGETS.filter(@(x) {{ x.id == USER_ID }})
		if (me.len == 0) {{
			Mk:dialog(TITLE, {not_target}.replace('{{user}}', `@{{USER_USERNAME}}`).replace('{{targets}}', names), 'warning')
			return null
		}}
		let user = me[0].name
		let others = TARGETS.filter(@(x) {{ x.id != USER_ID }}).map(@(x) {{ x.name }}).join(SEP)
		let all = Mk:api('i/registry/scopes-with-domain', {{}})
		if (Core:type(all) == 'error') {{
			Mk:dialog(all.name, Core:to_str(all.info), 'error')
			return null
		}}
		let apps = Mk:api('i/apps', {{}})
		if (Core:type(apps) == 'error') {{
			Mk:dialog(apps.name, Core:to_str(apps.info), 'error')
			return null
		}}
		let live = apps.map(@(a) {{ a.id }})
		let mine = all.filter(@(d) {{ (d.domain != null) && d.scopes.some(@(s) {{ s.join('/') == 'notedeck/push' }}) }}).map(@(d) {{ d.domain }})
		var pending = []
		var marks = 0
		var superseded = false
		each let d, mine {{
			let items = Mk:api('i/registry/get-all', {{ scope: SCOPE, domain: d }})
			if (Core:type(items) == 'error') {{
				Mk:dialog(items.name, Core:to_str(items.info), 'error')
				return null
			}}
			let alive = live.incl(d)
			if (!alive) {{
				each let k, Obj:keys(items) {{
					let v = Obj:get(items, k)
					if (Core:type(v) == 'obj' && v.state == 'pending') {{
						Mk:api('i/registry/set', {{ scope: SCOPE, key: k, domain: d, value: {{ v: 1, state: 'superseded' }} }})
						Obj:set(items, k, {{ v: 1, state: 'superseded' }})
					}}
				}}
			}}
			let v = Obj:get(items, PASS)
			if (Core:type(v) != 'obj') {{
				continue
			}}
			if (v.state == 'pending' && alive) {{
				pending.push({{ domain: d, item: v }})
			}} elif (v.state == 'superseded') {{
				marks += 1
				superseded = true
			}} elif (v.state == 'done') {{
				marks += 1
			}}
		}}
		let count = pending.len
		if (count == 1 && marks == 0) {{
			let p = pending[0]
			let t = p.item
			let r = Mk:api('sw/register', {{ endpoint: t.endpoint, auth: t.auth, publickey: t.publickey, sendReadMessage: true }})
			if (Core:type(r) == 'error') {{
				Mk:dialog(r.name, Core:to_str(r.info), 'error')
				return null
			}}
			if (r.sendReadMessage != true) {{
				let u = Mk:api('sw/update-registration', {{ endpoint: t.endpoint, sendReadMessage: true }})
				if (Core:type(u) == 'error') {{
					Mk:dialog(u.name, Core:to_str(u.info), 'error')
					return null
				}}
			}}
			Mk:api('i/registry/set', {{ scope: SCOPE, key: PASS, domain: p.domain, value: {{ v: 1, state: 'done', at: Date:now(), key: r.key, userId: USER_ID }} }})
			Mk:api('notifications/test-notification', {{}})
			if (others == '') {{
				Mk:dialog(TITLE, {enabled}.replace('{{user}}', user), 'success')
			}} else {{
				Mk:dialog(TITLE, {enabled_next}.replace('{{user}}', user).replace('{{others}}', others), 'success')
			}}
			return null
		}}
		if (count == 0 && superseded) {{
			<: {old_code}
			return null
		}}
		if (count == 0 && marks >= 1) {{
			Mk:dialog(TITLE, {registered}.replace('{{user}}', user), 'info')
			return null
		}}
		if (count == 0) {{
			Mk:dialog(TITLE, {no_pending}.replace('{{user}}', user).replace('{{targets}}', names), 'warning')
			return null
		}}
		Mk:dialog(TITLE, {cannot_confirm}, 'error')
	}}
	run()
}}
"#,
        nonce = ais_str(nonce),
        target_list = target_list,
        separator = ais_str(&separator),
        title = t("_native.push.title"),
        login_first = t("_native.push.loginFirst"),
        not_target = t("_native.push.notTarget"),
        enabled = t("_native.push.enabled"),
        enabled_next = t("_native.push.enabledNext"),
        old_code = t("_native.push.oldCode"),
        registered = t("_native.push.registered"),
        no_pending = t("_native.push.noPending"),
        cannot_confirm = t("_native.push.cannotConfirm"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn targets() -> Vec<Target> {
        vec![
            Target {
                user_id: "u1".into(),
                name: "@alice".into(),
            },
            Target {
                user_id: "u2".into(),
                name: "@bob".into(),
            },
        ]
    }

    /// コードは合言葉と対象の口座だけを含み、送り先や鍵は含まない。文言は差し込み位置を
    /// 残したまま入り、引用符と \ を壊さない
    #[test]
    fn register_code_carries_nonce_and_targets_but_no_secrets() {
        let code = register_code("abcdefghijklmnop", &targets(), "ja-JP");
        assert!(code.starts_with("eval {"));
        assert!(code.contains("let PASS = 'abcdefghijklmnop'"));
        assert!(code.contains("{ id: 'u1', name: '@alice' }, { id: 'u2', name: '@bob' }"));
        assert!(code.contains("{user}"));
        assert!(!code.contains("Core:abort"));
        assert!(!code.contains("auth: '"));
        assert_eq!(ais_str(r"a'b\c"), r"'a\'b\\c'");
        assert_eq!(
            scratchpad_url("misskey.example"),
            "https://misskey.example/scratchpad"
        );
    }

    /// 合言葉は 80 bit を英小文字と数字 16 文字で表す (レジストリの key に使える)
    #[test]
    fn nonce_is_sixteen_base32_chars_and_depends_on_every_byte() {
        assert_eq!(new_nonce([0; 10]), "aaaaaaaaaaaaaaaa");
        assert_eq!(
            new_nonce([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]),
            "aaaaaaaaaaaaaaab"
        );
        let all_ones = new_nonce([0xff; 10]);
        assert_eq!(all_ones, "7777777777777777");
    }

    #[test]
    fn server_vapid_requires_service_worker_and_a_valid_key() {
        let key = "B".repeat(87);
        let ok = json!({ "enableServiceWorker": true, "swPublickey": key });
        assert_eq!(server_vapid(&ok).as_deref(), Some(key.as_str()));
        // = の付いた鍵も connector と同じく受け付ける
        let padded = format!("{key}=");
        assert!(
            server_vapid(&json!({ "enableServiceWorker": true, "swPublickey": padded })).is_some()
        );
        assert!(
            server_vapid(&json!({ "enableServiceWorker": false, "swPublickey": key })).is_none()
        );
        assert!(
            server_vapid(&json!({ "enableServiceWorker": true, "swPublickey": null })).is_none()
        );
        assert!(
            server_vapid(&json!({ "enableServiceWorker": true, "swPublickey": "short" })).is_none()
        );
    }

    #[test]
    fn endpoint_usable_requires_https_without_userinfo() {
        assert!(endpoint_usable("https://ntfy.example/upAbC?up=1"));
        assert!(!endpoint_usable("http://ntfy.example/up"));
        assert!(!endpoint_usable("https://user:pass@ntfy.example/up"));
        assert!(!endpoint_usable("https:///nohost"));
    }

    #[test]
    fn parse_entry_reads_the_three_states() {
        let keys = PushKeys {
            endpoint: "e".into(),
            auth: "a".into(),
            publickey: "p".into(),
        };
        assert_eq!(parse_entry(&pending_value(&keys)), EntryState::Pending);
        assert_eq!(
            parse_entry(&json!({ "state": "done", "key": "K" })),
            EntryState::Done {
                server_key: Some("K".into())
            }
        );
        assert_eq!(parse_entry(&superseded_value()), EntryState::Superseded);
        assert_eq!(parse_entry(&json!(null)), EntryState::Unknown);
    }
}

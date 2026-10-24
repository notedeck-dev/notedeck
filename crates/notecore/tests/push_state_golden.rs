//! push の状態の遷移表 (#330) の golden。開始の状態 × 事象ごとに「遷移後の状態・届いた
//! push の扱い・積まれた後始末」を 1 マスに書き、表として固定する。遷移を変えたら
//! `UPDATE_GOLDEN=1 cargo test -p notecore --test push_state_golden` で書き直し、差分を
//! 表のまま読んで確かめる。純関数のモジュール (push_state) は I/O を持てないので、
//! ファイルの読み書きはここ

use notecore::push_state::{Cleanup, Delivery, Phase, PushStore, Reason};

const ACCOUNT: &str = "a";
const HOST: &str = "h";
/// 有効になった時刻。未着の推定はこれより後の通知だけを数える
const ACTIVE_AT: u64 = 1_000_000;
/// 突き合わせと推定の「今」(準備中が止まったと見なすのに十分あと)
const LATER: u64 = ACTIVE_AT + 24 * 60 * 60 * 1000;

fn ready(s: &mut PushStore) -> u32 {
    let generation = s.begin_generation(ACCOUNT, HOST, 0);
    s.generation_ready(ACCOUNT, generation, "fp");
    s.set_nonce(ACCOUNT, "nonce");
    generation
}

fn active(s: &mut PushStore) {
    let generation = ready(s);
    s.awaiting(ACCOUNT, Some("KEY"), 0);
    s.on_push(ACCOUNT, generation, None, ACTIVE_AT);
}

/// 開始の状態 (公開の遷移だけで作る)
fn starts() -> Vec<(&'static str, PushStore)> {
    let build = |f: fn(&mut PushStore)| {
        let mut s = PushStore::default();
        f(&mut s);
        s
    };
    vec![
        ("off", PushStore::default()),
        (
            "preparing",
            build(|s| {
                s.begin_generation(ACCOUNT, HOST, LATER);
            }),
        ),
        (
            "pending",
            build(|s| {
                ready(s);
            }),
        ),
        ("active", build(active)),
        (
            "needsRereg:endpoint",
            build(|s| {
                active(s);
                s.endpoint_changed(ACCOUNT, 1, None);
            }),
        ),
        (
            "needsRereg:missing",
            build(|s| {
                active(s);
                s.worker_observed(ACCOUNT, &[ACTIVE_AT + 1], LATER);
                s.worker_observed(ACCOUNT, &[ACTIVE_AT + 1], LATER);
            }),
        ),
        (
            "needsRereg:migrated",
            build(|s| s.mark_migrated(ACCOUNT, HOST)),
        ),
        (
            "unregistering",
            build(|s| {
                active(s);
                s.begin_disable(ACCOUNT);
            }),
        ),
    ]
}

fn generation(s: &PushStore) -> u32 {
    s.account(ACCOUNT).map(|a| a.generation).unwrap_or(0)
}

type Event = fn(&mut PushStore) -> Option<Delivery>;

/// 事象。届いた push は扱いを返す
fn events() -> Vec<(&'static str, Event)> {
    vec![
        ("push", |s| {
            let g = generation(s);
            Some(s.on_push(ACCOUNT, g, None, LATER))
        }),
        ("push(other gen)", |s| {
            let g = generation(s) + 1;
            Some(s.on_push(ACCOUNT, g, None, LATER))
        }),
        ("disable", |s| {
            s.begin_disable(ACCOUNT);
            None
        }),
        ("redo", |s| {
            s.begin_redo(ACCOUNT);
            None
        }),
        ("new gen", |s| {
            let g = s.begin_generation(ACCOUNT, HOST, LATER);
            s.generation_ready(ACCOUNT, g, "fp2");
            None
        }),
        ("gen failed", |s| {
            let g = generation(s);
            s.generation_failed(ACCOUNT, g);
            None
        }),
        ("endpoint gone", |s| {
            let g = generation(s);
            s.endpoint_changed(ACCOUNT, g, None);
            None
        }),
        ("server key changed", |s| {
            s.server_checked(ACCOUNT, Some("OTHER"));
            None
        }),
        ("missed x2", |s| {
            s.worker_observed(ACCOUNT, &[ACTIVE_AT + 1], LATER);
            s.worker_observed(ACCOUNT, &[ACTIVE_AT + 1], LATER);
            None
        }),
        ("reconcile", |s| {
            let g = generation(s);
            s.reconcile(&[(ACCOUNT.to_string(), g)], LATER);
            None
        }),
        ("reconcile +11 min", |s| {
            // 準備中のまま止まったと見なす猶予を過ぎてからの突き合わせ
            let g = generation(s);
            s.reconcile(&[(ACCOUNT.to_string(), g)], LATER + 11 * 60 * 1000);
            None
        }),
        ("cleanup done", |s| {
            let queue: Vec<Cleanup> = s.cleanup.clone();
            for c in queue {
                s.cleanup_progress(
                    &c.account_id,
                    c.generation,
                    notecore::push_state::CleanupDone {
                        unregister: true,
                        tombstone: true,
                        remove_instance: true,
                        failed: false,
                    },
                );
            }
            None
        }),
    ]
}

fn phase_text(s: &PushStore) -> String {
    let Some(a) = s.account(ACCOUNT) else {
        return "off".into();
    };
    let phase = match a.phase {
        Phase::Off => "off",
        Phase::Preparing => "preparing",
        Phase::Pending => "pending",
        Phase::Active => "active",
        Phase::NeedsReregistration => "needsRereg",
        Phase::Unregistering => "unregistering",
    };
    let reason = match a.reason {
        None => "",
        Some(Reason::EndpointChanged) => ":endpoint",
        Some(Reason::ServerChanged) => ":server",
        Some(Reason::Missing) => ":missing",
        Some(Reason::Migrated) => ":migrated",
    };
    format!("{phase}{reason} g{}", a.generation)
}

/// 後始末の 1 件 (U = 本家の解除 / T = 印の取り消し / R = 配送アプリから外す)
fn cleanup_text(c: &Cleanup) -> String {
    let mut steps = String::new();
    if c.unregister {
        steps.push('U');
    }
    if c.tombstone.is_some() {
        steps.push('T');
    }
    if c.remove_instance {
        steps.push('R');
    }
    format!("g{}:{steps}", c.generation)
}

fn cell(before: &PushStore, after: &PushStore, delivery: Option<Delivery>) -> String {
    let mut parts = vec![phase_text(after)];
    if let Some(d) = delivery {
        parts.push(
            match d {
                Delivery::Drop => "drop",
                Delivery::Show => "show",
                Delivery::Confirmed => "confirmed",
            }
            .into(),
        );
    }
    let queue: Vec<String> = after.cleanup.iter().map(cleanup_text).collect();
    let was: Vec<String> = before.cleanup.iter().map(cleanup_text).collect();
    if queue != was {
        parts.push(format!("queue[{}]", queue.join(" ")));
    }
    parts.join(" / ")
}

fn table() -> String {
    let mut out = String::from(
        "# push の状態の遷移表 (#330)。生成: crates/notecore/tests/push_state_golden.rs\n\
         # マス = 遷移後の状態 g世代 / 届いた push の扱い / 後始末のキュー (変わったときだけ。\n\
         # U = 本家の解除、T = 印の取り消し、R = 配送アプリから外す)\n",
    );
    for (start, store) in starts() {
        out.push_str(&format!("\n## {start} ({})\n", phase_text(&store)));
        for (name, event) in events() {
            let mut after = store.clone();
            let delivery = event(&mut after);
            out.push_str(&format!("{name:<20}→ {}\n", cell(&store, &after, delivery)));
        }
    }
    out
}

#[test]
fn transitions_match_golden() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/push_state_transitions.txt");
    let text = table();
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        std::fs::write(&path, &text).unwrap();
    }
    let golden = std::fs::read_to_string(&path).expect("golden がある");
    assert_eq!(text, golden, "UPDATE_GOLDEN=1 で書き直す");
}

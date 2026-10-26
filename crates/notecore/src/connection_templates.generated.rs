// 生成物 — 手で編集しない。正本は crates/notecore/connection_templates.json5、
// 生成は `pnpm gen:connection-templates` (scripts/gen-connection-templates.mjs)。
// 型は connection_templates.rs。TS 側 (src/data/connectionTemplates.generated.ts) と
// 同じ宣言から生成する (#1160)。

pub static CONNECTION_TEMPLATES: &[ConnectionTemplateDecl] = &[
    ConnectionTemplateDecl {
        id: "builtin:openai@1",
        allowed_hosts: &["api.openai.com"],
        affinity_header: None,
    },
    ConnectionTemplateDecl {
        id: "builtin:anthropic@1",
        allowed_hosts: &["api.anthropic.com"],
        affinity_header: None,
    },
    ConnectionTemplateDecl {
        id: "builtin:xai@1",
        allowed_hosts: &["api.x.ai"],
        affinity_header: None,
    },
    ConnectionTemplateDecl {
        id: "builtin:google@1",
        allowed_hosts: &["generativelanguage.googleapis.com"],
        affinity_header: None,
    },
    ConnectionTemplateDecl {
        id: "builtin:openrouter@1",
        allowed_hosts: &["openrouter.ai"],
        affinity_header: None,
    },
    ConnectionTemplateDecl {
        id: "builtin:opencode-go@1",
        allowed_hosts: &["opencode.ai"],
        affinity_header: Some("x-opencode-session"),
    },
    ConnectionTemplateDecl {
        id: "builtin:deepl@1",
        allowed_hosts: &["api-free.deepl.com", "api.deepl.com"],
        affinity_header: None,
    },
    ConnectionTemplateDecl {
        id: "builtin:saucenao@1",
        allowed_hosts: &["saucenao.com"],
        affinity_header: None,
    },
    ConnectionTemplateDecl {
        id: "builtin:todoist@1",
        allowed_hosts: &["api.todoist.com"],
        affinity_header: None,
    },
    ConnectionTemplateDecl {
        id: "builtin:clickup@1",
        allowed_hosts: &["api.clickup.com"],
        affinity_header: None,
    },
    ConnectionTemplateDecl {
        id: "builtin:hackerone@1",
        allowed_hosts: &["api.hackerone.com"],
        affinity_header: None,
    },
    ConnectionTemplateDecl {
        id: "builtin:wakatime@1",
        allowed_hosts: &["api.wakatime.com"],
        affinity_header: None,
    },
    ConnectionTemplateDecl {
        id: "builtin:steam@1",
        allowed_hosts: &["api.steampowered.com"],
        affinity_header: None,
    },
    ConnectionTemplateDecl {
        id: "builtin:shodan@1",
        allowed_hosts: &["api.shodan.io"],
        affinity_header: None,
    },
    ConnectionTemplateDecl {
        id: "builtin:habitica@1",
        allowed_hosts: &["habitica.com"],
        affinity_header: None,
    },
    ConnectionTemplateDecl {
        id: "builtin:commafeed@1",
        allowed_hosts: &["www.commafeed.com"],
        affinity_header: None,
    },
    ConnectionTemplateDecl {
        id: "builtin:mewk@1",
        allowed_hosts: &["mewk.app"],
        affinity_header: None,
    },
    ConnectionTemplateDecl {
        id: "builtin:vrchat@1",
        allowed_hosts: &["api.vrchat.cloud"],
        affinity_header: None,
    },
];

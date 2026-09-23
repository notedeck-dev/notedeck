use super::CmdContext;
use crate::error::NoteDeckError;
use crate::format::{
    print_action, print_emojis, print_note_compact, print_note_detail, print_notes,
    print_notifications, OutputFormat,
};
use crate::models::{CreateNoteParams, SearchOptions, TimelineKey, TimelineOptions};

pub async fn run_post(
    ctx: &CmdContext,
    text: &str,
    cw: Option<&str>,
    visibility: &str,
    reply_to: Option<&str>,
    local_only: bool,
) -> Result<(), NoteDeckError> {
    let params = CreateNoteParams {
        text: Some(text.to_string()),
        cw: cw.map(|s| s.to_string()),
        visibility: Some(visibility.to_string()),
        local_only: if local_only { Some(true) } else { None },
        mode_flags: None,
        reply_id: reply_to.map(|s| s.to_string()),
        renote_id: None,
        file_ids: None,
        poll: None,
        scheduled_at: None,
    };
    let note = ctx
        .client
        .create_note(&ctx.host, &ctx.token, &ctx.account.id, params)
        .await?;
    match ctx.fmt {
        OutputFormat::Json | OutputFormat::Jsonl => {
            println!("{}", serde_json::to_string(&note).unwrap());
        }
        OutputFormat::Ids => println!("{}", note.id),
        OutputFormat::Compact => print_note_compact(&note),
        OutputFormat::Default => {
            println!("Posted: https://{}/notes/{}", ctx.host, note.id);
        }
    }
    Ok(())
}

pub async fn run_timeline(
    ctx: &CmdContext,
    tl_type: &str,
    limit: i64,
) -> Result<(), NoteDeckError> {
    // parse により prefix 付きキー (antenna:{id} 等) もここから使える。
    // favorites / clip: は専用 API のため get_timeline 側で Err になる。
    let key = TimelineKey::parse(tl_type)?;
    let notes = ctx
        .client
        .get_timeline(
            &ctx.host,
            &ctx.token,
            &ctx.account.id,
            &key,
            TimelineOptions::new(limit, None, None),
        )
        .await?;
    print_notes(&notes, ctx.fmt);
    Ok(())
}

pub async fn run_search(ctx: &CmdContext, query: &str, limit: i64) -> Result<(), NoteDeckError> {
    let notes = ctx
        .client
        .search_notes(
            &ctx.host,
            &ctx.token,
            &ctx.account.id,
            query,
            SearchOptions::new(limit),
        )
        .await?;
    print_notes(&notes, ctx.fmt);
    Ok(())
}

pub async fn run_note(ctx: &CmdContext, id: &str) -> Result<(), NoteDeckError> {
    let note = ctx
        .client
        .get_note(&ctx.host, &ctx.token, &ctx.account.id, id)
        .await?;
    match ctx.fmt {
        OutputFormat::Json | OutputFormat::Jsonl => {
            println!("{}", serde_json::to_string(&note).unwrap());
        }
        OutputFormat::Ids => println!("{}", note.id),
        OutputFormat::Compact => print_note_compact(&note),
        OutputFormat::Default => print_note_detail(&note),
    }
    Ok(())
}

pub async fn run_replies(ctx: &CmdContext, id: &str, limit: i64) -> Result<(), NoteDeckError> {
    let notes = ctx
        .client
        .get_note_children(&ctx.host, &ctx.token, &ctx.account.id, id, limit as u32)
        .await?;
    print_notes(&notes, ctx.fmt);
    Ok(())
}

pub async fn run_thread(ctx: &CmdContext, id: &str, limit: i64) -> Result<(), NoteDeckError> {
    let notes = ctx
        .client
        .get_note_conversation(&ctx.host, &ctx.token, &ctx.account.id, id, limit as u32)
        .await?;
    print_notes(&notes, ctx.fmt);
    Ok(())
}

pub async fn run_delete(ctx: &CmdContext, id: &str) -> Result<(), NoteDeckError> {
    ctx.client.delete_note(&ctx.host, &ctx.token, id).await?;
    print_action(
        ctx.fmt,
        &format!(r#"{{"deleted":"{id}"}}"#),
        id,
        &format!("Deleted: {id}"),
    );
    Ok(())
}

pub async fn run_update(
    ctx: &CmdContext,
    id: &str,
    text: &str,
    cw: Option<&str>,
) -> Result<(), NoteDeckError> {
    let params = CreateNoteParams {
        text: Some(text.to_string()),
        cw: cw.map(|s| s.to_string()),
        visibility: None,
        local_only: None,
        mode_flags: None,
        reply_id: None,
        renote_id: None,
        file_ids: None,
        poll: None,
        scheduled_at: None,
    };
    ctx.client
        .update_note(&ctx.host, &ctx.token, id, params)
        .await?;
    print_action(
        ctx.fmt,
        &format!(r#"{{"updated":"{id}"}}"#),
        id,
        &format!("Updated: {id}"),
    );
    Ok(())
}

pub async fn run_react(
    ctx: &CmdContext,
    note_id: &str,
    reaction: &str,
) -> Result<(), NoteDeckError> {
    ctx.client
        .create_reaction(&ctx.host, &ctx.token, note_id, reaction)
        .await?;
    print_action(
        ctx.fmt,
        &format!(r#"{{"reacted":"{note_id}","reaction":"{reaction}"}}"#),
        note_id,
        &format!("Reacted {reaction} to {note_id}"),
    );
    Ok(())
}

pub async fn run_unreact(ctx: &CmdContext, note_id: &str) -> Result<(), NoteDeckError> {
    ctx.client
        .delete_reaction(&ctx.host, &ctx.token, note_id)
        .await?;
    print_action(
        ctx.fmt,
        &format!(r#"{{"unreacted":"{note_id}"}}"#),
        note_id,
        &format!("Unreacted from {note_id}"),
    );
    Ok(())
}

pub async fn run_renote(ctx: &CmdContext, note_id: &str) -> Result<(), NoteDeckError> {
    let params = CreateNoteParams {
        text: None,
        cw: None,
        visibility: Some("public".to_string()),
        local_only: None,
        mode_flags: None,
        reply_id: None,
        renote_id: Some(note_id.to_string()),
        file_ids: None,
        poll: None,
        scheduled_at: None,
    };
    let note = ctx
        .client
        .create_note(&ctx.host, &ctx.token, &ctx.account.id, params)
        .await?;
    match ctx.fmt {
        OutputFormat::Json | OutputFormat::Jsonl => {
            println!("{}", serde_json::to_string(&note).unwrap());
        }
        OutputFormat::Ids => println!("{}", note.id),
        OutputFormat::Compact => print_note_compact(&note),
        OutputFormat::Default => {
            println!("Renoted: https://{}/notes/{}", ctx.host, note.id);
        }
    }
    Ok(())
}

pub async fn run_notifications(ctx: &CmdContext, limit: i64) -> Result<(), NoteDeckError> {
    let notifications = ctx
        .client
        .get_notifications(
            &ctx.host,
            &ctx.token,
            &ctx.account.id,
            TimelineOptions::new(limit, None, None),
        )
        .await?;
    print_notifications(&notifications, ctx.fmt);
    Ok(())
}

pub async fn run_mentions(ctx: &CmdContext, limit: i64) -> Result<(), NoteDeckError> {
    let notes = ctx
        .client
        .get_mentions(
            &ctx.host,
            &ctx.token,
            &ctx.account.id,
            limit,
            None,
            None,
            None,
        )
        .await?;
    print_notes(&notes, ctx.fmt);
    Ok(())
}

pub async fn run_favorite(ctx: &CmdContext, note_id: &str) -> Result<(), NoteDeckError> {
    ctx.client
        .create_favorite(&ctx.host, &ctx.token, note_id)
        .await?;
    print_action(
        ctx.fmt,
        &format!(r#"{{"favorited":"{note_id}"}}"#),
        note_id,
        &format!("Favorited: {note_id}"),
    );
    Ok(())
}

pub async fn run_unfavorite(ctx: &CmdContext, note_id: &str) -> Result<(), NoteDeckError> {
    ctx.client
        .delete_favorite(&ctx.host, &ctx.token, note_id)
        .await?;
    print_action(
        ctx.fmt,
        &format!(r#"{{"unfavorited":"{note_id}"}}"#),
        note_id,
        &format!("Unfavorited: {note_id}"),
    );
    Ok(())
}

pub async fn run_favorites(ctx: &CmdContext, limit: i64) -> Result<(), NoteDeckError> {
    let notes = ctx
        .client
        .get_favorites(&ctx.host, &ctx.token, &ctx.account.id, limit, None, None)
        .await?;
    print_notes(&notes, ctx.fmt);
    Ok(())
}

pub async fn run_emojis(ctx: &CmdContext) -> Result<(), NoteDeckError> {
    let emojis = ctx.client.get_server_emojis(&ctx.host, &ctx.token).await?;
    print_emojis(&emojis, ctx.fmt);
    Ok(())
}

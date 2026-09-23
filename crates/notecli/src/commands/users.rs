use super::CmdContext;
use crate::error::NoteDeckError;
use crate::format::{oneline, print_action, print_notes, print_user_detail, OutputFormat};
use crate::models::{NormalizedUserDetail, TimelineOptions};

pub async fn run_user(ctx: &CmdContext, target: &str) -> Result<(), NoteDeckError> {
    let detail = resolve_and_get_user(ctx, target).await?;
    match ctx.fmt {
        OutputFormat::Json | OutputFormat::Jsonl => {
            println!("{}", serde_json::to_string(&detail).unwrap());
        }
        OutputFormat::Ids => println!("{}", detail.id),
        OutputFormat::Compact => {
            let host_str = detail.host.as_deref().unwrap_or("(local)");
            let name = detail.name.as_deref().unwrap_or(&detail.username);
            println!(
                "{}\t@{}@{}\t{}\tnotes:{}\tfollowing:{}\tfollowers:{}",
                detail.id,
                detail.username,
                host_str,
                oneline(name),
                detail.notes_count,
                detail.following_count,
                detail.followers_count
            );
        }
        OutputFormat::Default => print_user_detail(&detail),
    }
    Ok(())
}

pub async fn run_user_notes(
    ctx: &CmdContext,
    user_id: &str,
    limit: i64,
) -> Result<(), NoteDeckError> {
    let notes = ctx
        .client
        .get_user_notes(
            &ctx.host,
            &ctx.token,
            &ctx.account.id,
            user_id,
            TimelineOptions::new(limit, None, None),
        )
        .await?;
    print_notes(&notes, ctx.fmt);
    Ok(())
}

pub async fn run_follow(ctx: &CmdContext, user_id: &str) -> Result<(), NoteDeckError> {
    ctx.client
        .follow_user(&ctx.host, &ctx.token, user_id)
        .await?;
    print_action(
        ctx.fmt,
        &format!(r#"{{"followed":"{user_id}"}}"#),
        user_id,
        &format!("Followed: {user_id}"),
    );
    Ok(())
}

pub async fn run_unfollow(ctx: &CmdContext, user_id: &str) -> Result<(), NoteDeckError> {
    ctx.client
        .unfollow_user(&ctx.host, &ctx.token, user_id)
        .await?;
    print_action(
        ctx.fmt,
        &format!(r#"{{"unfollowed":"{user_id}"}}"#),
        user_id,
        &format!("Unfollowed: {user_id}"),
    );
    Ok(())
}

async fn resolve_and_get_user(
    ctx: &CmdContext,
    target: &str,
) -> Result<NormalizedUserDetail, NoteDeckError> {
    if let Some(rest) = target.strip_prefix('@') {
        let (username, user_host) = if let Some((u, h)) = rest.split_once('@') {
            (u, Some(h))
        } else {
            (rest, None)
        };
        let user = ctx
            .client
            .lookup_user(&ctx.host, &ctx.token, username, user_host)
            .await?;
        return ctx
            .client
            .get_user_detail(&ctx.host, &ctx.token, &ctx.account.id, &user.id)
            .await;
    }
    ctx.client
        .get_user_detail(&ctx.host, &ctx.token, &ctx.account.id, target)
        .await
}

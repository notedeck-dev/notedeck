use notecli::error::NoteDeckError;

use super::Result;

pub(crate) const VALID_AI_PROVIDERS: &[&str] = &["anthropic", "openai", "custom"];

pub(crate) fn validate_ai_provider(provider: &str) -> Result<()> {
    if VALID_AI_PROVIDERS.contains(&provider) {
        Ok(())
    } else {
        Err(NoteDeckError::InvalidInput(format!(
            "Unknown AI provider: {provider}"
        )))
    }
}

pub(crate) fn ai_keychain_id(provider: &str) -> String {
    format!("ai.{provider}")
}

/// Read an AI API key directly from the keychain (Rust-internal use).
/// Returns `None` if the entry is missing.
///
/// 旧来 `ai.<provider>` に保存していた AI API キーを読むのは、Vault 接続への
/// 移行 (`ai_migrate_provider_to_vault`、#564) のときだけ。新規書き込み経路は
/// もう存在しない (AI 設定は Vault 接続を選ぶ形に統合済み)。
pub(crate) fn read_ai_api_key(provider: &str) -> Result<Option<String>> {
    validate_ai_provider(provider)?;
    notecli::keychain::get_token(&ai_keychain_id(provider))
}

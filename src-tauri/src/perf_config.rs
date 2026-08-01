use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Performance configuration shared across the application.
/// All fields are dynamically updatable at runtime via Tauri commands.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct PerformanceConfig {
    pub memory_cache_max_total: usize,
    pub memory_cache_max_item: usize,
    pub max_concurrent_fetches: usize,
    pub rust_ogp_cache_max: usize,
    pub max_requests_per_window: usize,
    pub circuit_breaker_threshold: u32,
    pub circuit_breaker_duration: u64,
    pub image_cache_ttl_days: u64,
    /// ディスク画像キャッシュの上限バイト数。超過分は古い順に削除する
    pub image_cache_max_bytes: u64,
    /// 1 ファイルあたりの取得上限バイト数。超えるものは取得も配信もしない。
    /// 上げるほど大きな画像を扱えるが、プロキシは全バイトをメモリに載せるので
    /// そのぶんピークメモリが増える (モバイルでは特に効く)
    pub image_cache_max_file_bytes: u64,
}

impl Default for PerformanceConfig {
    fn default() -> Self {
        Self {
            memory_cache_max_total: 32 * 1024 * 1024, // 32MB
            memory_cache_max_item: 256 * 1024,        // 256KB
            max_concurrent_fetches: 30,
            rust_ogp_cache_max: 256,
            max_requests_per_window: 200,
            circuit_breaker_threshold: 5,
            circuit_breaker_duration: 60,
            image_cache_ttl_days: 7,
            image_cache_max_bytes: 512 * 1024 * 1024,
            image_cache_max_file_bytes: 20 * 1024 * 1024,
        }
    }
}

pub type SharedPerfConfig = Arc<RwLock<PerformanceConfig>>;

/// Tauri command: update performance config at runtime.
#[tauri::command]
#[specta::specta]
pub async fn update_performance_config(
    config: PerformanceConfig,
    state: tauri::State<'_, SharedPerfConfig>,
) -> Result<(), String> {
    let mut current = state.write().await;
    *current = config;
    Ok(())
}

/// Tauri command: get current performance config.
#[tauri::command]
#[specta::specta]
pub async fn get_performance_config(
    state: tauri::State<'_, SharedPerfConfig>,
) -> Result<PerformanceConfig, String> {
    Ok(state.read().await.clone())
}

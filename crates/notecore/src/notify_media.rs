//! OS 通知に添付するメディアの取得口。
//!
//! 通知画像 (アバター・リアクション絵文字) は WebView の外 (OS の通知
//! システム) で描画されるため WebView の画像プロキシを通せない。
//! かつては各プラットフォームが独自に fetch していた (Android は Kotlin の
//! HttpURLConnection で原寸 DL、デスクトップは os_notify 専用の reqwest) が、
//! ImageCache の防御 (ディスク/メモリキャッシュ・in-flight dedup・negative
//! cache・circuit breaker・サイズ上限) が一切効かない経路だった。ここに
//! 一元化し、消費者へはキャッシュ済みのローカルファイル/バイト列を渡す。
//! decode やプレゼンテーション変換 (円形クロップ・カンバス正規化) は
//! 各プラットフォームのデコーダに残す (アニメーション対応形式が違うため)。

use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tokio::task::JoinHandle;
use tokio::time::Instant;

use crate::image_cache::ImageCache;
use crate::media_proxy::MediaRequest;

/// リアクション通知に添付するカスタム絵文字画像の URL。
/// 本家 sw (create-notification.ts) と同じ `/emoji/<name>.webp` 形式で、
/// `@.` の local マーカーごとサーバーが解決する。Unicode 絵文字 (コロン
/// なし) は本文に出るので画像なし。パスは Url::set_path で percent-encode
/// する (リアクション文字列は untrusted なので生で埋め込まない)。
pub fn emoji_image_url(server_host: &str, reaction: &str) -> Option<String> {
    if reaction.len() <= 2 || !reaction.starts_with(':') || !reaction.ends_with(':') {
        return None;
    }
    let name = &reaction[1..reaction.len() - 1];
    let mut url = url::Url::parse(&format!("https://{server_host}")).ok()?;
    url.set_path(&format!("/emoji/{name}.webp"));
    Some(url.to_string())
}

/// url を ImageCache 経由で取得し、キャッシュ済みローカルファイルのパスを
/// 返す。`w` があれば静止画をサムネイル化した variant (webp) を指す。
/// アニメーションは変換で潰れるため素通しされ、原本のパスが返る。
/// 失敗はすべて None (画像なしで通知を出す)。
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub async fn ensure_local_file(cache: &ImageCache, url: &str, w: Option<u32>) -> Option<PathBuf> {
    let req = MediaRequest {
        url: url.to_string(),
        w,
        h: None,
        format: None,
        static_frame: false,
    };
    let key = req.cache_key();
    if let Some(entry) = cache.check_cache_only(&key).await {
        return Some(entry.path);
    }
    crate::media_proxy::ensure_media_inner(cache, &req)
        .await
        .ok()?;
    // ensure_media_inner は変換の要不要によらず必ず cache_key で永続化する
    // ので、直後の lookup はヒットする
    cache.check_cache_only(&key).await.map(|entry| entry.path)
}

/// 通知画像 1 枚の取得 (#1195)。結果は締切に関係なく slot に置かれ、取得は締切後も
/// 走り続けてキャッシュを温める (次の通知からは待たない)。
pub struct ImageJob {
    slot: Arc<Mutex<Option<PathBuf>>>,
    handle: Option<JoinHandle<()>>,
}

impl ImageJob {
    /// 今の時点で揃っている結果
    pub fn take(&self) -> Option<PathBuf> {
        self.slot.lock().ok().and_then(|s| s.clone())
    }

    /// 取得の完了まで待つ (巡回が終わる前にキャッシュへ書き終えるため)
    pub async fn finish(&mut self) {
        if let Some(handle) = self.handle.take() {
            let _ = handle.await;
        }
    }
}

/// 取得を runtime の task として始める。呼び出し側の future が締切で捨てられても続く
pub fn spawn_image_job<F>(fetch: F) -> ImageJob
where
    F: Future<Output = Option<PathBuf>> + Send + 'static,
{
    let slot = Arc::new(Mutex::new(None));
    let writer = slot.clone();
    let handle = tokio::spawn(async move {
        let result = fetch.await;
        if let Ok(mut s) = writer.lock() {
            *s = result;
        }
    });
    ImageJob {
        slot,
        handle: Some(handle),
    }
}

/// 締切まで取得の完了を待つ。全部終わればそこで返り、締切を過ぎたら揃った分だけで
/// 返る (描く時刻を決めるだけで、取得は打ち切らない)
pub async fn wait_until(deadline: Instant, jobs: &mut [ImageJob]) {
    let _ = tokio::time::timeout_at(deadline, async {
        for job in jobs.iter_mut() {
            if let Some(handle) = job.handle.as_mut() {
                let _ = handle.await;
                job.handle = None;
            }
        }
    })
    .await;
}

/// 締切までに揃った通知画像
#[derive(Debug, Default)]
pub struct PreparedImages {
    /// 大きいアイコン (アバター) のローカルファイル
    pub icon: Option<PathBuf>,
    /// 広げたときの画像 (リアクションのカスタム絵文字) のローカルファイル
    pub image: Option<PathBuf>,
}

/// 通知の画像 (アバター / 絵文字) を同時に取り、締切までに揃った分を返す (#1195)。
/// 3 つの届き方 (起動中 / 巡回 / push) が共通で使う。取得は締切後も続くので、
/// 返した job は呼び出し側が完了を待てる (巡回) し、捨ててもよい (起動中 / push)。
/// `icon_w` はアバターの縮小幅 (静止画のみ)。絵文字はアニメーション保持のため原本
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub async fn prepare_images(
    cache: Arc<ImageCache>,
    icon_url: Option<String>,
    image_url: Option<String>,
    icon_w: Option<u32>,
    deadline: Instant,
) -> (PreparedImages, Vec<ImageJob>) {
    let mut jobs = Vec::new();
    let mut icon_job = None;
    let mut image_job = None;
    if let Some(url) = icon_url {
        let cache = cache.clone();
        icon_job = Some(jobs.len());
        jobs.push(spawn_image_job(async move {
            ensure_local_file(&cache, &url, icon_w).await
        }));
    }
    if let Some(url) = image_url {
        let cache = cache.clone();
        image_job = Some(jobs.len());
        jobs.push(spawn_image_job(async move {
            ensure_local_file(&cache, &url, None).await
        }));
    }
    wait_until(deadline, &mut jobs).await;
    let prepared = PreparedImages {
        icon: icon_job.and_then(|i| jobs[i].take()),
        image: image_job.and_then(|i| jobs[i].take()),
    };
    (prepared, jobs)
}

/// url を ImageCache 経由で取得し、バイト列で返す (デスクトップの PNG
/// 再エンコード用)。失敗は None (画像なしで通知を出す)。
#[cfg_attr(not(any(target_os = "linux", target_os = "windows")), allow(dead_code))]
pub async fn ensure_bytes(cache: &ImageCache, url: &str) -> Option<Vec<u8>> {
    let req = MediaRequest {
        url: url.to_string(),
        w: None,
        h: None,
        format: None,
        static_frame: false,
    };
    crate::media_proxy::ensure_media_inner(cache, &req)
        .await
        .ok()
        .map(|(bytes, _content_type)| bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emoji_image_url_builds_sw_compatible_path() {
        assert_eq!(
            emoji_image_url("misskey.example", ":meow:").as_deref(),
            Some("https://misskey.example/emoji/meow.webp")
        );
        // local マーカー (@.) はサーバーが解決するのでそのまま渡す
        assert_eq!(
            emoji_image_url("misskey.example", ":meow@.:").as_deref(),
            Some("https://misskey.example/emoji/meow@..webp")
        );
        // リモート絵文字の host 部もパスとして素通し (本家 sw と同じ)
        assert_eq!(
            emoji_image_url("misskey.example", ":meow@remote.example:").as_deref(),
            Some("https://misskey.example/emoji/meow@remote.example.webp")
        );
    }

    #[test]
    fn emoji_image_url_rejects_non_custom_reactions() {
        assert_eq!(emoji_image_url("misskey.example", "🎉"), None);
        assert_eq!(emoji_image_url("misskey.example", "::"), None);
        assert_eq!(emoji_image_url("misskey.example", ":"), None);
        assert_eq!(emoji_image_url("misskey.example", ""), None);
    }

    #[test]
    fn emoji_image_url_percent_encodes_unsafe_chars() {
        // 名前に URL として不正な文字が混ざっても壊れた URL を作らない
        assert_eq!(
            emoji_image_url("misskey.example", ":a b:").as_deref(),
            Some("https://misskey.example/emoji/a%20b.webp")
        );
    }

    fn png_bytes(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([10, 20, 30, 255]));
        let mut buf = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .expect("encode png");
        buf
    }

    #[tokio::test]
    async fn ensure_local_file_returns_variant_and_original_paths() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(dir.path());
        let url = "https://e.com/a.png";
        // オリジナルをキャッシュ済みにしておく (ネットワーク不要で完結)
        cache
            .store_variant(url, png_bytes(200, 200), "image/png")
            .await;

        // w 指定 → リサイズ variant のパスが返り、実在する
        let variant = ensure_local_file(&cache, url, Some(64))
            .await
            .expect("variant path");
        assert!(variant.exists());

        // 変換なし → オリジナルのパス
        let original = ensure_local_file(&cache, url, None)
            .await
            .expect("original path");
        assert!(original.exists());
        assert_ne!(variant, original);
    }

    /// 締切は「描く時刻」を決めるだけで、取得は打ち切らない (#1195)。
    /// 速い方は締切内に揃い、遅い方は締切後も続いて最後まで完了する
    #[tokio::test(start_paused = true)]
    async fn wait_until_returns_at_deadline_and_keeps_slow_jobs_running() {
        let fast = spawn_image_job(async { Some(PathBuf::from("/fast")) });
        let slow = spawn_image_job(async {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            Some(PathBuf::from("/slow"))
        });
        let mut jobs = vec![fast, slow];
        let started = tokio::time::Instant::now();
        wait_until(started + std::time::Duration::from_secs(3), &mut jobs).await;
        assert_eq!(started.elapsed(), std::time::Duration::from_secs(3));
        assert_eq!(
            jobs[0].take().as_deref(),
            Some(std::path::Path::new("/fast"))
        );
        assert_eq!(jobs[1].take(), None, "締切に間に合わない画像は無しで描く");

        // 取得は続く: 完了を待てば遅い方も揃う (キャッシュが温まる)
        for job in &mut jobs {
            job.finish().await;
        }
        assert_eq!(
            jobs[1].take().as_deref(),
            Some(std::path::Path::new("/slow"))
        );
    }

    /// 全部が締切前に終われば締切まで待たない
    #[tokio::test(start_paused = true)]
    async fn wait_until_returns_early_when_all_jobs_finish() {
        let mut jobs = vec![spawn_image_job(async { None })];
        let started = tokio::time::Instant::now();
        wait_until(started + std::time::Duration::from_secs(3), &mut jobs).await;
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
    }

    /// 取得できない URL は締切を待たずに無しで返る
    #[tokio::test]
    async fn prepare_images_fails_closed_without_waiting_for_the_deadline() {
        let dir = tempfile::tempdir().unwrap();
        let cache = std::sync::Arc::new(ImageCache::new(dir.path()));
        let started = std::time::Instant::now();
        let (prepared, jobs) = prepare_images(
            cache,
            Some("https://localhost/a.png".to_string()),
            Some("https://localhost/e.webp".to_string()),
            Some(64),
            tokio::time::Instant::now() + std::time::Duration::from_secs(5),
        )
        .await;
        assert!(prepared.icon.is_none() && prepared.image.is_none());
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
        for mut job in jobs {
            job.finish().await;
        }
    }

    #[tokio::test]
    async fn ensure_local_file_fails_closed_on_unfetchable_url() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(dir.path());
        // 未キャッシュ + SSRF ガードで弾かれる host → None (画像なしで通知)
        assert!(ensure_local_file(&cache, "https://localhost/x.png", None)
            .await
            .is_none());
    }
}

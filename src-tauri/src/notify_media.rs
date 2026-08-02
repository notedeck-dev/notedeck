//! OS 通知に添付するメディアの取得口。
//!
//! 通知画像 (アバター・リアクション絵文字) は WebView の外 (OS の通知
//! システム) で描画されるため custom protocol (`ndmedia`) を通せない。
//! かつては各プラットフォームが独自に fetch していた (Android は Kotlin の
//! HttpURLConnection で原寸 DL、デスクトップは os_notify 専用の reqwest) が、
//! ImageCache の防御 (ディスク/メモリキャッシュ・in-flight dedup・negative
//! cache・circuit breaker・サイズ上限) が一切効かない経路だった。ここに
//! 一元化し、消費者へはキャッシュ済みのローカルファイル/バイト列を渡す。
//! decode やプレゼンテーション変換 (円形クロップ・カンバス正規化) は
//! 各プラットフォームのデコーダに残す (アニメーション対応形式が違うため)。

use std::path::PathBuf;

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

/// url を ImageCache 経由で取得し、バイト列で返す (デスクトップの PNG
/// 再エンコード用)。失敗は None (画像なしで通知を出す)。
#[cfg_attr(not(any(target_os = "linux", target_os = "windows")), allow(dead_code))]
pub async fn ensure_bytes(cache: &ImageCache, url: &str) -> Option<Vec<u8>> {
    let req = MediaRequest {
        url: url.to_string(),
        w: None,
        h: None,
        format: None,
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

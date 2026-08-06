import { usePerformanceStore } from '@/stores/performance'

/**
 * 画像・効果音プロキシの WebView 側の口 (#921 Phase 3)。
 *
 * 全プラットフォームで内蔵 HTTP サーバー (`127.0.0.1:19820/proxy/image`) に
 * 一本化している。以前は custom protocol `ndmedia:` を使っていたが、
 * wry Android は全 custom protocol リクエストが単一ロックで直列化されるため
 * 構造的に遅く、それを補う二段階配信 (プレースホルダ + 完了イベント +
 * 再要求) とフロント側の自己修復機構 (世代番号・バックオフ・1×1 検知・
 * 全画像監視) が 4 層積み重なっていた。ループバック HTTP なら WebView の
 * 並列ネットワークスタックとブラウザキャッシュが使え、プロキシは本物が
 * 用意できるまでブロックして返せるので、その全部が不要になる。
 *
 * - Android の cleartext-to-localhost は networkSecurityConfig で許可
 *   (src-tauri/android/)
 * - macOS/iOS の ATS は NSAllowsLocalNetworking で許可 (src-tauri/Info.plist)
 * - バックエンドは ImageCache (リサイズ・ディスクキャッシュ・サーキット
 *   ブレーカー・オフライン配信) — 経路によらず共通
 * - 失敗時の見た目のフォールバック (unknown アイコン等) は各コンポーネントの
 *   @error に残る。再試行はブラウザの通常のナビゲーション・再描画に任せる
 */
const HTTP_MEDIA_BASE = 'http://127.0.0.1:19820/proxy/image'

const proxyUrlCache = new Map<string, string>()

function getProxyCacheMax(): number {
  try {
    return usePerformanceStore().get('imageProxyCacheMax')
  } catch {
    return 256
  }
}

/** URL 文字列キャッシュの上限追い出し (最古 1 件、#893) */
function evictOldestIfFull(map: Map<string, unknown>, key: string) {
  if (map.has(key) || map.size < getProxyCacheMax()) return
  const oldest = map.keys().next().value
  if (oldest !== undefined) map.delete(oldest)
}

function buildProxyUrl(
  url: string | null | undefined,
  sizeQuery?: string,
): string | undefined {
  if (!url?.startsWith('https://')) return url ?? undefined
  const key = sizeQuery ? `${url}|${sizeQuery}` : url
  let cached = proxyUrlCache.get(key)
  if (!cached) {
    evictOldestIfFull(proxyUrlCache, key)
    cached = `${HTTP_MEDIA_BASE}?url=${encodeURIComponent(url)}${sizeQuery ? `&${sizeQuery}` : ''}`
    proxyUrlCache.set(key, cached)
  }
  return cached
}

/** 変換なしのプロキシ URL (効果音・原寸画像)。https 以外は素通し */
export function proxyUrl(url: string | null | undefined): string | undefined {
  return buildProxyUrl(url)
}

/**
 * 表示サイズが元画像よりずっと小さい面 (アバター・アイコン) 用のリサイズ付き URL。
 *
 * `format` は付けない。リサイズが必要な画像はプロキシ側が WebP で返すし、
 * format を明示すると「既に上限以下なので変換不要」の判定が使えなくなる
 * (明示された形式は尊重しなければならないため)。Misskey のアバターは
 * サーバー側で縮小済みのことが多く、その素通しが効くかどうかで
 * モバイルの初回表示が変わる。
 */
export function proxyThumbUrl(
  url: string | null | undefined,
  width: number,
): string | undefined {
  return buildProxyUrl(url, `w=${width}`)
}

/**
 * CSS の `url()` 値としてプロキシ URL を返す (#979)。
 *
 * ストア配布物 (プラグイン・ウィジェット・クエリ・スキル) のアイコンは
 * 第三者がメタデータで URL を指定できる。文字列補間で `url('...')` を
 * 組み立てると、クォートを含む値で url() を閉じて別のプロパティを
 * 注入できてしまうため、**プロキシを通った URL だけ**を CSS に入れる。
 *
 * `buildProxyUrl` は https 以外を素通しするが、素通し URL は CSS に
 * 渡さず `none` に倒す。配布元ホストへ直接リクエストが飛ぶのを防ぐ
 * (相手に「いつ誰が開いたか」と IP が見える) のが本来の目的なので、
 * プロキシに乗らない URL は表示しないのが正しい。
 */
export function proxyCssUrl(
  url: string | null | undefined,
  width: number,
): string {
  const proxied = proxyThumbUrl(url, width)
  if (!proxied?.startsWith(HTTP_MEDIA_BASE)) return 'none'
  return `url("${proxied}")`
}

/**
 * カスタム絵文字の共通サムネイル口。
 *
 * 本家 media-proxy の `emoji=1` と同じ「最大高さ 128px」基準 (#921)。
 * 絵文字は横長が普通に存在する資産なので、幅で丸めると高さが潰れて
 * 表示 (2em × DPR、MFM の $[x2] 等) の引き伸ばしで荒れる。128px は
 * 2em × DPR3 を賄い、全文脈 (ノート本文/ピッカー/リアクション面) で
 * 同じ variant キャッシュを共有する。
 * アニメ絵文字はプロキシ側が変換を素通しするので壊れない。
 */
export function proxyEmojiUrl(
  url: string | null | undefined,
): string | undefined {
  return buildProxyUrl(url, 'h=128')
}

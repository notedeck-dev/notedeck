import { onMounted, ref } from 'vue'

const RELEASES_LATEST =
  'https://github.com/notedeck-dev/notedeck/releases/latest'

/**
 * ダウンロードカードが解決したい配布物。名前の末尾でリリースアセットを引き当てる。
 * Android は ABI 別に複数の APK があるので、実機の大半を占める arm64 を固定で指す
 * (末尾 `.apk` だと名前順で先頭の APK が拾われ、どの ABI になるかが順序依存になる)。
 */
const ASSET_SUFFIX = {
  windows: '-setup.exe',
  macos: '.dmg',
  linux: '.deb',
  android: '-android-arm64.apk',
} as const

export type PlatformKey = keyof typeof ASSET_SUFFIX

/**
 * GitHub Releases API から最新版のタグと各プラットフォームの直リンクを引く。
 * 取れなければ /releases/latest のままにしておく (fallback)。
 */
export function useLatestRelease() {
  const version = ref('')
  const noticeText = ref('最新リリースを見る')
  const noticeHref = ref(RELEASES_LATEST)
  const downloadUrls = ref<Partial<Record<PlatformKey, string>>>({})

  onMounted(async () => {
    try {
      const res = await fetch(
        'https://api.github.com/repos/notedeck-dev/notedeck/releases/latest',
      )
      const release = await res.json()

      if (release.tag_name) {
        version.value = release.tag_name
        noticeText.value = `${release.tag_name} をリリースしました`
        if (release.html_url) noticeHref.value = release.html_url
      }

      const assets: { name: string; browser_download_url: string }[] =
        release.assets ?? []
      const resolved: Partial<Record<PlatformKey, string>> = {}
      for (const [platform, suffix] of Object.entries(ASSET_SUFFIX)) {
        const asset = assets.find((a) => a.name.endsWith(suffix))
        if (asset) resolved[platform as PlatformKey] = asset.browser_download_url
      }
      downloadUrls.value = resolved
    } catch {
      /* fallback: リンクは /releases/latest のまま */
    }
  })

  return { version, noticeText, noticeHref, downloadUrls, RELEASES_LATEST }
}

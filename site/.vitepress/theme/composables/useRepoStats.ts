import { onMounted, ref } from 'vue'

const API = 'https://api.github.com/repos/notedeck-dev/notedeck'

export type RepoStats = {
  stars: number
  releases: number
  downloads: number
}

/**
 * Hub の stats (Notes / Users / Servers) にあたる、リポジトリの実績を GitHub API から引く。
 * Star 数はリポジトリ本体、リリース数とダウンロード数はリリース一覧を数える。
 * 取れなければ null のまま — 表示側は Hub と同じく丸ごと隠す。
 */
export function useRepoStats() {
  const stats = ref<RepoStats | null>(null)

  onMounted(async () => {
    try {
      const repo = await (await fetch(API)).json()
      if (typeof repo.stargazers_count !== 'number') return

      let releases = 0
      let downloads = 0
      // 未認証の API は 1 ページ 100 件まで。数ページで打ち切る (件数が増えたら下限表示になるだけ)
      for (let page = 1; page <= 5; page++) {
        const res = await fetch(`${API}/releases?per_page=100&page=${page}`)
        if (!res.ok) break
        const list: { assets?: { download_count?: number }[] }[] = await res.json()
        releases += list.length
        for (const release of list) {
          for (const asset of release.assets ?? []) downloads += asset.download_count ?? 0
        }
        if (list.length < 100) break
      }

      stats.value = { stars: repo.stargazers_count, releases, downloads }
    } catch {
      /* 取れなければ stats は出さない */
    }
  })

  return { stats }
}

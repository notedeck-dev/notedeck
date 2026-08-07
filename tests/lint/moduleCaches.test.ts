// 「キャッシュには必ず上限」を機械検査に落とす (#987)。
//
// 長時間起動でメモリが単調増加した経路は、どれも同じ形で入っていた:
// モジュールスコープに空の Map を置き、delete を書き忘れる。レビューで
// 気づける保証は無いので、新しく置かれた時点でここが落ちるようにする。
//
// 検査対象は .ts の **空で初期化される** モジュールスコープの Map/Set だけ。
//   - リテラルで初期化されるもの (`new Set(['a', 'b'])`) は固定集合で育たない
//   - .vue のトップレベルはコンポーネント寿命なのでアンマウントで消える
//     (ただし常時開かれるカラムは実質モジュールスコープと同じ寿命になる。
//      DeckNotificationColumn の reaction URL キャッシュはそれで無制限に
//      育っていた — 検査に頼らず、面の寿命を見て判断すること)
//
// 新しく足したものがここで落ちたら、まず `createBoundedCache` に載せられ
// ないかを検討する。載らないなら、なぜ有界なのかを一言添えて ALLOWED に
// 足す。「なんとなく大丈夫」で足さない。

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const SRC = join(ROOT, 'src')

/**
 * 棚卸し済みのモジュールスコープ Map/Set。値はなぜ無制限に育たないか。
 *
 * - bounded  : 件数の上限がある
 * - lifecycle: 登録/解除・完了・発火で必ず消える
 * - keyed    : キー空間が有限 (アカウント・カラム・ホスト・種別など)
 */
const ALLOWED: Record<string, string> = {
  // bounded — 上限つき
  'src/utils/dedup.ts:responseCache': 'bounded: TTL + 閾値超過で期限切れを掃除',
  'src/utils/mediaProxy.ts:proxyUrlCache': 'bounded: imageProxyCacheMax',
  'src/utils/mfm.ts:parseCache': 'bounded: mfmCacheMax',
  'src/utils/mfm.ts:parseCacheMd': 'bounded: mfmCacheMax',
  'src/utils/formatTime.ts:parsedCache': 'bounded: 分が変わるたび clear',
  'src/composables/useNoteSound.ts:bufferCache': 'bounded: soundCacheMax',
  'src/composables/useNoteSound.ts:audioElCache': 'bounded: soundCacheMax',
  'src/composables/useOgpPreview.ts:ogpCache': 'bounded: ogpCacheMax',
  'src/composables/useImagePrefetch.ts:prefetchedUrls':
    'bounded: prefetchTrackedMax',
  'src/composables/useSnapshotStore.ts:store':
    'bounded: TTL 超過で削除 + カラム破棄で削除',
  'src/services/entityResolution.ts:resolutionCache':
    'bounded: MAX_CACHE_ENTRIES',

  // lifecycle — 完了・解除・発火で消える
  'src/services/boundedCache.ts:registry':
    'lifecycle: WeakRef 保持 — 参照切れは登録時と一覧読み取り時に掃除 (#977 観測レジストリ)',
  'src/utils/dedup.ts:inflight': 'lifecycle: finally で削除',
  'src/utils/highlight.ts:pendingLangs': 'lifecycle: ロード完了で削除',
  'src/composables/useOgpPreview.ts:pendingRequests':
    'lifecycle: 取得完了で削除',
  'src/utils/desktopNotification.ts:pendingContexts':
    'lifecycle: 通知のクリック/クローズで削除',
  'src/utils/startupTrace.ts:marks': 'lifecycle: 起動時の計測点のみ',
  'src/stores/toast.ts:timers': 'lifecycle: 発火・破棄で削除',
  'src/composables/useMemos.ts:writeTimers': 'lifecycle: 書き込み完了で削除',
  'src/composables/usePipWindow.ts:pipWindows':
    'lifecycle: ウィンドウを閉じると削除',
  'src/composables/usePipWindow.ts:creatingSet': 'lifecycle: 生成完了で削除',
  'src/composables/useDeckWindow.ts:openWindows':
    'lifecycle: ウィンドウを閉じると削除',
  'src/adapters/factory.ts:adapterPending': 'lifecycle: 初期化完了で削除',
  'src/aiscript/plugin-api.ts:pluginContexts':
    'lifecycle: プラグイン停止で削除',
  'src/aiscript/plugin-api.ts:pluginAccountContext':
    'lifecycle: プラグイン停止で削除',
  'src/aiscript/plugin-api.ts:pluginNdContexts':
    'lifecycle: プラグイン停止で削除',
  'src/aiscript/plugin-api.ts:pluginRunLoggers':
    'lifecycle: プラグイン停止で削除',
  'src/aiscript/plugin-api.ts:pluginContextQueues':
    'lifecycle: プラグイン停止で削除',
  'src/aiscript/events.ts:emitterHandlers': 'lifecycle: 購読解除で削除',
  'src/aiscript/events.ts:noteHandlers': 'lifecycle: 購読解除で削除',
  'src/aiscript/events.ts:notificationHandlers': 'lifecycle: 購読解除で削除',
  'src/aiscript/lsp/worker.ts:documents': 'lifecycle: エディタを閉じると削除',
  'src/aiscript/lsp/worker.ts:diagnosticTimers': 'lifecycle: 発火で削除',
  'src/core/queryDeltaBus.ts:handlers': 'lifecycle: 購読解除で削除',

  // keyed — キー空間が有限
  'src/adapters/registry.ts:registry': 'keyed: サーバーソフトウェアの種類',
  'src/adapters/factory.ts:adapterCache': 'keyed: アカウント',
  'src/capabilities/registry.ts:capabilities': 'keyed: 登録済み capability',
  'src/commands/taskCommands.ts:registeredIds': 'keyed: 登録済みタスク',
  'src/core/queryRegistry.ts:entriesByQueryId': 'keyed: 登録済みクエリ',
  'src/composables/useAds.ts:adsCache': 'keyed: アカウント',
  'src/composables/useLoginPrompt.ts:reloginPromptShownAt': 'keyed: アカウント',
  'src/composables/useUnreadCounter.ts:sharedStates': 'keyed: カラム',
  'src/composables/useNoteSound.ts:failedHosts': 'keyed: ホスト',
  'src/utils/customTimelines.ts:customTlMemCache': 'keyed: アカウント',
  'src/utils/customTimelines.ts:availableTlCache': 'keyed: アカウント',
  'src/utils/customTimelines.ts:runtimeDenied': 'keyed: アカウント',
  'src/utils/customTimelines.ts:filterKeyCache': 'keyed: タイムライン種別',
  'src/aiscript/codemirror/completions.ts:nsMemberCompletions':
    'keyed: AiScript の名前空間',
  'src/services/entityResolution.ts:NO_LIVE_KEYS': 'keyed: 常に空の番人',
}

function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return collect(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [path]
      : []
  })
}

/**
 * 行頭 (= モジュールスコープ) の、空で初期化される Map/Set。
 * 型引数が複数行に折り返されることがあるので改行も跨いで見る
 */
const EMPTY_COLLECTION =
  /^(?:const|let) ([A-Za-z_$][\w$]*)(?:\s*:[^=]+?)? = new (?:Map|Set|WeakMap|WeakSet)(?:<[\s\S]*?>)?\(\)/gm

const found = collect(SRC).flatMap((file) => {
  const path = relative(ROOT, file)
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(EMPTY_COLLECTION)].map((m) => `${path}:${m[1]}`)
})

describe('モジュールスコープのキャッシュ (#987)', () => {
  it('検査対象を取りこぼしていない', () => {
    expect(found.length).toBeGreaterThan(30)
  })

  it('すべて棚卸し済み (上限か、消える保証があること)', () => {
    const unlisted = found.filter((entry) => !(entry in ALLOWED)).sort()
    expect(unlisted).toEqual([])
  })

  it('棚卸し表に実在しないエントリが残っていない', () => {
    const stale = Object.keys(ALLOWED)
      .filter((entry) => !found.includes(entry))
      .sort()
    expect(stale).toEqual([])
  })
})

import {
  type AdapterFactoryDeps,
  configureAdapterFactory,
} from '@/adapters/factory'
import { useEmojisStore } from '@/stores/emojis'
import { usePinnedReactionsStore } from '@/stores/pinnedReactions'
import { useServersStore } from '@/stores/servers'

/**
 * adapter の factory に渡す store 側の仕事 (#1098)。起動時 (main.ts) と
 * カラムの dom テスト (columnTestKit) が `wireAdapterFactory` で繋ぐ。
 * 副作用は冪等: 絵文字辞書はホストごと、ピン留めリアクションはアカウントごとに
 * 一度だけ取りに行く
 */
export function wireAdapterFactory(): void {
  configureAdapterFactory(adapterFactoryDeps())
}

function adapterFactoryDeps(): AdapterFactoryDeps {
  return {
    getServerInfo: (host) => useServersStore().getServerInfo(host),
    onAdapterReady(adapter, { host, accountId, hasToken }, options) {
      useEmojisStore().ensureLoaded(host, (opts) =>
        adapter.api.getServerEmojis(opts),
      )
      if (hasToken && options?.pinnedReactions !== false) {
        usePinnedReactionsStore().ensureLoaded(accountId, () =>
          adapter.api.getPinnedReactions(),
        )
      }
    },
  }
}

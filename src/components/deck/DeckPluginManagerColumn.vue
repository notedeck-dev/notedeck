<script setup lang="ts">
import { computed, ref } from 'vue'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { i18n } from '@/i18n'
import { getPluginDenial } from '@/permissions/pluginDenials'
import { hasScopeTarget, type ScopeTarget } from '@/services/distributable'
import { readOnlyReason } from '@/services/sidecarFileCollection'
import { isExposed } from '@/settings/exposure'
import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import {
  getPluginDetailUrl,
  PLUGIN_CATEGORY_LABELS,
  type StorePluginEntry,
  useMisStoreStore,
} from '@/stores/misstore'
import { type PluginItem, usePluginsStore } from '@/stores/plugins'
import { useToast } from '@/stores/toast'
import { useWindowsStore } from '@/stores/windows'
import { openSafeUrl } from '@/utils/url'
import DeckDistributableColumn, {
  type EnabledFilterDecl,
  type StoreFeedDecl,
} from './DeckDistributableColumn.vue'
import PluginCard from './PluginCard.vue'
import {
  type CapabilityCheck,
  checkKnownCapabilities,
} from './widgets/capabilities'

/**
 * プラグイン管理カラム。殻は `DeckDistributableColumn` (#1202 段階 3)。
 * ここにあるのはプラグイン固有の意味だけ: スコープ別プール (#771)、起動 /
 * 停止を伴う有効切替 (store の hook)、権限の拒否バッジ、ストア由来の表示名補完
 */

const props = defineProps<{
  column: DeckColumnType
}>()

const pluginsStore = usePluginsStore()
const windowsStore = useWindowsStore()
const misStore = useMisStoreStore()
const accountsStore = useAccountsStore()
// 殻も setup するが、共通基盤の契約 (#1098 §4) はこのカラムでも結ぶ
useColumnSetup(() => props.column)

pluginsStore.ensureLoaded()
// Store メタデータをインストール済みカードの表示にも使うため事前取得（TTL キャッシュあり）
const pluginFeed = misStore.feed('plugin')
pluginFeed.fetch()

const shell = ref<{ closePicker(): void } | null>(null)

const storeByName = computed(() => {
  const map = new Map<string, StorePluginEntry>()
  for (const entry of pluginFeed.entries) map.set(entry.name, entry)
  return map
})

// --- スコープ (per-account / 全アカウント) ---
const isCrossAccount = computed(() => props.column.accountId == null)
const account = computed(() =>
  isCrossAccount.value
    ? null
    : (accountsStore.accounts.find((a) => a.id === props.column.accountId) ??
      null),
)
/**
 * このカラムが管理するスコープ (#771)。全アカウントカラムは全体、per-account
 * カラムは当該アカウント。アカウントが見つからない (ログアウト済) なら null
 */
const columnScope = computed<ScopeTarget | null>(() => {
  if (isCrossAccount.value) return { kind: 'global' }
  if (!account.value) return null
  return { kind: 'account', key: accountScopeKey(account.value) }
})

function matchesContext(plugin: PluginItem): boolean {
  const scope = columnScope.value
  return scope ? hasScopeTarget(plugin.scope, scope) : false
}

/** カラムのスコープに参加している本体 (スコープ別プール) */
const scopedPlugins = computed(() =>
  pluginsStore.items.filter((p) => matchesContext(p)),
)

/** このカラムのスコープに未参加のライブラリ本体 (= 追加可能候補)。 */
const libraryCandidates = computed(() =>
  pluginsStore.items.filter((p) => !matchesContext(p)),
)

const enabledFilter: EnabledFilterDecl<PluginItem> = {
  get enabledTitle() {
    return i18n.ts._deckPluginManagerColumn.enabledPlugins
  },
  get disabledTitle() {
    return i18n.ts._deckPluginManagerColumn.disabledPlugins
  },
  isEnabled: (p) => p.extra.active,
}

const texts = computed(() => ({
  noMatches: i18n.ts._deckPluginManagerColumn.noMatches,
  empty: i18n.ts._deckPluginManagerColumn.emptyInColumn,
  noLibrary: i18n.ts._deckPluginManagerColumn.noLibraryCandidates,
}))

const storeFeed = computed<StoreFeedDecl<StorePluginEntry>>(() => ({
  entries: pluginFeed.entries,
  loading: pluginFeed.loading,
  error: pluginFeed.error,
  fetch: pluginFeed.fetch,
  refresh: pluginFeed.refresh,
}))

// 未知 capability を宣言するエントリは install 不可 (要 NoteDeck アップデート)。
// widget と違いカラム文脈 (accountId) の条件は無く、実行時の認可は
// permissions.json5 の plugin principal 側で gate される。
const capabilityChecks = computed<Record<string, CapabilityCheck>>(() => {
  const result: Record<string, CapabilityCheck> = {}
  for (const p of pluginFeed.entries) {
    result[p.id] = checkKnownCapabilities(p.capabilities ?? [])
  }
  return result
})

// --- 導入済みの操作 ---

/** 有効 / 無効の切替。起動 / 停止は store の hook が行う */
async function toggleActive(plugin: PluginItem) {
  if (!(await pluginsStore.setEnabled(plugin.id, !plugin.extra.active))) {
    // 読取専用 (ソース欠損) は保存されず巻き戻る。起動もしない (#1111)
    useToast().show(readOnlyReason(), 'warning')
  }
}

function openPluginDetail(pluginId: string) {
  windowsStore.open('plugins', {
    initialPluginId: pluginId,
    ...(columnScope.value ? { initialScope: columnScope.value } : {}),
  })
}

/**
 * プラグインを「作る」面は開発者モードに従う (#1034)。導入・実行・on/off・
 * 削除は一般側なので、隠れるのは新規作成の入口とソース編集タブだけ。
 */
const canCreate = computed(() => isExposed('developer'))

function openNewPlugin() {
  windowsStore.open('plugins', {
    ...(columnScope.value ? { initialScope: columnScope.value } : {}),
  })
}

/**
 * カードの「外す」= このカラムのスコープから外す (widgets の detach と同型)。
 * 本体はライブラリに残り、ピッカーから再追加/完全削除できる。可逆なので
 * 確認は挟まず undo トーストで戻せるようにする (#1048)。
 */
async function detachFromScope(plugin: PluginItem) {
  const scope = columnScope.value
  if (!scope) return
  if (!(await pluginsStore.unlink(plugin.id, scope))) {
    useToast().show(readOnlyReason(), 'warning')
    return
  }
  useToast().show(i18n.ts._deckPluginManagerColumn.detached, 'info', {
    action: {
      label: i18n.ts._common.undo,
      onClick: () => void pluginsStore.link(plugin.id, scope),
    },
  })
}

const detachTitle = computed(() =>
  isCrossAccount.value
    ? i18n.ts._deckPluginManagerColumn.detachFromAllAccounts
    : i18n.ts._common.detachFromAccount,
)

async function placeFromLibrary(plugin: PluginItem) {
  const scope = columnScope.value
  if (!scope) return
  if (!(await pluginsStore.link(plugin.id, scope))) {
    useToast().show(readOnlyReason(), 'warning')
    return
  }
  shell.value?.closePicker()
}

const { confirm } = useConfirm()

/** ライブラリから本体ごと削除 (コードも消える)。停止は store の hook が行う */
async function deleteFromLibrary(plugin: PluginItem) {
  const ok = await confirm({
    title: i18n.ts._deckPluginManagerColumn.deleteTitle,
    message: i18n.tsx._deckPluginManagerColumn.deleteConfirm({
      name: plugin.name,
    }),
    okLabel: i18n.ts._common.delete,
    type: 'danger',
  })
  if (!ok) return
  const undo = await pluginsStore.remove(plugin.id)
  if (undo) {
    useToast().show(i18n.ts._deckPluginManagerColumn.deleted, 'info', {
      action: { label: i18n.ts._common.undo, onClick: undo },
    })
  }
}

// --- ストア ---

/** 本体はライブラリに 1 つ。既にあればこのカラムのスコープへ参照追加、無ければ取得してこのスコープで有効化 (#771) */
function installEntry(
  entry: StorePluginEntry,
  run: (action: () => Promise<unknown>) => Promise<void>,
) {
  const scope = columnScope.value
  if (!scope) return
  void run(() => misStore.install('plugin', entry, [scope]))
}

function openStoreDetail(entry: StorePluginEntry) {
  openSafeUrl(getPluginDetailUrl(entry.id))
}

// 拒否バッジのクリック → 権限ウィンドウの plugin 行 (#712 §8.4)
function openPermissionSettings(): void {
  windowsStore.open('permissions')
}
</script>

<template>
  <DeckDistributableColumn
    ref="shell"
    :column="column"
    :title="i18n.ts._columns.pluginManager"
    icon="puzzle"
    :safe-mode-subject="i18n.ts._deckPluginManagerColumn.safeModeSubject"
    :create-title="i18n.ts._deckPluginManagerColumn.create"
    :can-create="canCreate"
    :items="scopedPlugins"
    :search-placeholder="i18n.ts._deckPluginManagerColumn.searchInstalled"
    :search-text="(p) => [p.name, p.description, p.extra.author]"
    :enabled-filter="enabledFilter"
    :library-candidates="libraryCandidates"
    :texts="texts"
    :store="storeFeed"
    @create="openNewPlugin"
  >
    <template #card="{ item: plugin, mode }">
      <PluginCard
        v-if="mode === 'installed'"
        mode="installed"
        :name="plugin.name"
        :description="storeByName.get(plugin.name)?.description ?? plugin.description"
        :author="storeByName.get(plugin.name)?.author ?? plugin.extra.author"
        :version="plugin.extra.version"
        :category="storeByName.get(plugin.name)?.category"
        :category-label="storeByName.get(plugin.name)?.category ? PLUGIN_CATEGORY_LABELS[storeByName.get(plugin.name)!.category] : undefined"
        :active="plugin.extra.active"
        :read-only="plugin.readOnly"
        :detach-title="detachTitle"
        :icon-url="plugin.iconUrl ?? storeByName.get(plugin.name)?.iconUrl"
        :denied-badge="getPluginDenial(plugin.id)"
        @click="openPluginDetail(plugin.id)"
        @toggle="toggleActive(plugin)"
        @detach="detachFromScope(plugin)"
        @settings="openPluginDetail(plugin.id)"
        @denied-click="openPermissionSettings()"
      />
      <PluginCard
        v-else
        mode="library"
        :name="plugin.name"
        :description="storeByName.get(plugin.name)?.description ?? plugin.description"
        :author="storeByName.get(plugin.name)?.author ?? plugin.extra.author"
        :version="plugin.extra.version"
        :icon-url="plugin.iconUrl ?? storeByName.get(plugin.name)?.iconUrl"
        :read-only="plugin.readOnly"
        @click="openPluginDetail(plugin.id)"
        @place="placeFromLibrary(plugin)"
        @delete="deleteFromLibrary(plugin)"
      />
    </template>

    <template #store-card="{ entry, run }">
      <PluginCard
        mode="store"
        :name="entry.name"
        :description="entry.description"
        :author="entry.author"
        :version="entry.version"
        :category="entry.category"
        :category-label="entry.category ? PLUGIN_CATEGORY_LABELS[entry.category] : undefined"
        :installing="misStore.installing('plugin') === entry.id"
        :already-installed="misStore.installedIn('plugin', entry, columnScope ?? undefined)"
        :has-update="misStore.hasUpdate('plugin', entry)"
        :updated-at="entry.updatedAt"
        :capabilities="entry.capabilities"
        :capability-ok="capabilityChecks[entry.id]?.ok"
        :capability-badge="capabilityChecks[entry.id]?.badge"
        :capability-reason="capabilityChecks[entry.id]?.reason"
        :icon-url="entry.iconUrl"
        @install="installEntry(entry, run)"
        @update="run(() => misStore.update('plugin', entry), i18n.ts._common.updateFailed)"
        @open-detail="openStoreDetail(entry)"
      />
    </template>
  </DeckDistributableColumn>
</template>

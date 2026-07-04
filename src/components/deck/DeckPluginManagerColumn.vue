<script setup lang="ts">
import { computed, ref } from 'vue'
import { abortPlugin, launchPlugin } from '@/aiscript/plugin-api'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { useServerImages } from '@/composables/useServerImages'
import { useTabSlide } from '@/composables/useTabSlide'
import { getPluginDenial } from '@/permissions/pluginDenials'
import { getAccountAvatarUrl, useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import {
  getPluginDetailUrl,
  PLUGIN_CATEGORY_LABELS,
  type StorePluginEntry,
  useMisStoreStore,
} from '@/stores/misstore'
import { type PluginMeta, usePluginsStore } from '@/stores/plugins'
import { useWindowsStore } from '@/stores/windows'
import { openSafeUrl } from '@/utils/url'
import type { ColumnTabDef } from './ColumnTabs.vue'
import ColumnTabs from './ColumnTabs.vue'
import DeckColumn from './DeckColumn.vue'
import PluginCard from './PluginCard.vue'

// 拒否バッジのクリック → 権限ウィンドウの plugin 行 (#712 §8.4)
function openPermissionSettings(): void {
  useWindowsStore().open('permissions')
}

const props = defineProps<{
  column: DeckColumnType
}>()

const pluginsStore = usePluginsStore()
const windowsStore = useWindowsStore()
const misStore = useMisStoreStore()
const accountsStore = useAccountsStore()
const { serverIconUrl } = useServerImages(() => props.column)
const { columnThemeVars } = useColumnTheme(() => props.column)

pluginsStore.ensureLoaded()
// Store メタデータをインストール済みカードの表示にも使うため事前取得（TTL キャッシュあり）
misStore.fetchPlugins()

const storeByName = computed(() => {
  const map = new Map<string, StorePluginEntry>()
  for (const entry of misStore.plugins) map.set(entry.name, entry)
  return map
})

// --- Mode resolution (per-account / 全アカウント) ---
const isCrossAccount = computed(() => props.column.accountId == null)
const account = computed(() =>
  isCrossAccount.value
    ? null
    : (accountsStore.accounts.find((a) => a.id === props.column.accountId) ??
      null),
)
const accountId = computed(() => props.column.accountId)

/** カラムの context (per-account / 全アカウント) に応じた installedFor 対象 ids。 */
function contextAccountIds(): string[] {
  if (isCrossAccount.value) {
    return accountsStore.accounts.map((a) => a.id)
  }
  return accountId.value ? [accountId.value] : []
}

const loggedInIds = computed(
  () => new Set(accountsStore.accounts.map((a) => a.id)),
)

/**
 * カラム context に該当するか判定する。
 * - per-account カラム: installedFor が当該 account を含む or installedFor 未設定
 *   (旧プラグイン後方互換で全 account 対象扱い)
 * - 全アカウントカラム: installedFor が少なくとも 1 つ logged-in account を含む or 未設定
 */
function matchesContext(plugin: PluginMeta): boolean {
  const installedFor = plugin.installedFor
  if (!installedFor || installedFor.length === 0) return true
  if (isCrossAccount.value) {
    return installedFor.some((id) => loggedInIds.value.has(id))
  }
  return installedFor.includes(accountId.value as string)
}

// --- View mode ---
type ViewTab = 'installed' | 'store'
const viewTabs: ViewTab[] = ['installed', 'store']
const viewTab = ref<ViewTab>('installed')
const columnContentRef = ref<HTMLElement | null>(null)

const tabDefs = computed<ColumnTabDef[]>(() => [
  {
    value: 'installed',
    label: `インストール済み ${pluginsStore.plugins.length}`,
  },
  { value: 'store', label: 'ストア' },
])

function switchTab(tab: string) {
  const t = tab as ViewTab
  viewTab.value = t
  if (t === 'store') misStore.fetchPlugins()
}

// Tab slide animation
const tabIndex = computed(() => viewTabs.indexOf(viewTab.value))
useTabSlide(tabIndex, columnContentRef)

// --- Search & filter (shared) ---
const searchQuery = ref('')

// --- Installed tab ---
type FilterMode = 'all' | 'enabled' | 'disabled'
const activeFilter = computed<FilterMode>(() => {
  const q = searchQuery.value.trimStart()
  if (q.startsWith('@enabled')) return 'enabled'
  if (q.startsWith('@disabled')) return 'disabled'
  if (q.startsWith('@installed')) return 'all'
  return 'all'
})

const textQuery = computed(() => {
  return searchQuery.value
    .replace(/^@(?:installed|enabled|disabled)\s*/, '')
    .trim()
    .toLowerCase()
})

interface PluginSection {
  key: 'local' | 'store'
  label: string
  items: PluginMeta[]
}

/** Context-filter + active-filter + text-search を通したリスト */
const visiblePlugins = computed<PluginMeta[]>(() => {
  let list = pluginsStore.plugins.filter((p) => matchesContext(p))
  if (activeFilter.value === 'enabled') {
    list = list.filter((p) => p.active)
  } else if (activeFilter.value === 'disabled') {
    list = list.filter((p) => !p.active)
  }
  const q = textQuery.value
  if (q) {
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false) ||
        (p.author?.toLowerCase().includes(q) ?? false),
    )
  }
  return list
})

/**
 * インストール済みタブのセクション分け:
 *   - ローカル: storeId 無し (NoteDeck エディタで作成 / import)
 *   - ストア: storeId 持ち (MisStore からインストール)
 * 検索なし時は空セクションもラベルを出して状態が一目で分かるようにする。
 * 検索 / フィルタ適用時は該当 0 件のセクションは非表示にする。
 */
const installedSections = computed<PluginSection[]>(() => {
  const local = visiblePlugins.value.filter((p) => !p.storeId)
  const store = visiblePlugins.value.filter((p) => !!p.storeId)
  const sections: PluginSection[] = [
    { key: 'local', label: 'ローカル', items: local },
    { key: 'store', label: 'ストア', items: store },
  ]
  const isFiltering = textQuery.value.length > 0 || activeFilter.value !== 'all'
  if (isFiltering) return sections.filter((s) => s.items.length > 0)
  return sections
})

const visiblePluginCount = computed(() => visiblePlugins.value.length)

function setFilter(mode: FilterMode) {
  searchQuery.value =
    mode === 'enabled'
      ? '@enabled '
      : mode === 'disabled'
        ? '@disabled '
        : '@installed '
}

// --- Store tab ---
const storeQuery = ref('')

const filteredStorePlugins = computed(() => {
  const q = storeQuery.value.trim().toLowerCase()
  if (!q) return misStore.plugins
  return misStore.plugins.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.author.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q)),
  )
})

const installError = ref<string | null>(null)

async function handleStoreInstall(entry: StorePluginEntry) {
  installError.value = null
  try {
    // per-account: 当該アカウントの installedFor に追加
    // 全アカウント: 全 logged-in account の installedFor に追加 (集約 viewer)
    await misStore.installPlugin(entry, contextAccountIds())
  } catch (e) {
    installError.value = e instanceof Error ? e.message : 'インストール失敗'
  }
}

function handleOpenStoreDetail(entry: StorePluginEntry) {
  openSafeUrl(getPluginDetailUrl(entry.id))
}

// --- Installed tab actions ---
async function toggleActive(plugin: PluginMeta) {
  const newActive = !plugin.active
  pluginsStore.setActive(plugin.installId, newActive)
  if (newActive) {
    await launchPlugin(plugin)
  } else {
    abortPlugin(plugin.installId)
  }
}

function openPluginDetail(pluginId: string) {
  windowsStore.open('plugins', {
    initialPluginId: pluginId,
    initialAccountIds: contextAccountIds(),
  })
}

function openNewPlugin() {
  windowsStore.open('plugins', {
    initialAccountIds: contextAccountIds(),
  })
}

function handleUninstall(plugin: PluginMeta) {
  if (!isCrossAccount.value && accountId.value) {
    // per-account: このアカウントから外す (installedFor から除外)
    // installedFor が空になれば完全削除 (= abort も走る経路)
    const remaining = (plugin.installedFor ?? []).filter(
      (id) => id !== accountId.value,
    )
    pluginsStore.unlinkAccountFromPlugin(plugin.installId, accountId.value)
    if (remaining.length === 0) abortPlugin(plugin.installId)
  } else {
    // 全アカウント: 完全削除
    abortPlugin(plugin.installId)
    pluginsStore.removePlugin(plugin.installId)
  }
}
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name ?? 'プラグイン'"
    :theme-vars="columnThemeVars"
    @header-click="() => {}"
  >
    <template #header-icon>
      <i class="ti ti-puzzle" :class="$style.headerIcon" />
    </template>

    <template #header-meta>
      <div v-if="!isCrossAccount && account" :class="$style.headerAccount">
        <img :src="getAccountAvatarUrl(account)" :class="$style.headerAvatar" />
        <img
          :class="$style.headerFavicon"
          :src="serverIconUrl || `https://${account.host}/favicon.ico`"
          :title="account.host"
          @error="($event.target as HTMLImageElement).src = '/server-icon-error.svg'"
        />
      </div>
      <button
        v-if="viewTab === 'installed'"
        class="_button"
        :class="$style.headerBtn"
        title="新規プラグインを作成"
        @click.stop="openNewPlugin"
      >
        <i class="ti ti-plus" />
      </button>
    </template>

    <div ref="columnContentRef" :class="$style.wrapper">
      <ColumnTabs
        :tabs="tabDefs"
        :model-value="viewTab"
        :swipe-target="columnContentRef"
        @update:model-value="switchTab"
      />

      <!-- Search bar -->
      <div :class="$style.searchWrap">
        <input
          v-if="viewTab === 'installed'"
          v-model="searchQuery"
          :class="$style.searchInput"
          type="text"
          placeholder="インストール済みを探す"
        />
        <input
          v-else
          v-model="storeQuery"
          :class="$style.searchInput"
          type="text"
          placeholder="ストアを探す"
        />
        <div v-if="viewTab === 'installed'" :class="$style.searchActions">
          <button
            class="_button"
            :class="[$style.filterBtn, activeFilter === 'enabled' && $style.filterBtnActive]"
            title="有効なプラグイン"
            @click="setFilter('enabled')"
          >
            <i class="ti ti-check" />
          </button>
          <button
            class="_button"
            :class="[$style.filterBtn, activeFilter === 'disabled' && $style.filterBtnActive]"
            title="無効なプラグイン"
            @click="setFilter('disabled')"
          >
            <i class="ti ti-circle-off" />
          </button>
        </div>
      </div>
      <!-- ===== Installed tab ===== -->
      <template v-if="viewTab === 'installed'">
        <div :class="$style.list">
          <div
            v-for="section in installedSections"
            :key="section.key"
            :class="$style.section"
          >
            <h3 :class="$style.sectionTitle">{{ section.label }}</h3>
            <div v-if="section.items.length === 0" :class="$style.sectionEmpty">
              未設定
            </div>
            <PluginCard
              v-for="plugin in section.items"
              :key="plugin.installId"
              mode="installed"
              :name="plugin.name"
              :description="storeByName.get(plugin.name)?.description ?? plugin.description"
              :author="storeByName.get(plugin.name)?.author ?? plugin.author"
              :version="plugin.version"
              :category="storeByName.get(plugin.name)?.category"
              :category-label="storeByName.get(plugin.name)?.category ? PLUGIN_CATEGORY_LABELS[storeByName.get(plugin.name)!.category] : undefined"
              :active="plugin.active"
              :confirming-uninstall="false"
              :icon-url="plugin.iconUrl ?? storeByName.get(plugin.name)?.iconUrl"
              :denied-badge="getPluginDenial(plugin.installId)"
              @click="openPluginDetail(plugin.installId)"
              @toggle="toggleActive(plugin)"
              @uninstall="handleUninstall(plugin)"
              @settings="openPluginDetail(plugin.installId)"
              @denied-click="openPermissionSettings()"
            />
          </div>

          <div v-if="visiblePluginCount === 0" :class="$style.empty">
            <template v-if="textQuery || activeFilter !== 'all'">
              一致するプラグインがありません
            </template>
            <template v-else>
              <i class="ti ti-puzzle" :class="$style.emptyIcon" />
              <span>プラグインがインストールされていません</span>
              <button class="_button" :class="$style.emptyLink" @click="viewTab = 'store'">
                ストアからインストール...
              </button>
            </template>
          </div>
        </div>
      </template>

      <!-- ===== Store tab ===== -->
      <template v-else>
        <!-- Error -->
        <div v-if="installError" :class="$style.storeError">
          <i class="ti ti-alert-circle" />
          {{ installError }}
          <button class="_button" :class="$style.storeErrorClose" @click="installError = null">
            <i class="ti ti-x" />
          </button>
        </div>

        <div v-if="misStore.loading" :class="$style.storeLoading">
          <i class="ti ti-loader-2 nd-spin" />
          読み込み中...
        </div>

        <div v-else-if="misStore.error" :class="$style.empty">
          <i class="ti ti-cloud-off" :class="$style.emptyIcon" />
          <span>ストアに接続できません</span>
          <button class="_button" :class="$style.emptyLink" @click="misStore.refresh()">
            再試行
          </button>
        </div>

        <div v-else :class="$style.list">
          <PluginCard
            v-for="entry in filteredStorePlugins"
            :key="entry.id"
            mode="store"
            :name="entry.name"
            :description="entry.description"
            :author="entry.author"
            :version="entry.version"
            :category="entry.category"
            :category-label="entry.category ? PLUGIN_CATEGORY_LABELS[entry.category] : undefined"
            :installing="misStore.installing === entry.id"
            :already-installed="misStore.installedNames.has(entry.name)"
            :icon-url="entry.iconUrl"
            @install="handleStoreInstall(entry)"
            @open-detail="handleOpenStoreDetail(entry)"
          />

          <div v-if="filteredStorePlugins.length === 0 && !misStore.loading" :class="$style.empty">
            一致するプラグインがありません
          </div>
        </div>
      </template>
    </div>
  </DeckColumn>
</template>

<style module lang="scss">
@use './column-common.module.scss';

.headerIcon {
  font-size: 1em;
}

// .headerAccount / .headerAvatar / .headerFavicon は column-common.module.scss
// で定義された共通スタイル (DeckThemeManagerColumn 等と揃える)。

.headerBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.6;
  transition:
    background 0.1s,
    opacity 0.1s;

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }
}

// --- Search bar ---
.searchWrap {
  display: flex;
  align-items: center;
  padding: 6px 10px 4px;
  width: 100%;
}

.searchInput {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--nd-divider);
  border-radius: 2px;
  background: var(--nd-inputBg, var(--nd-bg));
  color: var(--nd-fg);
  font-size: 12px;

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.4;
  }

  &:focus {
    outline: none;
    border-color: var(--nd-accent);
  }
}

.searchActions {
  display: flex;
  align-items: center;
  margin-left: 2px;
  gap: 1px;
}

.filterBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 3px;
  color: var(--nd-fg);
  opacity: 0.45;
  font-size: 13px;
  transition:
    opacity 0.1s,
    background 0.1s;

  &:hover {
    opacity: 0.85;
    background: var(--nd-buttonHoverBg);
  }
}

.filterBtnActive {
  opacity: 1;
  color: var(--nd-accent);
}

// --- Wrapper ---
.wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

// --- List ---
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.section {
  &:not(:first-child) {
    margin-top: 8px;
  }
}

.sectionTitle {
  margin: 0;
  padding: 8px 12px 4px;
  font-size: 0.75em;
  font-weight: 600;
  color: var(--nd-fg);
  opacity: 0.55;
  letter-spacing: 0.04em;
}

.sectionEmpty {
  padding: 6px 12px 10px;
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.5;
}

// --- Store states ---
.storeLoading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 20px;
  color: var(--nd-fg);
  opacity: 0.5;
  font-size: 13px;
}

.storeError {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  margin: 6px 10px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--nd-love) 10%, transparent);
  color: var(--nd-love);
  font-size: 12px;
  flex-shrink: 0;
}

.storeErrorClose {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 3px;
  opacity: 0.6;
  font-size: 12px;

  &:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--nd-love) 15%, transparent);
  }
}

// --- Empty state ---
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 20px;
  color: var(--nd-fg);
  opacity: 0.5;
  font-size: 13px;
  text-align: center;
}

.emptyIcon {
  font-size: 36px;
  opacity: 0.3;
}

.emptyLink {
  color: var(--nd-accent);
  font-size: 12px;
  margin-top: 4px;
  opacity: 0.8;
  transition: opacity 0.1s;

  &:hover {
    opacity: 1;
    text-decoration: underline;
  }
}
</style>

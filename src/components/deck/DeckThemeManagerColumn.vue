<script setup lang="ts">
import { computed, ref } from 'vue'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { useServerImages } from '@/composables/useServerImages'
import { useTabSlide } from '@/composables/useTabSlide'
import { getAccountAvatarUrl, useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import {
  getThemeDetailUrl,
  type StoreThemeEntry,
  useMisStoreStore,
} from '@/stores/misstore'
import { useThemeStore } from '@/stores/theme'
import { useWindowsStore } from '@/stores/windows'
import { MI_DARK, MI_LIGHT } from '@/theme/builtinThemes'
import type { MisskeyTheme } from '@/theme/types'
import { openSafeUrl } from '@/utils/url'
import ColumnSection from './ColumnSection.vue'
import type { ColumnTabDef } from './ColumnTabs.vue'
import ColumnTabs from './ColumnTabs.vue'
import DeckColumn from './DeckColumn.vue'
import ThemeCard from './ThemeCard.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const themeStore = useThemeStore()
const misStore = useMisStoreStore()
const windowsStore = useWindowsStore()
const accountsStore = useAccountsStore()
const { serverIconUrl } = useServerImages(() => props.column)
const { columnThemeVars } = useColumnTheme(() => props.column)

misStore.fetchThemes()

// --- Mode resolution ---
const isCrossAccount = computed(() => props.column.accountId == null)
const account = computed(() =>
  isCrossAccount.value
    ? null
    : (accountsStore.accounts.find((a) => a.id === props.column.accountId) ??
      null),
)
const accountId = computed(() => props.column.accountId)

// 現在の dark/light モード。テーマ一覧を該当モードのみに絞る
// (DeckSettingsMenu の themeGrid と同パターン)。
// currentSource.kind ('builtin-dark' / 'custom-dark' / 'server-dark' 等) から判定。
const currentMode = computed<'dark' | 'light'>(() =>
  themeStore.currentSource?.kind.includes('light') ? 'light' : 'dark',
)

// --- View mode ---
type ViewTab = 'installed' | 'store'
const viewTabs: ViewTab[] = ['installed', 'store']
const viewTab = ref<ViewTab>('installed')
const columnContentRef = ref<HTMLElement | null>(null)

// --- Source-tagged theme list ---
type Source = 'builtin' | 'local' | 'misstore' | 'server'
interface ThemeEntry {
  theme: MisskeyTheme
  source: Source
  removable: boolean
}

// テーマの内容 (name + props) で同一性を判定する。
// accountThemeCache は theme.id を 'account-{mode}-{accountId}' に書き換える
// ため id 比較できないので、name と props で deep equal する。
function isSameTheme(
  a: MisskeyTheme | undefined,
  b: MisskeyTheme | undefined,
): boolean {
  if (!a || !b) return false
  if (a.name !== b.name) return false
  const aProps = a.props
  const bProps = b.props
  const keysA = Object.keys(aProps)
  if (keysA.length !== Object.keys(bProps).length) return false
  for (const k of keysA) {
    if (aProps[k] !== bProps[k]) return false
  }
  return true
}

interface ThemeSection {
  key: string
  label: string
  items: ThemeEntry[]
}

// インストール済みタブのセクション構成 (出自 3 分類 + サーバー):
//   per-account: 自作 + ストア配布 (MisStore 由来) + サーバー (admin Branding)
//   cross-account (Global): ビルドイン (同梱) + 自作 + ストア配布 — アプリ全体管理
//
// 「Web UI で選択中のテーマ」(本家 darkTheme/lightTheme Pref) はサーバーに保存
// されないため、NoteDeck 側でも介入しない。ユーザーが MisStore から取り込んだ
// テーマを per-column 適用する UX に集中する。
const themeSections = computed<ThemeSection[]>(() => {
  const mode = currentMode.value
  const sections: ThemeSection[] = []

  // logged-in account id 集合 (cross-account = 全アカウント集約 viewer の判定用)。
  const loggedInIds = new Set(accountsStore.accounts.map((a) => a.id))

  // 「ビルドイン」= アプリ同梱 (Mi Dark / Mi Light、削除/編集不可)。
  // プラグイン/スキルカラムの同梱セクションと同じ扱いで全アカウントカラムのみ。
  if (isCrossAccount.value) {
    sections.push({
      key: 'builtin',
      label: 'ビルドイン',
      items: [
        {
          theme: mode === 'dark' ? MI_DARK : MI_LIGHT,
          source: 'builtin',
          removable: false,
        },
      ],
    })
  }

  // 「自作」 (NoteDeck エディタ作成 / import / storeId 無し)。
  // - per-account: installedFor に該当アカウントを含むもののみ
  // - 全アカウント: installedFor に少なくとも 1 つの logged-in account を含む
  //   もの (集約 viewer の semantics)
  const selfMadeThemes = themeStore.installedThemes
    .filter((t) => {
      if (t.$notedeck?.storeId) return false
      if ((t.base ?? 'dark') !== mode) return false
      const installedFor = t.$notedeck?.installedFor ?? []
      if (isCrossAccount.value) {
        return installedFor.some((id) => loggedInIds.has(id))
      }
      return installedFor.includes(accountId.value as string)
    })
    .map<ThemeEntry>((t) => ({
      theme: t,
      source: 'local',
      removable: true,
    }))
  sections.push({
    key: 'selfmade',
    label: '自作',
    items: selfMadeThemes,
  })

  if (!isCrossAccount.value && accountId.value) {
    // ストア配布 (MisStore 由来、このアカウントが installedFor に登録されている
    // もののみ) → サーバーのテーマ (admin Branding) の順で表示。
    const cached = themeStore.accountThemeCache.get(accountId.value)
    const metaTheme = mode === 'dark' ? cached?.metaDark : cached?.metaLight

    const storeThemes = themeStore.installedThemes
      .filter(
        (t) =>
          t.$notedeck?.storeId &&
          t.$notedeck?.installedFor?.includes(accountId.value as string) &&
          (t.base ?? 'dark') === mode,
      )
      .map<ThemeEntry>((t) => ({
        theme: t,
        source: 'misstore',
        removable: true,
      }))
    sections.push({
      key: 'store',
      label: 'ストア配布',
      items: storeThemes,
    })

    sections.push({
      key: 'server',
      label: 'サーバー',
      items: metaTheme
        ? [{ theme: metaTheme, source: 'server', removable: false }]
        : [],
    })
  } else {
    // 全アカウントカラム: ストア配布 (installedFor が少なくとも 1 つの
    // logged-in account を含むもの)
    const storeThemes = themeStore.installedThemes
      .filter((t) => {
        if (!t.$notedeck?.storeId) return false
        if ((t.base ?? 'dark') !== mode) return false
        const installedFor = t.$notedeck?.installedFor ?? []
        return installedFor.some((id) => loggedInIds.has(id))
      })
      .map<ThemeEntry>((t) => ({
        theme: t,
        source: 'misstore',
        removable: true,
      }))
    sections.push({
      key: 'store',
      label: 'ストア配布',
      items: storeThemes,
    })
  }

  // 0 件のセクションは表示しない
  return sections.filter((s) => s.items.length > 0)
})

const installedTotalCount = computed(() =>
  themeSections.value.reduce((sum, s) => sum + s.items.length, 0),
)

const tabDefs = computed<ColumnTabDef[]>(() => [
  {
    value: 'installed',
    label: `インストール済み ${installedTotalCount.value}`,
  },
  { value: 'store', label: 'ストア' },
])

function switchTab(tab: string) {
  viewTab.value = tab as ViewTab
  if (tab === 'store') misStore.fetchThemes()
}

const tabIndex = computed(() => viewTabs.indexOf(viewTab.value))
useTabSlide(tabIndex, columnContentRef)

// --- Search ---
const searchQuery = ref('')
const storeQuery = ref('')

const filteredSections = computed<ThemeSection[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  // 検索クエリが空のときは空セクションもそのまま (label を表示するため)。
  // 検索時のみ非該当セクションを除外。
  if (!q) return themeSections.value
  return themeSections.value
    .map((s) => ({
      ...s,
      items: s.items.filter(
        (e) =>
          e.theme.name.toLowerCase().includes(q) ||
          e.theme.id.toLowerCase().includes(q),
      ),
    }))
    .filter((s) => s.items.length > 0)
})

const totalFilteredCount = computed(() =>
  filteredSections.value.reduce((sum, s) => sum + s.items.length, 0),
)

const filteredStoreThemes = computed(() => {
  const mode = currentMode.value
  const modeFiltered = misStore.themes.filter((t) => t.base === mode)
  const q = storeQuery.value.trim().toLowerCase()
  if (!q) return modeFiltered
  return modeFiltered.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.author.toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.toLowerCase().includes(q)),
  )
})

// --- Adoption status ---
function isAppliedToAccount(theme: MisskeyTheme): boolean {
  if (!accountId.value) return false
  const cached = themeStore.accountThemeCache.get(accountId.value)
  return isSameTheme(cached?.dark, theme) || isSameTheme(cached?.light, theme)
}

function isAppliedToGlobal(theme: MisskeyTheme): boolean {
  return (
    themeStore.selectedDarkThemeId === theme.id ||
    themeStore.selectedLightThemeId === theme.id ||
    (theme.id === 'dark' && !themeStore.selectedDarkThemeId) ||
    (theme.id === 'light' && !themeStore.selectedLightThemeId)
  )
}

// --- Actions ---
async function applyToAccount(entry: ThemeEntry) {
  if (!accountId.value) return
  const mode = entry.theme.base ?? 'dark'
  await themeStore.applyAccountTheme(entry.theme, mode, accountId.value)
}

async function clearForAccount(entry: ThemeEntry) {
  if (!accountId.value) return
  const mode = entry.theme.base ?? 'dark'
  await themeStore.clearAccountTheme(mode, accountId.value)
}

function applyToGlobal(entry: ThemeEntry) {
  const mode = entry.theme.base ?? 'dark'
  themeStore.selectTheme(entry.theme.id, mode)
}

function editTheme(entry: ThemeEntry) {
  // per-account なら [accountId]、全アカウントカラムなら全 logged-in account
  // を installedFor 紐付け対象として渡す
  windowsStore.open('themeEditor', {
    initialThemeId: entry.theme.id,
    initialAccountIds: contextAccountIds(),
  })
}

function removeTheme(entry: ThemeEntry) {
  if (!isCrossAccount.value && accountId.value) {
    // per-account カラムからの除去は「このアカウントから外す」のみ
    // (installedFor から accountId を抜き、空になれば完全削除)。同時に
    // accountThemeCache の per-column 適用も解除して meta default にフォール
    // バックさせる (ユーザーが × したテーマがそのカラムに当たり続けると混乱)。
    const mode = entry.theme.base ?? 'dark'
    themeStore.unlinkAccountFromTheme(entry.theme.id, accountId.value)
    themeStore.clearAccountTheme(mode, accountId.value)
  } else {
    // cross-account (Global) からは完全削除
    themeStore.removeTheme(entry.theme.id)
  }
}

const installError = ref<string | null>(null)

async function handleStoreInstall(entry: StoreThemeEntry) {
  installError.value = null
  try {
    // per-account: 当該アカウントの installedFor に追加 →「ストアのテーマ」表示
    // 全アカウントカラム: 全 logged-in account を installedFor に追加 → 全
    //   per-account カラムにも反映される (集約 viewer の semantics)
    await misStore.installTheme(entry, contextAccountIds())
  } catch (e) {
    installError.value = e instanceof Error ? e.message : 'インストール失敗'
  }
}

function openNewTheme() {
  windowsStore.open('themeEditor', {
    initialAccountIds: contextAccountIds(),
  })
}

/** カラムの context (per-account / 全アカウント) に応じた installedFor 対象 ids。 */
function contextAccountIds(): string[] {
  if (isCrossAccount.value) {
    return accountsStore.accounts.map((a) => a.id)
  }
  return accountId.value ? [accountId.value] : []
}

// Store entry → MisskeyTheme (preview 用)
// MisStore registry は themeProps にフル props を入れて返すので、そのまま
// compileMisskeyTheme に渡せば本物と同じ着色になる。
function storeEntryToTheme(entry: StoreThemeEntry): MisskeyTheme {
  return {
    id: entry.id,
    name: entry.name,
    base: entry.base,
    props: entry.themeProps ?? {},
  }
}
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name ?? 'テーマ'"
    :theme-vars="columnThemeVars"
    @header-click="() => {}"
  >
    <template #header-icon>
      <i class="ti ti-palette" :class="$style.tlHeaderIcon" />
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
        title="新規テーマを作成"
        @click.stop="openNewTheme"
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
      </div>

      <!-- ===== Installed tab ===== -->
      <template v-if="viewTab === 'installed'">
        <div :class="$style.scroll">
          <ColumnSection
            v-for="section in filteredSections"
            :key="section.key"
            :label="section.label"
            :count="section.items.length"
          >
            <div :class="$style.grid">
              <ThemeCard
                v-for="entry in section.items"
                :key="`${entry.source}:${entry.theme.id}`"
                mode="installed"
                :theme="entry.theme"
                :source="entry.source"
                :is-applied-account="isAppliedToAccount(entry.theme)"
                :is-applied-global="isAppliedToGlobal(entry.theme)"
                :per-account="!isCrossAccount"
                :removable="entry.removable"
                @apply-account="applyToAccount(entry)"
                @apply-global="applyToGlobal(entry)"
                @clear-account="clearForAccount(entry)"
                @edit="editTheme(entry)"
                @remove="removeTheme(entry)"
              />
            </div>
          </ColumnSection>

          <div v-if="totalFilteredCount === 0" :class="$style.empty">
            <template v-if="searchQuery">
              一致するテーマがありません
            </template>
            <template v-else>
              <i class="ti ti-palette" :class="$style.emptyIcon" />
              <span>テーマがありません</span>
              <button class="_button" :class="$style.emptyLink" @click="viewTab = 'store'">
                ストアからインストール...
              </button>
            </template>
          </div>
        </div>
      </template>

      <!-- ===== Store tab ===== -->
      <template v-else>
        <div v-if="installError" :class="$style.storeError">
          <i class="ti ti-alert-circle" />
          {{ installError }}
          <button class="_button" :class="$style.storeErrorClose" @click="installError = null">
            <i class="ti ti-x" />
          </button>
        </div>

        <div v-if="misStore.themesLoading" :class="$style.storeLoading">
          <i class="ti ti-loader-2 nd-spin" />
          読み込み中...
        </div>

        <div v-else-if="misStore.themesError" :class="$style.empty">
          <i class="ti ti-cloud-off" :class="$style.emptyIcon" />
          <span>ストアに接続できません</span>
          <button class="_button" :class="$style.emptyLink" @click="misStore.refreshThemes()">
            再試行
          </button>
        </div>

        <div v-else :class="$style.scroll">
          <div :class="$style.grid">
            <ThemeCard
              v-for="entry in filteredStoreThemes"
              :key="entry.id"
              mode="store"
              :theme="storeEntryToTheme(entry)"
              source="misstore"
              :installing="misStore.installingTheme === entry.id"
              :already-installed="misStore.isThemeInstalled(entry)"
              @install="handleStoreInstall(entry)"
              @open-detail="openSafeUrl(getThemeDetailUrl(entry.id))"
            />
          </div>

          <div v-if="filteredStoreThemes.length === 0 && !misStore.themesLoading" :class="$style.empty">
            一致するテーマがありません
          </div>
        </div>
      </template>
    </div>
  </DeckColumn>
</template>

<style module lang="scss">
@use './column-common.module.scss';

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

.wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  padding: 4px 10px 8px;
}

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

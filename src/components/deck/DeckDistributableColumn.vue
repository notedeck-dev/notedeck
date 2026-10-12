<script setup lang="ts" generic="Item extends DistributableMeta<unknown, unknown>, E extends StoreEntryBase">
import { computed, ref } from 'vue'
import SafeModeNotice from '@/components/common/SafeModeNotice.vue'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { useTabSlide } from '@/composables/useTabSlide'
import { i18n } from '@/i18n'
import type { DistributableMeta } from '@/services/distributable'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import type { StoreEntryBase } from '@/stores/misstore'
import ColumnSection from './ColumnSection.vue'
import type { ColumnTabDef } from './ColumnTabs.vue'
import ColumnTabs from './ColumnTabs.vue'
import DeckColumn from './DeckColumn.vue'

/**
 * 配布物 5 種 (plugin / widget / query / skill / theme) の管理カラムの共通の殻
 * (#1202 段階 3)。タブ (インストール済み / ストア)、検索欄と有効 / 無効の
 * 絞り込み、出自 (サイドロード / ストア配布) のセクション、ライブラリピッカー、
 * ストアタブ (取得中 / 失敗と再試行 / エラー行 / 一覧) を 1 実装で持つ。
 *
 * kind ごとの意味は props (宣言) と slot で差し込む。カードの中身とエディタは
 * kind 別 (決定 (c))。殻は個体の中身を見ない — 見るのは envelope の `name` /
 * `description` / `store` と、宣言された `isEnabled` だけ。
 *
 * slot:
 * - `card({ item, mode })`: インストール済み / ライブラリのカード
 * - `installed({ query })`: 導入済みタブの一覧を丸ごと差し替える (theme の
 *   モード別セクション / widget の配置)。無ければ出自のセクション + `card`
 * - `installed-empty({ query })`: 導入済みが 0 件のときの案内を差し替える
 * - `store-card({ entry, run })`: ストアのカード。`run` はインストール / 更新を
 *   包んでエラー行に出す
 */

export interface EnabledFilterDecl<Item> {
  enabledTitle: string
  disabledTitle: string
  isEnabled(item: Item): boolean
}

export interface StoreFeedDecl<E> {
  entries: readonly E[]
  loading: boolean
  error: string | null
  fetch(): unknown
  refresh(): unknown
  /** 検索の対象 (省略時は name / description / author / tags) */
  text?(entry: E): (string | undefined)[]
}

const props = withDefaults(
  defineProps<{
    column: DeckColumnType
    /** カラム名の既定 (利用者が付けた名前が無いとき) */
    title: string
    /** ヘッダーのアイコン (tabler 名、`ti-` 無し) */
    icon: string
    /** セーフモードの案内の主語。無ければ案内を出さない */
    safeModeSubject?: string
    /** 新規作成の「+」の tooltip。`canCreate` が立っているときだけ出す */
    createTitle?: string
    canCreate?: boolean
    /** 導入済みタブの個体 (カラムの文脈で絞り、並べ終えたもの) */
    items?: readonly Item[]
    /** 導入済みタブの件数 (既定は `items` の数。widget は配置の数) */
    installedCount?: number
    /** 導入済みタブの検索欄の placeholder。無ければ検索欄を出さない */
    searchPlaceholder?: string
    /** 検索の対象 (省略時は name / description) */
    searchText?: (item: Item) => (string | undefined)[]
    /** 有効 / 無効の絞り込み (宣言した kind だけボタンが出る) */
    enabledFilter?: EnabledFilterDecl<Item>
    /** ライブラリピッカーの候補。無ければピッカーを出さない */
    libraryCandidates?: readonly Item[]
    texts: {
      /** 検索に一致しない */
      noMatches: string
      /** 導入済みが 0 件 */
      empty: string
      /** ピッカーの候補が 0 件 */
      noLibrary?: string
      /** ストアに 1 件も無い (省略時は noMatches) */
      storeEmpty?: string
    }
    store: StoreFeedDecl<E>
    /** ストアのカードを 2 列のグリッドで並べる (theme) */
    storeGrid?: boolean
  }>(),
  { canCreate: false, items: () => [] },
)

const emit = defineEmits<(e: 'create') => void>()

defineSlots<{
  card(props: { item: Item; mode: 'installed' | 'library' }): unknown
  installed(props: {
    query: string
    serverInfoImageUrl: string | undefined
  }): unknown
  'installed-empty'(props: { query: string }): unknown
  'store-card'(props: {
    entry: E
    run: (action: () => Promise<unknown>, fallback?: string) => Promise<void>
  }): unknown
}>()

const { columnThemeVars, serverInfoImageUrl, scroller, scrollToTop } =
  useColumnSetup(() => props.column)

// --- タブ ---
type ViewTab = 'installed' | 'store'
const viewTabs: ViewTab[] = ['installed', 'store']
const viewTab = ref<ViewTab>('installed')
const columnContentRef = ref<HTMLElement | null>(null)

const tabDefs = computed<ColumnTabDef[]>(() => [
  {
    value: 'installed',
    label: i18n.tsx._common.installedTab({
      count: props.installedCount ?? props.items.length,
    }),
  },
  { value: 'store', label: i18n.ts._common.store },
])

function switchTab(tab: string) {
  viewTab.value = tab as ViewTab
  if (tab === 'store') props.store.fetch()
}

const tabIndex = computed(() => viewTabs.indexOf(viewTab.value))
useTabSlide(tabIndex, columnContentRef)

// --- 検索と絞り込み (導入済み) ---
const searchQuery = ref('')
const storeQuery = ref('')

/** `@enabled` / `@disabled` の接頭辞で有効 / 無効に絞る (#1043) */
type FilterMode = 'all' | 'enabled' | 'disabled'
const activeFilter = computed<FilterMode>(() => {
  const q = searchQuery.value.trimStart()
  if (q.startsWith('@enabled')) return 'enabled'
  if (q.startsWith('@disabled')) return 'disabled'
  return 'all'
})
const textQuery = computed(() =>
  searchQuery.value
    .replace(/^@(?:enabled|disabled)\s*/, '')
    .trim()
    .toLowerCase(),
)
/** 絞り込みボタン: 押すと接頭辞が入り、もう一度押すと解ける */
function toggleFilter(mode: 'enabled' | 'disabled') {
  searchQuery.value = activeFilter.value === mode ? '' : `@${mode} `
}

function matchesText(item: Item): boolean {
  const q = textQuery.value
  if (!q) return true
  const fields = props.searchText?.(item) ?? [item.name, item.description]
  return fields.some((f) => f?.toLowerCase().includes(q))
}

const visibleItems = computed<Item[]>(() => {
  let list = [...props.items]
  const f = props.enabledFilter
  if (f && activeFilter.value === 'enabled') {
    list = list.filter((i) => f.isEnabled(i))
  } else if (f && activeFilter.value === 'disabled') {
    list = list.filter((i) => !f.isEnabled(i))
  }
  return list.filter(matchesText)
})

/** 出自 2 分類: サイドロード (ストア由来でない) / ストア配布。0 件の節は出さない */
const installedSections = computed(() =>
  [
    {
      key: 'sideload',
      label: i18n.ts._common.sideload,
      items: visibleItems.value.filter((i) => !i.store),
    },
    {
      key: 'store',
      label: i18n.ts._common.storeDistributed,
      items: visibleItems.value.filter((i) => !!i.store),
    },
  ].filter((s) => s.items.length > 0),
)

const hasSearch = computed(
  () => activeFilter.value !== 'all' || textQuery.value.length > 0,
)

// --- ライブラリピッカー ---
const showLibraryPicker = ref(false)
function closePicker() {
  showLibraryPicker.value = false
}

// --- ストア ---
const installError = ref<string | null>(null)

const filteredStoreEntries = computed<E[]>(() => {
  const q = storeQuery.value.trim().toLowerCase()
  const entries = [...props.store.entries]
  if (!q) return entries
  return entries.filter((e) => {
    const fields = props.store.text?.(e) ?? [
      e.name,
      (e as { description?: string }).description,
      (e as { author?: string }).author,
      ...((e as { tags?: string[] }).tags ?? []),
    ]
    return fields.some((f) => f?.toLowerCase().includes(q))
  })
})

/** インストール / 更新を包み、失敗をエラー行に出す */
async function run(
  action: () => Promise<unknown>,
  fallback = i18n.ts._common.installFailed,
): Promise<void> {
  installError.value = null
  try {
    await action()
  } catch (e) {
    installError.value = e instanceof Error ? e.message : fallback
  }
}

function showTab(tab: ViewTab) {
  viewTab.value = tab
}

defineExpose({ closePicker, showTab })
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name ?? title"
    :theme-vars="columnThemeVars"
    :data-column-type="column.type"
    @header-click="scrollToTop"
  >
    <template #header-icon>
      <i :class="[`ti ti-${icon}`, $style.headerIcon]" />
    </template>

    <template #header-meta>
      <button
        v-if="viewTab === 'installed' && canCreate && createTitle"
        class="_button"
        :class="$style.headerBtn"
        :title="createTitle"
        @click.stop="emit('create')"
      >
        <i class="ti ti-plus" />
      </button>
    </template>

    <div ref="columnContentRef" :class="$style.wrapper">
      <SafeModeNotice v-if="safeModeSubject" :subject="safeModeSubject" />

      <ColumnTabs
        :tabs="tabDefs"
        :model-value="viewTab"
        :swipe-target="columnContentRef"
        @update:model-value="switchTab"
      />

      <div
        v-if="viewTab === 'store' || searchPlaceholder"
        :class="$style.searchWrap"
      >
        <input
          v-if="viewTab === 'installed'"
          v-model="searchQuery"
          :class="$style.searchInput"
          type="text"
          :placeholder="searchPlaceholder"
        />
        <input
          v-else
          v-model="storeQuery"
          :class="$style.searchInput"
          type="text"
          :placeholder="i18n.ts._common.browseStore"
        />
        <div
          v-if="viewTab === 'installed' && enabledFilter"
          :class="$style.searchActions"
        >
          <button
            class="_button"
            :class="[$style.filterBtn, activeFilter === 'enabled' && $style.filterBtnActive]"
            :title="enabledFilter.enabledTitle"
            @click="toggleFilter('enabled')"
          >
            <i class="ti ti-check" />
          </button>
          <button
            class="_button"
            :class="[$style.filterBtn, activeFilter === 'disabled' && $style.filterBtnActive]"
            :title="enabledFilter.disabledTitle"
            @click="toggleFilter('disabled')"
          >
            <i class="ti ti-circle-off" />
          </button>
        </div>
      </div>

      <!-- ===== 導入済み ===== -->
      <template v-if="viewTab === 'installed'">
        <div ref="scroller" :class="$style.list">
          <slot
            name="installed"
            :query="textQuery"
            :server-info-image-url="serverInfoImageUrl"
          >
            <ColumnSection
              v-for="section in installedSections"
              :key="section.key"
              :label="section.label"
              :count="section.items.length"
            >
              <template v-for="item in section.items" :key="item.id">
                <slot name="card" :item="item" mode="installed" />
              </template>
            </ColumnSection>

            <template v-if="visibleItems.length === 0">
              <div v-if="hasSearch" :class="$style.empty">
                <i :class="[`ti ti-${icon}`, $style.emptyIcon]" />
                <span>{{ texts.noMatches }}</span>
              </div>
              <slot v-else name="installed-empty" :query="textQuery">
                <div :class="$style.empty">
                  <i :class="[`ti ti-${icon}`, $style.emptyIcon]" />
                  <span>{{ texts.empty }}</span>
                </div>
              </slot>
            </template>
          </slot>

          <!-- ライブラリピッカー: このカラムに未参加 / 未配置の本体を足す -->
          <template v-if="libraryCandidates">
            <div :class="$style.addArea">
              <button
                :class="[$style.addBtn, showLibraryPicker && $style.addBtnActive]"
                @click="showLibraryPicker = !showLibraryPicker"
              >
                <i :class="showLibraryPicker ? 'ti ti-chevron-up' : 'ti ti-plus'" />
                {{ showLibraryPicker ? i18n.ts._common.close : i18n.ts._common.addFromLibrary }}
              </button>
            </div>
            <div v-if="showLibraryPicker" :class="$style.pickerWrap">
              <div v-if="libraryCandidates.length === 0" :class="$style.pickerEmpty">
                {{ texts.noLibrary ?? texts.empty }}
              </div>
              <template v-for="item in libraryCandidates" :key="item.id">
                <slot name="card" :item="item" mode="library" />
              </template>
            </div>
          </template>
        </div>
      </template>

      <!-- ===== ストア ===== -->
      <template v-else>
        <div v-if="installError" :class="$style.storeError">
          <i class="ti ti-alert-circle" />
          {{ installError }}
          <button
            :aria-label="i18n.ts._common.close"
            class="_button"
            :class="$style.storeErrorClose"
            @click="installError = null"
          >
            <i class="ti ti-x" />
          </button>
        </div>

        <div v-if="store.loading" :class="$style.storeLoading">
          <i class="ti ti-loader-2 nd-spin" />
          {{ i18n.ts._common.loading }}
        </div>

        <div v-else-if="store.error" :class="$style.empty">
          <i class="ti ti-cloud-off" :class="$style.emptyIcon" />
          <span>{{ i18n.ts._common.storeUnavailable }}</span>
          <button class="_button" :class="$style.emptyLink" @click="store.refresh()">
            {{ i18n.ts._common.retry }}
          </button>
        </div>

        <div v-else :class="$style.list">
          <div :class="storeGrid ? $style.grid : undefined">
            <template v-for="entry in filteredStoreEntries" :key="entry.id">
              <slot name="store-card" :entry="entry" :run="run" />
            </template>
          </div>

          <div v-if="filteredStoreEntries.length === 0" :class="$style.empty">
            <i :class="[`ti ti-${icon}`, $style.emptyIcon]" />
            <span>{{ storeQuery ? texts.noMatches : (texts.storeEmpty ?? texts.noMatches) }}</span>
          </div>
        </div>
      </template>
    </div>
  </DeckColumn>
</template>

<style module lang="scss">
@use '@/styles/buttons' as *;

.headerIcon {
  font-size: 1em;
  opacity: 0.85;
}

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
    background var(--nd-duration-fast),
    opacity 0.1s;

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }
}

.wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

// --- 検索 ---
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
  border-radius: var(--nd-radius-xs);
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
  border-radius: var(--nd-radius-xs);
  color: var(--nd-fg);
  opacity: 0.45;
  font-size: 13px;
  transition:
    opacity var(--nd-duration-fast),
    background 0.1s;

  &:hover {
    opacity: 0.85;
    background: var(--nd-buttonHoverBg);
  }
}

.filterBtnActive {
  opacity: 1;
  color: var(--nd-accentText);
}

// --- 一覧 ---
.list {
  display: flex;
  flex-direction: column;
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

// --- ライブラリピッカー ---
.addArea {
  display: flex;
  justify-content: center;
  padding: 6px;
}

.addBtn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px dashed var(--nd-divider);
  border-radius: var(--nd-radius-md);
  background: none;
  color: var(--nd-fg);
  cursor: pointer;
  font-size: var(--nd-font-md);
  opacity: 0.5;
  transition: opacity var(--nd-duration-base), border-color var(--nd-duration-base);

  &:hover {
    opacity: 1;
    border-color: var(--nd-accent);
    color: var(--nd-accentText);
  }
}

.addBtnActive {
  opacity: 1;
  border-color: var(--nd-accent);
  color: var(--nd-accentText);
}

.pickerWrap {
  display: flex;
  flex-direction: column;
  padding: 4px 0 8px;
}

.pickerEmpty {
  margin: 4px 10px;
  padding: 12px;
  border: 1px dashed var(--nd-divider);
  border-radius: var(--nd-radius-md);
  color: var(--nd-fg);
  opacity: 0.6;
  font-size: 11.5px;
  text-align: center;
}

// --- ストアの状態 ---
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
  border-radius: var(--nd-radius-xs);
  background: color-mix(in srgb, var(--nd-love) 10%, transparent);
  color: var(--nd-love);
  font-size: 12px;
  flex-shrink: 0;
}

.storeErrorClose {
  @include nd-interactive;
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--nd-radius-xs);
  opacity: 0.6;
  font-size: 12px;

  &:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--nd-love) 15%, transparent);
  }
}

// --- 空 ---
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
  color: var(--nd-accentText);
  font-size: 12px;
  margin-top: 4px;
  opacity: 0.8;
  transition: opacity var(--nd-duration-fast);

  &:hover {
    opacity: 1;
    text-decoration: underline;
  }
}
</style>

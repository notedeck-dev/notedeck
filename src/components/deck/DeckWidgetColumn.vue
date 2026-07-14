<script setup lang="ts">
import { computed, defineAsyncComponent, ref, useTemplateRef } from 'vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { usePointerReorder } from '@/composables/usePointerReorder'
import { useServerImages } from '@/composables/useServerImages'
import { useTabSlide } from '@/composables/useTabSlide'
import { useConfirm } from '@/stores/confirm'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import {
  getWidgetDetailUrl,
  type StoreWidgetEntry,
  useMisStoreStore,
} from '@/stores/misstore'
import {
  generateWidgetId,
  useWidgetsStore,
  type WidgetMeta,
} from '@/stores/widgets'
import { useWindowsStore } from '@/stores/windows'
import { openSafeUrl } from '@/utils/url'
import type { ColumnTabDef } from './ColumnTabs.vue'
import ColumnTabs from './ColumnTabs.vue'
import DeckColumn from './DeckColumn.vue'
import DeckHeaderAccount from './DeckHeaderAccount.vue'
import WidgetCard from './WidgetCard.vue'
import {
  type CapabilityCheck,
  checkWidgetCapabilities,
} from './widgets/capabilities'

const WidgetAiScript = defineAsyncComponent(
  () => import('./widgets/WidgetAiScript.vue'),
)

const props = defineProps<{
  column: DeckColumnType
}>()

const deckStore = useDeckStore()
const widgetsStore = useWidgetsStore()
const misStore = useMisStoreStore()
const windowsStore = useWindowsStore()
widgetsStore.ensureLoaded()

const { account, columnThemeVars } = useColumnTheme(() => props.column)
const { serverIconUrl, serverInfoImageUrl } = useServerImages(
  () => props.column,
)

/**
 * sidebar widget カラム (ナビバートグルで開閉) は sidebarWidgetIds[] を参照し、
 * non-sidebar widget カラムはカラム自身の widgetIds[] を参照する。
 * 追加・削除の責務は deckStore 側に集約 (sidebar 判定は内部で実施)。
 */
const isSidebar = computed(() => props.column.sidebar === true)

const widgets = computed(() => {
  const ids = isSidebar.value
    ? widgetsStore.sidebarWidgetIds
    : (props.column.widgetIds ?? [])
  return ids
    .map((id) => widgetsStore.getWidget(id))
    .filter((w): w is NonNullable<typeof w> => w !== undefined)
})

const showEmptyState = computed(
  () => widgets.value.length === 0 && props.column.accountId !== null,
)

const widgetBodyRef = useTemplateRef<HTMLElement>('widgetBodyRef')

function scrollToTop() {
  widgetBodyRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function handleRemove(installId: string) {
  deckStore.removeWidget(props.column.id, installId)
}

// --- Drag & drop reorder (配置タブ内) ---
const { dragFromIndex, dragOverIndex, startDrag } = usePointerReorder({
  dataAttr: 'widget-idx',
  onReorder: (from, to) => {
    if (isSidebar.value) {
      const ids = [...widgetsStore.sidebarWidgetIds]
      const [moved] = ids.splice(from, 1)
      if (!moved) return
      ids.splice(to, 0, moved)
      widgetsStore.reorderSidebar(ids)
    } else {
      const ids = [...(props.column.widgetIds ?? [])]
      const [moved] = ids.splice(from, 1)
      if (!moved) return
      ids.splice(to, 0, moved)
      deckStore.reorderWidgetIds(props.column.id, ids)
    }
  },
})

function handleDragStart(idx: number, e: PointerEvent) {
  startDrag(idx, e)
}

/**
 * 新規ローカル保存ウィジットをライブラリに追加し、ウィジット詳細ウィンドウで開く。
 * column.widgetIds には push しない (= 配置タブには出ない)。
 * 配置はピッカー (= showLibraryPicker) から行う。
 */
function openNewWidgetEditor() {
  const installId = generateWidgetId()
  const now = Date.now()
  widgetsStore.addWidget({
    installId,
    name: `Widget ${installId.slice(4, 12)}`,
    src: '',
    autoRun: false,
    createdAt: now,
    updatedAt: now,
  })
  windowsStore.open('widget-edit', {
    widgetId: installId,
    accountId: props.column.accountId,
  })
}

// --- Library picker (配置タブ Add Widget ボタン) ---
const showLibraryPicker = ref(false)

/** カラムに未配置のライブラリ widget (= 配置可能候補)。 */
const libraryCandidates = computed<WidgetMeta[]>(() => {
  const placed = new Set(
    isSidebar.value
      ? widgetsStore.sidebarWidgetIds
      : (props.column.widgetIds ?? []),
  )
  return widgetsStore.widgets.filter((w) => !placed.has(w.installId))
})

function toggleLibraryPicker() {
  showLibraryPicker.value = !showLibraryPicker.value
}

function placeFromLibrary(widget: WidgetMeta) {
  deckStore.attachWidget(props.column.id, widget.installId)
  showLibraryPicker.value = false
}

function openLibraryWidgetEditor(widget: WidgetMeta) {
  windowsStore.open('widget-edit', {
    widgetId: widget.installId,
    accountId: props.column.accountId,
  })
}

const { confirm } = useConfirm()

/** ライブラリから widget 本体を削除 (コードも消える)。
 *  本体削除前に全 widget カラムから参照を剥がして dangling id を残さない
 *  (widgetsStore 側は sidebarWidgetIds の自動 cleanup のみ)。 */
async function deleteFromLibrary(widget: WidgetMeta) {
  const ok = await confirm({
    title: 'ウィジットを削除',
    message: `「${widget.name}」をライブラリから削除しますか？ウィジットのコードも消えます。この操作は取り消せません。`,
    okLabel: '削除',
    type: 'danger',
  })
  if (!ok) return
  deckStore.detachWidgetFromAllColumns(widget.installId)
  widgetsStore.removeWidget(widget.installId)
}

// --- View tabs (installed / store) ---
// プラグイン/エディタと UX を揃えるため「インストール済み」表記。
// 値はカラム永続化と関わらないため見かけのラベルのみ変更。
type ViewTab = 'installed' | 'store'
const viewTabs: ViewTab[] = ['installed', 'store']
const viewTab = ref<ViewTab>('installed')
const columnContentRef = ref<HTMLElement | null>(null)

const tabDefs = computed<ColumnTabDef[]>(() => [
  { value: 'installed', label: `インストール済み ${widgets.value.length}` },
  { value: 'store', label: 'ストア' },
])

function switchTab(tab: string) {
  const t = tab as ViewTab
  viewTab.value = t
  if (t === 'store') misStore.fetchWidgets()
}

const tabIndex = computed(() => viewTabs.indexOf(viewTab.value))
useTabSlide(tabIndex, columnContentRef)

// --- Store tab ---
const storeQuery = ref('')
const installError = ref<string | null>(null)
const installingId = ref<string | null>(null)

const filteredStoreWidgets = computed(() => {
  const q = storeQuery.value.trim().toLowerCase()
  if (!q) return misStore.widgets
  return misStore.widgets.filter(
    (w) =>
      w.name.toLowerCase().includes(q) ||
      w.description.toLowerCase().includes(q) ||
      w.author.toLowerCase().includes(q) ||
      w.tags.some((t) => t.toLowerCase().includes(q)),
  )
})

const capabilityChecks = computed<Record<string, CapabilityCheck>>(() => {
  const ctx = { accountId: props.column.accountId }
  const result: Record<string, CapabilityCheck> = {}
  for (const w of misStore.widgets) {
    result[w.id] = checkWidgetCapabilities(w.capabilities ?? [], ctx)
  }
  return result
})

/** 既にライブラリにある storeId 集合 (= 「インストール済み」判定)。 */
const installedStoreIds = computed(
  () => new Set(widgetsStore.widgets.map((w) => w.storeId).filter(Boolean)),
)

async function handleStoreInstall(entry: StoreWidgetEntry) {
  if (installingId.value) return
  installError.value = null
  installingId.value = entry.id
  try {
    // 既に同 storeId のライブラリ widget があれば再インストールせず attach のみ。
    // (= 同じ storeId のものを 2 つに増やさない。複数 column で同じ widget を
    //  動かしたいなら別 column 側で同じ widget をピッカーから配置する想定だが、
    //  attachWidget は同 column 内では no-op なので同一カラム重複も起こらない)
    const existing = widgetsStore.widgets.find((w) => w.storeId === entry.id)
    if (existing) {
      deckStore.attachWidget(props.column.id, existing.installId)
      viewTab.value = 'installed'
      return
    }
    const src = await misStore.fetchWidgetSource(entry)
    deckStore.addWidget(props.column.id, {
      name: entry.name,
      src,
      autoRun: entry.autoRun,
      storeId: entry.id,
      iconUrl: entry.iconUrl,
    })
    viewTab.value = 'installed'
  } catch (e) {
    installError.value = e instanceof Error ? e.message : 'インストール失敗'
  } finally {
    installingId.value = null
  }
}

function handleOpenStoreDetail(entry: StoreWidgetEntry) {
  openSafeUrl(getWidgetDetailUrl(entry.id))
}
</script>

<template>
  <DeckColumn :column-id="column.id" :title="column.name ?? 'ウィジェット'" :theme-vars="columnThemeVars" data-column-type="widget" @header-click="scrollToTop">
    <template #header-icon>
      <i class="ti ti-layout-dashboard" />
    </template>

    <template #header-meta>
      <DeckHeaderAccount :account="account" :server-icon-url="serverIconUrl" />
      <button
        v-if="viewTab === 'installed'"
        class="_button"
        :class="$style.headerBtn"
        title="新規ローカルウィジットを作成"
        @click.stop="openNewWidgetEditor"
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

      <!-- ===== Placed tab ===== -->
      <template v-if="viewTab === 'installed'">
        <div ref="widgetBodyRef" :class="$style.widgetColumnBody">
          <ColumnEmptyState
            v-if="showEmptyState"
            message="ウィジェットを追加してカスタマイズしよう"
            :image-url="serverInfoImageUrl"
          />

          <div
            v-for="(widget, idx) in widgets"
            :key="widget.installId"
            :data-widget-idx="idx"
            :class="[
              $style.widgetItem,
              dragFromIndex === idx && $style.widgetItemDragging,
              dragOverIndex === idx && $style.widgetItemDragOver,
            ]"
          >
            <WidgetAiScript
              :widget="widget"
              :column-id="column.id"
              :account-id="column.accountId"
              :is-sidebar="isSidebar"
              @remove="handleRemove(widget.installId)"
              @drag-start="handleDragStart(idx, $event)"
            />
          </div>

          <div :class="$style.addWidgetArea">
            <button
              :class="[$style.addWidgetBtn, showLibraryPicker && $style.addWidgetBtnActive]"
              @click="toggleLibraryPicker"
            >
              <i :class="showLibraryPicker ? 'ti ti-chevron-up' : 'ti ti-plus'" />
              {{ showLibraryPicker ? '閉じる' : 'ウィジットを追加' }}
            </button>
          </div>

          <!-- ===== Library picker ===== -->
          <div v-if="showLibraryPicker" :class="$style.pickerWrap">
            <div v-if="libraryCandidates.length === 0" :class="$style.pickerEmpty">
              ライブラリに配置可能なウィジットがありません。
            </div>
            <WidgetCard
              v-for="w in libraryCandidates"
              :key="w.installId"
              mode="library"
              :name="w.name"
              :description="w.src ? `${w.src.length} chars` : '空のコード'"
              :store-id="w.storeId"
              :icon-url="w.iconUrl"
              @place="placeFromLibrary(w)"
              @edit="openLibraryWidgetEditor(w)"
              @delete="deleteFromLibrary(w)"
            />
          </div>
        </div>
      </template>

      <!-- ===== Store tab ===== -->
      <template v-else>
        <div :class="$style.searchWrap">
          <input
            v-model="storeQuery"
            :class="$style.searchInput"
            type="text"
            placeholder="ストアを探す"
          />
        </div>

        <div v-if="installError" :class="$style.storeError">
          <i class="ti ti-alert-circle" />
          {{ installError }}
          <button class="_button" :class="$style.storeErrorClose" @click="installError = null">
            <i class="ti ti-x" />
          </button>
        </div>

        <div v-if="misStore.widgetsLoading" :class="$style.storeLoading">
          <i class="ti ti-loader-2 nd-spin" />
          読み込み中...
        </div>

        <div v-else-if="misStore.widgetsError" :class="$style.empty">
          <i class="ti ti-cloud-off" :class="$style.emptyIcon" />
          <span>ストアに接続できません</span>
          <button class="_button" :class="$style.emptyLink" @click="misStore.refreshWidgets()">
            再試行
          </button>
        </div>

        <div v-else :class="$style.storeList">
          <WidgetCard
            v-for="entry in filteredStoreWidgets"
            :key="entry.id"
            :name="entry.name"
            :description="entry.description"
            :author="entry.author"
            :version="entry.version"
            :capabilities="entry.capabilities ?? []"
            :capability-ok="capabilityChecks[entry.id]?.ok"
            :capability-reason="capabilityChecks[entry.id]?.reason"
            :installing="installingId === entry.id"
            :already-installed="installedStoreIds.has(entry.id)"
            :icon-url="entry.iconUrl"
            @install="handleStoreInstall(entry)"
            @open-detail="handleOpenStoreDetail(entry)"
          />

          <div v-if="filteredStoreWidgets.length === 0 && !misStore.widgetsLoading" :class="$style.empty">
            一致するウィジェットがありません
          </div>
        </div>
      </template>
    </div>
  </DeckColumn>
</template>

<style lang="scss" module>
.wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
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
    background 0.1s,
    opacity 0.1s;

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }
}

// --- Placed tab ---
.widgetColumnBody {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.widgetItem {
  flex-shrink: 0;
  border: 1px solid var(--nd-divider);
  border-radius: 10px;
  background: var(--nd-panel);
  overflow: hidden;
  contain: layout style paint;
  content-visibility: auto;
  transition: transform 0.12s, box-shadow 0.12s, opacity 0.12s;
}

.widgetItemDragging {
  opacity: 0.45;
}

.widgetItemDragOver {
  border-color: var(--nd-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--nd-accent) 35%, transparent);
}

.addWidgetArea {
  display: flex;
  justify-content: center;
  padding: 6px;
}

.addWidgetBtn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  border: 1px dashed var(--nd-divider);
  border-radius: var(--nd-radius-md);
  background: none;
  color: var(--nd-fg);
  cursor: pointer;
  font-size: 0.85em;
  opacity: 0.5;
  transition: opacity var(--nd-duration-base), border-color var(--nd-duration-base);

  &:hover {
    opacity: 1;
    border-color: var(--nd-accent);
    color: var(--nd-accent);
  }
}

.addWidgetBtnActive {
  opacity: 1;
  border-color: var(--nd-accent);
  color: var(--nd-accent);
}

// --- Library picker ---
// ピッカーは WidgetCard (mode=library) を縦並びで render するだけ。
// カード見た目はストアタブと統一 (= WidgetCard 内部 CSS)。
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

// --- Store tab: search ---
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

// --- Store list (PluginCard 同様、card 内部の `& + &` で divider 描画) ---
.storeList {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

/* ウィジェットカラムのヘッダーはプレーンに（Misskey本家準拠） */
:global(.deck-column[data-column-type="widget"]) {
  :global(.column-header) {
    background: var(--nd-panel);
    box-shadow: none;
    border-bottom: 1px solid var(--nd-divider);
  }

  :global(.color-indicator) {
    display: none;
  }
}
</style>

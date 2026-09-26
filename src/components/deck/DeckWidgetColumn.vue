<script setup lang="ts">
import { computed, defineAsyncComponent, ref, useTemplateRef } from 'vue'
import { isAllAccounts } from '@/columns/accountScope'
import AccountPickerSheet from '@/components/common/AccountPickerSheet.vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import { useAccountPicker } from '@/composables/useAccountPicker'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { usePointerReorder } from '@/composables/usePointerReorder'
import { useServerImages } from '@/composables/useServerImages'
import { useTabSlide } from '@/composables/useTabSlide'
import { i18n } from '@/i18n'
import {
  findWidgetInstance,
  isStoreWidgetInstalled,
} from '@/services/widgetInstances'
import {
  accountScopeKey,
  findAccountByScopeKey,
  getAccountLabel,
  useAccountsStore,
} from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import {
  getWidgetDetailUrl,
  type StoreWidgetEntry,
  useMisStoreStore,
} from '@/stores/misstore'
import { useToast } from '@/stores/toast'
import {
  generateWidgetId,
  useWidgetsStore,
  type WidgetMeta,
} from '@/stores/widgets'
import { useWindowsStore } from '@/stores/windows'
import { openSafeUrl } from '@/utils/url'
import { isWindowExposed } from '@/windows/exposure'
import type { ColumnTabDef } from './ColumnTabs.vue'
import ColumnTabs from './ColumnTabs.vue'
import DeckColumn from './DeckColumn.vue'
import WidgetCard from './WidgetCard.vue'
import {
  type CapabilityCheck,
  checkWidgetCapabilities,
  requiresAccount,
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
const accountsStore = useAccountsStore()
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

/** 配置から外す (可逆)。本体はライブラリに残るので確認は挟まず undo を出す。 */
function handleRemove(installId: string) {
  const undo = deckStore.removeWidget(props.column.id, installId)
  if (undo) {
    useToast().show(i18n.ts._deckWidgetColumn.detached, 'info', {
      action: { label: i18n.ts._deckWidgetColumn.undo, onClick: undo },
    })
  }
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
 * 新規ローカル保存ウィジェットをライブラリに追加し、ウィジェット詳細ウィンドウで開く。
 * column.widgetIds には push しない (= 配置タブには出ない)。
 * 配置はピッカー (= showLibraryPicker) から行う。
 */
async function openNewWidgetEditor() {
  let accountId: string | undefined
  if (isAllAccounts(props.column)) {
    const picked = await pickAccount(
      i18n.ts._deckWidgetColumn.pickAccountForNew,
    )
    if (!picked) return
    accountId = picked
  }
  const installId = generateWidgetId()
  const now = Date.now()
  widgetsStore.addWidget({
    installId,
    name: `Widget ${installId.slice(4, 12)}`,
    src: '',
    autoRun: false,
    accountKey: scopeKeyOf(accountId),
    createdAt: now,
    updatedAt: now,
  })
  windowsStore.open('widget-edit', {
    widgetId: installId,
    accountId: accountId ?? props.column.accountId,
  })
}

/** 内部 UUID → 安定キー (ウィジェットの実行アカウントは安定キーで持つ、#1061) */
function scopeKeyOf(accountId: string | undefined): string | undefined {
  const account = accountId
    ? accountsStore.accountMap.get(accountId)
    : undefined
  return account ? accountScopeKey(account) : undefined
}

/** ウィジェットに固定された実行アカウント (現存しなければ undefined) */
function ownAccountOf(widget: WidgetMeta) {
  if (!widget.accountKey) return undefined
  return findAccountByScopeKey(accountsStore.accounts, widget.accountKey)
}

function ownAccountIdOf(widget: WidgetMeta): string | undefined {
  return ownAccountOf(widget)?.id
}

/** ライブラリピッカーで同名の個体を見分けるためのラベル (#1061) */
function ownAccountLabelOf(widget: WidgetMeta): string | undefined {
  const account = ownAccountOf(widget)
  return account ? getAccountLabel(account) : undefined
}

/**
 * ウィジェットを動かすアカウント (#1018)。ウィジェット固有の指定 → カラムの順。
 * 全アカウントのカラムはそのままだと accountId が決まらず、ウィジェットから
 * Misskey API を一切呼べない (「開けるが使えない」)。まだ決まっていなければ
 * 選ばせて、以後そのウィジェットに固定する。キャンセルは undefined。
 */
async function resolveWidgetAccountId(
  widget: WidgetMeta,
): Promise<string | null | undefined> {
  const own = ownAccountIdOf(widget)
  if (own) return own
  if (!isAllAccounts(props.column)) return props.column.accountId
  const picked = await pickAccount(
    i18n.tsx._deckWidgetColumn.pickAccountFor({ name: widget.name }),
  )
  if (!picked) return undefined
  widgetsStore.setAccountKey(widget.installId, scopeKeyOf(picked))
  return picked
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

async function openLibraryWidgetEditor(widget: WidgetMeta) {
  const accountId = await resolveWidgetAccountId(widget)
  if (accountId === undefined) return
  windowsStore.open('widget-edit', {
    widgetId: widget.installId,
    accountId,
  })
}

const { confirm } = useConfirm()
const {
  pickAccount,
  pickableAccounts,
  hasPickableAccount,
  sheetPurpose,
  resolveSheet,
} = useAccountPicker()

/** ライブラリから widget 本体を削除 (コードも消える)。
 *  本体削除前に全 widget カラムから参照を剥がして dangling id を残さない
 *  (widgetsStore 側は sidebarWidgetIds の自動 cleanup のみ)。 */
async function deleteFromLibrary(widget: WidgetMeta) {
  const ok = await confirm({
    title: i18n.ts._deckWidgetColumn.deleteTitle,
    message: i18n.tsx._deckWidgetColumn.deleteConfirm({ name: widget.name }),
    okLabel: i18n.ts._common.delete,
    type: 'danger',
  })
  if (!ok) return
  deckStore.detachWidgetFromAllColumns(widget.installId)
  const undo = widgetsStore.removeWidget(widget.installId)
  if (undo) {
    useToast().show(i18n.ts._deckWidgetColumn.deleted, 'info', {
      action: { label: i18n.ts._deckWidgetColumn.undo, onClick: undo },
    })
  }
}

// --- View tabs (installed / store) ---
// プラグイン/エディタと UX を揃えるため「インストール済み」表記。
// 値はカラム永続化と関わらないため見かけのラベルのみ変更。
type ViewTab = 'installed' | 'store'
const viewTabs: ViewTab[] = ['installed', 'store']
const viewTab = ref<ViewTab>('installed')
const columnContentRef = ref<HTMLElement | null>(null)

const tabDefs = computed<ColumnTabDef[]>(() => [
  {
    value: 'installed',
    label: i18n.tsx._deckWidgetColumn.installedTab({
      count: widgets.value.length,
    }),
  },
  { value: 'store', label: i18n.ts._common.store },
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
  const ctx = {
    accountId: props.column.accountId,
    // 全アカウントのカラムは install 時に実行アカウントを選ばせるので、
    // アカウント必須の capability でも止めない (#1018)
    canPickAccount: isAllAccounts(props.column) && hasPickableAccount.value,
  }
  const result: Record<string, CapabilityCheck> = {}
  for (const w of misStore.widgets) {
    result[w.id] = checkWidgetCapabilities(w.capabilities ?? [], ctx)
  }
  return result
})

/**
 * ストアカードの「インストール済み」判定 (#1061)。個体は storeId × 実行
 * アカウントの組なので、全アカウントのカラムでは「選べるアカウント全部に
 * 個体が揃っているか」を見る。未インストールのアカウントが残るうちは
 * 通常の状態で出す (プラグインのスコープ別判定と同じ粒度)。
 */
const installedStoreIds = computed(() => {
  const scope = isAllAccounts(props.column)
    ? ({
        kind: 'all',
        accountKeys: pickableAccounts.value.map((a) => accountScopeKey(a)),
      } as const)
    : ({
        kind: 'account',
        key: scopeKeyOf(props.column.accountId ?? undefined) ?? '',
      } as const)
  const result = new Set<string>()
  for (const entry of misStore.widgets) {
    const installed = isStoreWidgetInstalled(widgetsStore.widgets, entry.id, {
      requiresAccount: requiresAccount(entry.capabilities ?? []),
      scope,
    })
    if (installed) result.add(entry.id)
  }
  return result
})

async function handleStoreInstall(entry: StoreWidgetEntry) {
  if (installingId.value) return
  installError.value = null
  installingId.value = entry.id
  try {
    // 全アカウントのカラムはどのアカウントで動かすかが決まらないので、
    // アカウント必須のアイテムは先に選ばせる (#1018)。個体は storeId ×
    // 実行アカウントの組で 1 つ (#1061): 同じ組が既にあれば attach のみ、
    // 別アカウントなら新しい個体を作る。
    let accountId: string | undefined
    if (
      requiresAccount(entry.capabilities ?? []) &&
      isAllAccounts(props.column)
    ) {
      const picked = await pickAccount(
        i18n.tsx._deckWidgetColumn.pickAccountFor({ name: entry.name }),
      )
      if (!picked) return
      accountId = picked
    }
    const accountKey = scopeKeyOf(accountId)
    const existing = findWidgetInstance(
      widgetsStore.widgets,
      entry.id,
      accountKey,
    )
    if (existing) {
      deckStore.attachWidget(props.column.id, existing.installId)
      viewTab.value = 'installed'
      return
    }
    // sha512 検証と baseline 記録は misstore 側の経路に一本化する
    const widget = await misStore.installWidget(entry, accountKey)
    deckStore.attachWidget(props.column.id, widget.installId)
    viewTab.value = 'installed'
  } catch (e) {
    installError.value =
      e instanceof Error ? e.message : i18n.ts._deckWidgetColumn.installFailed
  } finally {
    installingId.value = null
  }
}

async function handleStoreUpdate(entry: StoreWidgetEntry) {
  installError.value = null
  try {
    await misStore.updateWidget(entry)
  } catch (e) {
    installError.value =
      e instanceof Error ? e.message : i18n.ts._deckWidgetColumn.updateFailed
  }
}

function handleOpenStoreDetail(entry: StoreWidgetEntry) {
  openSafeUrl(getWidgetDetailUrl(entry.id))
}
</script>

<template>
  <DeckColumn :column-id="column.id" :title="column.name ?? i18n.ts._columns.widget" :theme-vars="columnThemeVars" data-column-type="widget" @header-click="scrollToTop">
    <template #header-icon>
      <i class="ti ti-layout-dashboard" />
    </template>

    <template #header-meta>
      <button
        v-if="viewTab === 'installed' && isWindowExposed('widget-edit')"
        class="_button"
        :class="$style.headerBtn"
        :title="i18n.ts._deckWidgetColumn.createLocal"
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
            :message="i18n.ts._deckWidgetColumn.empty"
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
              :account-id="ownAccountIdOf(widget) ?? column.accountId"
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
              {{ showLibraryPicker ? i18n.ts._common.close : i18n.ts._deckWidgetColumn.addWidget }}
            </button>
          </div>

          <!-- ===== Library picker ===== -->
          <div v-if="showLibraryPicker" :class="$style.pickerWrap">
            <div v-if="libraryCandidates.length === 0" :class="$style.pickerEmpty">
              {{ i18n.ts._deckWidgetColumn.noLibraryWidgets }}
            </div>
            <WidgetCard
              v-for="w in libraryCandidates"
              :key="w.installId"
              mode="library"
              :name="w.name"
              :description="w.src ? `${w.src.length} chars` : i18n.ts._deckWidgetColumn.emptyCode"
              :store-id="w.storeId"
              :icon-url="w.iconUrl"
              :account-label="ownAccountLabelOf(w)"
              :read-only="w.readOnly"
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
            :placeholder="i18n.ts._common.browseStore"
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
          {{ i18n.ts._common.loading }}
        </div>

        <div v-else-if="misStore.widgetsError" :class="$style.empty">
          <i class="ti ti-cloud-off" :class="$style.emptyIcon" />
          <span>{{ i18n.ts._common.storeUnavailable }}</span>
          <button class="_button" :class="$style.emptyLink" @click="misStore.refreshWidgets()">
            {{ i18n.ts._common.retry }}
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
            :capability-badge="capabilityChecks[entry.id]?.badge"
            :capability-reason="capabilityChecks[entry.id]?.reason"
            :installing="installingId === entry.id || misStore.installingWidget === entry.id"
            :already-installed="installedStoreIds.has(entry.id)"
            :has-update="misStore.hasWidgetUpdate(entry)"
            :updated-at="entry.updatedAt"
            :icon-url="entry.iconUrl"
            @install="handleStoreInstall(entry)"
            @update="handleStoreUpdate(entry)"
            @open-detail="handleOpenStoreDetail(entry)"
          />

          <div v-if="filteredStoreWidgets.length === 0 && !misStore.widgetsLoading" :class="$style.empty">
            {{ i18n.ts._deckWidgetColumn.noMatches }}
          </div>
        </div>
      </template>
    </div>
  </DeckColumn>

  <!-- 実行アカウントの選択 (コンパクト表示のみ。デスクトップはコマンドパレット) -->
  <AccountPickerSheet
    :show="sheetPurpose !== null"
    :accounts="pickableAccounts"
    :title="i18n.ts._deckWidgetColumn.selectAccount"
    :description="sheetPurpose ?? undefined"
    @select="resolveSheet($event)"
    @close="resolveSheet(null)"
  />
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
  transition: transform 0.12s, opacity 0.12s;
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

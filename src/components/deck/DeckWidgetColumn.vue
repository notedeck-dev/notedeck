<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { isAllAccounts } from '@/columns/accountScope'
import AccountPickerSheet from '@/components/common/AccountPickerSheet.vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import { useAccountPicker } from '@/composables/useAccountPicker'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { usePointerReorder } from '@/composables/usePointerReorder'
import { i18n } from '@/i18n'
import type { ScopeTarget } from '@/services/distributable'
import {
  findWidgetByStore,
  isStoreWidgetInstalled,
} from '@/services/widgetInstances'
import type { WidgetPlacement } from '@/services/widgetPlacement'
import {
  accountScopeKey,
  findAccountByScopeKey,
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
  type WidgetItem,
} from '@/stores/widgets'
import { useWindowsStore } from '@/stores/windows'
import { openSafeUrl } from '@/utils/url'
import { isWindowExposed } from '@/windows/exposure'
import DeckDistributableColumn, {
  type StoreFeedDecl,
} from './DeckDistributableColumn.vue'
import WidgetCard from './WidgetCard.vue'
import {
  type CapabilityCheck,
  checkWidgetCapabilities,
  requiresAccount,
} from './widgets/capabilities'

const WidgetAiScript = defineAsyncComponent(
  () => import('./widgets/WidgetAiScript.vue'),
)

/**
 * ウィジェットカラム。殻は `DeckDistributableColumn` (#1202 段階 3) で、導入済み
 * タブの一覧だけは差し替える: 他の配布物は「スコープに参加した本体」を並べるが、
 * ウィジェットは「このカラムの配置」(本体 + 実行アカウント) を動かして見せる。
 * 本体は紐付け配列で共有し、実行アカウントは配置 (`widgetRefs`) が持つ
 * (#1202 決定 (b) / (g))
 */

const props = defineProps<{
  column: DeckColumnType
}>()

const deckStore = useDeckStore()
const widgetsStore = useWidgetsStore()
const misStore = useMisStoreStore()
const windowsStore = useWindowsStore()
const accountsStore = useAccountsStore()
widgetsStore.ensureLoaded()
useColumnSetup(() => props.column)

const shell = ref<{
  closePicker(): void
  showTab(tab: 'installed' | 'store'): void
} | null>(null)

/**
 * sidebar widget カラム (ナビバートグルで開閉) は sidebarPlacements[] を参照し、
 * non-sidebar widget カラムはカラム自身の widgetRefs[] を参照する。
 * 追加・削除の責務は deckStore 側に集約 (sidebar 判定は内部で実施)。
 */
const isSidebar = computed(() => props.column.sidebar === true)

const placements = computed<readonly WidgetPlacement[]>(() =>
  isSidebar.value
    ? widgetsStore.sidebarPlacements
    : (props.column.widgetRefs ?? []),
)

/**
 * 配置を動かすアカウント (#1018 / #1202 決定 (g))。配置の実行アカウント →
 * カラムのアカウントの順。全アカウントカラムで未指定なら null (Misskey API は
 * 呼べない)。配置が指すアカウントが現存しなければ null
 */
function accountIdOf(placement: WidgetPlacement): string | null {
  if (placement.accountKey) {
    return (
      findAccountByScopeKey(accountsStore.accounts, placement.accountKey)?.id ??
      null
    )
  }
  return props.column.accountId
}

interface PlacedWidget {
  placement: WidgetPlacement
  widget: WidgetItem
  accountId: string | null
}

const placed = computed<PlacedWidget[]>(() =>
  placements.value.flatMap((placement) => {
    const widget = widgetsStore.get(placement.id)
    if (!widget) return []
    return [{ placement, widget, accountId: accountIdOf(placement) }]
  }),
)

function placementKey(p: WidgetPlacement): string {
  return `${p.id}\u0000${p.accountKey ?? ''}`
}

const showEmptyState = computed(
  () => placed.value.length === 0 && props.column.accountId !== null,
)

/** 配置から外す (可逆)。本体はライブラリに残るので確認は挟まず undo を出す。 */
function handleRemove(placement: WidgetPlacement) {
  const undo = deckStore.removeWidget(props.column.id, placement)
  if (undo) {
    useToast().show(i18n.ts._deckWidgetColumn.detached, 'info', {
      action: { label: i18n.ts._common.undo, onClick: undo },
    })
  }
}

// --- Drag & drop reorder (配置タブ内) ---
const { dragFromIndex, dragOverIndex, startDrag } = usePointerReorder({
  dataAttr: 'widget-idx',
  onReorder: (from, to) => {
    const refs = [...placements.value]
    const [moved] = refs.splice(from, 1)
    if (!moved) return
    refs.splice(to, 0, moved)
    if (isSidebar.value) widgetsStore.reorderSidebar(refs)
    else deckStore.reorderWidgetRefs(props.column.id, refs)
  },
})

function handleDragStart(idx: number, e: PointerEvent) {
  startDrag(idx, e)
}

/** 内部 UUID → 安定キー (紐付けと配置はアカウントの安定キーで持つ、#1061) */
function scopeKeyOf(accountId: string | null | undefined): string | undefined {
  const account = accountId
    ? accountsStore.accountMap.get(accountId)
    : undefined
  return account ? accountScopeKey(account) : undefined
}

/**
 * このカラムが参加させるスコープ (#1018)。全アカウントカラムは全体、
 * per-account カラムはそのアカウント。アカウントが見つからない (ログアウト済)
 * なら null
 */
const columnScopeTarget = computed<ScopeTarget | null>(() => {
  if (isAllAccounts(props.column)) return { kind: 'global' }
  const key = scopeKeyOf(props.column.accountId)
  return key ? { kind: 'account', key } : null
})

/**
 * 全アカウントカラムで配置の実行アカウントを決める (#1018)。全アカウントの
 * カラムはそのままだと accountId が決まらず、ウィジェットから Misskey API を
 * 一切呼べない (「開けるが使えない」)。per-account カラムはカラムのアカウント。
 * キャンセルは undefined
 */
async function pickPlacementAccount(
  name: string,
): Promise<{ accountId: string | null; accountKey?: string } | undefined> {
  if (!isAllAccounts(props.column)) {
    return { accountId: props.column.accountId }
  }
  const picked = await pickAccount(
    i18n.tsx._deckWidgetColumn.pickAccountFor({ name }),
  )
  if (!picked) return undefined
  return { accountId: picked, accountKey: scopeKeyOf(picked) }
}

/**
 * 新規ローカル保存ウィジェットをライブラリに追加し、ウィジェット詳細ウィンドウで開く。
 * カラムには配置しない (= 配置タブには出ない)。配置はピッカーから行う。
 * このカラムの文脈で作る = そのスコープに参加した状態で始める
 */
async function openNewWidgetEditor() {
  let accountId: string | null | undefined = props.column.accountId
  if (isAllAccounts(props.column)) {
    const picked = await pickAccount(
      i18n.ts._deckWidgetColumn.pickAccountForNew,
    )
    if (!picked) return
    accountId = picked
  }
  const target = columnScopeTarget.value
  const id = generateWidgetId()
  const widget = await widgetsStore.add({
    id,
    name: `Widget ${id.slice(4, 12)}`,
    content: '',
    scope: {
      kind: 'shared',
      global: target?.kind === 'global',
      installedFor: target?.kind === 'account' ? [target.key] : [],
    },
    extra: { autoRun: false },
  })
  windowsStore.open('widget-edit', { widgetId: widget.id, accountId })
}

// --- Library picker ---

/**
 * 配置可能な本体。per-account カラムではこのカラムに未配置の本体、全アカウント
 * カラムでは全部 (同じ本体を別のアカウントで置き直せる)
 */
const libraryCandidates = computed<WidgetItem[]>(() => {
  if (isAllAccounts(props.column)) return widgetsStore.items
  const placedIds = new Set(placements.value.map((p) => p.id))
  return widgetsStore.items.filter((w) => !placedIds.has(w.id))
})

/** ライブラリから配置する。本体をこのカラムのスコープに参加させ、配置を足す */
async function placeFromLibrary(widget: WidgetItem) {
  const picked = await pickPlacementAccount(widget.name)
  if (!picked) return
  const target: ScopeTarget | null = picked.accountKey
    ? { kind: 'account', key: picked.accountKey }
    : columnScopeTarget.value
  if (target) await widgetsStore.link(widget.id, target)
  deckStore.attachWidget(props.column.id, {
    id: widget.id,
    ...(picked.accountKey ? { accountKey: picked.accountKey } : {}),
  })
  shell.value?.closePicker()
}

async function openLibraryWidgetEditor(widget: WidgetItem) {
  const picked = await pickPlacementAccount(widget.name)
  if (!picked) return
  windowsStore.open('widget-edit', {
    widgetId: widget.id,
    accountId: picked.accountId,
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
 *  本体削除前に全 widget カラムから配置を剥がして dangling id を残さない
 *  (widgetsStore 側は sidebarPlacements の自動 cleanup のみ)。 */
async function deleteFromLibrary(widget: WidgetItem) {
  const ok = await confirm({
    title: i18n.ts._deckWidgetColumn.deleteTitle,
    message: i18n.tsx._deckWidgetColumn.deleteConfirm({ name: widget.name }),
    okLabel: i18n.ts._common.delete,
    type: 'danger',
  })
  if (!ok) return
  deckStore.detachWidgetFromAllColumns(widget.id)
  const undo = await widgetsStore.remove(widget.id)
  if (undo) {
    useToast().show(i18n.ts._deckWidgetColumn.deleted, 'info', {
      action: { label: i18n.ts._common.undo, onClick: undo },
    })
  }
}

const texts = computed(() => ({
  noMatches: i18n.ts._deckWidgetColumn.noMatches,
  empty: i18n.ts._deckWidgetColumn.empty,
  noLibrary: i18n.ts._deckWidgetColumn.noLibraryWidgets,
}))

// --- Store tab ---
const installingId = ref<string | null>(null)

const storeFeed = computed<StoreFeedDecl<StoreWidgetEntry>>(() => ({
  entries: misStore.widgets,
  loading: misStore.widgetsLoading,
  error: misStore.widgetsError,
  fetch: () => misStore.fetchWidgets(),
  refresh: () => misStore.refreshWidgets(),
}))

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
 * ストアカードの「インストール済み」判定 (#1061 / #1202)。本体は storeId に
 * つき 1 つで、どのアカウントで選べるかは紐付け。全アカウントのカラムでは
 * 「選べるアカウント全部が紐付けにあるか」を見る (他の kind より厳しい —
 * アカウント必須のウィジェットはアカウントごとに置き直すため)
 */
const installedStoreIds = computed(() => {
  const scope = isAllAccounts(props.column)
    ? ({
        kind: 'all',
        accountKeys: pickableAccounts.value.map((a) => accountScopeKey(a)),
      } as const)
    : ({
        kind: 'account',
        key: scopeKeyOf(props.column.accountId) ?? '',
      } as const)
  const result = new Set<string>()
  for (const entry of misStore.widgets) {
    const installed = isStoreWidgetInstalled(widgetsStore.items, entry.id, {
      requiresAccount: requiresAccount(entry.capabilities ?? []),
      scope,
    })
    if (installed) result.add(entry.id)
  }
  return result
})

/**
 * 全アカウントのカラムはどのアカウントで動かすかが決まらないので、アカウント
 * 必須のアイテムは先に選ばせる (#1018)。本体は storeId につき 1 つ (#1202 決定
 * (b)): 既にあれば参加先を足して配置するだけ。配置したら導入済みタブへ戻る
 */
async function installEntry(entry: StoreWidgetEntry): Promise<void> {
  if (installingId.value) return
  installingId.value = entry.id
  try {
    let accountKey: string | undefined
    if (
      requiresAccount(entry.capabilities ?? []) &&
      isAllAccounts(props.column)
    ) {
      const picked = await pickAccount(
        i18n.tsx._deckWidgetColumn.pickAccountFor({ name: entry.name }),
      )
      if (!picked) return
      accountKey = scopeKeyOf(picked)
    }
    const target: ScopeTarget | null = accountKey
      ? { kind: 'account', key: accountKey }
      : columnScopeTarget.value
    const placement: WidgetPlacement = {
      id: '',
      ...(accountKey ? { accountKey } : {}),
    }
    const existing = findWidgetByStore(widgetsStore.items, entry.id)
    if (existing) {
      if (target) await widgetsStore.link(existing.id, target)
      deckStore.attachWidget(props.column.id, { ...placement, id: existing.id })
    } else {
      // sha512 検証と baseline 記録は misstore 側の経路に一本化する
      const widget = await misStore.installWidget(entry, target ?? undefined)
      deckStore.attachWidget(props.column.id, { ...placement, id: widget.id })
    }
    shell.value?.showTab('installed')
  } finally {
    installingId.value = null
  }
}

function openStoreDetail(entry: StoreWidgetEntry) {
  openSafeUrl(getWidgetDetailUrl(entry.id))
}
</script>

<template>
  <DeckDistributableColumn
    ref="shell"
    :column="column"
    :title="i18n.ts._columns.widget"
    icon="layout-dashboard"
    :create-title="i18n.ts._deckWidgetColumn.createLocal"
    :can-create="isWindowExposed('widget-edit')"
    :installed-count="placed.length"
    :library-candidates="libraryCandidates"
    :picker-label="i18n.ts._deckWidgetColumn.addWidget"
    :texts="texts"
    :store="storeFeed"
    @create="openNewWidgetEditor"
  >
    <template #installed="{ serverInfoImageUrl }">
      <div :class="$style.widgetColumnBody">
        <ColumnEmptyState
          v-if="showEmptyState"
          :message="i18n.ts._deckWidgetColumn.empty"
          :image-url="serverInfoImageUrl"
        />

        <div
          v-for="(entry, idx) in placed"
          :key="placementKey(entry.placement)"
          :data-widget-idx="idx"
          :class="[
            $style.widgetItem,
            dragFromIndex === idx && $style.widgetItemDragging,
            dragOverIndex === idx && $style.widgetItemDragOver,
          ]"
        >
          <WidgetAiScript
            :widget="entry.widget"
            :column-id="column.id"
            :account-id="entry.accountId"
            :is-sidebar="isSidebar"
            @remove="handleRemove(entry.placement)"
            @drag-start="handleDragStart(idx, $event)"
          />
        </div>
      </div>
    </template>

    <template #card="{ item: w }">
      <WidgetCard
        mode="library"
        :name="w.name"
        :description="w.content ? `${w.content.length} chars` : i18n.ts._deckWidgetColumn.emptyCode"
        :store-id="w.store?.id"
        :icon-url="w.iconUrl"
        :read-only="w.readOnly"
        @place="placeFromLibrary(w)"
        @edit="openLibraryWidgetEditor(w)"
        @delete="deleteFromLibrary(w)"
      />
    </template>

    <template #store-card="{ entry, run }">
      <WidgetCard
        mode="store"
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
        @install="run(() => installEntry(entry))"
        @update="run(() => misStore.updateWidget(entry), i18n.ts._common.updateFailed)"
        @open-detail="openStoreDetail(entry)"
      />
    </template>
  </DeckDistributableColumn>

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
// --- 配置タブ ---
.widgetColumnBody {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
}

.widgetItem {
  flex-shrink: 0;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-lg);
  background: var(--nd-panel);
  overflow: hidden;
  contain: layout style paint;
  content-visibility: auto;
  transition: transform var(--nd-duration-base), opacity var(--nd-duration-base);
}

.widgetItemDragging {
  opacity: 0.45;
}

.widgetItemDragOver {
  border-color: var(--nd-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--nd-accent) 35%, transparent);
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

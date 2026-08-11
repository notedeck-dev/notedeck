<script setup lang="ts">
import { json } from '@codemirror/lang-json'
import JSON5 from 'json5'
import {
  computed,
  defineAsyncComponent,
  nextTick,
  ref,
  toRaw,
  watch,
} from 'vue'
import ColumnBadges from '@/components/common/ColumnBadges.vue'
import EditorTabs from '@/components/common/EditorTabs.vue'
import type { ReorderableItem } from '@/components/common/ReorderableList.vue'
import ReorderableList from '@/components/common/ReorderableList.vue'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { COLUMN_ICONS, COLUMN_LABELS } from '@/composables/useColumnTabs'
import { useDoubleConfirm } from '@/composables/useDoubleConfirm'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { usePointerReorder } from '@/composables/usePointerReorder'
import { useWindowExternalFile } from '@/composables/useWindowExternalFile'
import { isExposed } from '@/settings/exposure'
import { getAccountAvatarUrl, useAccountsStore } from '@/stores/accounts'
import type { DeckColumn } from '@/stores/deck'
import {
  type ColumnType,
  DEFAULT_NAV_ITEMS,
  type NavItem,
  useDeckStore,
} from '@/stores/deck'
import { useServersStore } from '@/stores/servers'
import { useIsCompactLayout } from '@/stores/ui'

const AddColumnDialog = defineAsyncComponent(
  () => import('@/components/deck/AddColumnDialog.vue'),
)
const CodeEditor = defineAsyncComponent(
  () => import('@/components/deck/widgets/CodeEditor.vue'),
)

const accountsStore = useAccountsStore()
const serversStore = useServersStore()
const deckStore = useDeckStore()
const isCompact = useIsCompactLayout()
const jsonLang = json()

function itemAvatarUrl(item: NavColumnItem): string | null {
  if (!item.accountId) return null
  const account = accountsStore.accounts.find((a) => a.id === item.accountId)
  return account ? getAccountAvatarUrl(account) : null
}

function itemServerIconUrl(item: NavColumnItem): string | null {
  if (!item.accountId) return null
  const account = accountsStore.accounts.find((a) => a.id === item.accountId)
  if (!account) return null
  const server = serversStore.servers.get(account.host)
  return server?.iconUrl ?? `https://${account.host}/favicon.ico`
}

const props = defineProps<{
  initialTab?: string
}>()

// ── Tab management ──
// 生ファイルを直接編集する code タブは開発者向けの面 (#1034)。アピアランス /
// キーバインド / テーマ / 権限と同じ宣言的 opt-in
const editorTabs = computed(() =>
  isExposed('developer')
    ? (['visual', 'code'] as const)
    : (['visual'] as const),
)

const { tab, containerRef: contentRef } = useEditorTabs<'visual' | 'code'>(
  editorTabs,
  props.initialTab === 'code' && !isExposed('developer')
    ? 'visual'
    : ((props.initialTab as 'visual' | 'code') ?? 'visual'),
)

useWindowExternalFile(() =>
  tab.value === 'code' ? { name: 'navbar.json5' } : null,
)

function getItemIcon(item: NavColumnItem): string {
  return `ti-${COLUMN_ICONS[item.type] ?? 'layout-grid'}`
}

function getItemLabel(item: NavColumnItem): string {
  return item.label || COLUMN_LABELS[item.type] || item.type
}

// ── Visual tab state ──
type NavColumnItem = Exclude<NavItem, { type: 'divider' }>

const items = ref<NavColumnItem[]>(
  structuredClone(toRaw(deckStore.navItems)).filter(
    (item): item is NavColumnItem => item.type !== 'divider',
  ),
)

/** Skip watcher during reset to avoid re-storing defaults as overrides */
let skipSave = false

watch(
  items,
  (v) => {
    if (skipSave) return
    deckStore.setNavItems(v)
  },
  { deep: true },
)

function removeItem(index: number) {
  items.value.splice(index, 1)
}

// ── Mobile: ReorderableList items ──
const reorderableItems = computed<ReorderableItem[]>(() =>
  items.value.map((item) => ({
    icon: COLUMN_ICONS[item.type] ?? 'layout-grid',
    label: getItemLabel(item),
    avatarUrl: itemAvatarUrl(item),
    serverIconUrl: itemServerIconUrl(item),
  })),
)

function onMobileReorder(fromIdx: number, toIdx: number) {
  const arr = [...items.value]
  const [moved] = arr.splice(fromIdx, 1)
  if (moved) {
    arr.splice(toIdx, 0, moved)
    items.value = arr
  }
}

// ── Pointer-based drag & drop (desktop) ──
const { dragFromIndex, dragOverIndex, startDrag } = usePointerReorder({
  dataAttr: 'nav-idx',
  onReorder: onMobileReorder,
})

// ── Add via AddColumnDialog ──
function onColumnSelected(config: Omit<DeckColumn, 'id'>) {
  // Extract extra column properties (channelId, userId, etc.)
  const { type, accountId, name, width, active, sidebar, ...rest } = config
  const item: NavItem = {
    type,
    accountId: accountId ?? null,
    label: name ?? undefined,
    ...(Object.keys(rest).length > 0 ? { columnProps: rest } : {}),
  }
  items.value.push(item)
}

// ── Code tab (overrides: null = デフォルト使用) ──
function itemsToJson(): string {
  if (!deckStore.isNavCustomized) return 'null'
  return JSON5.stringify(items.value, null, 2)
}

const jsonCode = ref(itemsToJson())
const codeError = ref<string | null>(null)

watch(tab, (t) => {
  if (t === 'code') {
    jsonCode.value = itemsToJson()
    codeError.value = null
  }
})

watch(items, () => {
  if (tab.value === 'code') {
    const storeJson = itemsToJson()
    if (storeJson !== jsonCode.value) {
      jsonCode.value = storeJson
    }
  }
})

function applyFromCode() {
  const code = jsonCode.value
  try {
    const parsed = JSON5.parse(code)
    if (parsed === null) {
      skipSave = true
      items.value = structuredClone(DEFAULT_NAV_ITEMS).filter(
        (item): item is NavColumnItem => item.type !== 'divider',
      )
      deckStore.setNavItems(undefined)
      nextTick(() => {
        skipSave = false
      })
      codeError.value = null
      return
    }
    if (!Array.isArray(parsed)) {
      codeError.value = '配列または null が必要です'
      return
    }
    items.value = (parsed as NavItem[]).filter(
      (item): item is NavColumnItem => item.type !== 'divider',
    )
    codeError.value = null
  } catch (e) {
    codeError.value = e instanceof Error ? e.message : '無効な JSON5'
  }
}

// ── Actions ──
const { copied: copiedMessage, showCopied } = useClipboardFeedback()
const { confirming: confirmingReset, trigger: triggerReset } =
  useDoubleConfirm()

function handleReset() {
  triggerReset(() => {
    skipSave = true
    items.value = structuredClone(DEFAULT_NAV_ITEMS).filter(
      (item): item is NavColumnItem => item.type !== 'divider',
    )
    deckStore.setNavItems(undefined)
    nextTick(() => {
      skipSave = false
    })
  })
}

async function exportNav() {
  try {
    await navigator.clipboard.writeText(itemsToJson())
    showCopied()
  } catch {
    /* clipboard access denied */
  }
}

async function importNav() {
  try {
    const text = await navigator.clipboard.readText()
    const parsed = JSON5.parse(text)
    if (!Array.isArray(parsed)) return
    items.value = (parsed as NavItem[]).filter(
      (item): item is NavColumnItem => item.type !== 'divider',
    )
  } catch {
    /* clipboard access denied or invalid */
  }
}
</script>

<template>
  <div ref="contentRef" :class="$style.editor">
    <EditorTabs
      v-model="tab"
      :tabs="[
        { value: 'visual', icon: 'adjustments', label: 'ビジュアル' },
        ...(isExposed('developer')
          ? [{ value: 'code', icon: 'code', label: 'コード' }]
          : []),
      ]"
    />

    <!-- Visual tab -->
    <div v-show="tab === 'visual'" :class="$style.visualPanel">
      <!-- Mobile: row list with move buttons -->
      <div v-if="isCompact" :class="$style.mobilePanel">
        <div :class="$style.mobileSectionHeader">
          <i class="ti ti-list" />
          現在のアイテム
          <span :class="$style.mobileSectionBadge">{{ items.length }}</span>
        </div>

        <ReorderableList
          :items="reorderableItems"
          data-attr="nav-idx"
          @reorder="onMobileReorder"
          @remove="removeItem"
        />

        <div :class="$style.mobileSectionHeader">
          <i class="ti ti-plus" />
          アイテムを追加
        </div>

        <AddColumnDialog
          mode="pip"
          @column-selected="onColumnSelected"
        />
      </div>

      <!-- Desktop: icon grid with drag & drop -->
      <div v-else :class="$style.columns">
        <!-- Left: nav preview (vertical, drag & drop) -->
        <div :class="$style.previewPane">

          <div :class="$style.navPreview">
            <div
              v-for="(item, i) in items"
              :key="i"
              :data-nav-idx="i"
              :class="[$style.navTab, { [$style.dragging]: dragFromIndex === i, [$style.dragOver]: dragOverIndex === i }]"
              :title="getItemLabel(item)"
              @pointerdown="startDrag(i, $event)"
            >
              <div :class="$style.iconWrap">
                <i :class="['ti', getItemIcon(item)]" />
                <ColumnBadges :account-id="item.accountId" :size="14" />
              </div>
              <button class="_button" :class="$style.tabRemoveBtn" @click.stop="removeItem(i)">
                <i class="ti ti-x" />
              </button>
            </div>
            <div v-if="items.length === 0" :class="$style.empty">項目なし</div>
          </div>
        </div>

        <!-- Right: AddColumnDialog (pip, always visible) -->
        <div :class="$style.addPane">
          <AddColumnDialog
            mode="pip"
            @column-selected="onColumnSelected"
          />
        </div>
      </div>
    </div>

    <!-- Code tab -->
    <div v-show="tab === 'code'" :class="$style.codePanel">
      <div :class="$style.codeHint">
        デフォルト値からの差分 — null はデフォルト設定を使用
      </div>
      <CodeEditor
        v-model="jsonCode"
        :language="jsonLang"
        :class="[$style.codeEditorWrap, { [$style.hasError]: codeError }]"
        auto-height
      />
      <div v-if="codeError" :class="$style.errorMessage">
        <i class="ti ti-alert-triangle" />
        {{ codeError }}
      </div>
      <div v-if="!codeError && jsonCode.trim() && jsonCode.trim() !== '[]' && jsonCode.trim() !== 'null'" :class="$style.codeSuccess">
        <i class="ti ti-check" />
        適用中
      </div>
      <button class="_button" :class="$style.codeApplyBtn" @click="applyFromCode">
        <i class="ti ti-refresh" />
        ビジュアルに同期
      </button>
    </div>

    <!-- Actions (footer) -->
    <div :class="$style.actions">
      <div :class="$style.actionGroup">
        <button
          class="_button"
          :class="[$style.actionBtn, $style.secondary]"
          @click="importNav"
        >
          <i class="ti ti-clipboard-text" />
          インポート
        </button>
        <button
          class="_button"
          :class="[$style.actionBtn, $style.secondary, { [$style.feedback]: copiedMessage }]"
          @click="exportNav"
        >
          <i class="ti ti-clipboard-copy" />
          {{ copiedMessage ? 'コピー済み' : 'エクスポート' }}
        </button>
      </div>
      <button
        class="_button"
        :class="[$style.actionBtn, $style.danger, { [$style.confirming]: confirmingReset }]"
        @click="handleReset"
      >
        <i class="ti ti-trash" />
        {{ confirmingReset ? '本当にリセット？' : 'デフォルトに戻す' }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

// ── Visual tab ──

.visualPanel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.columns {
  display: flex;
  flex: 1;
  min-height: 0;
}

// ── Left: nav preview ──

.previewPane {
  display: flex;
  flex-direction: column;
  padding: 8px 0;
  border-right: 1px solid var(--nd-divider);
  width: 56px;
  flex-shrink: 0;
  overflow-y: auto;
  scrollbar-width: thin;
}

.navPreview {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0 0;
  background: var(--nd-panel);
  border-radius: var(--nd-radius-sm);
}

// Mirrors collapsed navbar icon style (44×44, circle)
.navTab {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: 2px auto;
  font-size: 1rem;
  color: var(--nd-navFg, var(--nd-fg));
  border-radius: 50%;
  cursor: grab;
  user-select: none;
  --column-badge-border: var(--nd-panel);
  transition:
    background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);

    :global(.ti) {
      opacity: 1;
    }
  }

  &.dragging {
    opacity: 0.3;
    cursor: grabbing;
  }

  &.dragOver {
    outline: 2px solid var(--nd-accent);
    outline-offset: 1px;
  }
}

.iconWrap {
  @include nav-icon-wrap;

  :global(.ti) {
    @include nav-icon;
    opacity: 0.7;
    transition: opacity var(--nd-duration-base);
  }
}

.tabRemoveBtn {
  position: absolute;
  top: -2px;
  right: -2px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--nd-panel);
  font-size: 8px;
  color: var(--nd-fg);
  opacity: 0;
  transition: opacity var(--nd-duration-fast);

  .navTab:hover & {
    opacity: 1;
  }

  &:hover {
    color: var(--nd-love, #ec4137);
  }
}

// ── Mobile: row-based list ──

.mobilePanel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
}

.mobileSectionHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 6px;
  font-size: 0.75em;
  font-weight: bold;
  color: var(--nd-fg);
  opacity: 0.5;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.mobileSectionBadge {
  margin-left: auto;
  font-weight: normal;
  opacity: 0.8;
}

.empty {
  padding: 8px;
  text-align: center;
  color: var(--nd-fg);
  opacity: 0.4;
  font-size: 0.75em;
}

// ── Right: AddColumnDialog ──

.addPane {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  scrollbar-width: thin;
}

// ── Code tab ──

.codePanel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.codeHint {
  font-size: 0.75em;
  opacity: 0.5;
}

.codeEditorWrap {
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);

  &.hasError {
    border-color: var(--nd-love, #ec4137);
  }
}

.errorMessage {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75em;
  color: var(--nd-love, #ec4137);
}

.codeSuccess {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75em;
  color: var(--nd-accent);
  opacity: 0.7;
}

.codeApplyBtn {
  @include btn-secondary;
}

// ── Actions (footer) ──

.actions {
  @include action-bar;
}

.actionGroup {
  @include action-group;
}

.actionBtn {
  &.secondary {
    @include btn-action;
  }

  &.danger {
    @include btn-danger-ghost;
  }
}

.secondary {
  /* modifier */
}

.feedback {
  /* modifier */
}

.danger {
  /* modifier */
}

.confirming {
  /* modifier */
}
</style>

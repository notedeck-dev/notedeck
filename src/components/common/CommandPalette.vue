<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { createCliHandlers } from '@/commands/cliHandlers'
import { getCliMeta, parseCliInput } from '@/commands/cliParser'
import type { QuickPickItem } from '@/commands/quickPick'
import {
  getColumnTypeItems,
  getProfileItems,
  getSettingsItems,
} from '@/commands/quickPickProviders'
import type { Command } from '@/commands/registry'
import { useCommandStore } from '@/commands/registry'
import { handleDeepLink } from '@/composables/useDeepLink'
import { useNavigation } from '@/composables/useNavigation'
import { usePortal } from '@/composables/usePortal'
import {
  commandItemTargetId,
  useSpotlightStore,
} from '@/composables/useSpotlight'
import { useAccountsStore } from '@/stores/accounts'
import { useDeckStore } from '@/stores/deck'
import { fuzzyMatch } from '@/utils/fuzzyMatch'
import { shortcutLabel } from '@/utils/shortcutLabel'

const commandStore = useCommandStore()
const spotlightStore = useSpotlightStore()
const query = ref('')
const selectedIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const inputWrapRef = ref<HTMLElement | null>(null)
const dropdownPos = ref({ top: 0, left: 0, width: 0 })

// --- Quick Pick / Prefix mode ---
type PaletteMode = 'addColumn' | 'profile' | 'settings'

const PREFIX_MAP: Record<string, PaletteMode> = {
  '+': 'addColumn',
  '~': 'profile',
  '*': 'settings',
}

const activePrefix = computed<PaletteMode | null>(() => {
  if (commandStore.quickPickStack.length > 0) return null
  const first = query.value[0]
  return first ? (PREFIX_MAP[first] ?? null) : null
})

const prefixQuery = computed(() =>
  activePrefix.value ? query.value.slice(1) : query.value,
)

/** Items for prefix-triggered mode (no Quick Pick stack yet) */
const prefixItems = computed<QuickPickItem[]>(() => {
  switch (activePrefix.value) {
    case 'settings':
      return getSettingsItems()
    case 'profile':
      return getProfileItems()
    case 'addColumn':
      return getColumnTypeItems()
    default:
      return []
  }
})

const currentQuickPickStep = computed(
  () => commandStore.quickPickStack.at(-1) ?? null,
)

/** Quick Pick items grouped by group field, filtered by fuzzy search */
interface QuickPickGroup {
  group: string
  items: QuickPickItem[]
}

const filteredQuickPickGroups = computed<QuickPickGroup[]>(() => {
  // Use prefix items when in prefix mode, otherwise use Quick Pick stack
  const items = currentQuickPickStep.value
    ? currentQuickPickStep.value.items
    : prefixItems.value

  if (items.length === 0) return []

  // Skip client-side filter when step has onQueryChange (server-side search)
  const serverSearch = currentQuickPickStep.value?.onQueryChange
  const q = currentQuickPickStep.value
    ? commandStore.quickPickQuery
    : prefixQuery.value
  const matched = serverSearch
    ? items
    : q
      ? items.filter((item) => fuzzyMatch(q, item.label))
      : items

  const map = new Map<string, QuickPickItem[]>()
  for (const item of matched) {
    const g = item.group ?? ''
    const list = map.get(g) ?? []
    list.push(item)
    map.set(g, list)
  }

  const groups: QuickPickGroup[] = []
  for (const [group, items] of map) {
    groups.push({ group, items })
  }
  return groups
})

const flatQuickPickList = computed(() =>
  filteredQuickPickGroups.value.flatMap((g) => g.items),
)

/** selectedIndex が属するグループのインデックス */
const currentGroupIndex = computed(() => {
  const groups = filteredQuickPickGroups.value
  if (groups.length <= 1) return 0
  let offset = 0
  for (let i = 0; i < groups.length; i++) {
    const size = groups[i]?.items.length ?? 0
    if (selectedIndex.value < offset + size) return i
    offset += size
  }
  return groups.length - 1
})

/** 現在グループの先頭の flatQuickPickList 上のインデックス */
const currentGroupStartIndex = computed(() => {
  const groups = filteredQuickPickGroups.value
  let offset = 0
  for (let i = 0; i < currentGroupIndex.value; i++) {
    offset += groups[i]?.items.length ?? 0
  }
  return offset
})

async function selectQuickPickItem(item: QuickPickItem) {
  // ユーザーが選んだ = 認識した。spotlight を即 clear (光らせ続けない原則)
  spotlightStore.clear(commandItemTargetId(item.id))
  if (item.children) {
    const children = await item.children()
    // Skip push if palette was closed during async (e.g. finalizeAddColumn)
    // or if children is empty (direct finalization)
    if (!commandStore.isOpen || children.length === 0) return
    commandStore.pushQuickPick({
      title: item.label,
      placeholder: `${item.label}を検索...`,
      items: children,
    })
    selectedIndex.value = 0
    nextTick(() => inputRef.value?.focus())
  } else if (item.action) {
    commandStore.close()
    item.action()
  }
}

const overlayRef = useTemplateRef<HTMLElement>('overlayRef')
const dropdownRef = useTemplateRef<HTMLElement>('dropdownRef')
usePortal(overlayRef)
usePortal(dropdownRef)

const isDeepLink = computed(() => query.value.startsWith('notedeck://'))
const cliMatch = computed(() => parseCliInput(query.value))
const cliMeta = computed(() =>
  cliMatch.value ? getCliMeta(cliMatch.value.name) : undefined,
)

const { navigateToNote, navigateToUser } = useNavigation()
const cliHandlers = createCliHandlers({
  deckStore: useDeckStore(),
  accountsStore: useAccountsStore(),
  navigateToNote,
  navigateToUser,
  toggleAccountMenu: () => commandStore.execute('account-menu'),
})

interface CommandGroup {
  category: string
  label: string
  commands: Command[]
}

const categoryLabels: Record<string, string> = {
  general: '全般',
  note: 'ノート',
  navigation: 'ナビゲーション',
  column: 'カラム',
  account: 'アカウント',
}

const categoryOrder = ['general', 'note', 'navigation', 'column', 'account']

const filteredGroups = computed<CommandGroup[]>(() => {
  const enabled = commandStore.getEnabled().filter((c) => c.visible !== false)

  const matched = query.value
    ? enabled.filter((c) => fuzzyMatch(query.value, c.label))
    : enabled

  const map = new Map<string, Command[]>()
  for (const cmd of matched) {
    const list = map.get(cmd.category) ?? []
    list.push(cmd)
    map.set(cmd.category, list)
  }

  const groups: CommandGroup[] = []
  for (const cat of categoryOrder) {
    const cmds = map.get(cat)
    if (cmds?.length) {
      groups.push({
        category: cat,
        label: categoryLabels[cat] ?? cat,
        commands: cmds,
      })
    }
  }
  return groups
})

const flatList = computed(() => filteredGroups.value.flatMap((g) => g.commands))

const listRef = useTemplateRef<HTMLElement>('listRef')

function moveDown(list: readonly unknown[]) {
  selectedIndex.value = Math.min(selectedIndex.value + 1, list.length - 1)
}

function moveUp() {
  selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
}

function jumpToGroup(direction: 1 | -1) {
  const groups = filteredQuickPickGroups.value
  if (groups.length <= 1) return
  const nextIdx =
    (currentGroupIndex.value + direction + groups.length) % groups.length
  let offset = 0
  for (let i = 0; i < nextIdx; i++) {
    offset += groups[i]?.items.length ?? 0
  }
  selectedIndex.value = offset
}

function onKeydown(e: KeyboardEvent) {
  const inQuickPick =
    currentQuickPickStep.value != null || activePrefix.value != null

  // --- Ctrl+N / Ctrl+P: Emacs風ナビゲーション ---
  if (e.ctrlKey && !e.shiftKey && !e.altKey) {
    if (e.key === 'n') {
      e.preventDefault()
      if (inQuickPick) moveDown(flatQuickPickList.value)
      else if (!cliMatch.value) moveDown(flatList.value)
      return
    }
    if (e.key === 'p') {
      e.preventDefault()
      if (inQuickPick || !cliMatch.value) moveUp()
      return
    }
    // Ctrl+G: Emacs keyboard-quit — 戻る/閉じる
    if (e.key === 'g') {
      e.preventDefault()
      if (currentQuickPickStep.value) {
        commandStore.popQuickPick()
        selectedIndex.value = 0
      } else {
        commandStore.close()
      }
      return
    }
  }

  // --- Tab / Shift+Tab: グループ間ジャンプ ---
  if (e.key === 'Tab' && inQuickPick) {
    e.preventDefault()
    jumpToGroup(e.shiftKey ? -1 : 1)
    return
  }

  // --- ArrowDown / ArrowUp ---
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (inQuickPick) moveDown(flatQuickPickList.value)
    else if (!cliMatch.value) moveDown(flatList.value)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (inQuickPick || !cliMatch.value) moveUp()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (inQuickPick) {
      const item = flatQuickPickList.value[selectedIndex.value]
      if (item) selectQuickPickItem(item)
    } else if (query.value.startsWith('notedeck://')) {
      commandStore.close()
      handleDeepLink(query.value)
    } else if (cliMatch.value) {
      const { name, args } = cliMatch.value
      const meta = getCliMeta(name)
      if (meta?.needsArgs && !args.trim()) return
      const handler = cliHandlers[name]
      if (!handler) return
      commandStore.close()
      handler(args)
    } else {
      const cmd = flatList.value[selectedIndex.value]
      if (cmd) {
        commandStore.close()
        cmd.execute()
      }
    }
  } else if (e.key === 'Backspace') {
    // Pop Quick Pick stack when input is empty (skip for server-search steps)
    if (
      currentQuickPickStep.value &&
      commandStore.quickPickQuery === '' &&
      !currentQuickPickStep.value.onQueryChange
    ) {
      e.preventDefault()
      commandStore.popQuickPick()
      selectedIndex.value = 0
    }
  } else if (e.key === 'Escape') {
    e.preventDefault()
    commandStore.close()
  } else if (e.altKey) {
    // Alt+キー: グループ相対で候補を直接選択 (1-9, 0, a-z)
    let idx = -1
    if (e.key >= '1' && e.key <= '9') idx = Number.parseInt(e.key, 10) - 1
    else if (e.key === '0') idx = 9
    else if (e.key >= 'a' && e.key <= 'z') idx = e.key.charCodeAt(0) - 97 + 10

    if (idx >= 0) {
      const hasGroups = filteredQuickPickGroups.value.length > 1
      if (inQuickPick) {
        const baseIdx = hasGroups ? currentGroupStartIndex.value : 0
        const item = flatQuickPickList.value[baseIdx + idx]
        if (item) {
          e.preventDefault()
          selectQuickPickItem(item)
        }
      } else {
        const cmd = flatList.value[idx]
        if (cmd) {
          e.preventDefault()
          commandStore.close()
          cmd.execute()
        }
      }
    }
  }
}

function runCommand(cmd: Command) {
  commandStore.close()
  cmd.execute()
}

function updateDropdownPos() {
  if (inputWrapRef.value) {
    const rect = inputWrapRef.value.getBoundingClientRect()
    dropdownPos.value = {
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    }
  }
}

watch(query, (val) => {
  selectedIndex.value = 0
  // Sync query to quickPickQuery when in Quick Pick mode
  if (currentQuickPickStep.value != null) {
    commandStore.quickPickQuery = val
    currentQuickPickStep.value.onQueryChange?.(val)
  }
})

watch(
  () => commandStore.quickPickStack.length,
  () => {
    // Reset input when Quick Pick stack changes
    query.value = ''
    selectedIndex.value = 0
    nextTick(() => inputRef.value?.focus())
  },
)

watch(selectedIndex, () => {
  nextTick(() => {
    const el = listRef.value?.querySelector('[data-selected]')
    el?.scrollIntoView({ block: 'nearest' })
  })
})

watch(
  () => commandStore.isOpen,
  (open) => {
    if (open) {
      if (commandStore.initialInput) {
        query.value = commandStore.initialInput
        commandStore.initialInput = null
      } else {
        query.value = ''
      }
      selectedIndex.value = 0
      nextTick(() => {
        updateDropdownPos()
        inputRef.value?.focus()
        if (query.value) {
          inputRef.value?.setSelectionRange(
            query.value.length,
            query.value.length,
          )
        }
      })
    }
  },
  { immediate: true },
)

const inputPlaceholder = computed(() => {
  if (currentQuickPickStep.value) return currentQuickPickStep.value.placeholder
  return 'コマンドを入力...'
})

/** グループ内インデックス → ヒントキー文字（1-9, 0, a-z） */
function hintKey(groupItemIndex: number): string | null {
  if (groupItemIndex < 9) return `${groupItemIndex + 1}`
  if (groupItemIndex === 9) return '0'
  if (groupItemIndex < 36) return String.fromCharCode(97 + groupItemIndex - 10) // a-z
  return null
}

function hintLabel(groupItemIndex: number): string | null {
  const key = hintKey(groupItemIndex)
  return key ? `Alt+${key}` : null
}

function primaryShortcut(cmd: Command): string | null {
  const s =
    cmd.shortcuts.find((s) => s.ctrl || s.shift || s.alt) ?? cmd.shortcuts[0]
  return s ? shortcutLabel(s) : null
}
</script>

<template>
  <!--
    VS Code integrated architecture:
    - Input lives in the titlebar (inline, same position as URI display)
    - Dropdown list is portaled to body (avoids ancestor overflow clipping)
  -->

  <!-- Background overlay (portaled) -->
  <div ref="overlayRef" :class="$style.overlayBg" @click="commandStore.close()" />

  <!-- Input: lives in the titlebar DOM, replaces URI display -->
  <div ref="inputWrapRef" :class="$style.inputWrap" @keydown="onKeydown">
    <i :class="['ti ti-search', $style.inputIcon]" />
    <input
      ref="inputRef"
      v-model="query"
      :class="$style.input"
      :placeholder="inputPlaceholder"
      spellcheck="false"
    />
    <kbd :class="$style.inputKbd">Esc</kbd>
  </div>

  <!-- Dropdown list (portaled to body — scroll works regardless of ancestors) -->
  <div
    ref="dropdownRef"
    :class="$style.dropdown"
    :style="{
      top: dropdownPos.top + 'px',
      left: dropdownPos.left + 'px',
      width: dropdownPos.width + 'px',
    }"
    @click.stop
    @keydown="onKeydown"
  >
    <!-- Quick Pick mode (prefix or stacked) -->
    <template v-if="currentQuickPickStep || activePrefix">
      <div v-if="currentQuickPickStep" :class="$style.quickPickHeader">
        <button
          v-if="commandStore.quickPickStack.length > 1"
          :class="$style.backBtn"
          @click="commandStore.popQuickPick(); selectedIndex = 0"
        >
          <i class="ti ti-arrow-left" />
        </button>
        <span :class="$style.quickPickTitle">{{ currentQuickPickStep.title }}</span>
      </div>
      <div v-if="currentQuickPickStep?.loading" :class="$style.empty">読み込み中...</div>
      <div v-else-if="flatQuickPickList.length" ref="listRef" :class="$style.list">
        <template v-for="(group, gi) in filteredQuickPickGroups" :key="group.group">
          <div v-if="gi > 0" :class="$style.separator" />
          <div v-if="group.group" :class="$style.category">{{ group.group }}</div>
          <button
            v-for="(item, ii) in group.items"
            :key="item.id"
            :class="[$style.item, { [$style.selected]: flatQuickPickList[selectedIndex]?.id === item.id, [$style.spotlighted]: spotlightStore.spotlights.has(commandItemTargetId(item.id)) }]"
            :data-selected="flatQuickPickList[selectedIndex]?.id === item.id ? '' : undefined"
            @click="selectQuickPickItem(item)"
            @mouseenter="selectedIndex = flatQuickPickList.indexOf(item)"
          >
            <img v-if="item.avatarUrl" :src="item.avatarUrl" :class="$style.itemAvatar" />
            <i v-else :class="['ti ti-' + item.icon, $style.itemIcon]" />
            <div :class="$style.itemContent">
              <span :class="$style.itemLabel">{{ item.label }}</span>
              <span v-if="item.description" :class="$style.itemDesc">{{ item.description }}</span>
            </div>
            <kbd
              v-if="gi === currentGroupIndex && hintLabel(ii)"
              :class="$style.itemKbd"
            >
              {{ hintLabel(ii) }}
            </kbd>
            <i v-if="item.children" :class="['ti ti-chevron-right', $style.itemChevron]" />
          </button>
        </template>
      </div>
      <div v-else :class="$style.empty">一致する項目がありません</div>
    </template>

    <!-- Deep link URI mode -->
    <div v-else-if="isDeepLink" :class="$style.cli">
      <div :class="$style.cliRow">
        <i :class="['ti ti-link', $style.itemIcon]" />
        <span :class="$style.cliAction">
          ↵ Enterで開く:
          <strong>{{ query }}</strong>
        </span>
      </div>
    </div>

    <!-- CLI mode -->
    <div v-else-if="cliMatch && cliMeta" :class="$style.cli">
      <div :class="$style.cliRow">
        <i :class="['ti ti-' + cliMeta.icon, $style.itemIcon]" />
        <span
          v-if="cliMeta.needsArgs && !cliMatch.args.trim()"
          :class="$style.cliHint"
        >
          {{ cliMeta.usage }}
        </span>
        <span v-else :class="$style.cliAction">
          ↵ Enterで実行:
          <strong>{{ cliMatch.name }}</strong>
          {{ cliMatch.args }}
        </span>
      </div>
      <div :class="$style.cliDesc">{{ cliMeta.about }}</div>
    </div>

    <!-- Command list -->
    <div v-else-if="flatList.length" ref="listRef" :class="$style.list">
      <template v-for="(group, gi) in filteredGroups" :key="group.category">
        <div v-if="gi > 0" :class="$style.separator" />
        <div :class="$style.category">{{ group.label }}</div>
        <button
          v-for="cmd in group.commands"
          :key="cmd.id"
          :class="[$style.item, { [$style.selected]: flatList[selectedIndex]?.id === cmd.id }]"
          :data-selected="flatList[selectedIndex]?.id === cmd.id ? '' : undefined"
          @click="runCommand(cmd)"
          @mouseenter="selectedIndex = flatList.indexOf(cmd)"
        >
          <i :class="['ti ti-' + cmd.icon, $style.itemIcon]" />
          <span :class="$style.itemLabel">{{ cmd.label }}</span>
          <kbd v-if="primaryShortcut(cmd)" :class="$style.itemKbd">
            {{ primaryShortcut(cmd) }}
          </kbd>
        </button>
      </template>
    </div>

    <div v-else :class="$style.empty">一致するコマンドがありません</div>
  </div>
</template>

<style module lang="scss">
/* ========================================
   Background overlay
   ======================================== */
.overlayBg {
  position: fixed;
  inset: 0;
  z-index: calc(var(--nd-z-palette) - 1);
  background: rgba(0, 0, 0, 0.08);
}

/* ========================================
   Input (lives in titlebar, same slot as URI)
   Matches TitleBar .titlebarSearchBar dimensions.
   ======================================== */
.inputWrap {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--nd-accent, #86b300);
  border-radius: var(--nd-radius-sm);
  background: rgba(255, 255, 255, 0.1);
  color: var(--nd-fg);
}

.inputIcon {
  font-size: 12px;
  opacity: 0.5;
  flex-shrink: 0;
}

.input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--nd-fg);
  font-size: 12px;
  font-family: inherit;
  line-height: 20px;
  min-width: 0;

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.4;
  }
}

.inputKbd {
  font-size: 10px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  opacity: 0.4;
  font-family: inherit;
  border: none;
  flex-shrink: 0;
  line-height: 1.5;
}

/* ========================================
   Dropdown (portaled to body, position: fixed)
   ======================================== */
.dropdown {
  position: fixed;
  z-index: var(--nd-z-palette);
  background: var(--nd-popup, #252526);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-top: none;
  border-radius: 0 0 6px 6px;
  box-shadow: 0 8px 36px rgba(0, 0, 0, 0.4);
}

/* ========================================
   List (scroll container)
   ======================================== */
.list {
  max-height: calc(20 * 22px);
  overflow-y: auto;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 3px;
  }
}

.separator {
  height: 1px;
  margin: 2px 0;
  background: rgba(255, 255, 255, 0.06);
}

.category {
  padding: 6px 12px 2px;
  font-size: 11px;
  font-weight: 400;
  color: var(--nd-fg);
  opacity: 0.5;
}

.item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 12px;
  border: none;
  border-left: 2px solid transparent;
  background: none;
  color: var(--nd-fg);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  line-height: 22px;

  &.selected {
    background: color-mix(in srgb, var(--nd-accent) 18%, transparent);
    border-left-color: var(--nd-accent, #86b300);
    color: var(--nd-fgHighlighted, #fff);
  }

  &:hover:not(.selected) {
    background: rgba(255, 255, 255, 0.04);
  }

  // AI / チュートリアルが指し示した項目を一時的に光らせる。視覚仕様は
  // navbar / bottombar の spotlight と統一 (#576: 朱色縦グラデ 2.4s)。
  &.spotlighted {
    position: relative;
    isolation: isolate;

    &::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--nd-warn) 55%, transparent) 0%,
        color-mix(in srgb, var(--nd-warn) 30%, transparent) 50%,
        color-mix(in srgb, var(--nd-warn) 5%, transparent) 100%
      );
      box-shadow: 0 -1px 8px color-mix(in srgb, var(--nd-warn) 25%, transparent);
      pointer-events: none;
      z-index: 0;
      animation: spotlightFill 2.4s ease-out 1 forwards;
    }

    > * {
      position: relative;
      z-index: 1;
    }

    @media (prefers-reduced-motion: reduce) {
      &::before {
        animation: none;
        opacity: 1;
      }
    }
  }
}

@keyframes spotlightFill {
  0%   { opacity: 0; }
  10%  { opacity: 1; }
  85%  { opacity: 1; }
  100% { opacity: 0; }
}

.itemIcon {
  font-size: 14px;
  opacity: 0.5;
  width: 18px;
  text-align: center;
  flex-shrink: 0;
}

.itemAvatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
}

.itemLabel {
  flex: 1;
}

.itemKbd {
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  border: 0.5px solid rgba(255, 255, 255, 0.1);
  border-bottom-width: 1px;
  opacity: 0.6;
  font-family: inherit;
  white-space: nowrap;
}

.empty {
  padding: 14px 12px;
  text-align: center;
  color: var(--nd-fg);
  opacity: 0.4;
  font-size: 13px;
}

/* ========================================
   Quick Pick header
   ======================================== */
.quickPickHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 2px;
}

.backBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--nd-radius-sm);
  background: none;
  color: var(--nd-fg);
  cursor: pointer;
  opacity: 0.5;

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }
}

.quickPickTitle {
  font-size: 12px;
  font-weight: 600;
  color: var(--nd-fg);
  opacity: 0.6;
}

.itemContent {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.itemDesc {
  font-size: 11px;
  opacity: 0.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.itemChevron {
  font-size: 14px;
  opacity: 0.3;
  flex-shrink: 0;
}

.cli {
  padding: 10px 12px;
}

.cliRow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--nd-fg);
}

.cliHint {
  opacity: 0.5;
  font-family: monospace;
}

.cliAction strong {
  color: var(--nd-accent);
}

.cliDesc {
  margin-top: 4px;
  padding-left: 26px;
  font-size: 12px;
  color: var(--nd-fg);
  opacity: 0.45;
}
</style>

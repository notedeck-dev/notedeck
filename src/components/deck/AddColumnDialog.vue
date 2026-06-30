<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  ACCOUNT_INDEPENDENT_TYPES,
  ACCOUNT_OPTIONAL_TYPES,
  buildColumnDefaults,
  COLUMN_REGISTRY,
  COLUMN_TYPE_GROUPS,
  CROSS_ACCOUNT_TYPES,
  GUEST_ALLOWED_TYPES,
  type SelectableItem,
  type SelectableSpec,
} from '@/columns/registry'
import AvatarStack from '@/components/common/AvatarStack.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import { showLoginPrompt } from '@/composables/useLoginPrompt'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { useNavigation } from '@/composables/useNavigation'
import {
  commandItemTargetId,
  useSpotlightStore,
} from '@/composables/useSpotlight'
import { formatUserHandle, useUserSearch } from '@/composables/useUserSearch'
import {
  getAccountAvatarUrl,
  getAccountLabel,
  isGuestAccount,
  useAccountsStore,
} from '@/stores/accounts'
import type { ColumnType, DeckColumn } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { logWarn } from '@/utils/logger'
import { commands, unwrap } from '@/utils/tauriInvoke'

const props = defineProps<{
  mode?: 'deck' | 'pip'
}>()

const emit = defineEmits<{
  close: []
  columnSelected: [column: Omit<DeckColumn, 'id'>]
}>()

const { navigateToLogin } = useNavigation()
const deckStore = useDeckStore()
const accountsStore = useAccountsStore()
const spotlightStore = useSpotlightStore()

function finalizeColumn(config: Omit<DeckColumn, 'id'>) {
  if (props.mode === 'pip') {
    emit('columnSelected', config)
  } else {
    deckStore.addColumn(config)
    close()
  }
}

const expandedCategories = reactive<Record<string, boolean>>({
  account: true,
})

function toggleCategory(key: string) {
  expandedCategories[key] = !expandedCategories[key]
}

const addColumnType = ref<ColumnType | null>(null)

/** Whether the selected column type requires authentication */
const requiresAuth = computed(() => {
  if (!addColumnType.value) return false
  return !GUEST_ALLOWED_TYPES.has(addColumnType.value)
})

function selectColumnType(type: ColumnType) {
  // 選んだ = 認識した。spotlight を即 clear (光らせ続けない原則)
  spotlightStore.clear(commandItemTargetId(`col-${type}`))
  addColumnType.value = type
  // Account-independent types: skip account selection
  if (ACCOUNT_INDEPENDENT_TYPES.has(type)) {
    addColumnForAccount(null)
    return
  }
  // Account-optional types: always show selection screen so user can choose "no account"
  if (ACCOUNT_OPTIONAL_TYPES.has(type)) return
  // Auto-select if only one valid account
  const authRequired = !GUEST_ALLOWED_TYPES.has(type)
  const accounts = accountsStore.accounts.filter(
    (a) => !(authRequired && isGuestAccount(a)),
  )
  const account = accounts[0]
  if (accounts.length === 1 && account) {
    if (!account.hasToken && authRequired) {
      showLoginPrompt()
    } else {
      addColumnForAccount(account.id)
    }
  }
}

/** Selectable config bundled with its column type for the item-selection flow */
interface ActiveSelectable {
  type: ColumnType
  label: string
  spec: SelectableSpec
}

function getSelectable(type: ColumnType): ActiveSelectable | null {
  const spec = COLUMN_REGISTRY[type]
  if (!spec.selectable) return null
  return { type, label: spec.label, spec: spec.selectable }
}

function addColumnForAccount(accountId: string | null) {
  const type = addColumnType.value || 'timeline'
  const selectable = getSelectable(type)
  if (selectable && accountId) {
    fetchSelectItems(selectable, accountId)
    return
  }
  finalizeColumn({
    type,
    ...buildColumnDefaults(type, accountId),
  } as Omit<DeckColumn, 'id'>)
}

const selectAccountId = ref<string | null>(null)
const selectItems = ref<SelectableItem[]>([])
const selectLoading = ref(false)
const selectConfig = ref<ActiveSelectable | null>(null)

// Unified search input for searchable configs (user, channel, etc.)
const searchQuery = ref('')
let searchDebounce: ReturnType<typeof setTimeout> | undefined

// User search via shared composable
const {
  query: userSearchQuery,
  results: userSearchResults,
  searching: userSearching,
} = useUserSearch(() => selectAccountId.value)

watch(userSearchResults, (users) => {
  if (selectConfig.value?.type !== 'user') return
  selectItems.value = users.map((u) => ({
    id: u.id,
    name: formatUserHandle(u),
    avatarUrl: u.avatarUrl ?? undefined,
  }))
})

watch(userSearching, (v) => {
  if (selectConfig.value?.type === 'user') selectLoading.value = v
})

// Dispatch search by config type
watch(searchQuery, (val) => {
  if (searchDebounce) clearTimeout(searchDebounce)
  const config = selectConfig.value
  if (!config?.spec.search) return

  // User: delegate to useUserSearch composable
  if (config.type === 'user') {
    userSearchQuery.value = val
    return
  }

  // Generic: server-side search with fallback to initial list
  const q = val.trim()
  const accountId = selectAccountId.value
  if (!q || !accountId) {
    if (accountId) fetchInitialItems(config, accountId)
    return
  }
  searchDebounce = setTimeout(() => searchSelectItems(config, q), 300)
})

async function searchSelectItems(config: ActiveSelectable, query: string) {
  if (!config.spec.search || !selectAccountId.value) return
  selectLoading.value = true
  try {
    selectItems.value = await config.spec.search(selectAccountId.value, query)
  } catch (e) {
    logWarn(`deck-search-${config.type}`, e)
    selectItems.value = []
  } finally {
    selectLoading.value = false
  }
}

async function fetchInitialItems(config: ActiveSelectable, accountId: string) {
  selectLoading.value = true
  try {
    selectItems.value = await config.spec.fetch(accountId)
  } catch (e) {
    logWarn(`deck-fetch-${config.type}`, e)
    selectItems.value = []
  } finally {
    selectLoading.value = false
  }
}

async function fetchSelectItems(config: ActiveSelectable, accountId: string) {
  selectConfig.value = config
  selectAccountId.value = accountId
  searchQuery.value = ''
  userSearchQuery.value = ''
  if (config.type === 'user') {
    // User: search-only, no initial list
    selectItems.value = []
    selectLoading.value = false
    return
  }
  selectLoading.value = true
  try {
    selectItems.value = await config.spec.fetch(accountId)
  } catch (e) {
    logWarn(`deck-fetch-${config.type}`, e)
    selectItems.value = []
  } finally {
    selectLoading.value = false
  }
}

// --- Inline create for list/antenna/clip ---
const showCreateForm = ref(false)
const createName = ref('')
const createLoading = ref(false)

async function createNewItem() {
  const config = selectConfig.value
  const accountId = selectAccountId.value
  if (!config?.spec.createEndpoint || !accountId) return
  const name = createName.value.trim()
  if (!name) return
  createLoading.value = true
  try {
    const created = unwrap(
      await commands.apiRequest(accountId, config.spec.createEndpoint, {
        name,
        ...config.spec.createDefaults,
      }),
    ) as unknown as SelectableItem
    // Add column with the newly created item
    const colName = config.spec.formatName
      ? config.spec.formatName(created)
      : created.name
    finalizeColumn({
      type: config.type,
      name: colName,
      width: 360,
      accountId,
      [config.spec.idKey]: created.id,
      active: true,
    } as Omit<DeckColumn, 'id'>)
  } catch (e) {
    logWarn(`deck-create-${config.type}`, e)
  } finally {
    createLoading.value = false
    showCreateForm.value = false
    createName.value = ''
  }
}

function addSelectableColumn(item: SelectableItem) {
  const config = selectConfig.value
  const accountId = selectAccountId.value
  if (!accountId || !config) return
  const name = config.spec.formatName ? config.spec.formatName(item) : item.name
  finalizeColumn({
    type: config.type,
    name,
    width: 360,
    accountId,
    [config.spec.idKey]: item.id,
    active: true,
  } as Omit<DeckColumn, 'id'>)
}

const dialogRef = ref<HTMLDialogElement | null>(null)
const showDialog = ref(true)

if (props.mode !== 'pip') {
  useNativeDialog(dialogRef, showDialog, {
    onCancel: () => close(),
  })
}

function close() {
  emit('close')
}
</script>

<template>
  <component
    :is="mode !== 'pip' ? 'dialog' : 'div'"
    ref="dialogRef"
    :class="[mode === 'pip' ? $style.addInline : [$style.addOverlay, '_nativeDialog']]"
  >
    <div :class="mode === 'pip' ? $style.addPopupInline : $style.addPopup">
      <div v-if="!(mode === 'pip' && !addColumnType && !selectConfig)" :class="[$style.addPopupHeader, mode === 'pip' && $style.addPopupHeaderPip]">
        <button v-if="addColumnType && !selectConfig" class="_button" :class="$style.addBackBtn" @click="addColumnType = null">
          <i class="ti ti-chevron-left" />
        </button>
        <button v-else-if="selectConfig" class="_button" :class="$style.addBackBtn" @click="selectConfig = null; selectItems = []; selectAccountId = null; searchQuery = ''">
          <i class="ti ti-chevron-left" />
        </button>
        <span :class="$style.addPopupTitle">
          {{ selectConfig ? `${selectConfig.label}を選択` : addColumnType ? 'アカウントを選択' : 'カラムを追加' }}
        </span>
      </div>

      <!-- Step 1: Column type selection -->
      <template v-if="!addColumnType">
        <div
          v-for="g in COLUMN_TYPE_GROUPS"
          :key="g.group"
          :class="$style.addCategorySection"
        >
          <button class="_button" :class="$style.addCategoryLabel" @click="toggleCategory(g.group)">
            <i class="ti" :class="`ti-${g.icon}`" />
            {{ g.label }}
            <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedCategories[g.group] }]" />
          </button>
          <template v-if="expandedCategories[g.group]">
            <button
              v-for="t in g.types"
              :key="t"
              class="_button"
              :class="[$style.addTypeBtn, { [$style.spotlighted]: spotlightStore.spotlights.has(commandItemTargetId(`col-${t}`)) }]"
              @click="selectColumnType(t)"
            >
              <i class="ti" :class="`ti-${COLUMN_REGISTRY[t].icon}`" />
              <span>{{ COLUMN_REGISTRY[t].label }}</span>
            </button>
          </template>
        </div>
      </template>

      <!-- Step 3a: Item selection (list/antenna/channel/clip/user) -->
      <template v-else-if="selectConfig">
        <div v-if="selectConfig.spec.search" :class="$style.selectSearchBar">
          <i class="ti ti-search" :class="$style.selectSearchIcon" />
          <input
            v-model="searchQuery"
            :class="$style.selectSearchInput"
            type="text"
            :placeholder="`${selectConfig.label}を検索...`"
          />
          <i v-if="selectLoading" class="ti ti-loader-2 nd-spin" :class="$style.selectSearchIcon" />
        </div>

        <!-- Inline create form -->
        <div v-if="selectConfig.spec.createEndpoint && showCreateForm" :class="$style.createForm">
          <form @submit.prevent="createNewItem">
            <input
              v-model="createName"
              :class="$style.createInput"
              type="text"
              :placeholder="`${selectConfig.label}名を入力...`"
              :disabled="createLoading"
            />
            <div :class="$style.createActions">
              <button type="button" class="_button" :class="$style.createCancelBtn" @click="showCreateForm = false; createName = ''">
                キャンセル
              </button>
              <button type="submit" class="_button" :class="$style.createSubmitBtn" :disabled="!createName.trim() || createLoading">
                <i v-if="createLoading" class="ti ti-loader-2 nd-spin" />
                <template v-else>作成</template>
              </button>
            </div>
          </form>
        </div>
        <!-- Create button -->
        <button
          v-else-if="selectConfig.spec.createEndpoint"
          class="_button"
          :class="[$style.addTypeBtn, $style.createBtn]"
          @click="showCreateForm = true"
        >
          <i class="ti ti-plus" />
          <span>新しい{{ selectConfig.label }}を作成</span>
        </button>

        <div v-if="!selectConfig.spec.search && selectLoading" :class="$style.addPopupLoading"><LoadingSpinner /></div>
        <div v-else-if="!selectLoading && selectItems.length === 0 && (!selectConfig.spec.search || searchQuery.trim())" :class="$style.addPopupEmpty">{{ selectConfig.label }}が見つかりません</div>
        <button
          v-for="item in selectItems"
          :key="item.id"
          class="_button"
          :class="$style.addTypeBtn"
          @click="addSelectableColumn(item)"
        >
          <img v-if="item.avatarUrl" :src="item.avatarUrl" :class="$style.selectItemAvatar" />
          <i v-else class="ti" :class="`ti-${COLUMN_REGISTRY[selectConfig.type].icon}`" />
          <span>{{ item.name }}</span>
        </button>
      </template>

      <!-- Step 2: Account selection -->
      <template v-else>
        <div v-if="accountsStore.accounts.length === 0" :class="$style.addPopupEmpty">
          アカウントが登録されていません。
          <button class="_button" style="color: var(--nd-accent); text-decoration: underline;" @click="close(); navigateToLogin()">
            アカウントを追加
          </button>
        </div>

        <button
          v-if="addColumnType && CROSS_ACCOUNT_TYPES.has(addColumnType) && accountsStore.accounts.length > 1"
          class="_button"
          :class="$style.addAccountBtn"
          @click="addColumnForAccount(null)"
        >
          <AvatarStack :size="28" />
          <span>全アカウント</span>
        </button>
        <button
          v-if="addColumnType && ACCOUNT_OPTIONAL_TYPES.has(addColumnType)"
          class="_button"
          :class="$style.addAccountBtn"
          @click="addColumnForAccount(null)"
        >
          <i class="ti ti-circle-off" style="font-size: 28px; opacity: 0.5;" />
          <span>アカウントなし</span>
        </button>
        <button
          v-for="account in accountsStore.accounts"
          :key="account.id"
          class="_button"
          :class="[$style.addAccountBtn, { [$style.addAccountDisabled]: isGuestAccount(account) && requiresAuth }]"
          :disabled="isGuestAccount(account) && requiresAuth"
          :title="isGuestAccount(account) && requiresAuth ? 'ゲストアカウントではこのカラムを使えません' : ''"
          @click="(!account.hasToken && requiresAuth) ? showLoginPrompt() : addColumnForAccount(account.id)"
        >
          <img :src="getAccountAvatarUrl(account)" :class="$style.addAccountAvatar" />
          <span>{{ getAccountLabel(account) }}</span>
        </button>
      </template>
    </div>
  </component>
</template>

<style lang="scss" module>
.addOverlay {
  &::backdrop {
    background: var(--nd-modalBg);
  }

  @media (prefers-reduced-motion: no-preference) {
    > .addPopup {
      animation: addPopupIn 0.2s var(--nd-ease-spring);
    }
  }
}

.addPopup {
  background: var(--nd-navBg);
  border-radius: 16px;
  box-shadow: 0 8px 32px var(--nd-shadow);
  width: calc(100% - 32px);
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
}

.addInline {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.addPopupInline {
  background: var(--nd-bg);
  width: 100%;
  flex: 1;
  overflow-y: auto;
}

.addPopupHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 20px 24px 16px;
  font-size: 1em;
  font-weight: bold;
  border-bottom: 1px solid var(--nd-divider);
}

.addPopupHeaderPip {
  padding: 12px 16px;
  font-size: 0.9em;
}

.addPopupTitle {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.addPopupEmpty {
  padding: 2rem;
  text-align: center;
  color: var(--nd-fg);
  opacity: 0.6;
  font-size: 0.9em;

  a {
    color: var(--nd-accent);
  }
}

.addPopupLoading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

.addAccountBtn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 24px;
  font-size: 0.85em;
  font-weight: bold;
  color: var(--nd-fgHighlighted);
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  & + & {
    border-top: 1px solid var(--nd-divider);
  }
}

.addAccountDisabled {
  opacity: 0.4;
  cursor: not-allowed;

  &:hover {
    background: transparent;
  }
}

.addAccountAvatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
}

.addBackBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--nd-radius-sm);
  opacity: 0.7;
  transition: background var(--nd-duration-base), opacity var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }
}

.addTypeBtn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 0 24px;
  line-height: 2.85rem;
  font-size: 0.95em;
  font-weight: bold;
  color: var(--nd-fgHighlighted);
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  & + & {
    border-top: 1px solid var(--nd-divider);
  }

  :global(.ti) {
    flex-shrink: 0;
    width: 32px;
    font-size: 1.5rem;
    text-align: center;
    opacity: 0.7;
  }

  // AI / チュートリアルが指し示した項目を一時的に光らせる。視覚仕様は
  // navbar / bottombar / コマンドパレットの spotlight と統一 (#576: 朱色縦グラデ 2.4s)。
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

.addCategorySection {
  & + & {
    border-top: 1px solid var(--nd-divider);
  }
}

.addCategoryLabel {
  display: flex;
  align-items: center;
  gap: 6px;
  position: sticky;
  top: 0;
  z-index: 1;
  width: 100%;
  padding: 10px 24px;
  background: var(--nd-popup);
  font-size: 0.8em;
  font-weight: bold;
  color: var(--nd-fg);
  opacity: 0.7;
  cursor: pointer;
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 1;
  }

  .addPopupInline & {
    background: var(--nd-bg);
  }
}

.chevron {
  margin-left: auto;
  font-size: 0.9em;
  transition: transform var(--nd-duration-base);
  transform: rotate(-90deg);
}

.chevronOpen {
  transform: rotate(0deg);
}

.selectSearchBar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--nd-divider);
}

.selectSearchIcon {
  flex-shrink: 0;
  opacity: 0.4;
}

.selectSearchInput {
  flex: 1;
  min-width: 0;
  background: var(--nd-buttonBg);
  border: none;
  border-radius: var(--nd-radius-sm);
  padding: 8px 12px;
  font-size: 0.9em;
  color: var(--nd-fg);
  outline: none;

  &:focus {
    box-shadow: 0 0 0 2px var(--nd-accent);
  }

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.4;
  }
}

.selectItemAvatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
}

.createBtn {
  color: var(--nd-accent);
  opacity: 0.85;

  &:hover {
    opacity: 1;
  }
}

.createForm {
  padding: 8px 12px;
}

.createInput {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.9em;
  outline: none;

  &:focus {
    border-color: var(--nd-accent);
  }
}

.createActions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 8px;
}

.createCancelBtn {
  padding: 4px 12px;
  border-radius: var(--nd-radius-sm);
  font-size: 0.85em;
  color: var(--nd-fg);
  opacity: 0.7;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.createSubmitBtn {
  padding: 4px 12px;
  border-radius: var(--nd-radius-sm);
  font-size: 0.85em;
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent);

  &:hover {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

@keyframes addPopupIn {
  from { opacity: 0; transform: scale(0.95); }
}
</style>

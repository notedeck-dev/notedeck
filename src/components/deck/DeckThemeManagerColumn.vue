<script setup lang="ts">
import { computed, ref } from 'vue'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { i18n } from '@/i18n'
import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import {
  getThemeDetailUrl,
  type StoreThemeEntry,
  useMisStoreStore,
} from '@/stores/misstore'
import { misskeyThemeOf, type ThemeItem, useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import { useWindowsStore } from '@/stores/windows'
import { MI_DARK, MI_LIGHT } from '@/theme/builtinThemes'
import type { MisskeyTheme } from '@/theme/types'
import { openSafeUrl } from '@/utils/url'
import ColumnSection from './ColumnSection.vue'
import DeckDistributableColumn, {
  type StoreFeedDecl,
} from './DeckDistributableColumn.vue'
import ThemeCard from './ThemeCard.vue'

/**
 * テーマ管理カラム。殻は `DeckDistributableColumn` (#1202 段階 3) で、導入済み
 * タブの一覧だけは差し替える: テーマは今の明暗 (dark / light) に絞って並べ、
 * 全アカウントカラムには「デフォルト」(同梱の Mi Dark / Mi Light)、アカウントの
 * カラムには「サーバー」(admin Branding) の節が加わる。適用は全体 (settings) と
 * アカウントのカラム (per-column 適用キャッシュ) の 2 種
 */

const props = defineProps<{
  column: DeckColumnType
}>()

const themeStore = useThemeStore()
const misStore = useMisStoreStore()
const windowsStore = useWindowsStore()
const accountsStore = useAccountsStore()
useColumnSetup(() => props.column)

misStore.fetchThemes()

const shell = ref<{ showTab(tab: 'installed' | 'store'): void } | null>(null)

// --- Mode resolution ---
const isCrossAccount = computed(() => props.column.accountId == null)
const account = computed(() =>
  isCrossAccount.value
    ? null
    : (accountsStore.accounts.find((a) => a.id === props.column.accountId) ??
      null),
)
const accountId = computed(() => props.column.accountId)
/** このカラムのアカウントの安定キー (紐付けの値、#1113)。 */
const accountKey = computed(() =>
  account.value ? accountScopeKey(account.value) : null,
)

// 現在の dark/light モード。テーマ一覧を該当モードのみに絞る
// (DeckSettingsMenu の themeGrid と同パターン)。
const currentMode = computed<'dark' | 'light'>(() =>
  themeStore.currentSource?.kind.includes('light') ? 'light' : 'dark',
)

// --- Source-tagged theme list ---
type Source = 'default' | 'local' | 'misstore' | 'server'
interface ThemeEntry {
  theme: MisskeyTheme
  source: Source
  removable: boolean
}

/** 紐付け (アカウントの安定キー)。テーマのスコープは紐付け配列だけ */
function installedForOf(t: ThemeItem): string[] {
  return t.scope.kind === 'shared' ? t.scope.installedFor : []
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

/** このカラムに出す本体か: per-account は紐付けに当該アカウント、全アカウントは logged-in のどれか */
function inThisColumn(t: ThemeItem, loggedInKeys: Set<string>): boolean {
  const installedFor = installedForOf(t)
  if (isCrossAccount.value) {
    return installedFor.some((key) => loggedInKeys.has(key))
  }
  return accountKey.value !== null && installedFor.includes(accountKey.value)
}

// インストール済みタブのセクション構成 (出自 3 分類 + サーバー):
//   per-account: サイドロード + ストア配布 (MisStore 由来) + サーバー (admin Branding)
//   cross-account (Global): デフォルト (同梱) + サイドロード + ストア配布 — アプリ全体管理
//
// 「Web UI で選択中のテーマ」(本家 darkTheme/lightTheme Pref) はサーバーに保存
// されないため、NoteDeck 側でも介入しない。ユーザーが MisStore から取り込んだ
// テーマを per-column 適用する UX に集中する。
const themeSections = computed<ThemeSection[]>(() => {
  const mode = currentMode.value
  const sections: ThemeSection[] = []
  const loggedInKeys = new Set(accountsStore.accounts.map(accountScopeKey))

  // 「デフォルト」= 起動時に適用される既定テーマ (Mi Dark / Mi Light、削除/編集不可)。
  //
  // 配布物の同梱は #746 で全廃したが、テーマだけは**ゼロ個が成立しない** —
  // テーマが無いと画面を描画できない。ストアから取ってくるまでの間に適用する
  // ものが要るので、既定値として本体が持つ。配布アイテムではないため「ビルド
  // イン」ではなく「デフォルト」と呼び分ける。全アカウントカラムのみ。
  if (isCrossAccount.value) {
    sections.push({
      key: 'default',
      label: i18n.ts._common.default,
      items: [
        {
          theme: mode === 'dark' ? MI_DARK : MI_LIGHT,
          source: 'default',
          removable: false,
        },
      ],
    })
  }

  const visible = themeStore.items.filter(
    (t) => t.content.base === mode && inThisColumn(t, loggedInKeys),
  )
  sections.push({
    key: 'sideload',
    label: i18n.ts._common.sideload,
    items: visible
      .filter((t) => !t.store)
      .map((t) => ({
        theme: misskeyThemeOf(t),
        source: 'local',
        removable: true,
      })),
  })
  sections.push({
    key: 'store',
    label: i18n.ts._common.storeDistributed,
    items: visible
      .filter((t) => !!t.store)
      .map((t) => ({
        theme: misskeyThemeOf(t),
        source: 'misstore',
        removable: true,
      })),
  })

  if (!isCrossAccount.value && accountId.value) {
    const cached = themeStore.accountThemeCache.get(accountId.value)
    const metaTheme = mode === 'dark' ? cached?.metaDark : cached?.metaLight
    sections.push({
      key: 'server',
      label: i18n.ts._common.server,
      items: metaTheme
        ? [{ theme: metaTheme, source: 'server', removable: false }]
        : [],
    })
  }

  // 0 件のセクションは表示しない
  return sections.filter((s) => s.items.length > 0)
})

const installedTotalCount = computed(() =>
  themeSections.value.reduce((sum, s) => sum + s.items.length, 0),
)

function filteredSections(query: string): ThemeSection[] {
  // 検索クエリが空のときは空セクションもそのまま。検索時のみ非該当セクションを除外
  if (!query) return themeSections.value
  return themeSections.value
    .map((s) => ({
      ...s,
      items: s.items.filter(
        (e) =>
          e.theme.name.toLowerCase().includes(query) ||
          e.theme.id.toLowerCase().includes(query),
      ),
    }))
    .filter((s) => s.items.length > 0)
}

const texts = computed(() => ({
  noMatches: i18n.ts._deckThemeManagerColumn.noMatches,
  empty: i18n.ts._deckThemeManagerColumn.noThemes,
  noLibrary: i18n.ts._deckThemeManagerColumn.noLibraryThemes,
}))

/** ストアも今の明暗に絞る。文字の絞り込みは殻 */
const storeFeed = computed<StoreFeedDecl<StoreThemeEntry>>(() => ({
  entries: misStore.themes.filter((t) => t.base === currentMode.value),
  loading: misStore.themesLoading,
  error: misStore.themesError,
  fetch: () => misStore.fetchThemes(),
  refresh: () => misStore.refreshThemes(),
}))

// --- Library picker (他アカウント向けに入れた / 紐付けの無いテーマをこのアカウントへ) ---
// 全アカウントのカラムは集約表示なので per-account カラムだけに出す

/** このアカウントに未紐付けの本体 (= 追加可能候補)。現在のモードに絞る */
const libraryCandidates = computed<ThemeItem[] | undefined>(() => {
  const key = accountKey.value
  if (isCrossAccount.value || !key) return undefined
  const mode = currentMode.value
  return themeStore.items.filter(
    (t) => t.content.base === mode && !installedForOf(t).includes(key),
  )
})

function placeFromLibrary(theme: ThemeItem): void {
  const key = accountKey.value
  if (!key) return
  void themeStore.linkAccountToTheme(theme.id, key)
}

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
  // を紐付け対象として渡す
  windowsStore.open('themeEditor', {
    initialThemeId: entry.theme.id,
    initialAccountIds: contextAccountIds(),
  })
}

const { confirm } = useConfirm()

/** このカラムのアカウントを外すとテーマ本体ごと消えるか (紐付けが空になる)。 */
function isLastAccountForTheme(theme: MisskeyTheme): boolean {
  const item = themeStore.get(theme.id)
  if (!item) return false
  const installedFor = installedForOf(item)
  if (installedFor.length === 0) return false
  return installedFor.every((key) => key === accountKey.value)
}

/**
 * remove ボタンが本体削除になるか、紐付けを外すだけか (#1048)。
 * per-account カラムからの除去は原則「外す」だが、紐付けが自分だけなら
 * 本体ごと消えるのでゴミ箱表示に落とす (実際の動作とアイコンを一致させる)。
 */
function removeModeOf(entry: ThemeEntry): 'detach' | 'delete' {
  if (isCrossAccount.value || !accountId.value) return 'delete'
  return isLastAccountForTheme(entry.theme) ? 'delete' : 'detach'
}

async function removeTheme(entry: ThemeEntry) {
  if (!isCrossAccount.value && accountId.value) {
    // per-account カラムからの除去は「このアカウントから外す」のみ
    // (紐付けから外し、空になれば完全削除)。同時に accountThemeCache の
    // per-column 適用も解除して meta default にフォールバックさせる。
    //
    // 紐付けが自分だけのときは本体ごと消える。無言で消さず、完全削除と
    // 同じ confirm → 元に戻せるトーストを通す (#988)。外すだけの場合も
    // 他の配布物と同じく undo 付きのトーストで戻せる
    const mode = entry.theme.base ?? 'dark'
    const key = accountKey.value ?? ''
    const deletesBody = isLastAccountForTheme(entry.theme)
    if (deletesBody) {
      const ok = await confirm({
        title: i18n.ts._deckThemeManagerColumn.deleteTitle,
        message: i18n.tsx._deckThemeManagerColumn.deleteLastAccountConfirm({
          name: entry.theme.name,
        }),
        okLabel: i18n.ts._common.delete,
        type: 'danger',
      })
      if (!ok) return
    }
    const undo = await themeStore.unlinkAccountFromTheme(entry.theme.id, key)
    themeStore.clearAccountTheme(mode, accountId.value)
    useToast().show(
      deletesBody
        ? i18n.ts._deckThemeManagerColumn.deleted
        : i18n.ts._deckThemeManagerColumn.detached,
      'info',
      {
        action: {
          label: i18n.ts._common.undo,
          onClick:
            undo ??
            (() => void themeStore.linkAccountToTheme(entry.theme.id, key)),
        },
      },
    )
  } else {
    // cross-account (Global) からは完全削除。他の配布物 (skill / widget /
    // plugin / query) と同じく confirm → 元に戻せるトースト (#988)
    const ok = await confirm({
      title: i18n.ts._deckThemeManagerColumn.deleteTitle,
      message: i18n.tsx._deckThemeManagerColumn.deleteConfirm({
        name: entry.theme.name,
      }),
      okLabel: i18n.ts._common.delete,
      type: 'danger',
    })
    if (!ok) return
    const undo = await themeStore.removeTheme(entry.theme.id)
    if (undo) {
      useToast().show(i18n.ts._deckThemeManagerColumn.deleted, 'info', {
        action: { label: i18n.ts._common.undo, onClick: undo },
      })
    }
  }
}

function openNewTheme() {
  windowsStore.open('themeEditor', {
    initialAccountIds: contextAccountIds(),
  })
}

/**
 * カラムの context (per-account / 全アカウント) に応じた対象アカウントの
 * 内部 ID (per-column 適用キャッシュ用。エディタへ渡す)。
 */
function contextAccountIds(): string[] {
  if (isCrossAccount.value) {
    return accountsStore.accounts.map((a) => a.id)
  }
  return accountId.value ? [accountId.value] : []
}

/** 同じ対象の安定キー (紐付けの値、#1113)。 */
function contextAccountKeys(): string[] {
  if (isCrossAccount.value) {
    return accountsStore.accounts.map(accountScopeKey)
  }
  return accountKey.value ? [accountKey.value] : []
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
  <DeckDistributableColumn
    ref="shell"
    :column="column"
    :title="i18n.ts._columns.themeManager"
    icon="palette"
    :safe-mode-subject="i18n.ts._deckThemeManagerColumn.safeModeSubject"
    :create-title="i18n.ts._deckThemeManagerColumn.createTheme"
    :can-create="true"
    :installed-count="installedTotalCount"
    :search-placeholder="i18n.ts._deckThemeManagerColumn.searchInstalled"
    :library-candidates="libraryCandidates"
    :texts="texts"
    :store="storeFeed"
    store-grid
    @create="openNewTheme"
  >
    <template #installed="{ query }">
      <ColumnSection
        v-for="section in filteredSections(query)"
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
            :remove-mode="removeModeOf(entry)"
            @apply-account="applyToAccount(entry)"
            @apply-global="applyToGlobal(entry)"
            @clear-account="clearForAccount(entry)"
            @edit="editTheme(entry)"
            @remove="removeTheme(entry)"
          />
        </div>
      </ColumnSection>

      <div v-if="filteredSections(query).length === 0" :class="$style.empty">
        <template v-if="query">
          {{ i18n.ts._deckThemeManagerColumn.noMatches }}
        </template>
        <template v-else>
          <i class="ti ti-palette" :class="$style.emptyIcon" />
          <span>{{ i18n.ts._deckThemeManagerColumn.noThemes }}</span>
          <button class="_button" :class="$style.emptyLink" @click="shell?.showTab('store')">
            {{ i18n.ts._deckThemeManagerColumn.installFromStore }}
          </button>
        </template>
      </div>
    </template>

    <template #card="{ item: theme }">
      <ThemeCard
        mode="library"
        :theme="misskeyThemeOf(theme)"
        :source="theme.store ? 'misstore' : 'local'"
        @place="placeFromLibrary(theme)"
      />
    </template>

    <template #store-card="{ entry, run }">
      <ThemeCard
        mode="store"
        :theme="storeEntryToTheme(entry)"
        source="misstore"
        :installing="misStore.installingTheme === entry.id"
        :already-installed="misStore.installedIn('theme', entry)"
        :has-update="misStore.hasThemeUpdate(entry)"
        :updated-at="entry.updatedAt"
        :version="entry.version"
        @install="run(() => misStore.installTheme(entry, contextAccountKeys()))"
        @update="run(() => misStore.updateTheme(entry), i18n.ts._common.updateFailed)"
        @open-detail="openSafeUrl(getThemeDetailUrl(entry.id))"
      />
    </template>
  </DeckDistributableColumn>
</template>

<style module lang="scss">
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  padding: 4px 10px 8px;
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

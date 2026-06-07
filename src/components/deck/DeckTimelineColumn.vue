<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { createQuerySubscription } from '@/adapters/misskey/query'
import type {
  NormalizedNote,
  TimelineFilter,
  TimelineType,
} from '@/adapters/types'
import MkAd from '@/components/common/MkAd.vue'
import { useAds } from '@/composables/useAds'
import type { NoteColumnConfig } from '@/composables/useNoteColumn'
import * as snapshotStore from '@/composables/useSnapshotStore'
import { useTabSlide } from '@/composables/useTabSlide'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import type { CustomTimelineInfo } from '@/utils/customTimelines'
import {
  clearAvailableTlCache,
  clearRuntimeDenied,
  detectAvailableTimelines,
  detectCustomTimelines,
  detectFilterKeys,
  findModeKeyForTimeline,
  getRelatedTimelineTypes,
  markTimelineDenied,
} from '@/utils/customTimelines'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { matchesFilter } from '@/utils/timelineFilter'
import type { ColumnTabDef } from './ColumnTabs.vue'
import ColumnTabs from './ColumnTabs.vue'
import DeckNoteColumn from './DeckNoteColumn.vue'
import TimelineFilterPopup from './TimelineFilterPopup.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const deckStore = useDeckStore()
const accountsStore = useAccountsStore()

// Guest accounts can only access public timelines (local/global), not home/social
const accountData = accountsStore.accountMap.get(props.column.accountId ?? '')
const isGuestAccountForTl = accountData?.hasToken === false
const defaultTl: TimelineType = isGuestAccountForTl ? 'local' : 'home'
const savedTl = props.column.tl
const initialTl: TimelineType =
  isGuestAccountForTl && (savedTl === 'home' || savedTl === 'social')
    ? defaultTl
    : savedTl || defaultTl
const tlType = ref<TimelineType>(initialTl)

// --- Filter ---
const columnFilters = computed<TimelineFilter>(() => props.column.filters ?? {})

function buildTimelineOptions() {
  const filters = columnFilters.value
  const hasFilters = Object.keys(filters).length > 0
  return {
    ...(hasFilters ? { filters } : {}),
  }
}

// --- Connect readiness: wait for policy detection before connecting ---
const connectReady = ref(false)

// --- NoteColumnConfig ---

const noteColumnConfig: NoteColumnConfig = {
  connectReady,
  getColumn: () => props.column,
  fetch: async (adapter, opts) => {
    try {
      return await adapter.api.getTimeline(tlType.value, {
        ...opts,
        ...buildTimelineOptions(),
      })
    } catch (e) {
      // Promote server errors that mean "this tab is unreachable" into
      // runtime-denied state. Both code-form (LTL_DISABLED, GTL_DISABLED,
      // CREDENTIAL_REQUIRED) and the legacy "disabled" substring are honored.
      const errStr = String(e)
      const explicitTarget: TimelineType | null = errStr.includes(
        'LTL_DISABLED',
      )
        ? 'local'
        : errStr.includes('GTL_DISABLED')
          ? 'global'
          : null
      const isUnreachable =
        explicitTarget !== null ||
        errStr.includes('disabled') ||
        errStr.includes('CREDENTIAL_REQUIRED')
      if (isUnreachable) {
        const target = explicitTarget ?? tlType.value
        const aid = props.column.accountId
        // CREDENTIAL_REQUIRED only kills the failing tab; *_DISABLED takes the
        // whole policy group (e.g. local + social share ltlAvailable).
        const related = errStr.includes('CREDENTIAL_REQUIRED')
          ? new Set<string>([target])
          : new Set(getRelatedTimelineTypes(target))
        if (aid) {
          for (const t of related) markTimelineDenied(aid, t)
        }
        availableStandardTl.value = availableStandardTl.value.filter(
          (t) => !related.has(t),
        )
        if (related.has(tlType.value)) {
          switchTl(availableStandardTl.value[0] ?? 'home')
        }
        return []
      }
      throw e
    }
  },
  cache: {
    getKey: () => tlType.value,
  },
  streaming: {
    subscribe: (_adapter, enqueue, callbacks) => {
      // biome-ignore lint/style/noNonNullAssertion: column.accountId は connect ガードで保証
      const accountId = props.column.accountId!
      const type = tlType.value
      return createQuerySubscription({
        open: async () =>
          unwrap(await commands.querySubscribeTimeline(accountId, type, null)),
        onInsert: (item) => {
          const note = item as unknown as NormalizedNote
          if (!matchesFilter(note, columnFilters.value, type)) return
          enqueue(note)
        },
        onDelete: (id) =>
          callbacks.onNoteUpdated?.({
            noteId: id,
            type: 'deleted',
            body: {},
          }),
        onUpdate: (event) => callbacks.onNoteUpdated?.(event),
      })
    },
  },
  filterCachedNotes: (cached) =>
    cached.filter((n) => matchesFilter(n, columnFilters.value, tlType.value)),
}

// --- DeckNoteColumn ref (expose: account, scroller, reconnect, switchWithSnapshot, notes, columnThemeVars) ---
const noteColumnRef = ref<InstanceType<typeof DeckNoteColumn> | null>(null)

// Report visible items to deckStore so AI / inspector / audit log can read them
// without special-casing AI columns (memory feedback_no_special_case_columns).
watch(
  () => noteColumnRef.value?.notes as NormalizedNote[] | undefined,
  (notes) => {
    deckStore.reportVisibleItems(props.column.id, notes ?? [])
  },
  { immediate: true },
)
const account = computed(() => noteColumnRef.value?.account)
const columnThemeVars = computed(
  () => noteColumnRef.value?.columnThemeVars ?? {},
)
const swipeTarget = computed<HTMLElement | null>(
  () => (noteColumnRef.value?.scroller as HTMLElement | undefined) ?? null,
)

async function reconnect(useCache = false) {
  await noteColumnRef.value?.reconnect(useCache)
}

// --- Ads ---
const { fetchAds, pickAd, shouldShowAd, muteAd, serverHost } = useAds(
  () => props.column.accountId ?? undefined,
)

// --- TL type definitions ---
const TL_TYPES: { value: TimelineType; label: string }[] = [
  { value: 'home', label: 'ホーム' },
  { value: 'local', label: 'ローカル' },
  { value: 'social', label: 'ソーシャル' },
  { value: 'global', label: 'グローバル' },
]

const TL_ICONS: Record<TimelineType, string> = {
  home: 'home',
  local: 'planet',
  social: 'rocket',
  global: 'whirl',
}

function isTablerIcon(icon: string): boolean {
  return !icon.includes(' ')
}

const currentTlIcon = computed(
  () => TL_ICONS[tlType.value] ?? customTlIcon.value ?? 'home',
)

// --- Custom timelines ---
const customTimelines = ref<CustomTimelineInfo[]>([])
const availableStandardTl = ref<string[]>([])
const customTlIcon = computed(() => {
  const ct = customTimelines.value.find((t) => t.type === tlType.value)
  return ct?.icon
})

// --- Mode state (per-account, per-TL) ---
const tlModes = ref<Record<string, boolean>>({})
const policyLoaded = ref(false)

const allTlTypes = computed(() => {
  if (!connectReady.value) return [] // Policy detection not yet complete
  if (!policyLoaded.value) return TL_TYPES.map((t) => t) // No account — show all
  const allowed = availableStandardTl.value
  if (allowed.length === 0) {
    // Policies loaded but nothing available. Guests have no home/social, so
    // returning empty is the only honest answer; authenticated users fall
    // back to home as a last resort.
    if (isGuestAccountForTl) return []
    return TL_TYPES.filter((t) => t.value === 'home')
  }
  const allowedSet = new Set(allowed)
  const standard = TL_TYPES.filter((t) => allowedSet.has(t.value))
  for (const ct of customTimelines.value) {
    if (allowedSet.has(ct.type)) {
      standard.push({ value: ct.type, label: ct.label })
    }
  }
  return standard
})

// Tab slide animation
const tlTabIndex = computed(() => {
  const types = allTlTypes.value
  return types.findIndex((t) => t.value === tlType.value)
})
useTabSlide(tlTabIndex, swipeTarget)

function getTlIcon(type: string): string {
  if (TL_ICONS[type]) return TL_ICONS[type]
  const ct = customTimelines.value.find((t) => t.type === type)
  return ct?.icon ?? TL_ICONS.home ?? ''
}

// --- Filter UI ---
const showFilterMenu = ref(false)
const filterBtnRef = ref<HTMLButtonElement | null>(null)
const filterPopupPos = ref({ top: 0, left: 0 })
const availableFilterKeys = ref<(keyof TimelineFilter)[]>([])

async function refreshFilterKeys() {
  const host = account.value?.host
  if (!host) {
    availableFilterKeys.value = []
    return
  }
  availableFilterKeys.value = await detectFilterKeys(host, tlType.value)
}

const hasActiveFilter = computed(() => {
  const f = columnFilters.value
  return Object.values(f).some((v) => v !== undefined)
})

function toggleFilterMenu() {
  showFilterMenu.value = !showFilterMenu.value
  if (showFilterMenu.value) {
    nextTick(() => {
      const btn = filterBtnRef.value
      if (btn) {
        const rect = btn.getBoundingClientRect()
        filterPopupPos.value = {
          top: rect.bottom + 4,
          left: Math.max(8, rect.right - 220),
        }
      }
    })
  }
}

function toggleFilter(key: keyof TimelineFilter) {
  const current = columnFilters.value[key]
  const next = { ...columnFilters.value }
  if (key === 'withFiles') {
    next[key] = current === true ? undefined : true
  } else {
    next[key] = current === false ? undefined : false
  }
  for (const k of Object.keys(next) as (keyof TimelineFilter)[]) {
    if (next[k] === undefined) delete next[k]
  }
  deckStore.updateColumn(props.column.id, {
    filters: Object.keys(next).length > 0 ? next : undefined,
  })
  reconnect()
}

// --- Tab defs for ColumnTabs ---
const tabDefs = computed<ColumnTabDef[]>(() =>
  allTlTypes.value.map((opt) => {
    const icon = getTlIcon(opt.value)
    return {
      value: opt.value,
      label: opt.label,
      icon,
      iconIsSvg: !isTablerIcon(icon),
    }
  }),
)

// --- TL switching ---

function onTabChange(value: string) {
  switchTl(value as TimelineType)
}

async function switchTl(type: TimelineType) {
  if (type === tlType.value) return

  // Save current tab snapshot via unified SnapshotStore.
  // unfiltered な orderedIds を保存（ミュート等の可視性を焼き込まない / #574）
  const col = noteColumnRef.value
  if (col) {
    snapshotStore.save(
      props.column.id,
      tlType.value,
      ((col.orderedIds as string[] | undefined) ?? []).slice(),
      (col.scroller as HTMLElement | undefined)?.scrollTop ?? 0,
    )
  }

  tlType.value = type
  deckStore.updateColumn(props.column.id, { tl: type })
  refreshFilterKeys()

  // Restore snapshot if available, otherwise full reconnect
  const snapshot = snapshotStore.restore(props.column.id, type)
  if (snapshot && snapshot.notes.length > 0) {
    await col?.switchWithSnapshot(snapshot.notes, snapshot.scrollTop)
  } else {
    await reconnect(true)
  }
}

// --- Policies ---

async function applyPolicies(accountId: string, host: string) {
  const [ct, availability] = await Promise.all([
    detectCustomTimelines(host),
    detectAvailableTimelines(accountId),
  ])
  customTimelines.value = ct.filter((c) => {
    if (!availability.denied.has(c.type)) return true
    const modeKey = findModeKeyForTimeline(c.type, availability.modes)
    return modeKey != null && availability.modes[modeKey] === true
  })
  availableStandardTl.value = [
    ...availability.available,
    ...customTimelines.value.map((c) => c.type),
  ]
  tlModes.value = availability.modes
  policyLoaded.value = true
}

async function refreshPolicies() {
  const accountId = props.column.accountId
  const host =
    account.value?.host ?? accountsStore.accountMap.get(accountId ?? '')?.host
  if (!accountId || !host) return
  clearAvailableTlCache(accountId)
  await applyPolicies(accountId, host)
}

// --- Mode version watch (per-account: only react to this column's account) ---
watch(
  () => {
    const aid = props.column.accountId
    return aid ? accountsStore.getModeVersion(aid) : -1
  },
  async () => {
    const accountId = props.column.accountId
    if (accountId) clearRuntimeDenied(accountId)
    await refreshPolicies()
    if (!availableStandardTl.value.includes(tlType.value)) {
      switchTl(availableStandardTl.value[0] ?? 'local')
    } else {
      await reconnect()
    }
  },
)

// --- Startup: detect policies and custom TLs ---
onMounted(async () => {
  const accountId = props.column.accountId

  // Wait for accounts to load so accountMap is populated.
  // Without this, host is undefined in production (Tauri IPC is slower),
  // which skips the policy check and connects with an unauthorized TL type.
  if (!accountsStore.isLoaded) {
    await accountsStore.loadAccounts()
  }

  const host = accountId
    ? accountsStore.accountMap.get(accountId)?.host
    : undefined
  fetchAds()
  try {
    if (host && accountId) {
      await Promise.all([applyPolicies(accountId, host), refreshFilterKeys()])
      if (availableStandardTl.value.length === 0) {
        // Nothing reachable for this account (e.g. guest on a closed server).
        // Leave connectReady=false so useNoteColumn doesn't fire a doomed fetch.
        return
      }
      if (!availableStandardTl.value.includes(tlType.value)) {
        // Only update tlType synchronously here — full reconnect will happen
        // via connectReady watcher in useNoteColumn, avoiding a double-connect race.
        const fallback = availableStandardTl.value[0] ?? 'local'
        tlType.value = fallback
        deckStore.updateColumn(props.column.id, { tl: fallback })
      }
    }
  } catch (e) {
    // Policy detection failed — show all tabs as fallback so the column
    // remains usable. Individual tabs will be removed at runtime if disabled.
    console.warn('[DeckTimelineColumn] policy detection failed:', e)
  }
  connectReady.value = true
})
</script>

<template>
  <DeckNoteColumn
    ref="noteColumnRef"
    :column="column"
    title="タイムライン"
    icon="ti-home"
    sound-enabled
    show-empty-cta
    :note-column-config="noteColumnConfig"
  >
    <template #header-icon>
      <span :class="$style.tlHeaderIconWrap">
        <i v-if="isTablerIcon(currentTlIcon)" :class="['ti ti-' + currentTlIcon, $style.tlHeaderIcon]" />
        <svg v-else :class="$style.tlHeaderIcon" viewBox="0 0 24 24" width="14" height="14">
          <path :d="currentTlIcon" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
        </svg>
      </span>
    </template>

    <template #header-extra>
      <ColumnTabs
        :tabs="tabDefs"
        :model-value="tlType"
        :swipe-target="swipeTarget"
        compact
        @update:model-value="onTabChange"
      >
        <template v-if="availableFilterKeys.length > 0" #trailing>
          <button
            ref="filterBtnRef"
            class="_button"
            :class="[$style.tlFilterBtn, { [$style.active]: hasActiveFilter }]"
            title="フィルター"
            @click.stop="toggleFilterMenu"
          >
            <i class="ti ti-filter" />
          </button>
        </template>
      </ColumnTabs>
    </template>

    <template #note-item="{ index }">
      <MkAd v-if="shouldShowAd(index)" :ad="pickAd(index)!" :server-host="serverHost" @mute="muteAd" />
    </template>
  </DeckNoteColumn>

  <TimelineFilterPopup
    :show="showFilterMenu"
    :filter-keys="availableFilterKeys"
    :filters="columnFilters"
    :position="filterPopupPos"
    :theme-vars="columnThemeVars"
    @close="showFilterMenu = false"
    @toggle="toggleFilter"
  />
</template>

<style lang="scss" module>
@use './column-common.module.scss';

.tlFilterBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  padding: 8px 12px;
  opacity: 0.5;
  color: var(--nd-fg);
  transition:
    opacity var(--nd-duration-base),
    background var(--nd-duration-base),
    color var(--nd-duration-base);

  &:hover {
    opacity: 0.8;
    background: var(--nd-buttonHoverBg);
  }

  &.active {
    opacity: 1;
    color: var(--nd-accent);
  }
}

.tlHeaderIconWrap {
  display: inline-flex;
  align-items: center;
}

/* tlHeaderIcon は column-common.module.scss から継承、font-size のみ拡張 */
.tlHeaderIcon {
  font-size: 14px;
}
</style>

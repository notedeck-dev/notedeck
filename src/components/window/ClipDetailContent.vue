<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import type { NormalizedNote, ServerAdapter } from '@/adapters/types'
import type { Clip } from '@/bindings'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkNote from '@/components/common/MkNote.vue'
import { usePaginatedList } from '@/composables/usePaginatedList'
import { useWindowExternalLink } from '@/composables/useWindowExternalLink'
import { useAccountsStore } from '@/stores/accounts'
import { useToast } from '@/stores/toast'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { webUiUrl } from '@/utils/url'

const props = defineProps<{
  accountId: string
  clipId: string
}>()

const accountsStore = useAccountsStore()
const toast = useToast()

const account = computed(() =>
  accountsStore.accounts.find((a) => a.id === props.accountId),
)

const clip = ref<Clip | null>(null)
const clipError = ref<string | null>(null)
const clipLoading = ref(true)

const NOTES_PAGE_SIZE = 20

let adapter: ServerAdapter | null = null

const {
  items: notes,
  isLoading: notesLoading,
  error: notesError,
  load: loadNotes,
  loadMore: loadMoreNotes,
} = usePaginatedList<NormalizedNote>({
  fetch: (untilId) =>
    adapter
      ? adapter.api.getClipNotes(props.clipId, {
          limit: NOTES_PAGE_SIZE,
          untilId,
        })
      : Promise.resolve([]),
  pageSize: NOTES_PAGE_SIZE,
})

const isOwnClip = computed(
  () => !!clip.value && clip.value.userId === account.value?.userId,
)

const clipWebUrl = computed(() => {
  if (!clip.value || !account.value?.host) return undefined
  return webUiUrl(account.value.host, `/clips/${clip.value.id}`)
})

useWindowExternalLink(() =>
  clipWebUrl.value ? { url: clipWebUrl.value } : null,
)

async function loadClip() {
  clipLoading.value = true
  clipError.value = null
  try {
    clip.value = unwrap(
      await commands.apiGetClip(props.accountId, { clipId: props.clipId }),
    )
  } catch (e) {
    clipError.value = AppError.from(e).message
  } finally {
    clipLoading.value = false
  }
}

let lastScrollCheck = 0
function onScroll(e: Event) {
  const now = Date.now()
  if (now - lastScrollCheck < 200) return
  lastScrollCheck = now
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
    loadMoreNotes()
  }
}

const togglingFavorite = ref(false)
async function toggleFavorite() {
  if (!clip.value || isOwnClip.value || togglingFavorite.value) return
  togglingFavorite.value = true
  const wasFav = clip.value.isFavorited === true
  try {
    const params = { clipId: clip.value.id }
    unwrap(
      wasFav
        ? await commands.apiUnfavoriteClip(props.accountId, params)
        : await commands.apiFavoriteClip(props.accountId, params),
    )
    clip.value.isFavorited = !wasFav
    clip.value.favoritedCount += wasFav ? -1 : 1
  } catch (e) {
    toast.show(
      `お気に入り操作に失敗しました（${AppError.from(e).displayCode}）`,
      'error',
    )
  } finally {
    togglingFavorite.value = false
  }
}

onMounted(async () => {
  const acc = accountsStore.accounts.find((a) => a.id === props.accountId)
  if (!acc) {
    clipError.value = 'アカウントが見つかりません'
    clipLoading.value = false
    return
  }
  try {
    const result = await initAdapterFor(acc.host, acc.id, {
      pinnedReactions: false,
      hasToken: acc.hasToken,
    })
    adapter = result.adapter
  } catch (e) {
    clipError.value = AppError.from(e).message
    clipLoading.value = false
    return
  }
  await Promise.all([loadClip(), loadNotes()])
})
</script>

<template>
  <div :class="$style.root" @scroll="onScroll">
    <div v-if="clipLoading" :class="$style.loading"><LoadingSpinner /></div>
    <ColumnEmptyState v-else-if="clipError" :message="clipError" is-error />
    <template v-else-if="clip">
      <div :class="$style.header">
        <div :class="$style.titleRow">
          <i
            v-if="!clip.isPublic"
            class="ti ti-lock"
            :class="$style.privateIcon"
            title="非公開"
          />
          <div :class="$style.title">{{ clip.name }}</div>
        </div>
        <div v-if="clip.description" :class="$style.description">{{ clip.description }}</div>
        <div :class="$style.meta">
          <span v-if="clip.user">
            <i class="ti ti-user" />
            @{{ clip.user.username }}{{ clip.user.host ? `@${clip.user.host}` : '' }}
          </span>
          <button
            v-if="!isOwnClip"
            class="_button"
            :class="[$style.favBtn, { [$style.favActive]: clip.isFavorited }]"
            :disabled="togglingFavorite"
            @click="toggleFavorite"
          >
            <i :class="clip.isFavorited ? 'ti ti-star-filled' : 'ti ti-star'" />
            {{ clip.favoritedCount }}
          </button>
          <span v-else :class="$style.favCount">
            <i class="ti ti-star" />
            {{ clip.favoritedCount }}
          </span>
        </div>
      </div>

      <div :class="$style.notes">
        <MkNote
          v-for="note in notes"
          :key="note.id"
          :note="note"
          :account-id="accountId"
        />
        <div v-if="notesLoading" :class="$style.notesLoading">
          <LoadingSpinner />
        </div>
        <ColumnEmptyState
          v-else-if="notesError"
          :message="notesError"
          is-error
        />
        <ColumnEmptyState
          v-else-if="notes.length === 0"
          message="クリップにノートがありません"
        />
      </div>
    </template>
  </div>
</template>

<style lang="scss" module>
.root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}

.loading,
.notesLoading {
  padding: 24px;
  text-align: center;
  opacity: 0.7;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px 16px 12px;
  border-bottom: 1px solid var(--nd-divider);
}

.titleRow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.privateIcon {
  font-size: 0.95em;
  opacity: 0.7;
}

.title {
  font-size: 1.2em;
  font-weight: bold;
  color: var(--nd-fgHighlighted);
}

.description {
  font-size: 0.9em;
  opacity: 0.8;
  white-space: pre-wrap;
  line-height: 1.5;
}

.meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.8em;
  opacity: 0.7;
}

.favBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--nd-radius-full);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: 0.95em;
  transition: background var(--nd-duration-base);

  &:hover:not(:disabled) {
    background: var(--nd-buttonHoverBg);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}

.favActive {
  color: var(--nd-warn, #f0a020);
}

.favCount {
  display: flex;
  align-items: center;
  gap: 4px;
}

.notes {
  display: flex;
  flex-direction: column;
}
</style>
